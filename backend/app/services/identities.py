"""Rules for signing in with an external provider (Yandex ID, VK ID, ...).

Only the data model and the decisions live here - the OAuth exchange itself is
not implemented yet. The point of writing the rules first is that the security
properties don't depend on whichever OAuth library gets added later:

  1. An external account maps to exactly one user (DB-enforced); a user has at
     most one account per provider (DB-enforced).
  2. A provider-asserted email NEVER links an external account to an existing
     website account by itself. "Pre-hijacking" and unverified-email providers
     make that an account-takeover vector. Linking an existing account always
     needs the owner to sign in with a method they already have, then link.
  3. A new account may be created from a provider only if the provider vouches
     for the email (a trusted provider, `email_verified`) and no account owns it;
     otherwise the person must supply and verify an email through our own flow.
  4. The last way to sign in can't be removed (no password and a single provider).
  5. Banned / deleted users can't sign in through a provider either.
"""
from __future__ import annotations

import enum
from dataclasses import dataclass
from typing import Any

import asyncpg

from app.repositories import identities as identities_repo
from app.repositories import users as users_repo

# Providers the application accepts. Adding one is a code change (and an OAuth
# integration), not a migration: `user_identities.provider` is a free slug.
SUPPORTED_PROVIDERS: frozenset[str] = frozenset({"yandex", "vk"})

# Providers whose "email is verified" claim we accept for creating a new,
# already-verified account. VK often returns an unverified/absent email.
TRUSTED_EMAIL_PROVIDERS: frozenset[str] = frozenset({"yandex"})


@dataclass(frozen=True)
class ExternalProfile:
    provider: str
    provider_user_id: str
    email: str | None = None  # already normalised/lower-cased by the caller
    email_verified: bool = False
    display_name: str | None = None


class SignInOutcome(enum.Enum):
    SIGN_IN = "sign_in"  # known external account -> that user
    LINK_REQUIRED = "link_required"  # an account owns this email: sign in there first, then link
    CREATE_ACCOUNT = "create_account"  # new person, trusted verified email
    EMAIL_REQUIRED = "email_required"  # new person, email missing/unverified: collect + verify one


@dataclass(frozen=True)
class SignInDecision:
    outcome: SignInOutcome
    user: dict[str, Any] | None = None


class UnsupportedProvider(ValueError):
    pass


def _check_provider(provider: str) -> None:
    if provider not in SUPPORTED_PROVIDERS:
        raise UnsupportedProvider(provider)


async def decide_sign_in(conn: asyncpg.Connection, profile: ExternalProfile) -> SignInDecision:
    _check_provider(profile.provider)
    identity = await identities_repo.get_by_external(conn, profile.provider, profile.provider_user_id)
    if identity is not None:
        user = await users_repo.get_by_id(conn, identity["user_id"])
        if user is not None and user.get("deleted_at") is None and not user["is_banned"]:
            return SignInDecision(SignInOutcome.SIGN_IN, user)
        raise PermissionError("account is banned or deleted")

    if profile.email:
        owner = await users_repo.get_by_email(conn, profile.email)
        if owner is not None:
            return SignInDecision(SignInOutcome.LINK_REQUIRED, None)  # deliberately no user: nothing to leak
        if profile.email_verified and profile.provider in TRUSTED_EMAIL_PROVIDERS:
            return SignInDecision(SignInOutcome.CREATE_ACCOUNT)
    return SignInDecision(SignInOutcome.EMAIL_REQUIRED)


async def link_identity(conn: asyncpg.Connection, user_id: Any, profile: ExternalProfile) -> str:
    """Links `profile` to an ALREADY signed-in user. Returns "ok" | "external_taken" | "provider_taken"."""
    _check_provider(profile.provider)
    status, _row = await identities_repo.link(
        conn,
        user_id=user_id,
        provider=profile.provider,
        provider_user_id=profile.provider_user_id,
        provider_email=profile.email,
        provider_email_verified=profile.email_verified,
        display_name=profile.display_name,
    )
    return status


def remaining_login_methods(has_password: bool, identities: list[dict[str, Any]], *, without: str | None = None) -> int:
    return int(has_password) + sum(1 for i in identities if i["provider"] != without)


async def unlink_identity(conn: asyncpg.Connection, user: dict[str, Any], provider: str) -> str:
    """"ok" | "not_found" | "last_login_method"."""
    identities = await identities_repo.list_for_user(conn, user["id"])
    if not any(i["provider"] == provider for i in identities):
        return "not_found"
    if remaining_login_methods(bool(user.get("has_password")), identities, without=provider) == 0:
        return "last_login_method"
    await identities_repo.unlink(conn, user["id"], provider)
    return "ok"
