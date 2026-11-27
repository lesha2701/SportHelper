from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from datetime import date, timedelta
from uuid import UUID, uuid4

import asyncpg
from fastapi import APIRouter, Depends, Request, Response, UploadFile

from app.api.deps import get_current_user, get_optional_user, get_db, get_settings_dep
from app.config import Settings
from app.core.exceptions import APIError, NotFoundError
from app.core import session_time
from app.integrations.paths import build_user_file_path
from app.integrations.yandex_disk import YandexDiskError
from app.repositories import coach_listings as listings_repo
from app.repositories import files as files_repo
from app.repositories import profiles as profiles_repo
from app.schemas.coach_listing import (
    AvailabilityWindowIn,
    AvailabilityWindowOut,
    CoachListingCardOut,
    CoachListingIn,
    CoachListingOut,
    CoachListingProfileOut,
    OneOffDateIn,
    OneOffDateOut,
    OpenSlotOut,
)
from app.services.uploads import (
    IMAGE_MIME_EXTENSIONS,
    VIDEO_MIME_EXTENSIONS,
    FileTooLarge,
    VideoProbeError,
    VideoTooLong,
    discard_stored_image,
    safe_filename,
    store_image_or_raise,
    upload_video_to_disk,
)

router = APIRouter(prefix="/api/coach-listings", tags=["coach-listings"])


def _view_cookie_name(settings: Settings) -> str:
    return "__Host-sag_listing_viewer" if settings.secure_cookies else "sag_listing_viewer"


def _viewer_key(request: Request, response: Response, user: dict | None, settings: Settings) -> str:
    secret = settings.jwt_secret.encode()
    if user:
        identity = f"user:{user['id']}"
    else:
        raw = request.cookies.get(_view_cookie_name(settings), "")
        visitor_id, _, signature = raw.partition(".")
        expected = hmac.new(secret, visitor_id.encode(), hashlib.sha256).hexdigest()
        if not re.fullmatch(r"[0-9a-f]{32}", visitor_id) or not hmac.compare_digest(signature, expected):
            visitor_id = secrets.token_hex(16)
            signature = hmac.new(secret, visitor_id.encode(), hashlib.sha256).hexdigest()
            response.set_cookie(
                _view_cookie_name(settings), f"{visitor_id}.{signature}", max_age=365 * 24 * 3600,
                secure=settings.secure_cookies, httponly=True, samesite="lax", path="/",
            )
        identity = f"guest:{visitor_id}"
    return hmac.new(secret, identity.encode(), hashlib.sha256).hexdigest()


async def _require_player(conn: asyncpg.Connection, user: dict) -> None:
    if await profiles_repo.get_player_profile(conn, user["id"]) is None:
        raise APIError("player profile required", code="player_profile_required", status_code=403)


def _require_coach_profile_error() -> APIError:
    return APIError(
        "create a coach profile before managing listings", code="coach_profile_required", status_code=409
    )


async def _get_owned_listing_or_404(conn: asyncpg.Connection, listing_id: UUID, coach_user_id: UUID) -> dict:
    listing = await listings_repo.get_listing(conn, listing_id)
    if listing is None or listing["coach_user_id"] != coach_user_id:
        raise NotFoundError("listing not found")
    return listing


@router.post("", response_model=CoachListingOut)
async def create_listing(
    payload: CoachListingIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> CoachListingOut:
    if await profiles_repo.get_coach_profile(conn, user["id"]) is None:
        raise _require_coach_profile_error()
    if payload.is_listed:
        # A brand-new listing has no availability windows yet (they can
        # only be added after it exists), so is_listed=true is never valid
        # on creation — same rule PUT enforces once windows can exist.
        raise APIError(
            "set availability before publishing a brand-new listing",
            code="availability_required",
            status_code=409,
        )
    listing = await listings_repo.create_listing(conn, user["id"], title=payload.title)
    updated = await listings_repo.update_listing(conn, listing["id"], user["id"], **payload.model_dump())
    assert updated is not None
    return CoachListingOut(**updated)


@router.get("/me", response_model=list[CoachListingOut])
async def list_my_listings(
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[CoachListingOut]:
    listings = await listings_repo.list_for_coach(conn, user["id"])
    return [CoachListingOut(**listing) for listing in listings]


@router.put("/{listing_id}", response_model=CoachListingOut)
async def update_listing(
    listing_id: UUID,
    payload: CoachListingIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> CoachListingOut:
    await _get_owned_listing_or_404(conn, listing_id, user["id"])
    if payload.is_listed:
        availability = await listings_repo.list_availability(conn, listing_id)
        if not availability and not await listings_repo.list_one_off_dates(conn, listing_id):
            raise APIError(
                "set at least one availability window before listing",
                code="availability_required",
                status_code=409,
            )
    updated = await listings_repo.update_listing(conn, listing_id, user["id"], **payload.model_dump())
    assert updated is not None
    return CoachListingOut(**updated)


@router.delete("/{listing_id}", status_code=204, response_model=None)
async def delete_listing(
    listing_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> None:
    await _get_owned_listing_or_404(conn, listing_id, user["id"])
    if await listings_repo.has_active_booking(conn, listing_id):
        raise APIError(
            "cannot delete a listing with a pending request or an upcoming confirmed booking",
            code="listing_has_active_booking",
            status_code=409,
        )
    deleted = await listings_repo.soft_delete_listing(conn, listing_id, user["id"])
    if not deleted:
        raise NotFoundError("listing not found")


@router.get("/{listing_id}/availability", response_model=list[AvailabilityWindowOut])
async def get_listing_availability(
    listing_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[AvailabilityWindowOut]:
    await _get_owned_listing_or_404(conn, listing_id, user["id"])
    windows = await listings_repo.list_availability(conn, listing_id)
    return [AvailabilityWindowOut(**w) for w in windows]


# «В понедельник», «Во вторник», «В среду»…: the weekday after the preposition, as people say it.
_ON_WEEKDAY = ["В понедельник", "Во вторник", "В среду", "В четверг", "В пятницу", "В субботу", "В воскресенье"]


def _overlap_message(a: dict, b: dict) -> str:
    """Says which day and which two windows collide and what to do, instead of the bare «availability windows overlap»."""
    first, second = (f"{w['start_time']:%H:%M}–{w['end_time']:%H:%M}" for w in (a, b))
    return f"{_ON_WEEKDAY[a['weekday']]} два окна расписания пересекаются ({first} и {second}). Объедините их в одно или измените время."


@router.put("/{listing_id}/availability", response_model=list[AvailabilityWindowOut])
async def replace_listing_availability(
    listing_id: UUID,
    payload: list[AvailabilityWindowIn],
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[AvailabilityWindowOut]:
    await _get_owned_listing_or_404(conn, listing_id, user["id"])
    windows = [w.model_dump() for w in payload]
    overlap = listings_repo.first_overlap(windows)
    if overlap:
        raise APIError(_overlap_message(*overlap), code="overlapping_availability", status_code=400)
    updated = await listings_repo.replace_availability(conn, listing_id, windows)
    return [AvailabilityWindowOut(**w) for w in updated]


@router.get("/{listing_id}/dates", response_model=list[OneOffDateOut])
async def list_listing_dates(
    listing_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[OneOffDateOut]:
    """The upcoming one-off dates of the coach's own listing."""
    await _get_owned_listing_or_404(conn, listing_id, user["id"])
    return [OneOffDateOut(**d) for d in await listings_repo.list_one_off_dates(conn, listing_id)]


@router.post("/{listing_id}/dates", response_model=OneOffDateOut, status_code=201)
async def add_listing_date(
    listing_id: UUID,
    payload: OneOffDateIn,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> OneOffDateOut:
    """Adds a day the coach is free on just once. Allowed at any time, also for a listing that is already published."""
    await _get_owned_listing_or_404(conn, listing_id, user["id"])
    today = session_time.wall_today()
    if payload.slot_date < today or (
        payload.slot_date == today and payload.end_time <= session_time.wall_now().time()
    ):
        raise APIError("Эта дата уже прошла. Выберите дату в будущем.", code="date_in_past", status_code=400)
    if payload.slot_date > today + timedelta(days=listings_repo.MAX_ONE_OFF_DAYS_AHEAD):
        raise APIError("Дату можно назначить не дальше чем на год вперёд.", code="date_too_far", status_code=400)
    existing = await listings_repo.list_one_off_dates(conn, listing_id)
    if len(existing) >= listings_repo.MAX_ONE_OFF_DATES:
        raise APIError(
            f"Можно добавить не больше {listings_repo.MAX_ONE_OFF_DATES} разовых дат. Удалите прошедшие или ненужные.",
            code="too_many_dates",
            status_code=409,
        )
    clash = listings_repo.one_off_overlap(existing, payload.slot_date, payload.start_time, payload.end_time)
    if clash:
        raise APIError(
            f"На {payload.slot_date:%d.%m.%Y} уже есть окно {clash['start_time']:%H:%M}–{clash['end_time']:%H:%M}, "
            "оно пересекается с новым. Измените время или удалите прежнее окно.",
            code="overlapping_availability",
            status_code=400,
        )
    created = await listings_repo.add_one_off_date(
        conn, listing_id, payload.slot_date, payload.start_time, payload.end_time
    )
    return OneOffDateOut(**created)


@router.delete("/{listing_id}/dates/{date_id}", status_code=204, response_model=None)
async def delete_listing_date(
    listing_id: UUID,
    date_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> None:
    await _get_owned_listing_or_404(conn, listing_id, user["id"])
    if not await listings_repo.delete_one_off_date(conn, listing_id, date_id):
        raise NotFoundError("date not found")


async def _upload_listing_media(
    listing_id: UUID,
    file: UploadFile,
    user: dict,
    conn: asyncpg.Connection,
    settings: Settings,
    *,
    category: str,
    allowed_types: dict[str, str],
    max_size_mb: int,
) -> CoachListingOut:
    await _get_owned_listing_or_404(conn, listing_id, user["id"])

    if file.content_type not in allowed_types:
        kind = "image" if category == "photo" else "video"
        raise APIError(
            f"file must be a {kind} ({', '.join(allowed_types)})", code="unsupported_media_type", status_code=415
        )

    file_id = uuid4()

    def build_path(extension: str) -> str:
        return build_user_file_path(
            settings.yandex_disk_root_folder, settings.app_mode, user["id"], f"listings/{listing_id}/{category}", file_id, extension
        )

    stored = None
    if category == "photo":
        stored = await store_image_or_raise(settings, file, "listing_photo", build_path)
        disk_path, mime_type, size_bytes, filename = (
            stored.disk_path, stored.mime_type, stored.size_bytes, safe_filename(file.filename, stored.extension, "photo"),
        )
    else:
        max_bytes = max_size_mb * 1024 * 1024
        chunk_size = settings.upload_chunk_size_kb * 1024
        extension = allowed_types[file.content_type]
        disk_path = build_path(extension)
        mime_type, filename = file.content_type, file.filename or f"{file_id}.{extension}"
        try:
            size_bytes = await upload_video_to_disk(
                settings, disk_path, file, max_bytes, chunk_size, settings.max_video_duration_seconds
            )
        except RuntimeError as exc:
            raise APIError(str(exc), code="yandex_disk_not_configured", status_code=503) from exc
        except FileTooLarge as exc:
            raise APIError(f"file must be smaller than {max_size_mb} MB", code="file_too_large", status_code=413) from exc
        except VideoTooLong as exc:
            raise APIError(
                f"video must be under {settings.max_video_duration_seconds} seconds (got {exc.duration_seconds:.0f}s)",
                code="video_too_long",
                status_code=413,
            ) from exc
        except VideoProbeError as exc:
            raise APIError(f"could not read this video file: {exc}", code="invalid_video", status_code=415) from exc
        except YandexDiskError as exc:
            raise APIError("failed to store the file", code="storage_error", status_code=502) from exc

    try:
        file_record = await files_repo.create_file(
            conn,
            owner_id=user["id"],
            team_id=None,
            entity_type=f"coach_listing_{category}",
            entity_id=listing_id,
            disk_path=disk_path,
            filename=filename,
            mime_type=mime_type,
            size_bytes=size_bytes,
            access_level="PUBLIC",
            thumb_disk_path=stored.thumb_disk_path if stored else None,
        )
    except Exception:
        if stored:
            await discard_stored_image(settings, stored)
        raise
    if category == "photo":
        await files_repo.replace_listing_photo(conn, listing_id, file_record["id"])
    else:
        await files_repo.replace_listing_video(conn, listing_id, file_record["id"])
    updated = await listings_repo.get_listing(conn, listing_id)
    assert updated is not None
    return CoachListingOut(**updated)


@router.post("/{listing_id}/photo", response_model=CoachListingOut)
async def upload_listing_photo(
    listing_id: UUID,
    file: UploadFile,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> CoachListingOut:
    return await _upload_listing_media(
        listing_id,
        file,
        user,
        conn,
        settings,
        category="photo",
        allowed_types=IMAGE_MIME_EXTENSIONS,
        max_size_mb=settings.max_image_size_mb,
    )


@router.post("/{listing_id}/video", response_model=CoachListingOut)
async def upload_listing_video(
    listing_id: UUID,
    file: UploadFile,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> CoachListingOut:
    return await _upload_listing_media(
        listing_id,
        file,
        user,
        conn,
        settings,
        category="video",
        allowed_types=VIDEO_MIME_EXTENSIONS,
        max_size_mb=settings.max_video_size_mb,
    )


@router.get("", response_model=list[CoachListingCardOut])
async def list_listings(
    sport: str | None = None,
    location: str | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    min_rating: float | None = None,
    format: str | None = None,
    min_experience_years: int | None = None,
    favorite_only: bool = False,
    user: dict | None = Depends(get_optional_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> list[CoachListingCardOut]:
    if favorite_only:
        if user is None:
            raise APIError("sign in to view favorites", code="authentication_required", status_code=401)
        await _require_player(conn, user)
    cards = await listings_repo.list_listed(
        conn,
        sport=sport,
        location=location,
        min_price=min_price,
        max_price=max_price,
        min_rating=min_rating,
        training_format=format,
        min_experience_years=min_experience_years,
        viewer_user_id=user["id"] if user else None,
        admin_emails=settings.admin_emails_list,
        only_favorites=favorite_only,
    )
    return [CoachListingCardOut(**c) for c in cards]


@router.post("/{listing_id}/view")
async def record_listing_view(
    listing_id: UUID,
    request: Request,
    response: Response,
    user: dict | None = Depends(get_optional_user),
    conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> dict[str, int]:
    if not await listings_repo.is_public(conn, listing_id):
        raise NotFoundError("listing not found or not listed")
    listing = await listings_repo.get_listing(conn, listing_id)
    assert listing is not None
    if user and listing["coach_user_id"] == user["id"]:
        return {"views_count": listing["views_count"]}
    return {"views_count": await listings_repo.count_view(conn, listing_id, _viewer_key(request, response, user, settings))}


@router.put("/{listing_id}/favorite")
async def add_favorite(
    listing_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, bool]:
    await _require_player(conn, user)
    if not await listings_repo.is_public(conn, listing_id):
        raise NotFoundError("listing not found or not listed")
    await listings_repo.set_favorite(conn, listing_id, user["id"], True)
    return {"is_favorite": True}


@router.delete("/{listing_id}/favorite", status_code=204, response_model=None)
async def remove_favorite(
    listing_id: UUID,
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> None:
    await _require_player(conn, user)
    await listings_repo.set_favorite(conn, listing_id, user["id"], False)


@router.get("/{listing_id}", response_model=CoachListingProfileOut)
async def get_listing_profile(
    listing_id: UUID,
    user: dict | None = Depends(get_optional_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> CoachListingProfileOut:
    profile = await listings_repo.get_public_listing(conn, listing_id, user["id"] if user else None)
    if profile is None:
        raise NotFoundError("listing not found or not listed")
    return CoachListingProfileOut(**profile)


_MAX_SLOTS_RANGE_DAYS = 90


@router.get("/{listing_id}/slots", response_model=list[OpenSlotOut])
async def get_listing_open_slots(
    listing_id: UUID,
    from_date: date,
    to_date: date,
    user: dict | None = Depends(get_optional_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[OpenSlotOut]:
    if to_date < from_date:
        raise APIError("to_date must not be before from_date", code="invalid_date_range", status_code=400)
    if (to_date - from_date).days > _MAX_SLOTS_RANGE_DAYS:
        raise APIError(
            f"date range must not exceed {_MAX_SLOTS_RANGE_DAYS} days",
            code="date_range_too_wide",
            status_code=400,
        )
    listing = await listings_repo.get_listing(conn, listing_id)
    if listing is None or not listing["is_listed"] or not await listings_repo.is_public(conn, listing_id):
        raise NotFoundError("listing not found or not listed")
    slots = await listings_repo.compute_open_slots(conn, listing_id, from_date, to_date)
    return [OpenSlotOut(**s) for s in slots]
