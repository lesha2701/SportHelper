# REF-19 — время занятий против реальных часов

**Решение владельца (11.11.2026): вариант A.** Реализовано: `SESSION_TIMEZONE` + `app/core/session_time.py`, все сравнения
из карты ниже, поле `has_started` в `BookingOut` (web, iOS, Android берут его вместо часов устройства), патч
`0044_training_reminders_session_time.sql` (стоящие в очереди напоминания пересчитаны; напоминания о уже начавшихся тренировках
отозваны), описание полей времени в `docs/openapi.json`, подпись «(UTC)» убрана из описания платежа и заголовка чата.

## Как устроено сейчас

Все времена занятий — это **настенное время** («в 10:00»), без часового пояса:

| Данные | Хранение | Что внутри |
|---|---|---|
| `coach_listing_availability.start_time/end_time` | `TIME` | часы тренера «10:00–18:00» |
| `bookings.starts_at` | `TIMESTAMPTZ` | настенное время, записанное **как UTC** (`10:00Z` = «в 10:00») |
| `booking_cancellations.session_starts_at` | `TIMESTAMPTZ` | снимок `starts_at`, та же конвенция |
| `trainings.training_date + start_time`, `matches.match_date + start_time` | `DATE` + `TIME` | настенное время; `confirm_booking` кладёт сюда `starts_at.date()/.time()` |

Клиенты это знают и показывают «как есть»: web — `timeZone: "UTC"`, iOS — `Date.serverDay/serverTime` на UTC-календаре,
Android — `formatStart(... timeZone: "UTC")`. Отображение сейчас правильное и согласованное между тремя клиентами.

Ошибка — там, где это настенное время сравнивается с **реальным** моментом (`now()`, `datetime.now(utc)`, `Date.now()`):
для Москвы (UTC+3) все такие правила срабатывают на 3 часа позже.

## Карта мест, где настенное время встречается с реальными часами

### Backend — сравнения момента (ошибка 3 ч)
1. `services/cancellations.py` `check_cancellable` — `starts_at <= now` → `session_started`: отмена возможна до 3 ч **после** реального начала.
2. `services/cancellations.py` `make_plan` — `hours_before_start` и `free_until = starts_at − CANCEL_FREE_HOURS` против `now`: бесплатное окно фактически 21 ч вместо 24.
3. `repositories/bookings.py` `can_cancel` (флаг `can_cancel` для кнопки) — то же, что п.1.
4. `repositories/bookings.py` `is_completed` — конец занятия против `now`: отзывы открываются на 3 ч позже.
5. `repositories/bookings.py` `confirm_booking` — `starts_at <= now`: тренер может подтвердить заявку до 3 ч после реального начала.
6. `repositories/bookings.py` `sweep_expired` — SQL `starts_at < now()`: просроченные pending живут на 3 ч дольше.
7. `api/routes/bookings.py` mark conducted — `starts_at > now` → `session_not_started`: «Тренировка проведена» доступна на 3 ч позже.
8. `services/payments.py` `ensure_payable` — конец занятия против `now`: оплатить можно до 3 ч после реального окончания.
9. `repositories/coach_listings.py` `compute_open_slots` — `cursor > now`: слоты, которые уже начались (до 3 ч), всё ещё предлагаются к записи; плюс `_next_available_slot` берёт `date.today()` (дата сервера).
10. `repositories/coach_listings.py` ~101 — «есть активные записи» (запрет удалить объявление): `starts_at + duration > now()`.
11. `repositories/admin_content.py` ~109 — то же для админки.
12. `repositories/admin_stats.py` ~43 — `bookings_upcoming`: `starts_at >= now()`.
13. `services/notifications.py` `_combine_date_time` — напоминания о тренировках строятся как UTC → `send_at` на 3 ч позже реального (напоминание «за 60 мин» приходит через 2 ч после начала).

### Backend — сравнения даты (ошибка только 00:00–03:00 МСК)
`CURRENT_DATE` / `date.today()` берут дату в UTC (PostgreSQL в Docker — UTC):
`repositories/trainings.py` `HELD` / `UPCOMING` / сортировка «сначала будущие» (а через `HELD` — авто-посещаемость `initialize_held_attendance`, статистика),
`repositories/matches.py` сортировка, `repositories/admin_content.py` ~54 фильтр upcoming/past, `admin_stats.py` ~39.

### Backend — только текст (верно, если трактовать как настенное)
`notifications.py` (тексты «в 10:00»), `chat.py` ~70 — корректны. `payments.py` ~119 описание платежа: `"... 10:00 (UTC)"` — подпись «(UTC)» неверна, это московское время.

### Web (frontend/)
- Показ (`timeZone: "UTC"`) в `MyBookingsSection`, `CoachBookingsSection`, `BookingFlow`, `CancelBooking`, `IncomingBookingsScreen`, `CoachMarketplaceScreen` — **верно**, менять не надо.
- `CoachSessionActions.tsx:27` — `new Date(startsAt) <= Date.now()`: кнопка «Тренировка проведена» появляется на 3 ч позже.
- `BookingFlow.tsx` `nextNDays/toDateKey` — локальная дата → `toISOString()` (UTC-дата): с 00:00 до 03:00 МСК первый день в ленте — «вчера». `types/training.ts:12` — та же UTC-дата «сегодня».

### iOS
- Показ (`serverDay/serverTime`, `CancelWording.moment`) — **верно**.
- `Booking.coachCanMarkConducted(now: Date())` — `startsAt <= now`: та же ошибка, что на web.

### Android (mobile/) и контракт `docs/openapi.json`
- Показ (`formatStart`, `timeOf`, `groupSlotsByDay` в UTC) — **верно**.
- `booking/SessionParts.tsx:96` — `started = startsAt <= Date.now()`: та же ошибка.
- В контракте `starts_at`, `free_cancel_until`, `next_available_slot`, `OpenSlotOut.starts_at` — `date-time` с `Z`, но по смыслу это настенное время. Нигде не описано.

## Варианты

### A. Настенное время остаётся в хранении и API; backend переводит его в реальный момент через `SESSION_TIMEZONE` *(рекомендую)*
- Новая настройка `SESSION_TIMEZONE=Europe/Moscow` (по умолчанию; одна на платформу) и один модуль `app/core/session_time.py`:
  `wall_now()` («который сейчас час на часах платформы», в той же конвенции, что `starts_at`),
  `wall_today()`, `instant_of(date, time)` / `instant_of_wall(starts_at)` (настенное → реальный UTC-момент, для `send_at`).
- Все 13 сравнений выше переходят на `wall_now()` (в SQL — параметром `$n`, без `now()`), даты — на `wall_today()`,
  напоминания — на `instant_of(...)`. Правило одно: **настенное сравниваем с настенным, в очередь кладём реальный момент.**
- В `BookingOut` добавляется флаг `has_started` (сервер решает, как уже с `can_cancel`); web/iOS/Android берут его вместо `Date.now()`.
- В `openapi.json` описания полей: «настенное время платформы (SESSION_TIMEZONE), записанное как UTC; показывать в UTC».
- Подпись «(UTC)» в описании платежа → «(МСК)» / без пояса.

**Миграция и совместимость:**
- Миграции БД нет. Существующие записи трактуются верно (они и были «по-московски»).
- Ставшие в очередь (ещё не отправленные) напоминания о тренировках пересчитываются: одноразовый скрипт/шаг тика сдвигает
  `send_at` на −3 ч у pending `training_reminder` (или пересоздаёт их через `schedule_training_reminders`).
- `booking_cancellations.hours_before_start` у уже сделанных отмен посчитаны с ошибкой — не трогаем (это история уже исполненных возвратов).
- Старые сборки iOS/Android/web: показ не меняется; единственное — кнопка «проведена» у них по-прежнему появляется на 3 ч позже,
  пока клиент не обновится (сервер её уже разрешит раньше). Ничего не ломается, `has_started` — аддитивное поле.

Минус: если появятся тренеры в других часовых поясах, понадобится пояс на тренера/объявление (но модуль `session_time` — ровно то место, куда его добавить).

### B. Хранить реальные моменты (`starts_at` = настоящий UTC)
- Миграция: `bookings.starts_at` и `booking_cancellations.session_starts_at` сдвинуть на −3 ч; `compute_open_slots` и
  `confirm_booking` всё равно переводят через `SESSION_TIMEZONE` (часы тренера и тренировки остаются настенными).
- Все три клиента меняют показ с `timeZone: "UTC"` на пояс платформы/устройства.
- **Ломает установленные iOS/Android-сборки:** до обновления они покажут «07:00» вместо «10:00» и разойдутся с календарём
  тренировок (там настенное время). Нужен одновременный релиз сервера и принудительное обновление приложений.
- Плюс: API становится «честным» и готовым к нескольким поясам. Минус: дороже, рискованнее, и всё равно нужна та же настройка пояса.

## Рекомендация
**A.** Один источник правды о поясе (`SESSION_TIMEZONE`), без миграции данных, без поломки клиентов в сторах; клиенты получают
только аддитивный `has_started`. Тесты: граничные случаи отмены (ровно 24 ч до начала по Москве, за минуту до/после реального начала),
просрочка pending, слоты «уже начались», `send_at` напоминания, `has_started`, плюс тесты web/Android на флаг.
