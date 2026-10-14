# Безопасность миграций БД и откат

Относится к переходу на веб-авторизацию: патчи `0031_web_auth.sql` и `0032_identities_ratelimit_admin_audit.sql`.
Миграции **не выполняются вручную**: backend применяет их сам при старте (под advisory-lock, поэтому backend и bot, стартующие
одновременно, не мешают друг другу). Ничего из описанного ниже не нужно делать на production до выката.

## Что делают патчи и почему это безопасно для существующей базы

| Оператор | Блокировка / риск | Проверено |
|---|---|---|
| `ALTER COLUMN telegram_id DROP NOT NULL` | только метаданные | — |
| `ADD COLUMN IF NOT EXISTS …` (все новые колонки `users`) | NULL-колонки и `NOT NULL DEFAULT 0` — без перезаписи таблицы (PostgreSQL ≥ 11; в проекте 16) | патчи на 300 000 пользователей: **0,04 с** (`test_migrations_on_a_large_production_sized_users_table…`) |
| `ADD CONSTRAINT users_email_lowercase / preferred_role_valid` | один проход по `users` для проверки (у всех старых строк `email IS NULL` → проходит) | то же |
| `CREATE UNIQUE INDEX users_email_unique … WHERE email IS NOT NULL` | короткая блокировка записи на время построения; индекс частичный, у старых строк email пуст | то же |
| новые таблицы (`user_sessions`, `auth_tokens`, `user_mfa`, `user_identities`, `rate_limit_hits`) | не затрагивают существующие данные | — |
| `admin_audit_log`: `DROP NOT NULL`, колонка `admin_user_id`, `CHECK (telegram_id IS NOT NULL OR user_id IS NOT NULL)` | все старые строки имеют `admin_telegram_id` → проверка проходит | `test_migration_0032_keeps_existing_audit_rows…` |
| `DROP` чего-либо | **нет**. `browser_login_tokens` намеренно оставлена (нужна прежней версии при откате) | — |

Каждый патч выполняется в одной транзакции: при ошибке он откатывается целиком, а `schema_versions` не получает записи — повторный старт
попробует снова. Оба патча идемпотентны (повторный запуск ничего не меняет и не падает; это проверяют тесты). Существующие
пользователи сохраняют `id` и `telegram_id`, без email и пароля — войти по паролю они смогут только после переноса аккаунта через бота.

### Как проверить на копии production-базы (рекомендуется перед выкатом)

```bash
# 1. дамп боевой базы (читает, ничего не меняет)
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > backup-before-web-auth.dump

# 2. поднять одноразовую БД на этом сервере (или на своём компьютере) и восстановить в неё дамп
docker run -d --name pg-scratch -e POSTGRES_PASSWORD=scratch -p 127.0.0.1:55432:5432 postgres:16-alpine
docker exec -i pg-scratch pg_restore -U postgres -d postgres --no-owner < backup-before-web-auth.dump

# 3. прогнать миграции новой версии на копии (НЕ на боевой базе)
cd backend && DATABASE_URL=postgresql://postgres:scratch@127.0.0.1:55432/postgres ENV_FILE=/dev/null \
  python -c "import asyncio;from app.config import get_settings;from app.database import create_pool,run_migrations
async def m():
    p=await create_pool(get_settings()); await run_migrations(p); await p.close()
asyncio.run(m())"

# 4. убрать копию
docker rm -f pg-scratch
```

## Откат

**Данные откатывать не нужно.** Схема изменена только добавлениями (плюс снятие `NOT NULL` с `users.telegram_id`), прежняя версия кода
работает на схеме v32 без изменений. Откат — это откат кода, плюс одна подготовительная команда (ниже).

Проверено автоматически (`database/rollback/check_rollback_compat.py`: прежняя версия `a70ea3d` запускается на базе, которую уже
мигрировала и использовала новая): запуск, вход через Telegram старого пользователя, профили, команды, календарь, уведомления,
объявления, бронирования, регистрация нового Telegram-пользователя, старый вход через бота (таблица цела), сохранность данных
веб-пользователей.

### Что ломается при откате и как это закрыть

1. **Пользователи, зарегистрированные на сайте, не смогут войти** в прежнюю версию (она знает только вход через Telegram). Их данные
   остаются в базе нетронутыми и снова будут доступны после возврата на новую версию.
2. **Фоновая отправка уведомлений прежней версии падает на пользователях без Telegram** (`chat_id=None`) — на каждом проходе цикла, и
   это блокирует уведомления остальным. Поэтому *перед* откатом выполните:

   ```bash
   docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
       < database/rollback/prepare_rollback.sql
   ```

   Скрипт помечает такие уведомления как обработанные (в колокольчике на сайте они остаются) и ставит триггер, который делает то же для
   новых. Структуру таблиц он не меняет и ничего не удаляет. (Без него проверка падает — это тоже показывает скрипт: `APPLY_PREPARE=0`.)
3. Рассылку `/broadcast` в прежней версии не запускайте, пока есть пользователи без Telegram (список получателей содержит `NULL`).

### Порядок отката

```bash
# 0. убедитесь, что есть свежий бэкап (pg_dump выше)
# 1. подготовить базу к прежней версии
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < database/rollback/prepare_rollback.sql
# 2. вернуть код (на сервере) и пересобрать
git log --oneline -8                       # найдите коммит ДО перехода на веб-авторизацию (a70ea3d)
git reset --hard a70ea3d && docker compose up -d --build
# 3. проверка
curl https://ВАШ_ДОМЕН/api/health          # {"status":"ok","database":true}
```

Если автодеплой включён, откатывать нужно и в GitHub (`git revert` + push), иначе следующий push вернёт новую версию. Старые `.env`-значения
подходят прежней версии (лишние переменные игнорируются), но ей нужны `TELEGRAM_BOT_TOKEN`, `MINI_APP_URL`, `JWT_SECRET`.

### Возврат на новую версию после отката

```bash
git reset --hard <коммит с веб-авторизацией> && docker compose up -d --build
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < database/rollback/finish_roll_forward.sql
```

(второй шаг убирает триггер из подготовки к откату; он безвреден, но лишний.)

### Чего откат не восстанавливает

Сессии, одноразовые ссылки и счётчики лимитов остаются в своих таблицах (прежняя версия их не читает). Если нужно «как было до миграции» —
восстановите базу из бэкапа командой `pg_restore` в **новую** пустую базу и переключите `DATABASE_URL`; это потеряет всё, что появилось после
бэкапа (регистрации, записи), поэтому используйте только при порче данных.
