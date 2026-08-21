# Заметки по локальной разработке

Рабочий журнал важных решений по локальному окружению — чтобы не забыть
и не наступить дважды на одни и те же грабли. Не путать с `docs/configuration.md`
(справочник по всем переменным `.env`) и `docs/deployment.md` (боевой деплой).

## Docker для локальной разработки (`docker-compose.dev.yml`)

Отдельный от боевого `docker-compose.yml` файл — без Caddy/HTTPS/домена,
с hot reload backend и frontend через bind mount.

```
docker compose -f docker-compose.dev.yml up -d --build        # postgres+backend+frontend
docker compose -f docker-compose.dev.yml --profile bot up bot  # бот отдельно, по требованию
```

**Порты нестандартные: backend `8002`, frontend `5175`, postgres `5433`**
(вместо обычных 8000/5173/5432) — на машине разработчика уже заняты другими
Docker-проектами (`football-cards-*`). Если у вас свободны обычные порты —
поменяйте маппинг в `docker-compose.dev.yml`, это не привязано к коду.

Бот (`profiles: ["bot"]`) не поднимается по умолчанию — `create_bot()`
кидает `RuntimeError`, если `TELEGRAM_BOT_TOKEN` пустой, а без него
контейнер уйдёт в crash-loop. Поднимайте явно, когда токен в `.env` есть и
бот реально нужен.

## Вход без Telegram в деве (`DEV_AUTH_ENABLED`)

По умолчанию Mini App работает только внутри настоящего Telegram-клиента —
`@tma.js/sdk`'s `isTMA()` возвращает `false` в обычном браузере, и
`AuthContext` показывает экран «Откройте приложение через Telegram». Это
осознанное ограничение прод-версии (initData физически негде взять без
Telegram), но оно же блокировало обычную разработку в браузере без туннеля.

Решение — `DEV_AUTH_ENABLED=true` в `.env`:

- backend: `app/api/routes/dev_auth.py` — роут `POST /api/auth/dev-login`,
  логинит фиксированного dev-пользователя, **полностью пропуская проверку
  подписи Telegram initData**. Роутер регистрируется в `app/main.py`
  **только если** `settings.dev_auth_enabled` — при выключенном флаге
  эндпоинта не существует вообще (404), а не просто "недоступен".
- frontend: `AuthContext.tsx` — если `isTMA()` вернул `false` и
  `import.meta.env.DEV` (то есть это dev-сборка Vite, не прод-билд), вместо
  экрана "откройте в Telegram" вызывается `devLogin()` из `api/auth.ts`.
  В проде `import.meta.env.DEV` компилируется в `false`, и эта ветка
  вырезается из бандла целиком.

**Двойная защита от утечки в прод:** флаг в конфиге (default `false`,
явно `false` в `.env.production.example` с предупреждением) + фронтенд сам
не станет звать `dev-login` в собранном прод-бандле. Тем не менее: **никогда
не ставьте `DEV_AUTH_ENABLED=true` на песочнице или боевом сервере** — это
не «более мягкий режим», это полное отключение аутентификации.

Локальный `.env` сейчас: `DEV_AUTH_ENABLED=true`, `MINI_APP_URL` и
`CORS_ORIGINS` указывают на `http://localhost:5175` (порт dev-фронтенда
из docker-compose.dev.yml, см. выше).

## Перед релизом / возвращением туннеля — не забыть

- `DEV_AUTH_ENABLED` → `false` (или просто убрать из `.env` — дефолт и так `false`).
- `MINI_APP_URL`, `CORS_ORIGINS` → реальный HTTPS-адрес (туннель или боевой домен).
- `DOMAIN` (сейчас `localhost`, используется только `docker-compose.yml`/Caddy) → реальный домен.
- Если возвращаетесь к обычным портам 8000/5173/5432 — поправить порты в
  `docker-compose.dev.yml` заодно с `VITE_API_BASE_URL` там же.
