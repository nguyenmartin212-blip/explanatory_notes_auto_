"""Lifecycle / sync / nearby tests using in-memory fake stores."""

import unittest
from datetime import datetime, timedelta, timezone

from app.core.errors import ConflictError, NotFoundError, NotReadyError
from app.schemas.content import PoiCreate, PoiUpdate
from app.services import content_service as svc
from app.services import poi_nearby, poi_sync
from tests.fakes import install

HANOI = (21.0353, 105.8402)
NEAR_HANOI = (21.0360, 105.8405)  # ~85 m away
HUE = (16.4690, 107.5788)


def loc(name, description="Mô tả", tts=None):
    return {"name": name, "description": description, "tts_script": tts}


def poi_data(poi_id="hanoi-thang-long", coords=HANOI, locs=None, **extra):
    return PoiCreate(
        poi_id=poi_id,
        latitude=coords[0],
        longitude=coords[1],
        localizations=locs if locs is not None else {"vi": loc("Thăng Long"), "en": loc("Thang Long", "Citadel")},
        **extra,
    )


class Base(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.w, ctx = install(self)
        self.db, self.settings = ctx.db, ctx.settings

    async def create(self, **kw):
        return await svc.create_poi(self.db, self.settings, poi_data(**kw))

    async def make_ready(self, poi_id="hanoi-thang-long", path="audio/a.mp3"):
        """Complete English audio for the current text."""
        h = self.w.locs[(poi_id, "en")]["content_hash"]
        return await svc.complete_audio(
            self.db, self.settings, poi_id=poi_id, language="en", content_hash=h,
            audio_path=path, audio_url="/static/" + path,
        )

    async def create_active(self, **kw):
        poi_id = kw.get("poi_id", "hanoi-thang-long")
        await self.create(**kw)
        await self.make_ready(poi_id, f"audio/{poi_id}-en.mp3")
        return await svc.activate_poi(self.db, poi_id)

    async def load(self, **kw):
        return await poi_sync.load_all(self.db, **kw)


class CreateTests(Base):
    async def test_create_is_draft_queues_audio_and_is_not_public(self):
        view = await self.create()
        self.assertEqual(view["status"], "draft")
        self.assertEqual(view["radius_meters"], 80)
        self.assertEqual({(p, l) for p, l, _ in self.w.enqueued}, {("hanoi-thang-long", "vi"), ("hanoi-thang-long", "en")})
        self.assertEqual(view["localizations"]["en"]["audio_status"], "pending")
        self.assertEqual(self.w.version, 0)
        self.assertEqual((await self.load())["pois"], [])

    async def test_duplicate_id_conflicts(self):
        await self.create()
        with self.assertRaises(ConflictError):
            await self.create()

    async def test_generated_id_when_missing(self):
        view = await svc.create_poi(self.db, self.settings, PoiCreate(latitude=1, longitude=2))
        self.assertTrue(view["poi_id"].startswith("poi-"))
        self.assertEqual(self.w.enqueued, [])  # no text -> no audio task


class ActivationTests(Base):
    async def test_requires_english_content_then_english_audio(self):
        await self.create(locs={"vi": loc("Thăng Long")})
        with self.assertRaises(NotReadyError) as ctx:
            await svc.activate_poi(self.db, "hanoi-thang-long")
        self.assertEqual(ctx.exception.report["missing"], ["en_content"])

        await svc.update_poi(self.db, self.settings, "hanoi-thang-long",
                             PoiUpdate(localizations={"en": loc("Thang Long", "Citadel")}))
        with self.assertRaises(NotReadyError) as ctx:
            await svc.activate_poi(self.db, "hanoi-thang-long")
        self.assertEqual(ctx.exception.report["missing"], ["en_audio"])
        self.assertEqual(self.w.version, 0)

        await self.make_ready()
        view = await svc.activate_poi(self.db, "hanoi-thang-long")
        self.assertEqual(view["status"], "active")
        self.assertEqual(self.w.version, 1)
        self.assertEqual(view["dataset_version"], 1)
        self.assertEqual([p["poi_id"] for p in (await self.load())["pois"]], ["hanoi-thang-long"])

    async def test_activate_is_idempotent_and_unknown_poi_not_found(self):
        await self.create_active()
        await svc.activate_poi(self.db, "hanoi-thang-long")
        self.assertEqual(self.w.version, 1)
        with self.assertRaises(NotFoundError):
            await svc.activate_poi(self.db, "missing-poi")


class AudioHandlingTests(Base):
    async def test_stale_audio_result_is_discarded(self):
        await self.create()
        old_hash = self.w.locs[("hanoi-thang-long", "en")]["content_hash"]
        await svc.update_poi(self.db, self.settings, "hanoi-thang-long",
                             PoiUpdate(localizations={"en": loc("Thang Long", "A new description")}))
        ok = await svc.complete_audio(self.db, self.settings, poi_id="hanoi-thang-long", language="en",
                                      content_hash=old_hash, audio_path="audio/old.mp3", audio_url="u")
        self.assertFalse(ok)
        self.assertIn("audio/old.mp3", self.w.deleted_files)
        self.assertEqual(self.w.locs[("hanoi-thang-long", "en")]["audio_status"], "pending")

    async def test_audio_for_deleted_poi_is_discarded(self):
        await self.create()
        h = self.w.locs[("hanoi-thang-long", "en")]["content_hash"]
        await svc.delete_poi(self.db, self.settings, "hanoi-thang-long")
        ok = await svc.complete_audio(self.db, self.settings, poi_id="hanoi-thang-long", language="en",
                                      content_hash=h, audio_path="audio/late.mp3", audio_url="u")
        self.assertFalse(ok)
        self.assertIn("audio/late.mp3", self.w.deleted_files)

    async def test_text_change_on_draft_drops_old_audio_without_version_bump(self):
        await self.create()
        await self.make_ready(path="audio/v1.mp3")
        self.w.enqueued.clear()
        view = await svc.update_poi(self.db, self.settings, "hanoi-thang-long",
                                    PoiUpdate(localizations={"en": loc("Thang Long", "Changed text")}))
        self.assertEqual(view["localizations"]["en"]["audio_status"], "pending")
        self.assertIsNone(view["localizations"]["en"]["audio_url"])
        self.assertIn("audio/v1.mp3", self.w.deleted_files)
        self.assertEqual([(p, l) for p, l, _ in self.w.enqueued], [("hanoi-thang-long", "en")])
        self.assertEqual(self.w.version, 0)

    async def test_text_change_on_active_poi_bumps_version_and_hides_old_audio(self):
        await self.create_active()
        self.assertEqual(self.w.version, 1)
        await svc.update_poi(self.db, self.settings, "hanoi-thang-long",
                             PoiUpdate(localizations={"en": loc("Thang Long", "Changed text")}))
        self.assertEqual(self.w.version, 2)
        public = (await self.load())["pois"][0]
        self.assertIsNone(public["localizations"]["en"]["audio_url"])
        # POI stays public while its audio is regenerated; new audio bumps again.
        await self.make_ready(path="audio/v2.mp3")
        self.assertEqual(self.w.version, 3)
        public = (await self.load())["pois"][0]
        self.assertEqual(public["localizations"]["en"]["audio_url"], "/static/audio/v2.mp3")
        self.assertIn("audio/hanoi-thang-long-en.mp3", self.w.deleted_files)

    async def test_update_without_text_change_keeps_audio_and_does_not_requeue(self):
        await self.create_active()
        self.w.enqueued.clear()
        # Same description/tts, new name: audio text is the same -> audio is kept.
        view = await svc.update_poi(self.db, self.settings, "hanoi-thang-long",
                                    PoiUpdate(localizations={"en": loc("Thang Long Citadel", "Citadel")}))
        self.assertEqual(view["localizations"]["en"]["audio_status"], "ready")
        self.assertEqual(self.w.enqueued, [])
        self.assertEqual(self.w.version, 2)  # the name change is visible to clients

    async def test_identical_update_does_not_bump_version(self):
        await self.create_active()
        await svc.update_poi(self.db, self.settings, "hanoi-thang-long", PoiUpdate(radius_meters=80))
        await svc.update_poi(self.db, self.settings, "hanoi-thang-long",
                             PoiUpdate(localizations={"en": loc("Thang Long", "Citadel")}))
        self.assertEqual(self.w.version, 1)
        await svc.update_poi(self.db, self.settings, "hanoi-thang-long", PoiUpdate(radius_meters=75))
        self.assertEqual(self.w.version, 2)

    async def test_failed_audio_is_retried_on_next_update(self):
        await self.create()
        h = self.w.locs[("hanoi-thang-long", "en")]["content_hash"]
        await svc.fail_audio(self.db, poi_id="hanoi-thang-long", language="en", content_hash=h, error="tts down")
        self.assertEqual(self.w.locs[("hanoi-thang-long", "en")]["audio_status"], "failed")
        self.w.enqueued.clear()
        await svc.update_poi(self.db, self.settings, "hanoi-thang-long",
                             PoiUpdate(localizations={"en": loc("Thang Long", "Citadel")}))
        self.assertEqual([(p, l) for p, l, _ in self.w.enqueued], [("hanoi-thang-long", "en")])


class DeleteTests(Base):
    async def test_delete_public_poi_cleans_everything_and_leaves_tombstone(self):
        await self.create_active()
        await svc.delete_poi(self.db, self.settings, "hanoi-thang-long")
        self.assertEqual(self.w.pois, {})
        self.assertEqual(self.w.locs, {})
        self.assertEqual(self.w.tasks, {})
        self.assertIn("audio/hanoi-thang-long-en.mp3", self.w.deleted_files)
        self.assertEqual(self.w.version, 2)
        self.assertIn("hanoi-thang-long", self.w.tombstones)

    async def test_delete_draft_has_no_public_effect(self):
        await self.create()
        await svc.delete_poi(self.db, self.settings, "hanoi-thang-long")
        self.assertEqual(self.w.version, 0)
        self.assertEqual(self.w.tombstones, {})
        with self.assertRaises(NotFoundError):
            await svc.delete_poi(self.db, self.settings, "hanoi-thang-long")


class SyncTests(Base):
    async def test_full_sync_shape(self):
        await self.create_active()
        r = await self.load(lang="zh")
        self.assertEqual((r["sync_mode"], r["dataset_version"], r["removed_poi_ids"]), ("full", 1, []))
        self.assertEqual(poi_sync.decode_cursor(r["sync_cursor"]), 1)
        poi = r["pois"][0]
        self.assertEqual(poi["content"]["language_served"], "en")  # zh missing -> English
        self.assertTrue(poi["content"]["fallback"])
        self.assertEqual(poi["localizations"]["en"]["audio_url"], "/static/audio/hanoi-thang-long-en.mp3")
        self.assertEqual((poi["latitude"], poi["longitude"]), HANOI)

    async def test_delta_returns_only_changes_and_removed_ids(self):
        await self.create_active(poi_id="poi-a")
        await self.create_active(poi_id="poi-b", coords=HUE)
        await self.create_active(poi_id="poi-c", coords=NEAR_HANOI)
        cursor = (await self.load())["sync_cursor"]

        r = await self.load(sync_cursor=cursor)
        self.assertEqual((r["sync_mode"], r["pois"], r["removed_poi_ids"]), ("delta", [], []))

        await svc.update_poi(self.db, self.settings, "poi-a", PoiUpdate(priority=5))
        await svc.delete_poi(self.db, self.settings, "poi-b")
        r = await self.load(sync_cursor=cursor)
        self.assertEqual(r["sync_mode"], "delta")
        self.assertEqual([p["poi_id"] for p in r["pois"]], ["poi-a"])
        self.assertEqual(r["removed_poi_ids"], ["poi-b"])
        self.assertEqual(r["pois"][0]["priority"], 5)

        # Advancing the cursor leaves nothing to send.
        r2 = await self.load(sync_cursor=r["sync_cursor"])
        self.assertEqual((r2["pois"], r2["removed_poi_ids"]), ([], []))

    async def test_invalid_future_or_forced_full_cursor_gives_full_sync(self):
        await self.create_active()
        for kwargs in (
            {"sync_cursor": "garbage"},
            {"sync_cursor": poi_sync.encode_cursor(99)},
            {"sync_cursor": poi_sync.encode_cursor(1), "sync_mode": "full"},
            {"sync_mode": "delta"},
        ):
            r = await self.load(**kwargs)
            self.assertEqual(r["sync_mode"], "full", kwargs)
            self.assertEqual(len(r["pois"]), 1)

    async def test_updated_after_delta(self):
        await self.create_active(poi_id="poi-a")
        await self.create_active(poi_id="poi-b", coords=HUE)
        long_ago = datetime(2000, 1, 1, tzinfo=timezone.utc)
        future = datetime.now(timezone.utc) + timedelta(hours=1)

        r = await self.load(updated_after=long_ago)
        self.assertEqual((r["sync_mode"], len(r["pois"])), ("delta", 2))
        r = await self.load(updated_after=future)
        self.assertEqual((r["sync_mode"], r["pois"]), ("delta", []))

        await svc.delete_poi(self.db, self.settings, "poi-b")
        self.assertEqual((await self.load(updated_after=long_ago))["removed_poi_ids"], ["poi-b"])
        # naive datetimes are treated as UTC
        r = await self.load(updated_after=datetime(2000, 1, 1))
        self.assertEqual(r["sync_mode"], "delta")

    async def test_recreated_poi_is_not_reported_as_removed(self):
        await self.create_active()
        cursor = (await self.load())["sync_cursor"]
        await svc.delete_poi(self.db, self.settings, "hanoi-thang-long")
        await self.create_active()
        r = await self.load(sync_cursor=cursor)
        self.assertEqual(r["removed_poi_ids"], [])
        self.assertEqual([p["poi_id"] for p in r["pois"]], ["hanoi-thang-long"])

    async def test_etag_tracks_dataset_version(self):
        await self.create_active()
        etag = poi_sync.make_etag(await poi_sync.get_dataset_version(self.db), None)
        self.assertTrue(poi_sync.etag_matches(etag, etag))
        await svc.update_poi(self.db, self.settings, "hanoi-thang-long", PoiUpdate(priority=9))
        new_etag = poi_sync.make_etag(await poi_sync.get_dataset_version(self.db), None)
        self.assertFalse(poi_sync.etag_matches(etag, new_etag))

    async def test_draft_pois_are_never_served(self):
        await self.create_active(poi_id="poi-a")
        await self.create(poi_id="poi-draft", coords=NEAR_HANOI)
        self.assertEqual([p["poi_id"] for p in (await self.load())["pois"]], ["poi-a"])
        found = await poi_nearby.find_nearby(self.db, lat=HANOI[0], lng=HANOI[1], radius_m=500, limit=10, lang=None)
        self.assertEqual([p["poi_id"] for p in found["pois"]], ["poi-a"])


class NearbyTests(Base):
    async def setUpPois(self):
        await self.create_active(poi_id="poi-far", coords=HUE)
        await self.create_active(poi_id="poi-near", coords=NEAR_HANOI)
        await self.create_active(poi_id="poi-here", coords=HANOI)

    async def find(self, **kw):
        args = dict(lat=HANOI[0], lng=HANOI[1], radius_m=1000, limit=10, lang=None)
        args.update(kw)
        return await poi_nearby.find_nearby(self.db, **args)

    async def test_geonear_path(self):
        await self.setUpPois()
        r = await self.find()
        self.assertEqual(r["source"], "geoNear")
        self.assertEqual([p["poi_id"] for p in r["pois"]], ["poi-here", "poi-near"])
        here, near = r["pois"]
        self.assertEqual(here["distance_m"], 0.0)
        self.assertTrue(here["inside_radius"])        # 0 m <= 80 m
        self.assertFalse(near["inside_radius"])       # ~84 m > 80 m

    async def test_haversine_fallback_matches_geonear(self):
        await self.setUpPois()
        expected = [p["poi_id"] for p in (await self.find())["pois"]]
        self.w.geo_fail = True
        r = await self.find()
        self.assertEqual(r["source"], "haversine")
        self.assertEqual([p["poi_id"] for p in r["pois"]], expected)

    async def test_radius_limit_and_language_fallback(self):
        await self.setUpPois()
        self.w.geo_fail = True
        self.assertEqual(len((await self.find(radius_m=50))["pois"]), 1)
        self.assertEqual(len((await self.find(limit=1))["pois"]), 1)
        self.assertEqual(len((await self.find(radius_m=2_000_000))["pois"]), 3)
        content = (await self.find(lang="ko"))["pois"][0]["content"]
        self.assertEqual((content["language_served"], content["fallback"]), ("en", True))

    async def test_fallback_tie_break_uses_priority(self):
        await self.create_active(poi_id="poi-low", coords=HANOI)
        await self.create_active(poi_id="poi-high", coords=HANOI)
        await svc.update_poi(self.db, self.settings, "poi-high", PoiUpdate(priority=10))
        self.w.geo_fail = True
        r = await self.find()
        self.assertEqual([p["poi_id"] for p in r["pois"]], ["poi-high", "poi-low"])


if __name__ == "__main__":
    unittest.main()
