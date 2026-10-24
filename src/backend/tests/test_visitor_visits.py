import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

from fastapi import HTTPException

from app.db.collections import VISITOR_VISITS
from app.routers.visitors import clear_itinerary, delete_visit
from app.stores import visitor_visit_store


class FakeCollection:
    def __init__(self):
        self.indexes = []
        self.visits = set()
        self.documents = []

    async def create_index(self, keys, **options):
        self.indexes.append((keys, options))

    def find(self, query, projection):
        filtered = [
            {key: value for key, value in visit.items() if projection.get(key) != 0}
            for visit in self.documents
            if all(visit.get(key) == value for key, value in query.items())
        ]
        return FakeCursor(filtered)

    async def count_documents(self, query):
        return sum(all(visit.get(key) == value for key, value in query.items()) for visit in self.documents)

    async def find_one_and_update(self, query, update, **options):
        visit = next(
            (
                item
                for item in self.documents
                if all(item.get(key) == value for key, value in query.items())
            ),
            None,
        )
        if visit is None:
            return None
        visit.update(update.get("$set", {}))
        for key in update.get("$unset", {}):
            visit.pop(key, None)
        return dict(visit)

    async def delete_one(self, query):
        visit_id = query["visit_id"]
        deleted = visit_id in self.visits
        self.visits.discard(visit_id)
        return SimpleNamespace(deleted_count=int(deleted))


class FakeCursor:
    def __init__(self, documents):
        self.documents = documents

    def sort(self, field, direction):
        self.documents.sort(key=lambda item: item[field], reverse=direction < 0)
        return self

    def skip(self, offset):
        self.documents = self.documents[offset:]
        return self

    def limit(self, limit):
        self.documents = self.documents[:limit]
        return self

    async def to_list(self, length):
        return self.documents[:length]


class FakeDatabase:
    def __init__(self):
        self.collection = FakeCollection()

    def __getitem__(self, name):
        if name != VISITOR_VISITS:
            raise KeyError(name)
        return self.collection


class VisitorVisitStoreTests(unittest.IsolatedAsyncioTestCase):
    async def test_indexes_configure_ninety_day_retention(self):
        db = FakeDatabase()

        await visitor_visit_store.ensure_indexes(db)

        retention_index = next(
            options for keys, options in db.collection.indexes if options.get("name") == "visitor_visit_retention_ttl"
        )
        self.assertEqual(retention_index["expireAfterSeconds"], 90 * 24 * 60 * 60)

    async def test_delete_by_visit_id_only_deletes_matching_visit(self):
        db = FakeDatabase()
        visit_id = str(uuid4())
        db.collection.visits.add(visit_id)

        self.assertTrue(await visitor_visit_store.delete_by_visit_id(db, visit_id))
        self.assertFalse(await visitor_visit_store.delete_by_visit_id(db, visit_id))

    async def test_delete_endpoint_returns_not_found_for_unknown_visit(self):
        db = FakeDatabase()
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=db)))

        with self.assertRaises(HTTPException) as raised:
            await delete_visit(uuid4(), request)

        self.assertEqual(raised.exception.status_code, 404)

    async def test_delete_endpoint_confirms_removed_visit(self):
        db = FakeDatabase()
        visit_id = uuid4()
        db.collection.visits.add(str(visit_id))
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=db)))

        self.assertEqual(await delete_visit(visit_id, request), {"deleted": True})

    async def test_clear_itinerary_removes_saved_route_without_deleting_visit(self):
        db = FakeDatabase()
        visit_id = str(uuid4())
        db.collection.documents.append({
            "visit_id": visit_id,
            "poi_id": "poi-a",
            "saved_itinerary": {"poi_ids": ["south", "north"]},
        })
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=db)))

        visit = await visitor_visit_store.clear_itinerary(db, visit_id=visit_id)

        self.assertIsNotNone(visit)
        self.assertNotIn("saved_itinerary", visit)
        self.assertEqual(len(db.collection.documents), 1)

    async def test_clear_itinerary_endpoint_returns_not_found_for_unknown_visit(self):
        db = FakeDatabase()
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=db)))

        with self.assertRaises(HTTPException) as raised:
            await clear_itinerary(uuid4(), request)

        self.assertEqual(raised.exception.status_code, 404)

    async def test_clear_itinerary_endpoint_preserves_visit_record(self):
        db = FakeDatabase()
        visit_id = uuid4()
        db.collection.documents.append({
            "visit_id": str(visit_id),
            "poi_id": "poi-a",
            "status": "inside",
            "entered_at": datetime.now(timezone.utc),
            "saved_itinerary": {"poi_ids": ["south"]},
        })
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=db)))

        response = await clear_itinerary(visit_id, request)

        self.assertIsNone(response["saved_itinerary"])
        self.assertEqual(response["status"], "inside")
        self.assertEqual(len(db.collection.documents), 1)

    async def test_list_visits_filters_and_paginates_newest_first(self):
        db = FakeDatabase()
        db.collection.documents = [
            {"visit_id": "old", "poi_id": "poi-a", "entered_at": 1, "_id": "mongo-1"},
            {"visit_id": "new", "poi_id": "poi-a", "entered_at": 3, "_id": "mongo-2"},
            {"visit_id": "other", "poi_id": "poi-b", "entered_at": 2, "_id": "mongo-3"},
        ]

        visits, total = await visitor_visit_store.list_visits(db, limit=1, offset=1, poi_id="poi-a")

        self.assertEqual(total, 2)
        self.assertEqual([visit["visit_id"] for visit in visits], ["old"])
        self.assertNotIn("_id", visits[0])

    async def test_geofence_checkout_records_method_without_coordinates(self):
        db = FakeDatabase()
        visit_id = str(uuid4())
        db.collection.documents.append({"visit_id": visit_id, "status": "inside"})

        visit = await visitor_visit_store.check_out(
            db,
            visit_id=visit_id,
            at=datetime.now(timezone.utc),
            exit_method="geofence",
        )

        self.assertEqual(visit["exit_method"], "geofence")
        self.assertNotIn("latitude", visit)
        self.assertNotIn("longitude", visit)
