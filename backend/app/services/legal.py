"""Which legal documents exist, in which edition, and which boxes each role ticks at sign-up.

The texts themselves are published by the frontend (frontend/src/legal/data/*.json). The sign-up form reports, for every
ticked box, the documents and editions that were on screen; an acceptance is only recorded when those are the CURRENT ones
(otherwise the person would be bound to a text other than the one they saw). tests/test_legal_documents.py keeps this list
in step with the frontend's. To publish a new edition: replace the JSON (scripts/legal_docx_to_json.py), then change the
version here and in frontend/src/legal/documents.ts."""
from __future__ import annotations

from dataclasses import dataclass

from app.core.exceptions import APIError
from app.schemas.auth import ConsentIn
from app.services.accounts import validation_error


@dataclass(frozen=True)
class LegalDocument:
    key: str
    title: str
    version: str  # YYYY-MM-DD, the "Редакция от" date


@dataclass(frozen=True)
class Consent:
    key: str
    documents: tuple[str, ...]


DOCUMENTS: dict[str, LegalDocument] = {
    doc.key: doc
    for doc in (
        LegalDocument("terms", "Пользовательское соглашение (публичная оферта) для спортсменов", "2026-10-20"),
        LegalDocument("coach-offer", "Оферта для тренеров (договор оказания услуг и агентский договор)", "2026-10-20"),
        LegalDocument("service-terms", "Типовые условия оказания услуг тренером", "2026-10-20"),
        LegalDocument("privacy", "Политика обработки персональных данных", "2026-10-20"),
        LegalDocument("consent-player", "Согласие спортсмена на обработку персональных данных", "2026-10-20"),
        LegalDocument("consent-coach", "Согласие тренера на обработку персональных данных", "2026-10-20"),
        LegalDocument(
            "consent-coach-dissemination",
            "Согласие тренера на обработку персональных данных, разрешённых для распространения",
            "2026-10-20",
        ),
    )
}

# The boxes of each role: all separate, none ticked in advance. Policy (privacy) is linked next to the consent, not signed on its own.
CONSENTS_BY_ROLE: dict[str, tuple[Consent, ...]] = {
    "player": (
        Consent("terms", ("terms",)),
        Consent("personal_data", ("consent-player", "privacy")),
    ),
    "coach": (
        Consent("coach_offer", ("coach-offer", "service-terms")),
        Consent("personal_data", ("consent-coach", "privacy")),
        Consent("data_dissemination", ("consent-coach-dissemination",)),
    ),
}


def check_consents(role: str, submitted: list[ConsentIn]) -> list[tuple[Consent, list[dict[str, str]]]]:
    """The boxes to record for this sign-up, each with the documents (key, title, edition) it covers.

    Raises a validation error when a box is missing/unknown/repeated, and 409 `documents_outdated` when the form was built
    from other editions than the current ones."""
    required = CONSENTS_BY_ROLE[role]
    keys = [item.key for item in submitted]
    if sorted(keys) != sorted(consent.key for consent in required):
        raise validation_error("Нужно отметить все согласия, предусмотренные для вашей роли.", "consents")

    by_key = {item.key: item for item in submitted}
    recorded: list[tuple[Consent, list[dict[str, str]]]] = []
    for consent in required:
        shown = {(ref.key, ref.version) for ref in by_key[consent.key].documents}
        current = {(key, DOCUMENTS[key].version) for key in consent.documents}
        if shown != current:
            raise APIError(
                "Документы обновились, пока вы заполняли форму. Обновите страницу и отметьте согласия заново.",
                code="documents_outdated",
                status_code=409,
            )
        recorded.append((consent, [{"key": k, "title": DOCUMENTS[k].title, "version": DOCUMENTS[k].version} for k in consent.documents]))
    return recorded
