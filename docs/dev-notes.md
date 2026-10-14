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

Бот (`profiles: ["bot"]`) не поднимается по умолчанию — он необязателен
(сайт работает без Telegram), а `create_bot()` кидает `RuntimeError`, если
`TELEGRAM_BOT_TOKEN` пустой, и контейнер ушёл бы в crash-loop. Поднимайте явно,
когда токен в `.env` есть и бот нужен (перенос старых аккаунтов, уведомления).

## Вход в деве

Telegram для разработки не нужен: сайт открывается в обычном браузере, регистрация идёт по email и паролю.

- **Docker-стек**: `docker compose -f docker-compose.dev.yml up -d --build` поднимает ещё и **Mailpit** — все письма сайта
  (подтверждение email, сброс пароля, уведомления безопасности) лежат на <http://localhost:8025>. В `.env` задайте
  `APP_BASE_URL=http://localhost:5175` и `CORS_ORIGINS=http://localhost:5175`.
- **Без Docker**: письма без SMTP печатаются в лог backend вместе со ссылкой (только при `APP_MODE != main`).
- **Быстрый аккаунт без писем**: `python backend/scripts/create_user.py me@example.com "Имя"` — создаёт подтверждённого
  пользователя (пароль спросит скрытым вводом).
- **API без браузера** (Swagger, curl): войдите `POST /api/auth/login`; тот же токен сессии можно слать как
  `Authorization: Bearer <токен>`. В Swagger UI — кнопка Authorize. (Для cookie-сессии браузера нужен заголовок
  `X-CSRF-Token`, для Bearer — нет.)
- Cookie ставится на хост (`localhost`), порты не различаются, поэтому frontend на `:5173/:5175` и backend на `:8000/:8002`
  делят сессию — это «один сайт» для браузера. `COOKIE_SECURE` не нужен на `http://localhost`.

Прежний `DEV_AUTH_ENABLED` (вход без проверки подписи Telegram) **удалён** вместе с самим Telegram-входом.

## Перед релизом — не забыть

- Чек-лист — в конце [docs/auth.md](auth.md): HTTPS, `JWT_SECRET`, SMTP + SPF/DKIM, `ADMIN_EMAILS`, `APP_BASE_URL`, `CORS_ORIGINS`.
- `DOMAIN` (локально `localhost`, используется только `docker-compose.yml`/Caddy) → реальный домен.
- Если возвращаетесь к обычным портам 8000/5173/5432 — поправить порты в
  `docker-compose.dev.yml` заодно с `VITE_API_BASE_URL` там же.
