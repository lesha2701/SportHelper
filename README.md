# SportArenaGlobal для iOS

Нативное приложение (SwiftUI) для платформы SportArenaGlobal. Сервер и сайт живут в другом репозитории
(`lesha2701/SportHelper`); здесь только iOS. Полное задание — [docs/BRIEF.md](docs/BRIEF.md), контракт сервера —
[docs/openapi-mobile.json](docs/openapi-mobile.json).

## Что здесь есть

- `Sources/SportArenaKit` — всё, что не экран: клиент сервера (`APIClient`: cookie-сессия + `X-CSRF-Token`, разбор ошибок,
  даты ISO 8601), модели и сервисы (`AuthService`: вход, выход, регистрация, `/api/features`).
- `Tests/SportArenaKitTests` — тесты на поддельном сервере (`MockServer`), без сети.
- Приложение (SwiftUI-проект) добавится на следующем шаге и будет подключать `SportArenaKit`.

## Как проверить

```bash
swift test      # без Xcode, 17 тестов
```

## Правила

См. [CLAUDE.md](CLAUDE.md).
