"""Rollback compatibility check: the PREVIOUS application version running against a database
that the NEW version has already migrated (0031 + 0032) and written to, with
database/rollback/prepare_rollback.sql applied (APPLY_PREPARE=0 shows what breaks without it).

Needs a checkout of the previous version and a Python 3.12 environment with ITS requirements
plus `pgserver` (an embedded PostgreSQL), e.g.:

    git worktree add /tmp/old a70ea3d
    uv venv --python 3.12 /tmp/venv_old
    uv pip install --python /tmp/venv_old/bin/python -r /tmp/old/backend/requirements.txt pgserver
    /tmp/venv_old/bin/python database/rollback/check_rollback_compat.py /tmp/old

Nothing here touches a real database: it starts its own throw-away PostgreSQL."""
import asyncio, hashlib, hmac, json, os, subprocess, sys, time, tempfile
from urllib.parse import urlencode
import httpx, pgserver, asyncpg

from pathlib import Path

NEW = str(Path(__file__).resolve().parents[2])
OLD = sys.argv[1]
BOT = "123456:rollback-test-token"
LOG = os.path.join(tempfile.gettempdir(), "old_app.log")
server = pgserver.get_server(tempfile.mkdtemp(prefix="rb_"))
base = server.get_uri()

async def prepare():
    admin = await asyncpg.connect(base); await admin.execute("CREATE DATABASE rb"); await admin.close()
    dsn = base.replace("/postgres?", "/rb?")
    # 1. production as it is TODAY: schema + patches up to 0030 (applied by the OLD code's own runner)
    env = {**os.environ, "DATABASE_URL": dsn, "ENV_FILE": "/dev/null", "PYTHONPATH": f"{OLD}/backend"}
    subprocess.run([sys.executable, "-c", "import asyncio;from app.config import get_settings;from app.database import create_pool, run_migrations\n"
        "async def m():\n s=get_settings(); p=await create_pool(s); await run_migrations(p); await p.close()\nasyncio.run(m())"], env=env, cwd=f"{OLD}/backend", check=True)
    conn = await asyncpg.connect(dsn)
    legacy = await conn.fetchrow("INSERT INTO users (telegram_id, username, first_name) VALUES (555001, 'old', 'Старый') RETURNING id")
    await conn.execute("INSERT INTO player_profiles (user_id, full_name, sport) VALUES ($1, 'Старый Игрок', 'Теннис')", legacy["id"])
    await conn.close()
    # 2. the NEW version migrates (0031, 0032) and runs for a while: web-only users appear
    env = {**os.environ, "DATABASE_URL": dsn, "ENV_FILE": "/dev/null", "PYTHONPATH": f"{NEW}/backend"}
    subprocess.run([sys.executable, "-c", "import asyncio;from app.config import get_settings;from app.database import create_pool, run_migrations\n"
        "async def m():\n s=get_settings(); p=await create_pool(s); await run_migrations(p); await p.close()\nasyncio.run(m())"], env=env, cwd=f"{NEW}/backend", check=True)
    conn = await asyncpg.connect(dsn)
    web = await conn.fetchrow("INSERT INTO users (email, email_verified_at, password_hash, first_name) VALUES ('web@example.com', now(), 'x', 'Веб') RETURNING id")
    await conn.execute("INSERT INTO notifications (user_id, category, title, body, entity_type, entity_id, send_at, status, dedup_key) "
                       "VALUES ($1, 'booking_requested', 'Заявка', 'Новая', 'booking', gen_random_uuid(), now() - interval '1 minute', 'pending', 'rb-1')", web["id"])
    print("schema version now:", await conn.fetchval("SELECT max(version) FROM schema_versions"))
    await conn.close()
    return dsn

def init_data(user_id=555001):
    fields = {"auth_date": str(int(time.time())), "query_id": "AAA", "user": json.dumps({"id": user_id, "first_name": "Старый", "username": "old"}, separators=(",", ":"), ensure_ascii=False)}
    check = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret = hmac.new(b"WebAppData", BOT.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)

dsn = asyncio.run(prepare())
PREPARE = os.environ.get("APPLY_PREPARE", "1") == "1"
async def prep():
    conn = await asyncpg.connect(dsn)
    await conn.execute(open(f"{NEW}/database/rollback/prepare_rollback.sql").read())
    await conn.close()
if PREPARE:
    asyncio.run(prep())

env = {**os.environ, "DATABASE_URL": dsn, "ENV_FILE": "/dev/null", "JWT_SECRET": "old-secret-for-rollback-check-0123456789", "TELEGRAM_BOT_TOKEN": "",
       "CORS_ORIGINS": "http://localhost:5173", "TELEGRAM_BOT_USERNAME": "RollbackBot", "BACKGROUND_TASK_INTERVAL_SECONDS": "1", "PYTHONPATH": f"{OLD}/backend"}
env["TELEGRAM_BOT_TOKEN"] = ""  # no background Telegram calls
proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--port", "8123", "--log-level", "warning"], env=env, cwd=f"{OLD}/backend")
results = []
try:
    for _ in range(60):
        try:
            if httpx.get("http://127.0.0.1:8123/api/health", timeout=1).status_code == 200: break
        except Exception: time.sleep(0.5)
    c = httpx.Client(base_url="http://127.0.0.1:8123", timeout=10)
    def check(name, ok, extra=""): results.append((name, ok)); print(("PASS " if ok else "FAIL ") + name, extra)
    check("old app starts on the migrated (v32) database", c.get("/api/health").json() == {"status": "ok", "database": True})
    # the bot token must match for initData: restart with token is overkill; sign with the token the app got (empty) is impossible,
    # so use the documented dev path instead: sign with BOT and tell the old app the same token
finally:
    proc.terminate(); proc.wait()

# second run WITH the token so initData verifies (background loop only starts a Bot object; there is no pending notification for the legacy user)
env["TELEGRAM_BOT_TOKEN"] = BOT
logfile = open(LOG, "w")
proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--port", "8124", "--log-level", "info"], env=env, cwd=f"{OLD}/backend", stdout=logfile, stderr=subprocess.STDOUT)
try:
    for _ in range(60):
        try:
            if httpx.get("http://127.0.0.1:8124/api/health", timeout=1).status_code == 200: break
        except Exception: time.sleep(0.5)
    c = httpx.Client(base_url="http://127.0.0.1:8124", timeout=10)
    r = c.post("/api/auth/telegram", json={"init_data": init_data()})
    check("old Telegram login still works for an existing user", r.status_code == 200, r.text[:80])
    h = {"Authorization": "Bearer " + r.json()["access_token"]}
    me = c.get("/api/auth/me", headers=h).json()
    check("old /me returns the same user id", me["telegram_id"] == 555001)
    check("old profile read keeps the data", c.get("/api/profile/me", headers=h).json()["player"]["full_name"] == "Старый Игрок")
    check("old app can write a coach profile", c.put("/api/profile/coach", headers=h, json={"full_name": "Тренер", "sport": "Теннис", "experience_years": 2, "specialization": None, "description": None}).status_code == 200)
    team = c.post("/api/teams", headers=h, json={"name": "Откат", "description": None, "sport": "Теннис", "age_category": None, "level": None})
    check("old app can create a team", team.status_code == 200, team.text[:60])
    for path in ("/api/calendar?date_from=2026-10-01&date_to=2026-10-30", "/api/notifications", "/api/coach-listings", "/api/teams/mine", "/api/bookings/me"):
        rr = c.get(path, headers=h); check(f"old GET {path.split('?')[0]}", rr.status_code == 200, f"{rr.status_code} {rr.text[:80] if rr.status_code != 200 else ''}")
    bt = c.post("/api/auth/browser/start")
    check("old browser-login handshake table still exists (0031 keeps it)", bt.status_code == 200, bt.text[:60])
    time.sleep(4)  # several background ticks
    r2 = c.post("/api/auth/telegram", json={"init_data": init_data(555002)})
    check("old app registers a brand-new Telegram user on the new schema", r2.status_code == 200)
finally:
    proc.terminate(); proc.wait()
async def after():
    conn = await asyncpg.connect(dsn)
    web = await conn.fetchrow("SELECT email, password_hash, email_verified_at FROM users WHERE email = 'web@example.com'")
    n = await conn.fetchval("SELECT count(*) FROM users")
    await conn.close(); return web, n
web, n = asyncio.run(after())
check("web-only users and their data survived the old version running", web is not None and web["password_hash"] == "x" and n == 3)
log = open(LOG).read()
check("old background loop runs cleanly (no Telegram chat_id errors)", "chat_id" not in log and "Background task tick failed" not in log)
async def pending():
    conn = await asyncpg.connect(dsn)
    n = await conn.fetchval("SELECT count(*) FROM notifications WHERE status = 'pending' AND user_id IN (SELECT id FROM users WHERE telegram_id IS NULL)")
    await conn.execute("INSERT INTO notifications (user_id, category, title, body, entity_type, entity_id, send_at, status, dedup_key) SELECT id, 'booking_decided', 't', 'b', 'booking', gen_random_uuid(), now(), 'pending', 'rb-2' FROM users WHERE email = 'web@example.com'")
    guarded = await conn.fetchval("SELECT status FROM notifications WHERE dedup_key = 'rb-2'")
    await conn.close(); return n, guarded
n, guarded = asyncio.run(pending())
check("no pending notification is left for a user without Telegram, and new ones are guarded", n == 0 and guarded == "sent")
print("\nALL PASS" if all(ok for _, ok in results) else "\nSOME FAILED")
