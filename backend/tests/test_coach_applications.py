"""New coaches stay in the review area until an administrator approves them."""
from __future__ import annotations
import json

from tests.auth_helpers import PASSWORD, link_token, register, register_payload, register_request, verify_latest


def test_old_json_coach_registration_cannot_skip_review(client):
    response = client.post('/api/auth/register', json=register_payload(role='coach'))
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'coach_application_required'
    assert client.auth_store.find_by_email('alice@example.com') is None


def test_coach_needs_a_real_document(client):
    payload = register_payload(role='coach')
    no_file = client.post('/api/auth/register-coach', data={'payload': json.dumps(payload), 'details': '{"sport":"Теннис","qualification":"Лицензия","experience":"3 года"}'})
    assert no_file.status_code == 422
    wrong_file = client.post('/api/auth/register-coach', data={'payload': json.dumps(payload), 'details': '{"sport":"Теннис","qualification":"Лицензия","experience":"3 года"}'}, files=[('documents', ('fake.pdf', b'plain text', 'application/pdf'))])
    assert wrong_file.status_code == 422
    assert client.auth_store.find_by_email(payload['email']) is None


def test_document_uses_file_signature_and_accepts_more_than_five_megabytes(client):
    payload = register_payload(role='coach')
    image = b'\xff\xd8\xff' + b'0' * (6 * 1024 * 1024)
    response = client.post('/api/auth/register-coach', data={
        'payload': json.dumps(payload),
        'details': json.dumps({'sport': 'Теннис', 'qualification': 'Лицензия', 'experience': '3 года'}),
    }, files=[('documents', ('license.jpg', image, 'application/octet-stream'))])
    assert response.status_code == 201, response.text
    too_large = client.post('/api/auth/register-coach', data={
        'payload': json.dumps({**payload, 'email': 'second@example.com'}),
        'details': json.dumps({'sport': 'Теннис', 'qualification': 'Лицензия', 'experience': '3 года'}),
    }, files=[('documents', ('license.jpg', image + b'0' * (5 * 1024 * 1024), 'image/jpeg'))])
    assert too_large.status_code == 422
    assert too_large.json()['error']['code'] == 'document_too_large'


def test_blank_qualification_cannot_create_an_application(client):
    payload = register_payload(role='coach')
    response = client.post('/api/auth/register-coach', data={
        'payload': json.dumps(payload),
        'details': json.dumps({'sport': 'Теннис', 'qualification': '   ', 'experience': 'Три года'}),
    }, files=[('documents', ('license.pdf', b'%PDF-1.4\nfixture', 'application/pdf'))])
    assert response.status_code == 422
    assert client.auth_store.find_by_email(payload['email']) is None


def test_verified_candidate_has_only_application_and_account_access(client):
    assert register(client, role='coach').status_code == 201
    verify_latest(client, 'alice@example.com', PASSWORD)
    me = client.get('/api/auth/me').json()
    assert me['coach_application_status'] == 'pending'
    application = client.get('/api/coach-applications/mine')
    assert application.status_code == 200
    assert application.json()['status'] == 'pending'
    assert application.json()['documents'][0]['filename'] == 'license.pdf'
    assert client.get('/api/auth/sessions').status_code == 200
    assert client.get('/api/profile/me').status_code == 403
    assert client.get('/api/profile/me').json()['error']['code'] == 'coach_application_pending'

    candidate = client.auth_store.find_by_email('alice@example.com')
    client.auth_store.coach_applications[candidate['id']]['status'] = 'approved'
    assert client.get('/api/auth/me').json()['coach_application_status'] == 'approved'
    assert client.get('/api/profile/me').status_code == 200


def test_coach_email_code_still_requires_the_registration_password(client):
    assert register(client, role='coach').status_code == 201
    code = link_token(client.outbox[-1])
    assert len(code) == 8 and code.isdigit()
    assert code in client.outbox[-1].text
    denied = client.post('/api/auth/verify-email', json={'token': code, 'password': 'wrong password'})
    assert denied.status_code == 403
    assert client.post('/api/auth/verify-email', json={'token': code, 'password': PASSWORD}).status_code == 200


def test_player_registration_is_unchanged(client):
    assert register_request(client, register_payload(role='player')).status_code == 201
    verify_latest(client, 'alice@example.com', PASSWORD)
    assert client.get('/api/auth/me').json()['coach_application_status'] is None
    assert client.get('/api/profile/me').status_code == 200


def test_legacy_unassigned_account_cannot_create_a_new_coach_profile(client):
    assert register(client, role='player').status_code == 201
    verify_latest(client, 'alice@example.com', PASSWORD)
    client.auth_store.find_by_email('alice@example.com')['preferred_role'] = None
    csrf = client.get('/api/auth/me').json()['csrf_token']
    response = client.put('/api/profile/coach', headers={'X-CSRF-Token': csrf}, json={
        'full_name': 'Новый тренер', 'sport': 'Теннис', 'experience_years': 3,
    })
    assert response.status_code == 403
    assert response.json()['error']['code'] == 'coach_application_required'
