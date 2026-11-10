"""Writes the API contract to docs/: the full schema (docs/openapi.json) and its mobile subset (docs/ios/openapi-mobile.json).

Run it from the backend folder after changing an endpoint, a request or a response, and commit the result:

    python scripts/export_openapi.py

No database is needed: the schema is built from the routes. `--check` only compares and exits with 1 when a file is out of date."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("DATABASE_URL", "postgresql://export:export@localhost/export")  # never connected to

from app import contract  # noqa: E402


def main() -> int:
    full = contract.full_spec()
    files = {contract.FULL_PATH: contract.to_text(full), contract.MOBILE_PATH: contract.to_text(contract.mobile_spec(full))}
    stale = []
    for relative, text in files.items():
        target = ROOT / relative
        if target.exists() and target.read_text(encoding="utf-8") == text:
            continue
        stale.append(str(relative))
        if "--check" not in sys.argv:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text, encoding="utf-8")
    if "--check" in sys.argv:
        print("out of date: " + ", ".join(stale) if stale else "up to date")
        return 1 if stale else 0
    print("written: " + ", ".join(stale) if stale else "nothing to change")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
