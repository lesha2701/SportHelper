from __future__ import annotations

import json
from fastapi import UploadFile
from app.core.exceptions import APIError
from app.schemas.coach_application import ApplicationDetails

MAX_DOCUMENTS = 3
MAX_BYTES = 5 * 1024 * 1024

async def read_documents(files: list[UploadFile], *, require_one: bool = True) -> list[tuple[str, str, bytes]]:
    if len(files) > MAX_DOCUMENTS or (require_one and not files):
        raise APIError('Приложите от одного до трёх документов.', code='documents_required', status_code=422)
    result = []
    for file in files:
        data = await file.read(MAX_BYTES + 1)
        mime = file.content_type or ''
        valid = (
            mime == 'application/pdf' and data.startswith(b'%PDF-')
            or mime == 'image/jpeg' and data.startswith(b'\xff\xd8\xff')
            or mime == 'image/png' and data.startswith(b'\x89PNG\r\n\x1a\n')
            or mime == 'image/webp' and data.startswith(b'RIFF') and data[8:12] == b'WEBP'
        )
        if not valid or not data or len(data) > MAX_BYTES:
            raise APIError('Документ должен быть PDF, JPG, PNG или WebP размером до 5 МБ.', code='invalid_document', status_code=422)
        name = (file.filename or 'document').split('/')[-1].split('\\')[-1]
        name = ''.join(char for char in name if char.isprintable())[:150].strip() or 'document'
        result.append((name, mime, data))
    return result


def parse_details(raw: str) -> ApplicationDetails:
    try:
        return ApplicationDetails.model_validate(json.loads(raw))
    except (ValueError, TypeError) as exc:
        raise APIError('Проверьте сведения о квалификации.', code='invalid_application', status_code=422) from exc
