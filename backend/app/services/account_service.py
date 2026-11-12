"""Admin account changes, with session invalidation and last-admin protection."""

from contextlib import asynccontextmanager
from datetime import datetime, timezone

from redis.exceptions import RedisError

from app.auth.passwords import default_hasher
from app.auth.permissions import SUPER_ADMIN_ROLE
from app.core.errors import AuthenticationError, ConflictError, NotFoundError, PermissionDenied
from app.stores import admin_user_store, audit_log_store


@asynccontextmanager
async def account_lock(redis):
    lock = redis.lock("admin:account-mutations", timeout=30, blocking_timeout=5)
    try:
        acquired = await lock.acquire()
    except RedisError as exc:
        raise AuthenticationError("auth_unavailable", "Account changes are temporarily unavailable") from exc
    if not acquired:
        raise ConflictError("Another account change is in progress; retry")
    try:
        yield
    finally:
        try:
            await lock.release()
        except RedisError:
            pass


async def load_account(db, user_id):
    user = await admin_user_store.get_by_id(db, user_id)
    if user is None:
        raise NotFoundError("Account not found")
    return user


async def require_other_super_admin(db, user):
    if user.get("role") == SUPER_ADMIN_ROLE and user.get("is_active", True):
        count = await admin_user_store.count_active_with_role(db, SUPER_ADMIN_ROLE)
        if count <= 1:
            raise ConflictError("The last active super admin must be retained")


async def require_current_super_admin(db, ctx):
    user = await load_account(db, ctx.user_id)
    if user.get("role") != SUPER_ADMIN_ROLE or not user.get("is_active", True):
        raise PermissionDenied("forbidden", "Only a super admin can manage accounts")


async def audit(db, ctx, action, user_id):
    await audit_log_store.insert(
        db, action=action, actor_id=ctx.user_id, target_id=user_id,
        details=None, at=datetime.now(timezone.utc)
    )


async def change_password(db, ctx, old_password, new_password):
    user = await load_account(db, ctx.user_id)
    old_hash = user["password_hash"]
    if not await default_hasher.verify(old_password, old_hash):
        raise AuthenticationError("invalid_credentials", "Current password is incorrect")
    password_hash = await default_hasher.hash(new_password)
    if not await admin_user_store.update_account(
        db, ctx.user_id, {"password_hash": password_hash}, expected_hash=old_hash
    ):
        raise ConflictError("Password already changed; sign in and retry")
    await audit(db, ctx, "account.password_changed", ctx.user_id)
