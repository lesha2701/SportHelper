"""Dev-only helper: prints a validly-signed Telegram Mini App `initData`
string for manually testing POST /api/auth/telegram (e.g. via Swagger UI)
without opening the app inside a real Telegram client.

Uses the bot token configured in .env (via ENV_FILE) to compute the HMAC
signature exactly as Telegram would. Never use this outside local
development.

    python scripts/dev_init_data.py
    python scripts/dev_init_data.py --user-id 42 --first-name Anna --username anna
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
sys.path.insert(0, str(BACKEND_DIR / "tests"))

from conftest import build_init_data  # noqa: E402

from app.config import get_settings  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-id", type=int, default=111111111)
    parser.add_argument("--first-name", default="Dev")
    parser.add_argument("--username", default="dev_user")
    args = parser.parse_args()

    settings = get_settings()
    if not settings.telegram_bot_token:
        raise SystemExit("TELEGRAM_BOT_TOKEN is not set in .env")

    init_data = build_init_data(
        settings.telegram_bot_token,
        user_id=args.user_id,
        first_name=args.first_name,
        username=args.username,
    )
    print(init_data)


if __name__ == "__main__":
    main()
