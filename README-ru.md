# PostgreSQL MCP Сервер

Также доступно на английском: [README.md](README.md)

[![CI](https://github.com/VitalyOstanin/postgres-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/VitalyOstanin/postgres-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@vitalyostanin/postgres-mcp.svg)](https://www.npmjs.com/package/@vitalyostanin/postgres-mcp)

**Примечание**: Этот проект разработан для моих личных нужд. Я не планирую расширять его функциональность возможностями, которые я не использую и не могу проверить. Вы свободны предлагать идеи и создавать pull request'ы, но я не гарантирую, что всё будет принято.

MCP сервер для всесторонней интеграции с PostgreSQL со следующими возможностями:

- **Операции с базами данных** - подключение к экземплярам PostgreSQL, список баз данных и схем
- **Управление таблицами** - список таблиц, представлений, функций и получение детальной информации
- **Инструменты запросов** - выполнение SELECT, INSERT, UPDATE, DELETE запросов с полным синтаксисом PostgreSQL
- **Управление подключениями** - управление подключениями PostgreSQL с поддержкой режима только для чтения
- **Потоковое сохранение в файлы** - потоковое сохранение больших наборов данных в файлы
- **Режим только для чтения** - безопасные операции только для чтения, предотвращающие случайное изменение данных
- **Мониторинг** - статистика базы данных, метрики производительности
- **Операции со схемой** - создание, изменение и удаление таблиц, представлений, функций и индексов

## Содержание

- [Требования](#требования)
- [Конфигурация для VS Code Cline](#конфигурация-для-vs-code-cline)
- [Разработка](#разработка)
  - [Структура проекта](#структура-проекта)
  - [Сборка](#сборка)
  - [Тесты](#тесты)
  - [Линт и форматирование](#линт-и-форматирование)
  - [Локальный контейнер PostgreSQL](#локальный-контейнер-postgresql)
- [MCP Инструменты](#mcp-инструменты)
  - [Инструменты для режима только для чтения](#инструменты-для-режима-только-для-чтения)
  - [Инструменты для режима с возможностью записи](#инструменты-для-режима-с-возможностью-записи)
  - [Ограничения режима только для чтения](#ограничения-режима-только-для-чтения)

## Требования

- Node.js ≥ 22
- Переменные окружения:
  - `POSTGRES_MCP_CONNECTION_STRING` — строка подключения к PostgreSQL (в формате postgresql://)
  - `POSTGRES_MCP_TIMEZONE` — опциональная таймзона для операций с датами (по умолчанию: `Europe/Moscow`), должна быть валидным идентификатором IANA (например, `Europe/London`, `America/New_York`, `Asia/Tokyo`)
  - `POSTGRES_MCP_OUTPUT_DIRS` — опциональный `:`-разделённый whitelist каталогов, куда разрешена запись `filePath` в инструменте `execute-sql` (по умолчанию: только OS temp). Используйте, если LLM-клиенту нужно сохранять выгрузки рядом с проектом, например `POSTGRES_MCP_OUTPUT_DIRS=/var/data/exports:/srv/dumps`.
- CLI-флаги (передаются через `args` в конфигурации MCP-клиента):
  - `--read-only` / `--no-read-only` — старт в режиме только-чтения или чтение-запись. По умолчанию: `--read-only`. Чтобы разрешить запись, добавьте `--no-read-only` в args MCP-клиента.
  - `--pool-size <n>` — размер пула подключений (по умолчанию: 1).
  - `--idle-timeout <ms>` — таймаут простоя соединений в пуле (по умолчанию: 30000).
  - `--connection-timeout <ms>` — таймаут начального подключения (по умолчанию: 10000).
  - `--auto-connect` — подключаться при старте с использованием `POSTGRES_MCP_CONNECTION_STRING`. По умолчанию: выключено.

## Конфигурация для VS Code Cline

Чтобы использовать этот MCP сервер с расширением [Cline](https://github.com/cline/cline) в VS Code:

1. Откройте VS Code с установленным расширением Cline
2. Нажмите иконку MCP Servers в верхней навигации Cline
3. Выберите вкладку "Configure" и нажмите "Configure MCP Servers"
4. Добавьте следующую конфигурацию в `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "postgres-mcp": {
      "command": "npx",
      "args": ["-y", "@vitalyostanin/postgres-mcp@latest"],
      "env": {
        "POSTGRES_MCP_CONNECTION_STRING": "postgresql://localhost:5432/postgres"
      }
    }
  }
}
```

**Примечание:** Эта конфигурация использует npx для запуска опубликованного пакета. Переменная окружения `POSTGRES_MCP_TIMEZONE` опциональна. Размер пула задаётся CLI-флагом `--pool-size` (по умолчанию `1`); через переменные окружения он не настраивается.

## Разработка

Раздел для разработчиков и операторов, которые работают со сборкой из репозитория. Подробные правила стиля и code review для AI-агентов лежат в [AGENTS.md](AGENTS.md).

```bash
git clone https://github.com/VitalyOstanin/postgres-mcp.git
cd postgres-mcp
npm install
```

Рекомендуемая для разработки версия Node.js — 24 (см. [.nvmrc](.nvmrc)). Минимум в `engines.node` зафиксирован на `>=22`, чтобы пакет публиковался для Node 22 LTS; CI прогоняет матрицу на 22.x и 24.x.

### Структура проекта

- `index.ts` — CLI-точка входа (`bin: postgres-mcp`); парсит аргументы, подключает stdio-транспорт, регистрирует обработчики сигналов.
- `src/server.ts` — класс `PostgreSQLServer`; владеет жизненным циклом пула и регистрирует все MCP-инструменты.
- `src/postgres-client.ts` — тонкая async-обёртка над `pg.Pool` (lifecycle, `executeQuery`, `streamQuery`, `withTransaction`).
- `src/tools/` — по одному файлу на MCP-инструмент (`connect`, `disconnect`, `service-info`, `list-schemas`, `list-objects`, `show-object`, `execute-sql`, `index-operation`).
- `src/utils/` — общие helper-ы: connection guard, redaction, identifier quoting, pagination, валидация SQL-параметров, безопасные пути для файлов, streaming, разбор запросов.
- `src/defaults.ts` — единый источник дефолтов для пула, таймаутов, timezone, лимитов пагинации.
- `test/` — unit-тесты vitest (мокают пул); `test-integration/` — интеграционные тесты vitest, идущие в реальный контейнер PostgreSQL.

### Сборка

| Команда             | Что делает                                                                          |
| ------------------- | ----------------------------------------------------------------------------------- |
| `npm run build`     | Компиляция TypeScript по `tsconfig.build.json` в `dist/`. `postbuild` ставит `+x` и копирует `package.json` в `dist/`. |
| `npm run dev`       | Watch-режим TypeScript (`tsc --watch`). Сам stdio MCP-сервер не перезапускается — после пересборки нужно вручную перезапустить MCP-клиент. |
| `npm start`         | Запустить собранный сервер (`node dist/index.js`). После `npm run build`.            |
| `npm run typecheck` | `tsc -p tsconfig.json --noEmit` (покрывает `src/`, `test/`, `test-integration/`, файлы корня). |

### Тесты

| Команда                          | Что делает                                                                  |
| -------------------------------- | --------------------------------------------------------------------------- |
| `npm test`                       | Unit-тесты (`vitest run` по `test/`).                                       |
| `npm run test:watch`             | Unit-тесты в watch-режиме.                                                  |
| `npm run test:coverage`          | Unit-тесты с coverage; HTML-отчёт в `coverage/index.html`.                  |
| `npm run test:integration`       | Интеграционные тесты по локальному контейнеру PostgreSQL.                   |
| `npm run test:integration:up`    | `podman-compose -f compose.yaml up -d` — поднять контейнер.                 |
| `npm run test:integration:down`  | `podman-compose -f compose.yaml down` — погасить и удалить контейнер.       |

Unit-набор использует мок пула (`test/__mocks__/postgres-client.mock.ts`); интеграционному набору нужен запущенный PostgreSQL на `127.0.0.1:55432` — поднимите его через `npm run test:integration:up`, затем `npm run test:integration`.

### Линт и форматирование

Форматирование зашито в стилистические правила ESLint (отдельной конфигурации Prettier нет). Команды:

| Команда             | Что делает                                                       |
| ------------------- | ---------------------------------------------------------------- |
| `npm run lint`      | Прогнать ESLint по `.ts` / `.mts` (плоский конфиг `eslint.config.mjs`). |
| `npm run lint:fix`  | То же самое плюс автофиксы безопасных правил.                   |
| `npm run format`    | Алиас `lint:fix`. Используйте удобное вам имя.                  |

### Локальный контейнер PostgreSQL

[`compose.yaml`](compose.yaml) объявляет PostgreSQL 18 с биндингом на `127.0.0.1:55432` и одноразовыми учётными данными `test:test`. Эти учётные данные намеренные — они же используются в CI-сервисе и в `test/setup.ts` / `test-integration/setup.ts`. Не меняйте binding на `0.0.0.0` и не копируйте `compose.yaml` в production-окружение.

```bash
npm run test:integration:up      # поднять контейнер в фоне
npm run test:integration         # прогнать интеграционные тесты
npm run test:integration:down    # остановить и удалить контейнер
```

## MCP Инструменты

### Инструменты для режима только для чтения

#### `service-info`
Получить информацию о сервисе PostgreSQL и текущем состоянии подключения. Без параметров.

#### `connect`
Открыть подключение, используя `POSTGRES_MCP_CONNECTION_STRING`.
- `readonlyMode` (boolean, по умолчанию `true`).
- `poolSize` (number, по умолчанию `1`).
- `idleTimeoutMillis` (number, по умолчанию `30000`).
- `connectionTimeoutMillis` (number, по умолчанию `10000`).

#### `disconnect`
Закрыть пул и сбросить состояние подключения. Без параметров.

#### `list-schemas`
Список пользовательских схем (без `information_schema`, `pg_catalog`, `pg_toast`).
- `limit` (number, 1–1000, по умолчанию `100`).
- `offset` (number, по умолчанию `0`).

#### `list-objects`
Список таблиц, представлений и функций в схеме.
- `schema` (string, по умолчанию `'public'`).
- `type` (`'table' | 'view' | 'function' | 'all'`, по умолчанию `'all'`).
- `limit` (number, 1–1000, по умолчанию `100`).
- `offset` (number, по умолчанию `0`).

#### `show-object`
Подробная информация о конкретной таблице, представлении или функции.
- `schema` (string, по умолчанию `'public'`).
- `name` (string, обязательный).
- `type` (`'table' | 'view' | 'function'`, обязательный).

#### `execute-sql`
Выполнить SELECT/WITH/VALUES (в read-only режиме модифицирующие операторы отклоняются с PostgreSQL-ошибкой 25006).
- `query` (string, обязательный) — SQL с плейсхолдерами `$1`/`$2`.
- `params` (array, опционально) — допустимы скаляры, `null`, `Date`, `Buffer`, массивы и plain-объекты (передаются как JSON/JSONB).
- `saveToFile` (boolean, по умолчанию `false`) — потоковая запись результата в файл.
- `filePath` (string, опционально) — должен находиться внутри OS temp или одного из `POSTGRES_MCP_OUTPUT_DIRS`.
- `format` (`'jsonl' | 'json'`, по умолчанию `'jsonl'`).
- `forceSaveToFile` (boolean, по умолчанию `false`) — для не-cursor запросов: буферизация в памяти перед записью.

#### `index-operation` (в режиме только-чтения разрешён только `operation: 'list'`)
- `operation` (`'create' | 'drop' | 'list'`, обязательный).
- `schema` (string, по умолчанию `'public'`).
- `table` (string) — обязательный для `create`/`drop`; опциональный для `list` (фильтр по таблице).
- `name` (string) — имя индекса; обязательный для `create`/`drop`.
- `columns` (string[]) — обязательный для `create`.
- `unique` (boolean, по умолчанию `false`).
- `ifNotExists` / `ifExists` (boolean, по умолчанию `false`).
- `tableName` (string, deprecated-алиас `table` для `list`).
- `limit` (number, 1–1000, по умолчанию `100`); `offset` (number, по умолчанию `0`).

### Инструменты для режима с возможностью записи

В режиме чтения-записи (`--no-read-only`) доступны те же инструменты; дополнительно `execute-sql` принимает INSERT/UPDATE/DELETE/DDL, а `index-operation` — операции `create`/`drop`. Сигнатуры параметров совпадают с описанными выше.

**Примечание:** Сервер по умолчанию работает в режиме только для чтения. Режим применяется на уровне сессии: при `connect` с `readonlyMode=true` каждое подключение из пула стартует с параметром `default_transaction_read_only=on`, и любая модифицирующая операция отклоняется сервером с ошибкой PostgreSQL 25006 (`read_only_sql_transaction`).

В режиме только для чтения блокируются:
- `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `TRUNCATE`
- DDL: `CREATE`, `ALTER`, `DROP`, `COMMENT`, `GRANT`, `REVOKE`
- Операции `create` и `drop` инструмента `index-operation`

### Ограничения режима только для чтения

Режим только для чтения — это страховка, а не полная изоляция. Следующие операции остаются возможными, поскольку формально не являются записью:

- Чтение чувствительных системных каталогов (`pg_authid`, `pg_shadow` и т.д.), если у роли есть привилегии.
- Вызов функций `SECURITY DEFINER`, которые внутри пишут данные — записи внутренней роли обходят флаг внешней сессии.
- Серверные функции доступа к файлам: `pg_read_server_files`, `lo_export`, `COPY ... TO PROGRAM` (последняя требует superuser).
- Смена режима на лету требует переподключения: повторный вызов `connect` с другим `readonlyMode` пересоздаёт пул с новой настройкой.

Для более строгой изоляции используйте PostgreSQL-роль без прав `INSERT`/`UPDATE`/`DELETE`/`USAGE` на нужные объекты.

### Поведение пула подключений

- По умолчанию пул содержит одно соединение (`--pool-size 1`). Это осознанный компромисс: при размере 1 два параллельных `tools/call` сериализуются, зато многошаговая транзакция, разбитая на несколько `execute-sql` (`BEGIN`, `…`, `COMMIT`), гарантированно попадает на одну и ту же backend-сессию. При `--pool-size > 1` подряд идущие `execute-sql` могут уходить на разные клиенты пула, что молча ломает `BEGIN/COMMIT`, разнесённый по вызовам — выполняйте многошаговые транзакции внутри одного `execute-sql` (например, через CTE, `INSERT … ON CONFLICT` или блок `BEGIN; …; COMMIT;` в одном запросе). Увеличивайте `--pool-size`, если нужны параллельные чтения/записи и multi-call-транзакции вам не нужны.
- Ошибка на уровне пула (обрыв сети, рестарт сервера и т.д.) переводит сервер в состояние disconnected, но **не** запускает авто-reconnect. Следующий вызов вернёт сохранённый `connectionError`; вызовите `connect` заново для восстановления.
- `disconnect` закрывает все idle-сокеты через `pool.end()`. Сам MCP-сервер продолжает работу и сразу примет новый `connect`.
