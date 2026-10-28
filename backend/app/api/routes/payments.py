"""The webhook ЮKassa calls when a payment changes (set its URL in the shop's cabinet: <site>/api/payments/yookassa/webhook).

It is public by necessity, so it believes nothing it is told: the body only names a payment, and the outcome is read back from
ЮKassa with our credentials. A forged request therefore cannot mark anything paid."""
from __future__ import annotations

import re

import asyncpg
from fastapi import APIRouter, Depends, Request

from app.api.deps import get_db, get_settings_dep
from app.config import Settings
from app.core.exceptions import APIError
from app.integrations.yookassa import YooKassaError
from app.repositories import payments as payments_repo
from app.services import payments as payments_service

router = APIRouter(prefix="/api/payments", tags=["payments"])

_PROVIDER_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_MAX_BODY_BYTES = 64 * 1024


@router.post("/yookassa/webhook")
async def yookassa_webhook(
    request: Request,
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> dict:
    if not settings.payments_enabled:
        return {"ok": True}
    raw = await request.body()
    if len(raw) > _MAX_BODY_BYTES:
        raise APIError("payload too large", code="payload_too_large", status_code=413)
    try:
        body = await request.json()
    except ValueError as exc:
        raise APIError("invalid json", code="invalid_payload", status_code=400) from exc
    obj = body.get("object") if isinstance(body, dict) else None
    provider_id = obj.get("id") if isinstance(obj, dict) else None
    if not isinstance(provider_id, str) or not _PROVIDER_ID.match(provider_id):
        raise APIError("invalid payload", code="invalid_payload", status_code=400)

    payment = await payments_repo.get_by_provider_id(conn, provider_id)
    if payment is None:
        return {"ok": True}  # not ours (or not yet stored): nothing to do, and nothing to retry
    try:
        await payments_service.sync_payment(conn, settings, payment)
    except YooKassaError as exc:
        # Tell ЮKassa to try again later.
        raise APIError("could not verify the payment", code="payment_provider_error", status_code=502) from exc
    return {"ok": True}
