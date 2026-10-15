# Чек-лист перед выкатом веб-авторизации

`git push` в `main` запускает CI и **автодеплой** на сервер, поэтому всё ниже выполняется **до** пуша. Каждый пункт можно проверить командой.

## A. На сервере (до пуша)
- [ ] **Бэкап базы:** `docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > backup-$(date +%F).dump`; файл скопирован с сервера.
- [ ] **Проверка миграций на копии** (необязательно, но рекомендуется): [docs/rollback.md](rollback.md#как-проверить-на-копии-production-базы-рекомендуется-перед-выкатом). Патчи отрабатывают за доли секунды и ничего не удаляют.
- [ ] **`.env` на сервере** (`chmod 600 .env`, не в git) содержит:
  - `APP_MODE=main`; `APP_BASE_URL=https://<домен>`; `CORS_ORIGINS=https://<домен>` (один источник, без `*`);
  - `JWT_SECRET` — случайная строка ≥ 32 символов (`openssl rand -hex 32`), не из примера;
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM` — рабочая почта;
  - `ADMIN_EMAILS=ваш@email`; `PASSWORD_BREACH_CHECK=true`; `BEARER_AUTH_ENABLED=false` (или строки нет);
  - `NUDGE_ENABLED=false` на время переноса пользователей (по желанию);
  - если бот нужен: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`.
- [ ] **Проверка конфигурации без запуска:** `docker compose run --rm --no-deps backend python scripts/check_production_config.py` → код выхода 0, **нет строк FATAL**; WARNING разобрать (SMTP, прокси).
  *(Образ собирается из нового кода — запустите после сборки: `docker compose build backend`; сборка ничего не перезапускает.)*
- [ ] **HTTPS:** DNS домена указывает на сервер, порты 80/443 открыты (`ufw status`), сертификат Let's Encrypt выдан (`curl -I https://<домен>` без ошибок).
- [ ] **Почта:** SPF, DKIM, DMARC настроены у провайдера; тестовое письмо с этого ящика доходит во «Входящие» (не в «Спам»), например проверка на mail-tester.com.
- [ ] **Юридические тексты** (`/terms`, `/privacy`) согласованы юристом; задан `VITE_SUPPORT_EMAIL` при сборке frontend (или принято решение оставить без контакта).
- [ ] **План отката прочитан**, `database/rollback/prepare_rollback.sql` на месте на сервере (в репозитории; после `git pull`).

## B. Пуш и первые минуты
1. CI зелёный (backend на fake и на реальном PostgreSQL, frontend: тесты, lint, build). Только потом — `git push`.
2. Следите: `docker compose logs -f backend` — строки `Applying patch 0031…`, `0032…`, затем `Application startup complete`; **нет** `Unsafe configuration`.
3. `curl https://<домен>/api/health` → `{"status":"ok","database":true}`; `https://<домен>/docs` → 404.
4. Пройдите [ручной сценарий](manual-testing-auth.md) (минимум разделы 1–3, 5, 6) реальным ящиком.
5. Создайте администратора (`scripts/create_user.py`), включите 2FA, откройте «Аккаунт и безопасность».
6. Только после этого — сообщение пользователям (своим каналом) с просьбой нажать `/start` у бота и перенести аккаунт.

## C. Мониторинг первых суток
- `docker compose logs backend | grep -E "teamflow.email|WARNING|ERROR"` — ошибки отправки писем, лимиты.
- Всплеск `429`/`account_locked` — возможный подбор; смотрите IP в списке сессий пострадавших.
- Доля подтверждённых регистраций (письма доходят?): `SELECT count(*) FILTER (WHERE email_verified_at IS NOT NULL), count(*) FROM users WHERE email IS NOT NULL;`

## D. Если что-то пошло не так
[docs/rollback.md](rollback.md): подготовка базы (`prepare_rollback.sql`) → откат кода → проверка. Данные пользователей не теряются.
