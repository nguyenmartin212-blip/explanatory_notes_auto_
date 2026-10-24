"""Chapter 07: tokens, RBAC, roles, owner verification, CCCD encryption and retention.

Uses real PyJWT and Fernet, with in-memory fakes for MongoDB, Redis and bcrypt.
"""

import copy
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import mock

from cryptography.fernet import Fernet

from app.auth import permissions as perms
from app.auth.context import authorize, authorize_verified_owner, build_context, extract_token
from app.auth.tokens import ACCESS, REFRESH, create_token, decode_token
from app.core.errors import AuthenticationError, ConflictError, NotFoundError, PermissionDenied
from app.services import auth_service, owner_service, role_service

NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)
SETTINGS = SimpleNamespace(
    jwt_secret="a" * 40,
    refresh_token_secret="b" * 40,
    secret_key="c" * 40,
    is_development=False,
    cccd_encryption_keys=Fernet.generate_key().decode(),
)


class FakeHasher:
    async def hash(self, p):
        return "h:" + p

    async def verify(self, p, h):
        return h == "h:" + p

    async def dummy_verify(self, p):
        pass


class FakeRedis:
    def __init__(self):
        self.data = {}
        self.down = False

    async def exists(self, k):
        if self.down:
            raise ConnectionError
        return k in self.data

    async def set(self, k, v, ex=None, nx=False):
        if self.down:
            raise ConnectionError
        if nx and k in self.data:
            return None
        self.data[k] = v
        return True


class World:
    def __init__(self):
        self.users = {}
        self.roles = {r["name"]: copy.deepcopy(r) for r in perms.DEFAULT_ROLES}
        self.audit = []
        self.audit_fail = False


class FakeUsers:
    def __init__(self, w):
        self.w = w

    async def get_by_id(self, db, uid):
        return copy.deepcopy(self.w.users.get(uid))

    async def get_by_username(self, db, name):
        return next((copy.deepcopy(u) for u in self.w.users.values() if u["username"] == name), None)

    async def record_login(self, db, uid, now):
        self.w.users[uid]["last_login_at"] = now

    async def bump_token_version(self, db, uid):
        u = self.w.users.get(uid)
        if not u:
            return None
        u["token_version"] += 1
        return u["token_version"]

    async def update_fields(self, db, uid, fields):
        self.w.users[uid].update(copy.deepcopy(fields))
        return True

    async def set_role(self, db, uid, role):
        self.w.users[uid]["role"] = role
        return True

    async def count_with_role(self, db, role):
        return sum(1 for u in self.w.users.values() if u["role"] == role)

    async def hide_expired_cccd(self, db, now):
        n = 0
        for u in self.w.users.values():
            if u.get("cccd_encrypted") and u.get("cccd_expires_at") and u["cccd_expires_at"] <= now:
                u.update(cccd_encrypted=None, cccd_masked=None, cccd_hidden_at=now)
                n += 1
        return n


class FakeRoles:
    def __init__(self, w):
        self.w = w

    async def get(self, db, name):
        return copy.deepcopy(self.w.roles.get(name))

    async def list_all(self, db):
        return [copy.deepcopy(r) for r in self.w.roles.values()]

    async def create(self, db, doc):
        if doc["name"] in self.w.roles:
            raise ConflictError("exists")
        self.w.roles[doc["name"]] = copy.deepcopy(doc)

    async def update(self, db, name, fields):
        self.w.roles[name].update(copy.deepcopy(fields))
        return True

    async def delete(self, db, name):
        return self.w.roles.pop(name, None) is not None


class FakeAudit:
    def __init__(self, w):
        self.w = w

    async def insert(self, db, **kw):
        if self.w.audit_fail:
            raise RuntimeError("audit down")
        self.w.audit.append(kw)


class Base(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.w = World()
        self.redis = FakeRedis()
        for module in (auth_service, role_service, owner_service):
            for name, fake in (
                ("admin_user_store", FakeUsers(self.w)),
                ("role_store", FakeRoles(self.w)),
                ("audit_log_store", FakeAudit(self.w)),
            ):
                if hasattr(module, name):
                    p = mock.patch.object(module, name, fake)
                    p.start()
                    self.addCleanup(p.stop)
        self.hasher = FakeHasher()

    def add_user(self, uid, role, password="pw", **extra):
        self.w.users[uid] = {
            "user_id": uid, "username": uid, "password_hash": "h:" + password, "role": role,
            "is_active": True, "token_version": 0, "is_poi_owner_verified": False, **extra,
        }

    async def ctx(self, uid):
        u = self.w.users[uid]
        return build_context(copy.deepcopy(u), copy.deepcopy(self.w.roles.get(u["role"])))


class CatalogTests(unittest.TestCase):
    def test_visitor_read_is_a_dedicated_permission(self):
        self.assertIn("visitor:read", perms.ALL_PERMISSIONS)
        self.assertEqual(perms.DEFAULT_ROLES[1]["name"], "admin")
        self.assertIn("visitor:read", perms.DEFAULT_ROLES[1]["permissions"])
        self.assertNotIn("visitor:read", perms.DEFAULT_ROLES[2]["permissions"])
        self.assertNotIn("visitor:read", perms.DEFAULT_ROLES[3]["permissions"])

    def test_default_roles(self):
        self.assertEqual({r["name"] for r in perms.DEFAULT_ROLES}, {"super_admin", "admin", "poi_owner", "user"})

    def test_token_lifetimes(self):
        a = create_token(SETTINGS, user_id="u", token_version=0, token_type=ACCESS, now=NOW)
        r = create_token(SETTINGS, user_id="u", token_version=0, token_type=REFRESH, now=NOW)
        self.assertEqual(a.expires_at - NOW, timedelta(minutes=30))
        self.assertEqual(r.expires_at - NOW, timedelta(days=7))

    def test_token_type_and_signature_checked(self):
        r = create_token(SETTINGS, user_id="u", token_version=0, token_type=REFRESH, now=NOW)
        with self.assertRaises(AuthenticationError):
            decode_token(SETTINGS, r.token, ACCESS)
        a = create_token(SETTINGS, user_id="u", token_version=0, token_type=ACCESS)
        other = SimpleNamespace(**{**vars(SETTINGS), "jwt_secret": "z" * 40})
        with self.assertRaises(AuthenticationError):
            decode_token(other, a.token, ACCESS)

    def test_expired_token(self):
        a = create_token(SETTINGS, user_id="u", token_version=0, token_type=ACCESS, now=NOW - timedelta(hours=1))
        with self.assertRaises(AuthenticationError) as cm:
            decode_token(SETTINGS, a.token, ACCESS)
        self.assertEqual(cm.exception.code, "token_expired")

    def test_bearer_header_wins_over_cookie(self):
        self.assertEqual(extract_token("Bearer abc", "cookie"), "abc")
        self.assertEqual(extract_token(None, "cookie"), "cookie")
        self.assertIsNone(extract_token("Basic abc", None))


class AuthFlowTests(Base):
    def setUp(self):
        super().setUp()
        self.add_user("admin1", "admin")

    async def test_login_and_authenticate(self):
        user, session = await auth_service.login(None, SETTINGS, "Admin1", "pw", hasher=self.hasher)
        ctx = await auth_service.authenticate(None, self.redis, SETTINGS, session.access_token)
        self.assertEqual(ctx.user_id, "admin1")
        view = auth_service.user_view(ctx)
        self.assertNotIn("password_hash", view)

    async def test_wrong_password_and_unknown_user_same_error(self):
        for name, pw in (("admin1", "bad"), ("nobody", "pw")):
            with self.assertRaises(AuthenticationError) as cm:
                await auth_service.login(None, SETTINGS, name, pw, hasher=self.hasher)
            self.assertEqual(cm.exception.code, "invalid_credentials")

    async def test_disabled_account(self):
        self.w.users["admin1"]["is_active"] = False
        with self.assertRaises(AuthenticationError) as cm:
            await auth_service.login(None, SETTINGS, "admin1", "pw", hasher=self.hasher)
        self.assertEqual(cm.exception.code, "account_disabled")

    async def test_refresh_rotation_single_use(self):
        _, s = await auth_service.login(None, SETTINGS, "admin1", "pw", hasher=self.hasher)
        _, s2 = await auth_service.refresh_session(None, self.redis, SETTINGS, s.refresh_token)
        self.assertNotEqual(s.refresh_token, s2.refresh_token)
        with self.assertRaises(AuthenticationError):
            await auth_service.refresh_session(None, self.redis, SETTINGS, s.refresh_token)

    async def test_access_token_cannot_refresh(self):
        _, s = await auth_service.login(None, SETTINGS, "admin1", "pw", hasher=self.hasher)
        with self.assertRaises(AuthenticationError):
            await auth_service.refresh_session(None, self.redis, SETTINGS, s.access_token)

    async def test_logout_revokes_tokens(self):
        _, s = await auth_service.login(None, SETTINGS, "admin1", "pw", hasher=self.hasher)
        n = await auth_service.logout(self.redis, SETTINGS, access_token=s.access_token, refresh_token=s.refresh_token)
        self.assertEqual(n, 2)
        with self.assertRaises(AuthenticationError):
            await auth_service.authenticate(None, self.redis, SETTINGS, s.access_token)
        with self.assertRaises(AuthenticationError):
            await auth_service.refresh_session(None, self.redis, SETTINGS, s.refresh_token)

    async def test_logout_with_garbage_is_harmless(self):
        self.assertEqual(await auth_service.logout(self.redis, SETTINGS, access_token="junk"), 0)

    async def test_token_version_bump_invalidates_all(self):
        _, s = await auth_service.login(None, SETTINGS, "admin1", "pw", hasher=self.hasher)
        await auth_service.revoke_all_sessions(None, "admin1")
        with self.assertRaises(AuthenticationError):
            await auth_service.authenticate(None, self.redis, SETTINGS, s.access_token)

    async def test_deactivated_after_login(self):
        _, s = await auth_service.login(None, SETTINGS, "admin1", "pw", hasher=self.hasher)
        self.w.users["admin1"]["is_active"] = False
        with self.assertRaises(AuthenticationError):
            await auth_service.authenticate(None, self.redis, SETTINGS, s.access_token)

    async def test_fail_closed_when_redis_down(self):
        _, s = await auth_service.login(None, SETTINGS, "admin1", "pw", hasher=self.hasher)
        self.redis.down = True
        with self.assertRaises(AuthenticationError) as cm:
            await auth_service.authenticate(None, self.redis, SETTINGS, s.access_token)
        self.assertEqual(cm.exception.code, "auth_unavailable")

    async def test_role_change_applies_immediately(self):
        _, s = await auth_service.login(None, SETTINGS, "admin1", "pw", hasher=self.hasher)
        self.w.roles["admin"]["permissions"] = []
        ctx = await auth_service.authenticate(None, self.redis, SETTINGS, s.access_token)
        with self.assertRaises(PermissionDenied):
            authorize(ctx, ["poi:delete"])


class RbacTests(Base):
    async def test_only_default_admin_and_super_admin_can_read_visits(self):
        self.add_user("root", "super_admin")
        self.add_user("admin", "admin")
        self.add_user("owner", "poi_owner", is_poi_owner_verified=True)
        self.add_user("user", "user")

        authorize(await self.ctx("admin"), ["visitor:read"])
        authorize(await self.ctx("root"), ["visitor:read"])
        for uid in ("owner", "user"):
            with self.assertRaises(PermissionDenied):
                authorize(await self.ctx(uid), ["visitor:read"])

    async def test_super_admin_wildcard(self):
        self.add_user("root", "super_admin")
        authorize(await self.ctx("root"), ["poi:delete", "role:delete"])

    async def test_user_role_cannot_delete(self):
        self.add_user("u", "user")
        with self.assertRaises(PermissionDenied) as cm:
            authorize(await self.ctx("u"), ["poi:delete"])
        self.assertEqual(cm.exception.missing, ("poi:delete",))

    async def test_unverified_owner_blocked_even_with_role_permission(self):
        self.add_user("o", "poi_owner")
        ctx = await self.ctx("o")
        permission = next(p for p in ctx.permissions if p not in perms.OWNER_UNVERIFIED_ALLOWED)
        with self.assertRaises(PermissionDenied) as cm:
            authorize(ctx, [permission])
        self.assertEqual(cm.exception.code, "owner_not_verified")
        with self.assertRaises(PermissionDenied):
            authorize_verified_owner(ctx)

    async def test_unverified_owner_limited_view_and_verified_ok(self):
        self.add_user("o", "poi_owner")
        view = auth_service.user_view(await self.ctx("o"))
        self.assertTrue(set(view["permissions"]) <= perms.OWNER_UNVERIFIED_ALLOWED)
        self.w.users["o"]["is_poi_owner_verified"] = True
        ctx = await self.ctx("o")
        authorize_verified_owner(ctx)
        permission = next(p for p in ctx.permissions if p not in perms.OWNER_UNVERIFIED_ALLOWED)
        authorize(ctx, [permission])

    async def test_missing_role_denied(self):
        self.add_user("x", "ghost")
        with self.assertRaises(PermissionDenied):
            authorize(await self.ctx("x"), ["poi:read"])


class RoleServiceTests(Base):
    def setUp(self):
        super().setUp()
        self.add_user("root", "super_admin")
        self.add_user("adm", "admin")
        self.add_user("usr", "user")

    async def test_create_role_dynamic(self):
        role = await role_service.create_role(None, await self.ctx("root"), name="editor", permissions=["poi:read"])
        self.assertEqual(role["permissions"], ["poi:read"])
        self.assertIn("editor", self.w.roles)

    async def test_unknown_permission_and_wildcard_rejected(self):
        for bad in (["nope:nope"], ["*"]):
            with self.assertRaises(ValueError):
                await role_service.create_role(None, await self.ctx("root"), name="r1", permissions=bad)

    async def test_requires_role_create_permission(self):
        with self.assertRaises(PermissionDenied):
            await role_service.create_role(None, await self.ctx("usr"), name="r1", permissions=[])

    async def test_cannot_grant_what_you_lack(self):
        self.w.roles["admin"]["permissions"] = ["role:create", "poi:read"]
        with self.assertRaises(PermissionDenied):
            await role_service.create_role(None, await self.ctx("adm"), name="r2", permissions=["poi:delete"])

    async def test_super_admin_role_immutable_and_defaults_undeletable(self):
        ctx = await self.ctx("root")
        with self.assertRaises(ConflictError):
            await role_service.update_role(None, ctx, "super_admin", permissions=["poi:read"])
        with self.assertRaises(ConflictError):
            await role_service.delete_role(None, ctx, "user")

    async def test_delete_role_in_use_blocked(self):
        ctx = await self.ctx("root")
        await role_service.create_role(None, ctx, name="editor", permissions=["poi:read"])
        self.w.users["usr"]["role"] = "editor"
        with self.assertRaises(ConflictError):
            await role_service.delete_role(None, ctx, "editor")
        self.w.users["usr"]["role"] = "user"
        await role_service.delete_role(None, ctx, "editor")

    async def test_last_super_admin_cannot_be_demoted(self):
        with self.assertRaises(ConflictError):
            await role_service.assign_role(None, await self.ctx("root"), "root", "user")

    async def test_admin_cannot_assign_super_admin(self):
        self.w.roles["admin"]["permissions"] = ["user:update"]
        with self.assertRaises(PermissionDenied):
            await role_service.assign_role(None, await self.ctx("adm"), "usr", "super_admin")


class OwnerTests(Base):
    CCCD = "012345678901"

    def setUp(self):
        super().setUp()
        self.add_user("root", "super_admin")
        self.add_user("own", "poi_owner")

    async def submit(self, now=NOW):
        return await owner_service.submit_cccd(None, SETTINGS, await self.ctx("own"), self.CCCD, now=now)

    async def test_stored_encrypted_never_plain(self):
        view = await self.submit()
        stored = self.w.users["own"]
        self.assertNotIn(self.CCCD, str(stored["cccd_encrypted"]))
        self.assertEqual(view["cccd_masked"], "********8901")
        self.assertNotIn(self.CCCD, str(view))
        self.assertEqual(stored["cccd_expires_at"] - NOW, timedelta(days=180))
        self.assertEqual(view["owner_status"], "pending")

    async def test_invalid_cccd_rejected(self):
        with self.assertRaises(ValueError):
            await owner_service.submit_cccd(None, SETTINGS, await self.ctx("own"), "12ab", now=NOW)

    async def test_non_owner_cannot_submit(self):
        self.add_user("u", "user")
        with self.assertRaises(PermissionDenied):
            await owner_service.submit_cccd(None, SETTINGS, await self.ctx("u"), self.CCCD)

    async def test_verify_needs_cccd_then_sets_flag(self):
        root = await self.ctx("root")
        with self.assertRaises(ConflictError):
            await owner_service.verify_owner(None, root, "own", approve=True, now=NOW)
        await self.submit()
        view = await owner_service.verify_owner(None, root, "own", approve=True, now=NOW)
        self.assertTrue(view["is_poi_owner_verified"])
        self.assertTrue(self.w.users["own"]["is_poi_owner_verified"])
        self.assertEqual(self.w.audit[-1]["action"], "owner.verify")

    async def test_owner_cannot_verify_self(self):
        await self.submit()
        with self.assertRaises(PermissionDenied):
            await owner_service.verify_owner(None, await self.ctx("own"), "own", approve=True)

    async def test_reject_unverifies(self):
        await self.submit()
        root = await self.ctx("root")
        await owner_service.verify_owner(None, root, "own", approve=True, now=NOW)
        view = await owner_service.verify_owner(None, root, "own", approve=False, reason="blurry", now=NOW)
        self.assertFalse(view["is_poi_owner_verified"])
        self.assertEqual(view["owner_reject_reason"], "blurry")

    async def test_reveal_audited_and_correct(self):
        await self.submit()
        out = await owner_service.reveal_cccd(None, SETTINGS, await self.ctx("root"), "own", now=NOW)
        self.assertEqual(out["cccd"], self.CCCD)
        self.assertEqual(self.w.audit[-1]["action"], "owner.cccd.reveal")
        self.assertNotIn(self.CCCD, str(self.w.audit))

    async def test_reveal_refused_if_audit_fails(self):
        await self.submit()
        self.w.audit_fail = True
        with self.assertRaises(RuntimeError):
            await owner_service.reveal_cccd(None, SETTINGS, await self.ctx("root"), "own", now=NOW)

    async def test_reveal_denied_without_permission(self):
        await self.submit()
        self.add_user("adm", "admin")
        self.w.roles["admin"]["permissions"] = ["owner:read"]
        with self.assertRaises(PermissionDenied):
            await owner_service.reveal_cccd(None, SETTINGS, await self.ctx("adm"), "own", now=NOW)

    async def test_retention_180_days_boundary(self):
        await self.submit()
        root = await self.ctx("root")
        day179 = NOW + timedelta(days=179)
        self.assertEqual((await owner_service.reveal_cccd(None, SETTINGS, root, "own", now=day179))["cccd"], self.CCCD)
        day181 = NOW + timedelta(days=181)
        with self.assertRaises(NotFoundError):  # refused even before the job runs
            await owner_service.reveal_cccd(None, SETTINGS, root, "own", now=day181)

    async def test_auto_hide_job(self):
        await self.submit()
        self.assertEqual(await owner_service.hide_expired_cccd(None, now=NOW + timedelta(days=179)), 0)
        self.assertEqual(await owner_service.hide_expired_cccd(None, now=NOW + timedelta(days=181)), 1)
        u = self.w.users["own"]
        self.assertIsNone(u["cccd_encrypted"])
        self.assertIsNone(u["cccd_masked"])
        self.assertIsNotNone(u["cccd_hidden_at"])
        self.assertEqual(self.w.audit[-1]["action"], "owner.cccd.auto_hide")
        self.assertEqual(await owner_service.hide_expired_cccd(None, now=NOW + timedelta(days=200)), 0)

    async def test_verified_status_survives_hide(self):
        await self.submit()
        await owner_service.verify_owner(None, await self.ctx("root"), "own", approve=True, now=NOW)
        await owner_service.hide_expired_cccd(None, now=NOW + timedelta(days=181))
        self.assertTrue(self.w.users["own"]["is_poi_owner_verified"])


if __name__ == "__main__":
    unittest.main()
