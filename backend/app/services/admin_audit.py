"""Writing the administrators' audit trail.

Every administrative change records who did it, what, to which object, why, whether it worked, and the
relevant state before and after. Secrets never get in: values under keys that look like credentials are
dropped, long text is cut, and only plain JSON-able values are kept.
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

from app.repositories import admin as admin_repo

_FORBIDDEN_KEY_PARTS = ("password", "passwd", "token", "secret", "cookie", "authorization", "session", "hash", "otp", "mfa", "code", "key")
_MAX_TEXT = 500
_MAX_ITEMS = 40
_MAX_DEPTH = 3


def sanitize(value: Any, _depth: int = 0) -> Any:
    """A copy of `value` that is safe to store: no credential-looking keys, bounded size and depth."""
    if _depth > _MAX_DEPTH:
        return "…"
    if isinstance(value, dict):
        clean: dict[str, Any] = {}
        for key, item in list(value.items())[:_MAX_ITEMS]:
            name = str(key)
            if any(part in name.lower() for part in _FORBIDDEN_KEY_PARTS):
                continue
            clean[name] = sanitize(item, _depth + 1)
        return clean
    if isinstance(value, (list, tuple, set)):
        return [sanitize(item, _depth + 1) for item in list(value)[:_MAX_ITEMS]]
    if isinstance(value, (bool, int, float)) or value is None:
        return value
    if isinstance(value, UUID):
        return str(value)
    if hasattr(value, "isoformat"):
        return value.isoformat()
    text = str(value)
    return text if len(text) <= _MAX_TEXT else text[:_MAX_TEXT] + "…"


async def record(
    conn: asyncpg.Connection,
    admin_user_id: UUID,
    action: str,
    *,
    target_type: str,
    target_id: str | UUID,
    reason: str | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    extra: dict[str, Any] | None = None,
    result: str = "success",
) -> None:
    details: dict[str, Any] = {}
    if before is not None:
        details["before"] = sanitize(before)
    if after is not None:
        details["after"] = sanitize(after)
    if extra:
        details.update(sanitize(extra))
    await admin_repo.record_audit(
        conn,
        admin_user_id=admin_user_id,
        action=action,
        target_type=target_type,
        target_id=str(target_id),
        details=details or None,
        reason=reason.strip() if reason else None,
        result=result,
    )
