"""Creates (or resets the password of) a confirmed account straight in the
database - handy for local development (no email round-trip) and for
bootstrapping the first administrator on a fresh server.

    python scripts/create_user.py alice@example.com "Алиса" --role coach
    python scripts/create_user.py boss@example.com "Босс"          # prompts for the password

The password is read from a hidden prompt (or the CREATE_USER_PASSWORD
environment variable), never from the command line, so it doesn't end up in
shell history. Administrator rights are NOT granted here - list the address in
ADMIN_EMAILS instead.
"""
from __future__ import annotations

import argparse
import asyncio
import getpass
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings  # noqa: E402
from app.database import create_pool, run_migrations  # noqa: E402
from app.security.passwords import PasswordPolicyError, PolicyContext, check_password_policy, hash_password  # noqa: E402
from app.services.accounts import normalize_email  # noqa: E402


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("email")
    parser.add_argument("first_name")
    parser.add_argument("--role", choices=["player", "coach"], default=None)
    args = parser.parse_args()

    settings = get_settings()
    email = normalize_email(args.email)
    password = os.environ.get("CREATE_USER_PASSWORD") or getpass.getpass("Password: ")
    try:
        check_password_policy(password, settings, PolicyContext(email=email, first_name=args.first_name))
    except PasswordPolicyError as exc:
        print(f"Rejected: {exc.message}", file=sys.stderr)
        return 1
    password_hash = hash_password(password, settings)

    pool = await create_pool(settings)
    try:
        await run_migrations(pool)
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO users (email, email_verified_at, password_hash, password_changed_at, first_name,
                                   preferred_role, terms_accepted_at, terms_version)
                VALUES ($1, now(), $2, now(), $3, $4, now(), $5)
                ON CONFLICT (lower(email)) WHERE email IS NOT NULL DO UPDATE SET
                    password_hash = EXCLUDED.password_hash, password_changed_at = now(),
                    email_verified_at = COALESCE(users.email_verified_at, now()),
                    failed_login_count = 0, locked_until = NULL
                RETURNING id, (xmax = 0) AS created
                """,
                email,
                password_hash,
                args.first_name,
                args.role,
                settings.terms_version,
            )
            await conn.execute("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", row["id"])
    finally:
        await pool.close()
    print(f"{'Created' if row['created'] else 'Updated'} {email} (id {row['id']}); existing sessions were ended.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
