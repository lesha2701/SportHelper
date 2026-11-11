"""Telling an out-of-date mobile app to update (card #28): the comparison, which requests are refused and which never are."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.config import Settings, get_settings
from app.core.client_version import is_older, parse_version, platform_of


def _configure(monkeypatch, **env: str) -> None:
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()


def _app(platform: str | None, version: str | None) -> dict[str, str]:
    headers = {}
    if platform:
        headers["X-Client-Platform"] = platform
    if version:
        headers["X-Client-Version"] = version
    return headers


class TestComparison:
    def test_versions_compare_as_numbers_not_as_text(self) -> None:
        assert is_older(parse_version("1.9"), parse_version("1.10")) is True
        assert is_older(parse_version("1.10"), parse_version("1.9")) is False
        assert is_older(parse_version("2.0.0"), parse_version("10.0.0")) is True

    def test_a_missing_part_is_zero(self) -> None:
        assert is_older(parse_version("1.4"), parse_version("1.4.0")) is False
        assert is_older(parse_version("1.4.0"), parse_version("1.4")) is False
        assert is_older(parse_version("1.4"), parse_version("1.4.1")) is True
        assert is_older(parse_version("1.4.0.1"), parse_version("1.4")) is False

    def test_what_is_not_a_dotted_number_is_not_a_version(self) -> None:
        for text in (None, "", " ", "abc", "1.4.x", "1.4.0-beta", "v1.4", "1..4", "1.4.0.0.1", "-1", "1,4"):
            assert parse_version(text) is None, text
        assert parse_version(" 1.4.0 ") == (1, 4, 0)

    def test_only_the_two_apps_are_platforms(self) -> None:
        assert platform_of("iOS") == "ios" and platform_of(" android ") == "android"
        assert platform_of("web") is None and platform_of("") is None and platform_of(None) is None


class TestTheGate:
    def test_nothing_is_refused_until_a_minimum_is_set(self, client) -> None:
        assert client.get("/api/features", headers=_app("ios", "0.0.1")).status_code == 200

    def test_an_app_older_than_the_minimum_gets_426_with_where_to_update(self, client, monkeypatch) -> None:
        _configure(monkeypatch, MIN_CLIENT_VERSION_IOS="1.4.0", APP_STORE_URL="https://apps.apple.com/app/id1")
        refused = client.get("/api/features", headers=_app("ios", "1.3.9"))
        assert refused.status_code == 426
        error = refused.json()["error"]
        assert error["code"] == "client_update_required" and error["min_version"] == "1.4.0" and error["update_url"] == "https://apps.apple.com/app/id1"
        assert "Обновите приложение" in error["message"]

    def test_the_minimum_itself_and_newer_versions_pass(self, client, monkeypatch) -> None:
        _configure(monkeypatch, MIN_CLIENT_VERSION_IOS="1.4.0")
        for version in ("1.4.0", "1.4", "1.4.1", "1.10.0", "2.0"):
            assert client.get("/api/features", headers=_app("ios", version)).status_code == 200, version

    def test_a_change_is_refused_too_before_it_reaches_the_route(self, client, monkeypatch) -> None:
        _configure(monkeypatch, MIN_CLIENT_VERSION_ANDROID="2.0.0")
        refused = client.post("/api/auth/logout", headers=_app("android", "1.9.9"))
        assert refused.status_code == 426 and refused.json()["error"]["code"] == "client_update_required"

    def test_each_platform_has_its_own_minimum(self, client, monkeypatch) -> None:
        _configure(monkeypatch, MIN_CLIENT_VERSION_IOS="3.0.0")
        assert client.get("/api/features", headers=_app("android", "1.0.0")).status_code == 200
        assert client.get("/api/features", headers=_app("ios", "2.9.9")).status_code == 426

    def test_the_website_and_apps_that_do_not_say_who_they_are_are_never_refused(self, client, monkeypatch) -> None:
        _configure(monkeypatch, MIN_CLIENT_VERSION_IOS="9.0.0", MIN_CLIENT_VERSION_ANDROID="9.0.0")
        assert client.get("/api/features").status_code == 200                                # the site: no headers
        assert client.get("/api/features", headers=_app("web", "0.1")).status_code == 200      # not an app platform
        assert client.get("/api/features", headers=_app("ios", None)).status_code == 200       # platform without a version
        assert client.get("/api/features", headers=_app("ios", "garbage")).status_code == 200  # an unreadable version is no reason to lock out

    def test_the_config_and_health_are_reachable_for_an_app_that_must_update(self, client, monkeypatch) -> None:
        _configure(monkeypatch, MIN_CLIENT_VERSION_IOS="2.0.0")
        old = _app("ios", "1.0.0")
        assert client.get("/api/health", headers=old).status_code == 200
        assert client.get("/api/app-config", headers=old).status_code == 200


class TestAppConfig:
    def test_it_is_public_and_empty_until_configured(self, client) -> None:
        body = client.get("/api/app-config").json()
        assert body["api_version"] == 1 and body["client"] is None
        assert body["platforms"]["ios"] == {"min_version": None, "latest_version": None, "update_url": None}

    def test_it_publishes_the_policy_and_answers_for_the_asking_app(self, client, monkeypatch) -> None:
        _configure(monkeypatch, MIN_CLIENT_VERSION_IOS="1.4.0", LATEST_CLIENT_VERSION_IOS="1.6.0", APP_STORE_URL="https://apps.apple.com/app/id1",
                   MIN_CLIENT_VERSION_ANDROID="1.0.0", PLAY_STORE_URL="https://play.google.com/store/apps/details?id=x")
        body = client.get("/api/app-config", headers=_app("ios", "1.5.0")).json()
        assert body["platforms"]["ios"] == {"min_version": "1.4.0", "latest_version": "1.6.0", "update_url": "https://apps.apple.com/app/id1"}
        assert body["platforms"]["android"]["update_url"] == "https://play.google.com/store/apps/details?id=x"
        assert body["client"] == {"platform": "ios", "version": "1.5.0", "update_required": False, "update_available": True}

        old = client.get("/api/app-config", headers=_app("ios", "1.3.0")).json()["client"]
        assert old["update_required"] is True and old["update_available"] is True
        current = client.get("/api/app-config", headers=_app("ios", "1.6.0")).json()["client"]
        assert current["update_required"] is False and current["update_available"] is False


class TestConfiguration:
    def _settings(self, monkeypatch, **env: str) -> Settings:
        for key, value in env.items():
            monkeypatch.setenv(key, value)
        return Settings(_env_file=None)  # type: ignore[call-arg]

    def test_a_typo_in_a_version_stops_the_server_instead_of_silently_doing_nothing(self, monkeypatch) -> None:
        for bad in ("1.4.x", "v1.4", "latest"):
            with pytest.raises(ValidationError):
                self._settings(monkeypatch, MIN_CLIENT_VERSION_IOS=bad)

    def test_a_store_link_must_be_https(self, monkeypatch) -> None:
        with pytest.raises(ValidationError):
            self._settings(monkeypatch, APP_STORE_URL="http://apps.apple.com/app/id1")
        with pytest.raises(ValidationError):
            self._settings(monkeypatch, PLAY_STORE_URL="javascript:alert(1)")

    def test_blank_values_mean_nothing_is_set(self, monkeypatch) -> None:
        s = self._settings(monkeypatch, MIN_CLIENT_VERSION_IOS="  ", APP_STORE_URL="")
        assert s.client_policy("ios") == ("", "", "")
