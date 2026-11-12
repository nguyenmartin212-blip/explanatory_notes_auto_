"""Password policy and hashing (bcrypt). Plain passwords are never stored or logged.

bcrypt only looks at the first 72 bytes, so longer passwords are rejected up
front instead of being silently truncated. Hashing runs in a thread because it
is deliberately slow.
"""

from __future__ import annotations

import asyncio

MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_BYTES = 72
BCRYPT_ROUNDS = 12


class PasswordPolicyError(ValueError):
    """The password does not satisfy the policy."""


def validate_password_policy(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise PasswordPolicyError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise PasswordPolicyError(f"Password must be at most {MAX_PASSWORD_BYTES} bytes")
    if not password.strip():
        raise PasswordPolicyError("Password cannot be blank")


class BcryptHasher:
    def __init__(self, rounds: int = BCRYPT_ROUNDS) -> None:
        self.rounds = rounds
        self._dummy_hash: str | None = None

    def hash_sync(self, password: str) -> str:
        import bcrypt

        return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=self.rounds)).decode("ascii")

    def verify_sync(self, password: str, hashed: str | None) -> bool:
        import bcrypt

        if not hashed:
            return False
        data = password.encode("utf-8")
        if len(data) > MAX_PASSWORD_BYTES:
            return False  # cannot match: such passwords are rejected when set
        try:
            return bcrypt.checkpw(data, hashed.encode("ascii"))
        except (ValueError, UnicodeError):
            return False  # malformed hash

    async def hash(self, password: str) -> str:
        validate_password_policy(password)
        return await asyncio.to_thread(self.hash_sync, password)

    async def verify(self, password: str, hashed: str | None) -> bool:
        return await asyncio.to_thread(self.verify_sync, password, hashed)

    async def dummy_verify(self, password: str) -> None:
        """Spend the same time as a real check, so an unknown username cannot be
        told apart from a wrong password by response time."""
        if self._dummy_hash is None:
            self._dummy_hash = await asyncio.to_thread(self.hash_sync, "dummy-password-for-timing")
        await asyncio.to_thread(self.verify_sync, password, self._dummy_hash)


default_hasher = BcryptHasher()
