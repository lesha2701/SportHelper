from __future__ import annotations

from uuid import UUID, uuid4

import asyncpg
from fastapi import APIRouter, Depends, UploadFile

from app.api.deps import get_current_user, get_db, get_settings_dep
from app.config import Settings
from app.core.exceptions import APIError, NotFoundError
from app.integrations.paths import build_user_file_path
from app.integrations.yandex_disk import YandexDiskError
from app.repositories import coach_listings as listings_repo
from app.repositories import files as files_repo
from app.repositories import profiles as profiles_repo
from app.schemas.coach_listing import (
    AvailabilityWindowIn,
    AvailabilityWindowOut,
    CoachListingIn,
    CoachListingOut,
)
from app.services.uploads import IMAGE_MIME_EXTENSIONS, VIDEO_MIME_EXTENSIONS, FileTooLarge, upload_to_disk

router = APIRouter(prefix="/api/coach-listings", tags=["coach-listings"])


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
        if not availability:
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


@router.put("/{listing_id}/availability", response_model=list[AvailabilityWindowOut])
async def replace_listing_availability(
    listing_id: UUID,
    payload: list[AvailabilityWindowIn],
    user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
) -> list[AvailabilityWindowOut]:
    await _get_owned_listing_or_404(conn, listing_id, user["id"])
    windows = [w.model_dump() for w in payload]
    if listings_repo.has_overlap(windows):
        raise APIError("availability windows overlap", code="overlapping_availability", status_code=400)
    updated = await listings_repo.replace_availability(conn, listing_id, windows)
    return [AvailabilityWindowOut(**w) for w in updated]


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

    max_bytes = max_size_mb * 1024 * 1024
    chunk_size = settings.upload_chunk_size_kb * 1024
    file_id = uuid4()
    extension = allowed_types[file.content_type]
    disk_path = build_user_file_path(
        settings.yandex_disk_root_folder,
        settings.app_mode,
        user["id"],
        f"listings/{listing_id}/{category}",
        file_id,
        extension,
    )

    try:
        size_bytes = await upload_to_disk(settings, disk_path, file, max_bytes, chunk_size)
    except RuntimeError as exc:
        raise APIError(str(exc), code="yandex_disk_not_configured", status_code=503) from exc
    except FileTooLarge as exc:
        raise APIError(f"file must be smaller than {max_size_mb} MB", code="file_too_large", status_code=413) from exc
    except YandexDiskError as exc:
        raise APIError("failed to store the file", code="storage_error", status_code=502) from exc

    file_record = await files_repo.create_file(
        conn,
        owner_id=user["id"],
        team_id=None,
        entity_type=f"coach_listing_{category}",
        entity_id=listing_id,
        disk_path=disk_path,
        filename=file.filename or f"{file_id}.{extension}",
        mime_type=file.content_type,
        size_bytes=size_bytes,
        access_level="PUBLIC",
    )
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
