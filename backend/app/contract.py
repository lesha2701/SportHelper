"""The API contract as files: what the clients (iPhone, Android, the site) can rely on.

The schema is built from the running application, never written by hand: `scripts/export_openapi.py` writes it to `docs/`, and
`tests/test_openapi_contract.py` fails when the committed files are out of date. So a change of an endpoint, a field or an error
shows up in the same pull request as a diff of `docs/openapi.json`, where both developers see it.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

# Where the files live, from the repository root.
FULL_PATH = Path("docs/openapi.json")
MOBILE_PATH = Path("docs/ios/openapi-mobile.json")

# The administrators work on the site only: the mobile subset has no admin routes.
_ADMIN_PREFIX = "/api/admin"


def full_spec() -> dict[str, Any]:
    from app.main import app

    return app.openapi()


def mobile_spec(full: dict[str, Any]) -> dict[str, Any]:
    """The same contract without the administrators' routes (the apps never call them)."""
    spec = json.loads(json.dumps(full))  # a copy: the application caches its schema
    spec["paths"] = {path: item for path, item in spec["paths"].items() if not path.startswith(_ADMIN_PREFIX)}
    spec["info"] = {**spec["info"], "title": f"{spec['info']['title']} (mobile subset: admin routes removed)"}
    return spec


def to_text(spec: dict[str, Any]) -> str:
    return json.dumps(spec, ensure_ascii=False, indent=2) + "\n"
