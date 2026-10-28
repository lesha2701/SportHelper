"""Thin async client for the ЮKassa payments API (https://yookassa.ru/developers/api).

The shop id and secret key are used only here, server-side: they are never logged, never returned to the browser and never
put in an error message. Only two calls are needed: create a payment (the customer is sent to `confirmation_url` to pay) and
read a payment back (the one way the site learns the truth: a webhook body is never trusted, it only says "look at payment X").
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import Settings

logger = logging.getLogger("teamflow.payments")


def _rub(kopecks: int) -> str:
    """Kopecks as the provider's decimal string ("2500.00"), without any floating point."""
    return f"{kopecks // 100}.{kopecks % 100:02d}"


class YooKassaError(Exception):
    """The provider refused or could not be reached. `message` is safe to log (it never holds credentials)."""

    def __init__(self, message: str, *, status_code: int | None = None, retryable: bool = False):
        super().__init__(message)
        self.status_code = status_code
        self.retryable = retryable


class YooKassaClient:
    def __init__(self, settings: Settings):
        if not settings.payments_enabled:
            raise RuntimeError("YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY are not configured")
        self._auth = (settings.yookassa_shop_id, settings.yookassa_secret_key)
        self._base = settings.yookassa_api_url.rstrip("/")
        self._timeout = settings.http_client_timeout_seconds

    async def _request(self, method: str, path: str, *, headers: dict[str, str] | None = None, json: dict | None = None) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.request(method, f"{self._base}{path}", auth=self._auth, headers=headers, json=json)
        except httpx.HTTPError as exc:  # network trouble: nothing is known about the outcome
            raise YooKassaError(f"ЮKassa is unreachable ({type(exc).__name__})", retryable=True) from exc
        if response.status_code >= 400:
            detail = ""
            try:
                body = response.json()
                detail = f"{body.get('code', '')}: {body.get('description', '')}".strip(": ")
            except ValueError:
                pass
            raise YooKassaError(
                f"ЮKassa answered {response.status_code} {detail}".strip(),
                status_code=response.status_code,
                retryable=response.status_code >= 500 or response.status_code == 429,
            )
        try:
            return response.json()
        except ValueError as exc:
            raise YooKassaError("ЮKassa sent an unreadable answer", retryable=True) from exc

    async def create_payment(
        self,
        *,
        amount_kopecks: int,
        currency: str,
        description: str,
        return_url: str,
        idempotence_key: str,
        metadata: dict[str, str],
        receipt: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "amount": {"value": _rub(amount_kopecks), "currency": currency},
            "capture": True,  # one step: the money is taken as soon as the customer pays
            "confirmation": {"type": "redirect", "return_url": return_url},
            "description": description[:128],
            "metadata": metadata,
        }
        if receipt is not None:
            body["receipt"] = receipt
        return await self._request("POST", "/payments", headers={"Idempotence-Key": idempotence_key}, json=body)

    async def get_payment(self, provider_payment_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/payments/{provider_payment_id}")

    async def create_refund(
        self, *, provider_payment_id: str, amount_kopecks: int, currency: str, description: str, idempotence_key: str
    ) -> dict[str, Any]:
        body = {
            "payment_id": provider_payment_id,
            "amount": {"value": _rub(amount_kopecks), "currency": currency},
            "description": description[:250],
        }
        return await self._request("POST", "/refunds", headers={"Idempotence-Key": idempotence_key}, json=body)

    async def get_refund(self, provider_refund_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/refunds/{provider_refund_id}")


def get_client(settings: Settings) -> YooKassaClient:
    """Separate seam so tests can substitute a fake provider (no test ever talks to the real ЮKassa)."""
    return YooKassaClient(settings)
