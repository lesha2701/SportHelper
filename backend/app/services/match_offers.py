"""«Подобрать тренера», offers to trainers: the terms a trainer accepts and what a trainer may see of a request."""
from __future__ import annotations

import re
from decimal import Decimal

# Bump on any change of the terms' meaning: trainers who accepted an older version have the matching switched off until they accept again.
TERMS_VERSION = "2026-11-23"
TERMS_TITLE = "Условия подбора клиентов"
HIDDEN = "[контакт скрыт]"


def format_percent(percent: Decimal | float) -> str:
    """50 -> "50", 12.5 -> "12,5"."""
    text = f"{Decimal(str(percent)).normalize():f}"
    return text.replace(".", ",")


def terms_paragraphs(percent: Decimal | float, window_days: int = 30) -> list[str]:
    p = format_percent(percent)
    return [
        "Мы подбираем тренеров спортсменам, которые сами не нашли подходящего в каталоге. Если вы включите подбор, мы сможем предлагать вам таких людей.",
        f"За первую тренировку с клиентом, которого привели мы, платформа удерживает {p}% вместо обычной комиссии. Это разово: "
        "со всех следующих тренировок с этим клиентом комиссия обычная. Цена для спортсмена не меняется — удерживается часть вашей доли.",
        "Каждое предложение приходит вам отдельно, с процентом, который действует именно по нему. Вы можете принять его или отклонить — "
        "обязательств брать клиента нет. Если вы отказались или не ответили вовремя, ничего не меняется.",
        "До выбора и оплаты первой тренировки имя и контакты спортсмена вам не показываются: вы видите только анкету. "
        "Первую тренировку с таким клиентом оплачивают в приложении — так мы можем засчитать её как привлечённую нами.",
        f"Первой считается первая оплаченная запись этого спортсмена к вам в течение {window_days} дн. после того, как он выбрал вас (на любое ваше объявление). "
        "Если эта запись отклонена, отменена или деньги возвращены полностью, повышенный процент переходит на следующую запись.",
        "Подбор можно выключить в любой момент. Уже принятые предложения остаются в силе.",
    ]


# Phones, e-mails, links, messengers' handles: a trainer who sees them before the payment could take the client away from the platform.
_PATTERNS = [
    re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"),
    re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE),
    re.compile(r"\b(?:t\.me|wa\.me|vk\.com|vk\.cc|instagram\.com|youtube\.com)/\S*", re.IGNORECASE),
    re.compile(r"(?<![\w@])@[A-Za-z0-9_]{3,}"),
    re.compile(r"(?<!\d)(?:\+?\d[\s().-]*){10,}(?!\d)"),
]


def mask_contacts(text: str | None) -> str | None:
    if not text:
        return text
    for pattern in _PATTERNS:
        text = pattern.sub(HIDDEN, text)
    return text


def hide_athlete(row: dict) -> dict:
    """A booking as the trainer sees it before the first session of a client from the matching is paid: no name, no contacts in the note."""
    from app.repositories.match_attribution import HIDDEN_NAME

    return {**row, "athlete_full_name": HIDDEN_NAME, "athlete_notes": mask_contacts(row.get("athlete_notes"))}


# --- shaping offers for the people who see them ----------------------------------------------------------------------

_SUMMARY_FIELDS = (
    "sport", "goal", "level", "format", "city", "budget_min", "budget_max", "currency", "weekdays", "day_parts", "schedule_note", "comment"
)


def coach_offer_out(row: dict):
    """A trainer's view of an offer: the request without name or contacts, free text with contacts masked."""
    from app.schemas.match_offers import CoachOfferOut, MatchRequestSummaryOut

    summary = {k: row[k] for k in _SUMMARY_FIELDS}
    for key in ("goal", "city", "schedule_note", "comment"):
        summary[key] = mask_contacts(summary[key])
    return CoachOfferOut(
        id=row["id"], status=row["status"], created_at=row["created_at"], expires_at=row["expires_at"],
        first_session_percent=row["first_session_percent"], admin_message=mask_contacts(row["admin_message"]),
        request=MatchRequestSummaryOut(**summary),
    )


def admin_offer_out(row: dict):
    from app.schemas.admin import PersonOut
    from app.schemas.match_offers import AdminOfferOut

    return AdminOfferOut(
        id=row["id"], status=row["status"], coach=PersonOut(id=row["coach_user_id"], name=row["coach_name"] or "", email=row["coach_email"]),
        coach_sport=row["coach_sport"], first_session_percent=row["first_session_percent"], admin_message=row["admin_message"],
        coach_decline_reason=row["coach_decline_reason"], created_at=row["created_at"], expires_at=row["expires_at"],
        athlete_expires_at=row["athlete_expires_at"], coach_responded_at=row["coach_responded_at"],
        athlete_responded_at=row["athlete_responded_at"], window_ends_at=row["window_ends_at"],
        percent_overridden=row["percent_overridden"], percent_reason=row["percent_reason"],
    )


async def athlete_requests_out(conn, rows: list[dict]):
    """The athlete's own requests, each with the trainers who agreed and those trainers' published listings."""
    from app.repositories import coach_listings as listings_repo
    from app.repositories import match_offers as offers_repo
    from app.schemas.match_offers import AthleteOfferCoachOut, AthleteOfferOut
    from app.schemas.match_requests import MatchRequestOut

    offers = await offers_repo.accepted_for_requests(conn, [r["id"] for r in rows])
    result = []
    for row in rows:
        items = []
        for o in offers.get(row["id"], []):
            listings = await listings_repo.list_listed_for_coach(conn, o["coach_user_id"])
            items.append(
                AthleteOfferOut(
                    id=o["id"], status=o["status"], expires_at=o["expires_at"] if o["status"] == "coach_accepted" else None,
                    coach=AthleteOfferCoachOut(
                        user_id=o["coach_user_id"], full_name=o["full_name"], is_pro=o["is_pro"], photo_url=o["photo_url"], sport=o["sport"],
                        specialization=o["specialization"], experience_years=o["experience_years"], average_rating=o["average_rating"],
                        review_count=o["review_count"],
                    ),
                    listings=listings,
                )
            )
        result.append(MatchRequestOut(**row, offers=items))
    return result
