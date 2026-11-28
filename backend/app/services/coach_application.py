from __future__ import annotations

import json
from fastapi import UploadFile
from app.core.exceptions import APIError
from app.schemas.coach_application import ApplicationDetails

MAX_DOCUMENTS = 3
MAX_BYTES = 10 * 1024 * 1024

async def read_documents(files: list[UploadFile], *, require_one: bool = True) -> list[tuple[str, str, bytes]]:
    if len(files) > MAX_DOCUMENTS or (require_one and not files):
        raise APIError('Приложите от одного до трёх документов.', code='documents_required', status_code=422)
    result = []
    for file in files:
        data = await file.read(MAX_BYTES + 1)
        # Browser MIME values are not reliable (some send application/octet-stream).
        # The stored type is derived from the actual file signature instead.
        mime = (
            'application/pdf' if data.startswith(b'%PDF-') else
            'image/jpeg' if data.startswith(b'\xff\xd8\xff') else
            'image/png' if data.startswith(b'\x89PNG\r\n\x1a\n') else
            'image/webp' if data.startswith(b'RIFF') and data[8:12] == b'WEBP' else None
        )
        if len(data) > MAX_BYTES:
            raise APIError('Размер каждого документа не должен превышать 10 МБ.', code='document_too_large', status_code=422)
        if not mime or not data:
            raise APIError('Документ должен быть PDF, JPG, PNG или WebP.', code='invalid_document', status_code=422)
        name = (file.filename or 'document').split('/')[-1].split('\\')[-1]
        name = ''.join(char for char in name if char.isprintable())[:150].strip() or 'document'
        result.append((name, mime, data))
    return result


def parse_details(raw: str) -> ApplicationDetails:
    try:
        return ApplicationDetails.model_validate(json.loads(raw))
    except (ValueError, TypeError) as exc:
        raise APIError('Проверьте сведения о квалификации.', code='invalid_application', status_code=422) from exc
