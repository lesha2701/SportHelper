"""SQL for telling administrator accounts apart in public lists (the marketplace, the global search).

Administrators exist only in configuration (ADMIN_EMAILS, see app.api.deps.is_admin): an address on that list with a verified
e-mail. Their test listings and their own accounts are kept out of what ordinary people see."""
from __future__ import annotations


def is_admin_account(users_alias: str, param: str) -> str:
    """A SQL condition: the user row `users_alias` is an administrator. `param` is the placeholder holding the lower-cased
    list of administrator addresses (e.g. "$4")."""
    return f"({users_alias}.email_verified_at IS NOT NULL AND lower({users_alias}.email) = ANY({param}::text[]))"
