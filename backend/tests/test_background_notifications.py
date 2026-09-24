from __future__ import annotations

import pytest

from app.services import background
from tests.test_bookings_api import _list_coach_with_slot
from tests.test_teams_api import _create_coach_profile


class _CapturingBot:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_message(self, *, chat_id, text, reply_markup=None) -> None:
        self.sent.append({"chat_id": chat_id, "text": text, "reply_markup": reply_markup})


async def test_due_notification_carries_mini_app_deep_link_button(
    logged_in_client, login_as, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MINI_APP_URL", "https://t.me/TeamFlowSportsBot/app")
    from app.config import get_settings

    get_settings.cache_clear()
    try:
        client, _ = logged_in_client
        coach_token = login_as(870001, first_name="Coach")
        _create_coach_profile(client, coach_token)
        listing_id, slot = _list_coach_with_slot(client, coach_token)

        athlete_token = login_as(870002, first_name="Athlete")
        booking = client.post(
            "/api/bookings",
            headers={"Authorization": f"Bearer {athlete_token}"},
            json={"listing_id": listing_id, "starts_at": slot, "format": "online"},
        ).json()

        bot = _CapturingBot()
        # send_due_notifications never touches `conn` beyond passing it through
        # to the (monkeypatched) repo functions, which ignore it — same as
        # every other repo fake in this suite.
        await background.send_due_notifications(None, bot, get_settings())

        assert len(bot.sent) == 1
        keyboard = bot.sent[0]["reply_markup"]
        assert keyboard is not None
        button = keyboard.inline_keyboard[0][0]
        assert button.text == "Открыть в приложении"
        assert button.web_app.url == f"https://t.me/TeamFlowSportsBot/app?open=booking_requested&id={booking['id']}"
    finally:
        get_settings.cache_clear()


async def test_no_deep_link_button_when_mini_app_url_unset(logged_in_client, login_as, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MINI_APP_URL", "")
    from app.config import get_settings

    get_settings.cache_clear()
    try:
        client, _ = logged_in_client
        coach_token = login_as(870003, first_name="Coach")
        _create_coach_profile(client, coach_token)
        listing_id, slot = _list_coach_with_slot(client, coach_token)

        athlete_token = login_as(870004, first_name="Athlete")
        client.post(
            "/api/bookings",
            headers={"Authorization": f"Bearer {athlete_token}"},
            json={"listing_id": listing_id, "starts_at": slot, "format": "online"},
        )

        bot = _CapturingBot()
        await background.send_due_notifications(None, bot, get_settings())

        assert len(bot.sent) == 1
        assert bot.sent[0]["reply_markup"] is None
    finally:
        get_settings.cache_clear()
