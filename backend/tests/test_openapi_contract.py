"""The committed API contract (docs/openapi.json and the mobile subset) must be the one the application describes now.

A change of an endpoint, a field or an error that was not exported fails here. Fix: `python scripts/export_openapi.py` in backend/,
then commit the changed files, so the reviewer of the pull request sees what changed for the apps."""
from __future__ import annotations

from pathlib import Path

from app import contract

ROOT = Path(__file__).resolve().parents[2]
HINT = "the API contract is out of date: run `python scripts/export_openapi.py` in backend/ and commit docs/openapi.json and docs/ios/openapi-mobile.json"


def test_the_committed_contract_is_current() -> None:
    full = contract.full_spec()
    assert (ROOT / contract.FULL_PATH).read_text(encoding="utf-8") == contract.to_text(full), HINT
    assert (ROOT / contract.MOBILE_PATH).read_text(encoding="utf-8") == contract.to_text(contract.mobile_spec(full)), HINT


def test_the_mobile_subset_has_no_admin_routes_and_keeps_the_rest() -> None:
    full = contract.full_spec()
    mobile = contract.mobile_spec(full)
    assert not [path for path in mobile["paths"] if path.startswith("/api/admin")]
    kept = {path for path in full["paths"] if not path.startswith("/api/admin")}
    assert set(mobile["paths"]) == kept
    assert "/api/auth/mobile/login" in mobile["paths"], "the Android sign-in belongs to the contract"
    assert "/api/admin/users" in full["paths"], "the full contract keeps the administrators' routes"
