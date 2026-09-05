# Два бота на одном сервере — как всем этим управлять

Справочник по серверу `89.127.200.98`, на котором рядом живут два независимых
проекта. Не путать с [deployment.md](deployment.md) (это гайд «с нуля на
чистом сервере») — этот файл про то, как безопасно работать, когда сервер
уже общий.

## Общая схема

```
                        Интернет (80/443)
                              │
                    ┌─────────▼─────────┐
                    │  Системный Caddy   │   /etc/caddy/Caddyfile
                    │ (systemd, не в     │   один процесс на весь сервер,
                    │  Docker)           │   держит порты 80 и 443
                    └──────────┬─────────┘
             ┌──────────────────┴──────────────────┐
             │ по Host-заголовку (SNI)              │
   footycards.ru                          sportarenamba.ru
             │                                       │
   127.0.0.1:8090                          127.0.0.1:8100
             │                                       │
  ┌──────────▼──────────┐              ┌─────────────▼─────────────┐
  │ football-cards       │              │ sporthelper                │
  │ /root/footyCards3     │              │ /opt/sporthelper            │
  │ compose project:      │              │ compose project:            │
  │  football-cards        │              │  sporthelper                 │
  │                          │              │                               │
  │ nginx   → :8090 (host)   │              │ frontend → 127.0.0.1:8100     │
  │ bot     → :8081 (host)   │              │ backend  → 127.0.0.1:8101     │
  │ backend (internal)        │              │ bot      (internal, polling) │
  │ postgres (internal)        │              │ postgres (internal)           │
  └──────────────────────────┘              └───────────────────────────────┘
```

Оба проекта — **полностью изолированные** Docker Compose проекты (свои сети,
свои volumes, свои контейнеры). Пересекаются только на уровне хоста: общий
Caddy и общий список занятых портов.

## Где что лежит

| | football-cards (первый бот) | sporthelper (этот проект) |
|---|---|---|
| Папка на сервере | `/root/footyCards3` | `/opt/sporthelper` |
| Compose-файл | `docker-compose.prod.yml` (+ override) | `docker-compose.coexist.yml` |
| Домен | `footycards.ru` | `sportarenamba.ru` |
| Порт фронтенда на хосте | `8090` | `127.0.0.1:8100` |
| Порт backend на хосте | — (только внутри сети) | `127.0.0.1:8101` |
| `.env` | `/root/footyCards3/.env` | `/opt/sporthelper/.env` |

**Важно:** `/opt/sporthelper` содержит два compose-файла —
`docker-compose.yml` (стандартный, из `deployment.md`, сам пытается занять
80/443) и `docker-compose.coexist.yml` (тот, что реально используется на этом
сервере). **Всегда** явно указывайте `-f docker-compose.coexist.yml` — если
запустить `docker compose up` без `-f`, Docker возьмёт стандартный файл и
попробует занять 80/443, что уронит Caddy и, возможно, зацепит первого бота.

Чтобы не забывать флаг, можно один раз создать удобный алиас на сервере:

```bash
cat >> ~/.bashrc <<'EOF'
alias dc-sporthelper='docker compose -f /opt/sporthelper/docker-compose.coexist.yml'
EOF
source ~/.bashrc
```

Дальше в этом файле команды показаны как есть (`docker compose -f
docker-compose.coexist.yml ...`, из каталога `/opt/sporthelper`) — с алиасом
это просто `dc-sporthelper ...` из любого места.

## Проверить статус

```bash
# оба бота одной командой
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# только sporthelper
cd /opt/sporthelper && docker compose -f docker-compose.coexist.yml ps

# только football-cards
cd /root/footyCards3 && docker compose -f docker-compose.prod.yml ps
```

## Посмотреть логи

```bash
# sporthelper
cd /opt/sporthelper
docker compose -f docker-compose.coexist.yml logs -f bot        # только бот, в реальном времени
docker compose -f docker-compose.coexist.yml logs backend --tail 100

# football-cards — аналогично, но без -f docker-compose.coexist.yml,
# смотрите какой у него файл (docker-compose.prod.yml)
cd /root/footyCards3
docker compose logs -f bot
```

## Обновить sporthelper (после `git push` в `main`)

```bash
cd /opt/sporthelper
git pull origin main
docker compose -f docker-compose.coexist.yml up -d --build
docker compose -f docker-compose.coexist.yml ps
```

Это пересобирает и перезапускает **только** контейнеры `sporthelper-*`.
football-cards продолжает работать без единого перезапуска — это разные
Docker Compose проекты, `up`/`build` одного никак не касается другого.

## Перезапустить / остановить / запустить один бот

```bash
cd /opt/sporthelper
docker compose -f docker-compose.coexist.yml restart bot   # только бот
docker compose -f docker-compose.coexist.yml stop          # весь стек sporthelper
docker compose -f docker-compose.coexist.yml start         # поднять обратно
```

`stop`/`start` (без `down`) не трогают volumes — база данных сохраняется.
**Никогда** не используйте `docker compose down -v` — флаг `-v` стирает
volume, то есть базу данных, безвозвратно.

## Бэкапы баз данных

У каждого бота — своя, отдельная база в отдельном контейнере. Бэкапить нужно
обе, отдельными командами:

```bash
mkdir -p /opt/backups

# sporthelper (имя базы/юзера — то, что в /opt/sporthelper/.env, POSTGRES_DB/POSTGRES_USER)
cd /opt/sporthelper
docker compose -f docker-compose.coexist.yml exec postgres \
  pg_dump -U teamflow teamflow > /opt/backups/sporthelper_$(date +%Y%m%d).sql

# football-cards — своей командой, из его каталога, с его именами базы/юзера
cd /root/footyCards3
docker compose exec postgres pg_dump -U <его_user> <его_db> \
  > /opt/backups/footycards_$(date +%Y%m%d).sql
```

Автоматизация через `crontab -e` — так же, как описано в
[deployment.md](deployment.md#бэкапы--обязательно-настройте-это-единственная-копия-ваших-данных),
но с двумя строчками (по одной на проект) и разными именами файлов.

## Системный Caddy — общая точка, где оба бота встречаются

Файл: `/etc/caddy/Caddyfile`. Два блока, каждый отвечает за свой домен:

```caddyfile
footycards.ru {
    reverse_proxy 127.0.0.1:8090
}

sportarenamba.ru {
    reverse_proxy 127.0.0.1:8100
}
```

**Правила работы с этим файлом** (он общий — ошибка здесь может задеть
обоих ботов):

1. Перед любым изменением — бэкап: `sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.$(date +%Y%m%d-%H%M)`
2. Правьте только свой блок, не трогайте чужой.
3. Обязательно проверяйте синтаксис **перед** применением:
   ```bash
   sudo caddy validate --config /etc/caddy/Caddyfile
   ```
4. Применяйте через `reload`, не `restart` — `reload` не разрывает уже
   открытые соединения ни у одного из ботов:
   ```bash
   sudo systemctl reload caddy
   sudo systemctl status caddy --no-pager
   ```
5. Если что-то пошло не так — откатите бэкап из шага 1 и повторите `reload`.

## Если понадобится третий бот на этом сервере

Тот же рецепт: своя папка (например `/opt/<имя>`), свой `.env`, свой
compose-файл (скопировать `docker-compose.coexist.yml` и поменять только
порты — например `127.0.0.1:8200`/`127.0.0.1:8201`, следующие свободные),
свой домен, и ещё один блок в `/etc/caddy/Caddyfile` по образцу выше.
Занятые порты на сервере сейчас: `8081`, `8090`, `8100`, `8101`, плюс `8080`
занят чем-то посторонним (`beadmin`, не из этих двух проектов) — новые
порты берите за пределами этого списка.

## Быстрая диагностика

| Симптом | Что проверить |
|---|---|
| Один из доменов не открывается | `curl -sI https://ДОМЕН/api/health`; если TLS/сертификат — смотрите `sudo systemctl status caddy` и `sudo journalctl -u caddy -n 50` |
| Бот не отвечает в Telegram | `docker compose -f docker-compose.coexist.yml logs bot --tail 50` — почти всегда видно причину (неверный токен, не поднялся backend) |
| Контейнер в рестарт-лупе | `docker compose -f docker-compose.coexist.yml logs <сервис>` |
| Не понятно, какой контейнер чей | `docker ps` — имя контейнера всегда с префиксом проекта: `sporthelper-*` или `football-cards-*` |
| После `docker compose up` пропал первый бот | Проверьте, что команда выполнялась с `-f docker-compose.coexist.yml` из `/opt/sporthelper` — без флага мог подхватиться `docker-compose.yml`, пытающийся занять 80/443 |

## Чего никогда не делать

- Не запускать `docker compose` (в `/opt/sporthelper`) без `-f docker-compose.coexist.yml`.
- Не редактировать файлы внутри `/root/footyCards3` — это не ваш проект.
- Не использовать `docker compose down -v` ни для одного из проектов.
- Не менять `/etc/caddy/Caddyfile` без предварительного `caddy validate` и бэкапа.
- Не использовать `systemctl restart caddy` вместо `reload`, если не крайняя необходимость — `restart` на секунду обрывает обоих ботов, `reload` — нет.
