# Мобильное приложение (Android, React Native + Expo)

Код приложения лежит в `mobile/`. Здесь — то, что приложению нужно от backend.

## Вход по токену

`POST /api/auth/mobile/login` — тело как у `/api/auth/login` (`email`, `password`). Работает только при
`MOBILE_AUTH_ENABLED=true`, иначе `404`.

Проверки те же, что у входа на сайте (общая функция `_verify_login`): лимиты по IP и по адресу, блокировка после
серии неудач, одинаковое время ответа для неизвестных адресов, заблокированный аккаунт, неподтверждённая почта.

Ответ: пользователь (как у `/auth/me`) плюс

| Поле | Значение |
|---|---|
| `access_token` | обычный токен сессии; приложение хранит его только в `expo-secure-store` |
| `expires_at` | момент, до которого сессия действует при простое |

Cookie не ставится, `csrf_token` не отдаётся. Токен шлётся как `Authorization: Bearer <access_token>`; для запросов
с Bearer CSRF не нужен. Выход — `POST /api/auth/logout` (сессия отзывается на сервере), список и завершение
сессий — `GET /api/auth/sessions`, `DELETE /api/auth/sessions/{id}`.

`POST /api/auth/mobile/verify-email` — подтверждение почты с автовходом: тело как у `/verify-email`, в ответе `session` (как у mobile/login) или `null` для заблокированного аккаунта или аккаунта с 2FA.

`MOBILE_AUTH_ENABLED=true` включает приём Bearer для всех маршрутов (так же, как `BEARER_AUTH_ENABLED`).

## Ещё не сделано

Вход с 2FA (второй шаг кодом), регистрация устройств для push,
`app-config`, App Links — отдельными этапами (релизные пункты в конце).
