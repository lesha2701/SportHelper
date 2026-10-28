"""The webhook ЮKassa calls when a payment or a refund changes (set its URL in the shop's cabinet:
<site>/api/payments/yookassa/webhook, events payment.succeeded, payment.canceled, refund.succeeded).

It is public by necessity, so it believes nothing it is told. The layers:
  1. the sender's address must be one of ЮKassa's published ranges (YOOKASSA_WEBHOOK_IP_CHECK) - one layer, never the only one;
  2. the body only NAMES an object; its status is read back from ЮKassa with our credentials;
  3. the object must be one we created (unknown ids are ignored), and a success must match amount, currency and booking.
A forged request therefore cannot move any money. The answer is 200 only once the outcome is safely stored; if ЮKassa cannot be
reached we answer 502 so it delivers again (it retries for 24 hours), and reconciliation catches whatever is still missing."""
from __future__ import annotations

import re

import asyncpg
from fastapi import APIRouter, Depends, Request

from app.api.deps import get_db, get_settings_dep
from app.config import Settings
from app.core.exceptions import APIError
from app.integrations.yookassa import YooKassaError
from app.repositories import payments as payments_repo
from app.repositories import refunds as refunds_repo
from app.services import payments as payments_service
from app.services import refunds as refunds_service
from app.services.accounts import ip_of

router = APIRouter(prefix="/api/payments", tags=["payments"])

_PROVIDER_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_MAX_BODY_BYTES = 64 * 1024
_PAYMENT_EVENTS = {"payment.succeeded", "payment.canceled", "payment.waiting_for_capture"}
_REFUND_EVENTS = {"refund.succeeded"}


@router.post("/yookassa/webhook")
async def yookassa_webhook(
    request: Request,
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> dict:
    if not settings.payments_enabled:
        return {"ok": True}
    if settings.yookassa_webhook_ip_check and not payments_service.ip_is_from_yookassa(ip_of(request, settings)):
        await payments_repo.record_event(conn, source="webhook", event="?", provider_object_id=None, outcome="refused_source")
        raise APIError("forbidden", code="forbidden_source", status_code=403)
    raw = await request.body()
    if len(raw) > _MAX_BODY_BYTES:
        raise APIError("payload too large", code="payload_too_large", status_code=413)
    try:
        body = await request.json()
    except ValueError as exc:
        raise APIError("invalid json", code="invalid_payload", status_code=400) from exc
    event = body.get("event") if isinstance(body, dict) else None
    obj = body.get("object") if isinstance(body, dict) else None
    provider_id = obj.get("id") if isinstance(obj, dict) else None
    if not isinstance(event, str) or not isinstance(provider_id, str) or not _PROVIDER_ID.match(provider_id):
        raise APIError("invalid payload", code="invalid_payload", status_code=400)
    if event not in _PAYMENT_EVENTS | _REFUND_EVENTS:
        await payments_repo.record_event(conn, source="webhook", event=event[:60], provider_object_id=provider_id, outcome="ignored_event")
        return {"ok": True}

    try:
        if event in _PAYMENT_EVENTS:
            attempt = await payments_repo.get_attempt_by_provider_id(conn, provider_id)
            if attempt is None:
                await payments_repo.record_event(conn, source="webhook", event=event, provider_object_id=provider_id, outcome="unknown_object")
                return {"ok": True}  # not ours: nothing to do and nothing to retry
            await payments_service.sync_attempt(conn, settings, attempt, source="webhook")
        else:
            refund = await refunds_repo.get_by_provider_id(conn, provider_id)
            if refund is None:
                await payments_repo.record_event(conn, source="webhook", event=event, provider_object_id=provider_id, outcome="unknown_object")
                return {"ok": True}
            await refunds_service.sync_refund(conn, settings, refund, source="webhook")
    except YooKassaError as exc:
        await payments_repo.record_event(conn, source="webhook", event=event, provider_object_id=provider_id, outcome="provider_unreachable", detail=str(exc))
        raise APIError("could not verify the object", code="payment_provider_error", status_code=502) from exc
    return {"ok": True}
