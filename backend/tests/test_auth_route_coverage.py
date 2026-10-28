"""A safety net over the WHOLE API: every route must refuse an anonymous
caller unless it is on the explicit list of public routes below. Adding a new
endpoint without authentication therefore fails this test until someone
consciously adds it here."""
from __future__ import annotations

import re
from uuid import uuid4

from fastapi.routing import APIRoute

# (METHOD, path template) pairs that guests may call.
PUBLIC_ROUTES = {
    # health & docs
    ("GET", "/api/health"),
    ("GET", "/api/features"),
    ("POST", "/api/payments/yookassa/webhook"),  # called by ЮKassa; it believes nothing it is told (see the payments tests)
    # sign-up, sign-in and account recovery (these ARE the way in)
    ("POST", "/api/auth/register"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/logout"),  # idempotent: nothing to end without a session
    ("POST", "/api/auth/verify-email"),
    ("POST", "/api/auth/verify-email/inspect"),
    ("POST", "/api/auth/verify-email/set-password"),
    ("POST", "/api/auth/resend-verification"),
    ("POST", "/api/auth/forgot-password"),
    ("POST", "/api/auth/reset-password"),
    ("POST", "/api/auth/confirm-email-change"),
    ("POST", "/api/auth/claim/inspect"),
    ("POST", "/api/auth/claim"),
    # the public catalogue of coaches
    ("GET", "/api/coach-listings"),
    ("GET", "/api/coach-listings/{listing_id}"),
    ("GET", "/api/coach-listings/{listing_id}/slots"),
    ("GET", "/api/coaches/{coach_user_id}/profile"),
    ("GET", "/api/coaches/{coach_user_id}/listings"),
    ("GET", "/api/coaches/{coach_user_id}/reviews"),
    # media: the handler itself refuses anything that is not PUBLIC / a coach gallery
    ("GET", "/api/files/{file_id}"),
    ("GET", "/api/profile/media/{user_id}"),
}


def _concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", lambda _m: str(uuid4()), path)


def test_every_non_public_route_rejects_anonymous_requests(client) -> None:
    client.cookies.clear()
    checked = 0
    leaks: list[str] = []
    for route in client.app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/api/"):
            continue
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            if (method, route.path) in PUBLIC_ROUTES:
                continue
            checked += 1
            resp = client.request(method, _concrete(route.path), json={} if method != "GET" else None)
            if resp.status_code != 401:
                leaks.append(f"{method} {route.path} -> {resp.status_code}")
    assert checked > 100  # sanity: we really did walk the whole API
    assert not leaks, "routes reachable without authentication:\n" + "\n".join(leaks)


def test_public_routes_list_has_no_stale_entries(client) -> None:
    existing = {
        (method, route.path)
        for route in client.app.routes
        if isinstance(route, APIRoute)
        for method in route.methods
    }
    assert PUBLIC_ROUTES <= existing, PUBLIC_ROUTES - existing
