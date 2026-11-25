from __future__ import annotations

from uuid import UUID
import asyncpg

async def replace_unverified(conn: asyncpg.Connection, user_id: UUID, details, files: list[tuple[str, str, bytes]]) -> None:
    """Called inside the registration transaction; a new unverified signup replaces an old draft."""
    await conn.execute('DELETE FROM coach_applications WHERE user_id=$1', user_id)
    row = await conn.fetchrow(
        "INSERT INTO coach_applications(user_id,sport,qualification,experience,about,links,status) "
        "VALUES($1,$2,$3,$4,$5,$6,'pending') RETURNING id",
        user_id, details.sport, details.qualification, details.experience, details.about, details.links,
    )
    await add_documents(conn, row['id'], files)
    await record(conn, row['id'], user_id, 'submitted')

async def get_for_user(conn: asyncpg.Connection, user_id: UUID) -> dict | None:
    row = await conn.fetchrow('SELECT * FROM coach_applications WHERE user_id=$1', user_id)
    return dict(row) if row else None

async def delete_for_user(conn: asyncpg.Connection, user_id: UUID) -> None:
    await conn.execute('DELETE FROM coach_applications WHERE user_id=$1', user_id)

async def get(conn: asyncpg.Connection, application_id: UUID, *, lock: bool = False) -> dict | None:
    suffix = ' FOR UPDATE' if lock else ''
    row = await conn.fetchrow('SELECT a.*, u.email, u.first_name, u.last_name, u.email_verified_at FROM coach_applications a JOIN users u ON u.id=a.user_id WHERE a.id=$1' + suffix, application_id)
    return dict(row) if row else None

async def documents(conn: asyncpg.Connection, application_id: UUID) -> list[dict]:
    rows = await conn.fetch('SELECT id, filename, mime_type, created_at FROM coach_application_documents WHERE application_id=$1 ORDER BY created_at', application_id)
    return [dict(row) for row in rows]

async def add_documents(conn: asyncpg.Connection, application_id: UUID, files: list[tuple[str,str,bytes]]) -> None:
    for filename, mime, content in files:
        await conn.execute('INSERT INTO coach_application_documents(application_id,filename,mime_type,content) VALUES($1,$2,$3,$4)', application_id, filename, mime, content)

async def get_document(conn: asyncpg.Connection, document_id: UUID) -> dict | None:
    row = await conn.fetchrow('SELECT d.*, a.user_id FROM coach_application_documents d JOIN coach_applications a ON a.id=d.application_id WHERE d.id=$1', document_id)
    return dict(row) if row else None

async def record(conn: asyncpg.Connection, application_id: UUID, actor_id: UUID, action: str, note: str | None = None) -> None:
    await conn.execute('INSERT INTO coach_application_events(application_id,actor_id,action,note) VALUES($1,$2,$3,$4)', application_id, actor_id, action, note)
