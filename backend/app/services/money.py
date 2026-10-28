"""Money, exactly. Everything financial is integer KOPECKS; Decimal only appears at the edges (prices from the database, percents).

One rounding rule for the whole system: ROUND_HALF_UP to the kopeck (0.5 kopeck rounds up). The platform's commission is
`gross * percent / 100` rounded that way; the trainer gets the rest, so fee + trainer == gross always."""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

KOPECKS = Decimal(100)


def rub_to_kopecks(value: Decimal | int | float | str) -> int:
    """A price in roubles as exact kopecks. (A float is accepted only because the legacy bookings column is a float; it is read
    through its shortest decimal form, never multiplied as a float.)"""
    try:
        amount = Decimal(str(value))
    except InvalidOperation as exc:
        raise ValueError(f"not an amount: {value!r}") from exc
    return int((amount * KOPECKS).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def kopecks_to_decimal(kopecks: int) -> Decimal:
    return (Decimal(kopecks) / KOPECKS).quantize(Decimal("0.01"))


def format_rub(kopecks: int) -> str:
    """1 800,00 ₽ (for messages; the API sends integers)."""
    sign = "-" if kopecks < 0 else ""
    rubles, rest = divmod(abs(kopecks), 100)
    return f"{sign}{rubles:,}".replace(",", " ") + f",{rest:02d} ₽"


def round_half_up(value: Decimal) -> int:
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def split_commission(gross_kopecks: int, percent: Decimal) -> tuple[int, int]:
    """(platform fee, trainer's share) in kopecks; they always add up to the gross amount."""
    if gross_kopecks < 0:
        raise ValueError("negative amount")
    fee = round_half_up(Decimal(gross_kopecks) * Decimal(percent) / Decimal(100))
    fee = min(max(fee, 0), gross_kopecks)
    return fee, gross_kopecks - fee


def split_refund(
    refund_kopecks: int, *, gross_kopecks: int, fee_kopecks: int, fee_already_refunded: int, refunded_before: int, return_commission: bool
) -> tuple[int, int]:
    """How a refund divides into (commission given back, trainer's share given back).

    Commission comes back in proportion to the part of the price refunded (half-up); the last refund of a payment takes exactly
    what is left, so over the whole life of a payment the commission returned never exceeds the commission taken."""
    if refund_kopecks <= 0 or refund_kopecks > gross_kopecks:
        raise ValueError("refund out of range")
    if not return_commission:
        return 0, refund_kopecks
    if refunded_before + refund_kopecks >= gross_kopecks:
        commission = fee_kopecks - fee_already_refunded
    else:
        commission = round_half_up(Decimal(fee_kopecks) * Decimal(refund_kopecks) / Decimal(gross_kopecks))
    commission = min(max(commission, 0), fee_kopecks - fee_already_refunded, refund_kopecks)
    return commission, refund_kopecks - commission
