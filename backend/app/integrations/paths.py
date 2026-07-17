"""Builds the Yandex.Disk folder structure used across the app:

    /TeamFlow/
      sandbox/
        users/
        teams/
      main/
        users/
        teams/
"""
from __future__ import annotations

from uuid import UUID


def build_team_file_path(
    root_folder: str, app_mode: str, team_id: UUID, category: str, file_id: UUID, extension: str
) -> str:
    ext = f".{extension.lstrip('.')}" if extension else ""
    return f"{root_folder.rstrip('/')}/{app_mode}/teams/{team_id}/{category}/{file_id}{ext}"


def build_user_file_path(
    root_folder: str, app_mode: str, user_id: UUID, category: str, file_id: UUID, extension: str
) -> str:
    ext = f".{extension.lstrip('.')}" if extension else ""
    return f"{root_folder.rstrip('/')}/{app_mode}/users/{user_id}/{category}/{file_id}{ext}"
