from __future__ import annotations

import pytest

from app.config import get_settings
from app.services import background
from tests.test_bookings_api import _list_coach_with_slot
from tests.test_teams_api import _create_coach_profile


class _CapturingBot:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_message(self, *, chat_id, text, reply_markup=None) -> None:
        self.sent.append({"chat_id": chat_id, "text": text, "reply_markup": reply_markup})


def _book_a_coach(client, login_as, coach_number: int, athlete_number: int, *, link_coach_telegram: int | None):
    """A pending booking, which queues a 'booking_requested' notification
    for the coach. Optionally links the coach's Telegram first."""
    coach_token = login_as(coach_number, first_name="Coach")
    if link_coach_telegram is not None:
        client.auth_store.find_by_email(f"user{coach_number}@fixtures.example.com")["telegram_id"] = link_coach_telegram
    _create_coach_profile(client, coach_token)
    listing_id, slot = _list_coach_with_slot(client, coach_token)
    athlete_token = login_as(athlete_number, first_name="Athlete")
    booking = client.post(
        "/api/bookings",
        headers={"Authorization": f"Bearer {athlete_token}"},
        json={"listing_id": listing_id, "starts_at": slot, "format": "online"},
    ).json()
    return booking, coach_token


async def test_due_notification_carries_site_deep_link_button(logged_in_client, login_as, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_BASE_URL", "https://sportarenaglobal.ru")
    get_settings.cache_clear()
    try:
        client, _ = logged_in_client
        booking, _ = _book_a_coach(client, login_as, 870001, 870002, link_coach_telegram=555001)

        bot = _CapturingBot()
        # send_due_notifications never touches `conn` beyond passing it through
        # to the (monkeypatched) repo functions, which ignore it — same as
        # every other repo fake in this suite.
        await background.send_due_notifications(None, bot, get_settings())

        assert len(bot.sent) == 1
        assert bot.sent[0]["chat_id"] == 555001
        button = bot.sent[0]["reply_markup"].inline_keyboard[0][0]
        assert button.text == "Открыть на сайте"
        assert button.url == f"https://sportarenaglobal.ru/?open=booking_requested&id={booking['id']}"
    finally:
        get_settings.cache_clear()


async def test_no_deep_link_button_when_site_url_unset(logged_in_client, login_as, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_BASE_URL", "")
    get_settings.cache_clear()
    try:
        client, _ = logged_in_client
        _book_a_coach(client, login_as, 870003, 870004, link_coach_telegram=555003)

        bot = _CapturingBot()
        await background.send_due_notifications(None, bot, get_settings())

        assert len(bot.sent) == 1
        assert bot.sent[0]["reply_markup"] is None
    finally:
        get_settings.cache_clear()


async def test_user_without_telegram_still_gets_the_in_app_notification(logged_in_client, login_as) -> None:
    client, _ = logged_in_client
    _, coach_token = _book_a_coach(client, login_as, 870005, 870006, link_coach_telegram=None)

    bot = _CapturingBot()
    await background.send_due_notifications(None, bot, get_settings())

    assert bot.sent == []  # nothing to deliver over Telegram
    assert [n["status"] for n in client.notifications_store.values()] == ["sent"]  # handled, never retried
    feed = client.get("/api/notifications", headers={"Authorization": f"Bearer {coach_token}"}).json()
    assert len(feed) == 1  # and the bell in the app shows it


async def test_notifications_are_in_app_only_without_a_bot(logged_in_client, login_as) -> None:
    client, _ = logged_in_client
    _book_a_coach(client, login_as, 870007, 870008, link_coach_telegram=555007)

    await background.send_due_notifications(None, None, get_settings())

    assert [n["status"] for n in client.notifications_store.values()] == ["sent"]
