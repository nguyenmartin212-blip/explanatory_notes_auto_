from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from app.stores import visitor_visit_store

router = APIRouter(prefix="/api/visitors", tags=["visitors"])


class CheckInRequest(BaseModel):
    visit_id: UUID
    poi_id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9-]{1,80}$")


class CheckOutRequest(BaseModel):
    visit_id: UUID
    exit_method: Literal["manual", "geofence"] = "manual"


class SaveItineraryRequest(BaseModel):
    visit_id: UUID
    poi_ids: list[Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9-]{1,80}$")]] = Field(
        min_length=1,
        max_length=20,
    )

    @field_validator("poi_ids")
    @classmethod
    def require_unique_pois(cls, poi_ids: list[str]) -> list[str]:
        if len(set(poi_ids)) != len(poi_ids):
            raise ValueError("A saved itinerary cannot contain duplicate locations")
        return poi_ids


def _public_visit(visit: dict) -> dict:
    return {
        "visit_id": visit["visit_id"],
        "poi_id": visit["poi_id"],
        "status": visit["status"],
        "entered_at": visit["entered_at"],
        "exited_at": visit.get("exited_at"),
        "exit_method": visit.get("exit_method"),
        "saved_itinerary": visit.get("saved_itinerary"),
    }


@router.post("/check-in")
async def check_in(payload: CheckInRequest, request: Request):
    visit = await visitor_visit_store.check_in(
        request.app.state.db,
        visit_id=str(payload.visit_id),
        poi_id=payload.poi_id,
        at=datetime.now(timezone.utc),
    )
    return _public_visit(visit)


@router.post("/check-out")
async def check_out(payload: CheckOutRequest, request: Request):
    db = request.app.state.db
    visit_id = str(payload.visit_id)
    visit = await visitor_visit_store.check_out(
        db,
        visit_id=visit_id,
        at=datetime.now(timezone.utc),
        exit_method=payload.exit_method,
    )
    if visit is None:
        visit = await visitor_visit_store.get_by_visit_id(db, visit_id)
    if visit is None:
        raise HTTPException(status_code=404, detail="Visit session not found")
    return _public_visit(visit)


@router.post("/itinerary")
async def save_itinerary(payload: SaveItineraryRequest, request: Request):
    visit = await visitor_visit_store.save_itinerary(
        request.app.state.db,
        visit_id=str(payload.visit_id),
        poi_ids=payload.poi_ids,
        at=datetime.now(timezone.utc),
    )
    if visit is None:
        raise HTTPException(status_code=404, detail="Visit session not found")
    return _public_visit(visit)


@router.delete("/itinerary/{visit_id}")
async def clear_itinerary(visit_id: UUID, request: Request):
    visit = await visitor_visit_store.clear_itinerary(
        request.app.state.db,
        visit_id=str(visit_id),
    )
    if visit is None:
        raise HTTPException(status_code=404, detail="Visit session not found")
    return _public_visit(visit)


@router.delete("/{visit_id}")
async def delete_visit(visit_id: UUID, request: Request):
    deleted = await visitor_visit_store.delete_by_visit_id(
        request.app.state.db,
        visit_id=str(visit_id),
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Visit session not found")
    return {"deleted": True}
