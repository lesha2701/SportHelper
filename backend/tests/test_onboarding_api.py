from __future__ import annotations

from tests.conftest import BOT_TOKEN, build_init_data


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_new_user_has_not_completed_onboarding(client) -> None:
    resp = client.post("/api/auth/telegram", json={"init_data": build_init_data(BOT_TOKEN, user_id=7001)})

    user = resp.json()["user"]
    assert user["completed_onboarding_version"] == 0


def test_current_onboarding_version_is_one(logged_in_client) -> None:
    client, token = logged_in_client

    me = client.get("/api/auth/me", headers=_headers(token)).json()

    assert me["current_onboarding_version"] == 1


def test_user_can_complete_onboarding(logged_in_client) -> None:
    client, token = logged_in_client

    resp = client.post("/api/users/me/onboarding/complete", headers=_headers(token))

    assert resp.status_code == 200
    assert resp.json()["completed_onboarding_version"] == 1
    # persisted: a later /me (e.g. from the browser after Telegram) sees it
    assert client.get("/api/auth/me", headers=_headers(token)).json()["completed_onboarding_version"] == 1


def test_completing_twice_is_harmless(logged_in_client) -> None:
    client, token = logged_in_client

    client.post("/api/users/me/onboarding/complete", headers=_headers(token))
    resp = client.post("/api/users/me/onboarding/complete", headers=_headers(token))

    assert resp.status_code == 200
    assert resp.json()["completed_onboarding_version"] == 1


def test_completing_only_affects_the_caller(logged_in_client, login_as) -> None:
    client, token = logged_in_client
    other_token = login_as(7002, first_name="Other")

    client.post("/api/users/me/onboarding/complete", headers=_headers(token))

    # The endpoint has no user id to point at someone else: the other user is untouched,
    # and a body naming them is ignored.
    other = client.get("/api/auth/me", headers=_headers(other_token)).json()
    assert other["completed_onboarding_version"] == 0
    other_id = other["id"]
    client.post("/api/users/me/onboarding/complete", headers=_headers(token), json={"user_id": other_id})
    assert client.get("/api/auth/me", headers=_headers(other_token)).json()["completed_onboarding_version"] == 0


def test_unauthenticated_cannot_complete_onboarding(client) -> None:
    assert client.post("/api/users/me/onboarding/complete").status_code == 401
    assert client.post("/api/users/me/onboarding/complete", headers=_headers("not-a-token")).status_code == 401
