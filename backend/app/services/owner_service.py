"""POI owner verification and CCCD handling.

- The CCCD is stored only as a Fernet token (+ a masked copy like ********1234).
- Retention: CCCD_RETENTION_DAYS (180) counted from the moment it is submitted.
  After that the data is hidden: the encrypted value and its mask are removed and
  `cccd_hidden_at` is set. A background job does this (`hide_expired_cccd`), and
  `reveal` also refuses expired data, so it is never readable late even if the
  job has not run yet. The owner's verification status is not affected.
- Every reveal, verification decision and auto-hide is written to `audit_logs`
  (never containing the CCCD itself). The audit entry of a reveal is written
  BEFORE the number is decrypted: if auditing fails, nothing is revealed.
- `is_poi_owner_verified` is only ever set here, by someone holding `owner:verify`.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from app.auth.cccd import get_cipher, mask_cccd, normalize_cccd
from app.auth.constants import CCCD_RETENTION_DAYS
from app.auth.context import AuthContext, authorize
from app.auth.permissions import POI_OWNER_ROLE
from app.core.errors import ConflictError, NotFoundError, PermissionDenied
from app.services.poi_payload import iso
from app.stores import admin_user_store, audit_log_store

logger = logging.getLogger(__name__)

SYSTEM_ACTOR = "system"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def cccd_available(user: dict, now: datetime | None = None) -> bool:
    """True if an encrypted CCCD is on file and its retention has not ended."""
    now = now or _now()
    expires = user.get("cccd_expires_at")
    return (
        isinstance(user.get("cccd_encrypted"), str)
        and expires is not None
        and expires > now
    )


def owner_profile_view(user: dict, now: datetime | None = None) -> dict:
    """Owner data that is safe to show. Never contains the CCCD number or its ciphertext."""
    available = cccd_available(user, now)
    return {
        "user_id": user["user_id"],
        "username": user["username"],
        "role": user.get("role"),
        "is_poi_owner_verified": bool(user.get("is_poi_owner_verified")),
        "owner_status": user.get("owner_status", "none"),
        "owner_verified_at": iso(user.get("owner_verified_at")),
        "owner_reviewed_at": iso(user.get("owner_reviewed_at")),
        "owner_reject_reason": user.get("owner_reject_reason"),
        "cccd_on_file": available,
        "cccd_masked": user.get("cccd_masked") if available else None,
        "cccd_submitted_at": iso(user.get("cccd_submitted_at")),
        "cccd_expires_at": iso(user.get("cccd_expires_at")),
        "cccd_hidden_at": iso(user.get("cccd_hidden_at")),
    }


async def _audit(db, *, action, actor_id, target_id, details, now) -> None:
    await audit_log_store.insert(
        db, action=action, actor_id=actor_id, target_id=target_id, details=details, at=now
    )


async def _get_owner(db, user_id: str) -> dict:
    user = await admin_user_store.get_by_id(db, user_id)
    if user is None:
        raise NotFoundError(f"User '{user_id}' not found")
    if user.get("role") != POI_OWNER_ROLE:
        raise ConflictError("This account is not a POI owner")
    return user


# --------------------------------------------------------------------------- #
# The owner submits their CCCD
# --------------------------------------------------------------------------- #
async def submit_cccd(
    db, settings, ctx: AuthContext, raw_cccd: str, *, now: datetime | None = None
) -> dict:
    """An owner submits (or replaces) their own CCCD. Allowed even before verification."""
    authorize(ctx, ["owner:profile"])
    if ctx.role_name != POI_OWNER_ROLE:
        raise PermissionDenied("not_an_owner", "Only POI owners can submit a CCCD")
    now = now or _now()

    number = normalize_cccd(raw_cccd)  # raises CccdFormatError (a ValueError)
    fields = {
        "cccd_encrypted": get_cipher(settings).encrypt(number),
        "cccd_masked": mask_cccd(number),
        "cccd_submitted_at": now,
        "cccd_expires_at": now + timedelta(days=CCCD_RETENTION_DAYS),
        "cccd_hidden_at": None,
    }
    if not ctx.is_poi_owner_verified:
        fields.update(owner_status="pending", owner_reject_reason=None)
    await admin_user_store.update_fields(db, ctx.user_id, fields)
    return owner_profile_view(await admin_user_store.get_by_id(db, ctx.user_id), now)


# --------------------------------------------------------------------------- #
# Staff
# --------------------------------------------------------------------------- #
async def get_owner_profile(db, ctx: AuthContext, user_id: str, *, now: datetime | None = None) -> dict:
    authorize(ctx, ["owner:read"])
    return owner_profile_view(await _get_owner(db, user_id), now)


async def verify_owner(
    db,
    ctx: AuthContext,
    user_id: str,
    *,
    approve: bool,
    reason: str | None = None,
    now: datetime | None = None,
) -> dict:
    """Approve (sets is_poi_owner_verified) or reject / un-verify an owner."""
    authorize(ctx, ["owner:verify"])
    now = now or _now()
    owner = await _get_owner(db, user_id)

    if approve:
        if owner.get("is_poi_owner_verified"):
            return owner_profile_view(owner, now)  # already verified: idempotent
        if not cccd_available(owner, now):
            raise ConflictError("The owner has no CCCD on file (never submitted, or hidden after retention)")
        fields = {
            "is_poi_owner_verified": True,
            "owner_status": "verified",
            "owner_verified_at": now,
            "owner_reject_reason": None,
        }
        action = "owner.verify"
    else:
        fields = {
            "is_poi_owner_verified": False,
            "owner_status": "rejected",
            "owner_verified_at": None,
            "owner_reject_reason": (reason or "").strip() or None,
        }
        action = "owner.reject"
    fields.update(owner_reviewed_at=now, owner_reviewed_by=ctx.user_id)

    await admin_user_store.update_fields(db, user_id, fields)
    await _audit(db, action=action, actor_id=ctx.user_id, target_id=user_id,
                 details={"reason": fields.get("owner_reject_reason")} if not approve else {}, now=now)
    return owner_profile_view(await admin_user_store.get_by_id(db, user_id), now)


async def reveal_cccd(
    db, settings, ctx: AuthContext, user_id: str, *, now: datetime | None = None
) -> dict:
    """Decrypt an owner's CCCD for staff. Audited; refused once the retention has ended."""
    authorize(ctx, ["owner:view_cccd"])
    now = now or _now()
    owner = await _get_owner(db, user_id)
    if not cccd_available(owner, now):
        raise NotFoundError("The CCCD is not available (never submitted, or hidden after retention)")

    await _audit(db, action="owner.cccd.reveal", actor_id=ctx.user_id, target_id=user_id,
                 details={}, now=now)  # first: no audit entry, no reveal
    number = get_cipher(settings).decrypt(owner["cccd_encrypted"])
    return {
        "user_id": user_id,
        "cccd": number,
        "cccd_expires_at": iso(owner["cccd_expires_at"]),
    }


# --------------------------------------------------------------------------- #
# Retention (background job)
# --------------------------------------------------------------------------- #
async def hide_expired_cccd(db, *, now: datetime | None = None) -> int:
    """Hide every CCCD whose 180 days are over. Returns how many were hidden."""
    now = now or _now()
    count = await admin_user_store.hide_expired_cccd(db, now)
    if count:
        logger.info("Auto-hid %d expired CCCD record(s)", count)
        await _audit(db, action="owner.cccd.auto_hide", actor_id=SYSTEM_ACTOR, target_id=None,
                     details={"count": count}, now=now)
    return count
