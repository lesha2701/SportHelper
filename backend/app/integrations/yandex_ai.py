"""Thin async client for Yandex AI Studio, via Yandex Cloud's
OpenAI-compatible chat completions endpoint.

Docs: https://yandex.cloud/ru/docs/foundation-models/text-generation/openai-compatibility

The API key is only ever used here, server-side — same rule as the
Yandex.Disk OAuth token in yandex_disk.py: loaded from config, never
logged, never returned to the frontend.
"""
from __future__ import annotations

import httpx

from app.config import Settings

_TEMPERATURE = 0.4
_MAX_TOKENS = 2000


class YandexAIError(Exception):
    pass


class YandexAIClient:
    def __init__(self, settings: Settings):
        if not settings.yandex_ai_api_key or not settings.yandex_ai_folder_id:
            raise RuntimeError("YANDEX_API_KEY / YANDEX_FOLDER_ID is not configured")
        self._api_key = settings.yandex_ai_api_key
        self._model = f"gpt://{settings.yandex_ai_folder_id}/{settings.yandex_ai_model}/latest"
        self._url = f"{settings.yandex_ai_base_url.rstrip('/')}/chat/completions"
        self._timeout = settings.http_client_timeout_seconds

    async def complete(self, *, system_prompt: str, user_prompt: str) -> str:
        payload = {
            "model": self._model,
            "temperature": _TEMPERATURE,
            "max_tokens": _MAX_TOKENS,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(
                    self._url,
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
        except httpx.HTTPError as exc:
            raise YandexAIError(f"network error contacting Yandex AI Studio: {exc}") from exc
        if response.status_code != 200:
            raise YandexAIError(f"Yandex AI Studio returned {response.status_code}: {response.text[:300]}")
        data = response.json()
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError) as exc:
            raise YandexAIError("unexpected Yandex AI Studio response shape") from exc
