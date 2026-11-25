"""The coach review lifecycle against real PostgreSQL and real admin MFA."""
from __future__ import annotations

import json

from tests.admin_world import world, sql, sql_value  # noqa: F401
from tests.auth_helpers import PASSWORD, link_token, register_payload, register_request
from tests.live_helpers import Browser
from tests.test_auth_postgres import live_client, pg  # noqa: F401


def _candidate(world):
    email = 'candidate@example.com'
    payload = register_payload(role='coach', email=email)
    assert register_request(world.client, payload).status_code == 201
    # Until mailbox ownership is proved, the application is invisible to the admin queue.
    assert world.admin.fresh_unlocked_session().ok('GET', '/api/admin/coach-applications') == []
    world.client.cookies.clear()
    assert world.client.post('/api/auth/verify-email', json={
        'token': link_token(world.client.outbox[-1]), 'password': PASSWORD,
    }).status_code == 200
    world.client.cookies.clear()
    response = world.client.post('/api/auth/login', json={'email': email, 'password': PASSWORD})
    assert response.status_code == 200, response.text
    candidate = Browser.__new__(Browser)
    candidate.client, candidate.email, candidate.password = world.client, email, PASSWORD
    candidate.csrf, candidate.user_id = response.json()['csrf_token'], response.json()['id']
    candidate.cookies = dict(world.client.cookies)
    return candidate


def _resubmit(candidate):
    return candidate.call('POST', '/api/coach-applications/mine/resubmit', data={
        'details': json.dumps({'sport': 'Теннис', 'qualification': 'КМС и лицензия', 'experience': 'Пять лет работы', 'about': '', 'links': ['https://example.org/coach']})
    }, files=[('documents', ('new.png', b'\x89PNG\r\n\x1a\nnew evidence', 'image/png'))])


def test_review_request_more_reject_cooldown_and_approve(world):
    candidate = _candidate(world)
    application = candidate.ok('GET', '/api/coach-applications/mine')
    app_id = application['id']
    document_id = application['documents'][0]['id']
    assert candidate.call('GET', '/api/profile/me').status_code == 403
    own_document = candidate.call('GET', f'/api/coach-applications/documents/{document_id}')
    assert own_document.content.startswith(b'%PDF-')
    assert own_document.headers['content-disposition'].startswith('attachment;')
    assert own_document.headers['cache-control'] == 'private, no-store'
    outsider = Browser(world.client, 'outsider@example.com', 'Другой')
    assert outsider.call('GET', f'/api/coach-applications/documents/{document_id}').status_code == 404
    assert world.admin.call('GET', f'/api/admin/coach-applications/documents/{document_id}').status_code == 200
    assert len(world.admin.ok('GET', '/api/admin/coach-applications')) == 1

    more = world.admin.ok('POST', f'/api/admin/coach-applications/{app_id}/decision', json={
        'action': 'needs_info', 'note': 'Добавьте документ о спортивном разряде.'
    })
    assert more['status'] == 'needs_info'
    assert candidate.ok('GET', '/api/coach-applications/mine')['admin_note'].startswith('Добавьте')
    assert _resubmit(candidate).status_code == 200
    assert sql_value(world.dsn, 'SELECT count(*) FROM coach_application_documents WHERE application_id=$1', app_id) == 2

    refused = world.admin.ok('POST', f'/api/admin/coach-applications/{app_id}/decision', json={
        'action': 'reject', 'note': 'Пока недостаточно подтверждений.'
    })
    assert refused['status'] == 'rejected' and refused['resubmit_after']
    assert _resubmit(candidate).status_code == 409
    sql(world.dsn, 'UPDATE coach_applications SET resubmit_after=now()-interval \'1 day\' WHERE id=$1', app_id)
    assert _resubmit(candidate).status_code == 200

    accepted = world.admin.ok('POST', f'/api/admin/coach-applications/{app_id}/decision', json={
        'action': 'approve', 'note': ''
    })
    assert accepted['status'] == 'approved'
    assert candidate.call('GET', '/api/profile/me').status_code == 200
    assert candidate.ok('GET', '/api/auth/me')['coach_application_status'] == 'approved'
    assert sql_value(world.dsn, "SELECT count(*) FROM coach_application_events WHERE application_id=$1", app_id) == 6
