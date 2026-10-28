"""Request bodies of the finance API. Amounts are integer kopecks; the browser can send an amount only where the person chooses one
(a withdrawal) - never a price, a commission or a balance."""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class WithdrawalCreateIn(BaseModel):
    amount_kopecks: int = Field(gt=0, le=100_000_000_00)
    method: str = Field(max_length=20)
    details: dict[str, Any]
    # Sent again if the form is submitted twice (double click / retry): the same key can only ever create one request.
    client_key: UUID
    password: str = Field(max_length=2048)


class ReasonIn(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class OptionalNoteIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class RejectIn(BaseModel):
    reason: str = Field(min_length=1, max_length=500)
    # Needed only when the transfer was already started ("processing"): the administrator states the money was NOT sent.
    confirm_not_sent: bool = False


class MarkPaidIn(BaseModel):
    bank_reference: str = Field(min_length=5, max_length=64)
    paid_amount_kopecks: int = Field(gt=0)
    paid_at: datetime | None = None
    transfer_note: str | None = Field(default=None, max_length=500)


class RefundIn(BaseModel):
    amount_kopecks: int = Field(gt=0, le=100_000_000_00)
    reason: str = Field(min_length=1, max_length=500)
    # Only to give back a DUPLICATE charge (an attempt marked duplicate_paid).
    attempt_id: UUID | None = None


class ResolveIncidentIn(BaseModel):
    resolution: str = Field(min_length=1, max_length=500)
