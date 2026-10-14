"""Reads the configuration the backend would use and reports what the production checks
(app/config.py: production_problems) think of it - WITHOUT starting anything or touching the
database. Run it against the server's .env before deploying:

    docker compose run --rm --no-deps backend python scripts/check_production_config.py

Exit code 0: no fatal problems (warnings may remain). 1: the backend would refuse to start."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings, production_problems  # noqa: E402


def main() -> int:
    settings = get_settings()
    print(f"APP_MODE            = {settings.app_mode}")
    print(f"APP_BASE_URL        = {settings.app_base_url}")
    print(f"CORS origins        = {', '.join(settings.cors_origins_list) or '(none)'}")
    print(f"secure cookies      = {settings.secure_cookies}  (cookie name: {settings.session_cookie_name})")
    print(f"proxy headers       = {settings.trust_proxy_headers}")
    print(f"SMTP                = {settings.smtp_host or '(not configured)'}:{settings.smtp_port} ({settings.smtp_security})")
    print(f"bearer auth         = {settings.bearer_auth_enabled}")
    print(f"API docs            = {settings.docs_enabled}")
    print(f"admins (ADMIN_EMAILS) = {len(settings.admin_emails_list)}")
    if settings.app_mode != "main":
        print("\nAPP_MODE is not 'main': production checks do not apply to this configuration.")
        return 0
    fatal, warnings = production_problems(settings)
    for message in fatal:
        print(f"\nFATAL   {message}")
    for message in warnings:
        print(f"WARNING {message}")
    if not fatal and not warnings:
        print("\nOK: nothing to report.")
    return 1 if fatal else 0


if __name__ == "__main__":
    raise SystemExit(main())
