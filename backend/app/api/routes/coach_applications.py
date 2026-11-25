"""Private coach applications and an audited administrator review queue."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID
from urllib.parse import quote
import asyncpg
from fastapi import APIRouter, Depends, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import Response
from app.api.deps import AuthContext, get_auth_context, get_db, get_settings_dep, require_admin_mfa, require_admin_write
from app.config import Settings
from app.core.exceptions import APIError, NotFoundError
from app.repositories import coach_applications as repo
from app.schemas.coach_application import ApplicationOut, DecisionIn
from app.services import admin_audit, coach_application as service
from app.services.email import OutgoingEmail, send_email

router = APIRouter(prefix='/api/coach-applications', tags=['coach-applications'])
admin_router = APIRouter(prefix='/api/admin/coach-applications', tags=['admin'])

async def _out(conn: asyncpg.Connection, row: dict) -> ApplicationOut:
    return ApplicationOut(**row, documents=await repo.documents(conn, row['id']))

def _document_response(row: dict) -> Response:
    return Response(row['content'], media_type=row['mime_type'], headers={
        'Cache-Control': 'private, no-store',
        'Content-Disposition': f"attachment; filename=\"document\"; filename*=UTF-8''{quote(row['filename'])}",
    })

@router.get('/mine', response_model=ApplicationOut | None)
async def mine(ctx: AuthContext = Depends(get_auth_context), conn: asyncpg.Connection = Depends(get_db)):
    row = await repo.get_for_user(conn, ctx.user['id'])
    return await _out(conn, row) if row else None

@router.post('/mine/resubmit', response_model=ApplicationOut)
async def resubmit(
    details: str = Form(...), documents: list[UploadFile] = File(default_factory=list),
    ctx: AuthContext = Depends(get_auth_context), conn: asyncpg.Connection = Depends(get_db),
):
    parsed = service.parse_details(details)
    files = await service.read_documents(documents, require_one=False)
    async with conn.transaction():
        row = await conn.fetchrow('SELECT * FROM coach_applications WHERE user_id=$1 FOR UPDATE', ctx.user['id'])
        if row is None:
            raise NotFoundError('Заявка не найдена')
        if row['status'] not in ('needs_info', 'rejected'):
            raise APIError('Заявку сейчас нельзя отправить повторно.', code='bad_transition', status_code=409)
        if row['resubmit_after'] and row['resubmit_after'] > datetime.now(timezone.utc):
            raise APIError('Повторная подача будет доступна через 30 дней после отказа.', code='cooldown', status_code=409)
        count = await conn.fetchval('SELECT count(*) FROM coach_application_documents WHERE application_id=$1', row['id'])
        if count + len(files) > 10:
            raise APIError('К заявке можно приложить не более десяти документов. Свяжитесь с поддержкой.', code='document_limit', status_code=422)
        await conn.execute('UPDATE coach_applications SET sport=$2,qualification=$3,experience=$4,about=$5,links=$6,status=\'pending\',admin_note=NULL,resubmit_after=NULL,decided_by=NULL,decided_at=NULL,updated_at=now() WHERE id=$1', row['id'], parsed.sport, parsed.qualification, parsed.experience, parsed.about, parsed.links)
        await repo.add_documents(conn, row['id'], files)
        await repo.record(conn, row['id'], ctx.user['id'], 'resubmitted')
    return await mine(ctx, conn)

@router.get('/documents/{document_id}')
async def my_document(document_id: UUID, ctx: AuthContext = Depends(get_auth_context), conn: asyncpg.Connection = Depends(get_db)):
    row = await repo.get_document(conn, document_id)
    if row is None or row['user_id'] != ctx.user['id']:
        raise NotFoundError('Документ не найден')
    return _document_response(row)

@admin_router.get('', response_model=list[ApplicationOut])
async def queue(ctx: AuthContext = Depends(require_admin_mfa), conn: asyncpg.Connection = Depends(get_db)):
    rows = await conn.fetch("SELECT a.*,u.email,u.first_name,u.last_name FROM coach_applications a JOIN users u ON u.id=a.user_id WHERE u.email_verified_at IS NOT NULL ORDER BY CASE a.status WHEN 'pending' THEN 0 WHEN 'needs_info' THEN 1 ELSE 2 END, a.updated_at LIMIT 100")
    return [await _out(conn, dict(row)) for row in rows]

@admin_router.get('/{application_id}', response_model=ApplicationOut)
async def detail(application_id: UUID, ctx: AuthContext = Depends(require_admin_mfa), conn: asyncpg.Connection = Depends(get_db)):
    row = await repo.get(conn, application_id)
    if row is None or row['email_verified_at'] is None:
        raise NotFoundError('Заявка не найдена')
    return await _out(conn, row)

@admin_router.get('/documents/{document_id}')
async def admin_document(document_id: UUID, ctx: AuthContext = Depends(require_admin_mfa), conn: asyncpg.Connection = Depends(get_db)):
    row = await repo.get_document(conn, document_id)
    if row is None:
        raise NotFoundError('Документ не найден')
    return _document_response(row)

@admin_router.post('/{application_id}/decision', response_model=ApplicationOut)
async def decide(
    application_id: UUID, payload: DecisionIn, background: BackgroundTasks,
    ctx: AuthContext = Depends(require_admin_write), conn: asyncpg.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
):
    if payload.action != 'approve' and len(payload.note.strip()) < 3:
        raise APIError('Укажите причину или необходимые дополнения.', code='note_required', status_code=422)
    new_status = {'approve': 'approved', 'needs_info': 'needs_info', 'reject': 'rejected'}[payload.action]
    async with conn.transaction():
        row = await repo.get(conn, application_id, lock=True)
        if row is None or row['email_verified_at'] is None:
            raise NotFoundError('Заявка не найдена')
        if row['status'] != 'pending':
            raise APIError('Заявка уже обработана.', code='bad_transition', status_code=409)
        cooldown = datetime.now(timezone.utc) + timedelta(days=30) if new_status == 'rejected' else None
        await conn.execute('UPDATE coach_applications SET status=$2,admin_note=$3,decided_by=$4,decided_at=now(),resubmit_after=$5,updated_at=now() WHERE id=$1', application_id, new_status, payload.note.strip() or None, ctx.user['id'], cooldown)
        await repo.record(conn, application_id, ctx.user['id'], new_status, payload.note.strip() or None)
        await admin_audit.record(conn, ctx.user['id'], f'coach_application_{new_status}', target_type='coach_application', target_id=application_id, reason=payload.note.strip() or None, before={'status': 'pending'}, after={'status': new_status})
    titles = {'approved': 'Заявка тренера одобрена', 'needs_info': 'Дополните заявку тренера', 'rejected': 'Решение по заявке тренера'}
    body = {'approved': 'Ваш аккаунт тренера открыт.', 'needs_info': 'Мы просим дополнить заявку.', 'rejected': 'Сейчас мы не готовы одобрить заявку. Повторить подачу можно через 30 дней.'}[new_status]
    background.add_task(send_email, OutgoingEmail(to=row['email'], subject=titles[new_status], text=body + ('\n\n' + payload.note.strip() if payload.note.strip() else '') + '\n\nОткройте свой аккаунт, чтобы увидеть статус.'), settings)
    return await detail(application_id, ctx, conn)
