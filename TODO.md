# TODO

## Table of Contents

- [Review session summary](#review-session-summary)
- [Pending verification](#pending-verification)
- [Deferred tasks](#deferred-tasks)

## Review session summary

Polnoe code/logic/security/performance/usability review проекта проведено в одной
сессии. Ниже фиксация для контекста-после-compact.

### P1 — критичные исправления (все done)

- **L1**: SQL для `index-operation list` с `tableName` ссылался на `n.nspname`
  без `pg_namespace n` в `FROM`. Исправлено в
  [src/tools/index-operation.ts](src/tools/index-operation.ts).
- **L5**: убран устаревший `pg_proc.proisagg` (несовместим с PG ≥ 11) из
  [src/tools/list-objects.ts](src/tools/list-objects.ts) — оставлено
  `prokind = 'f'`.
- **S1+L2**: SQL injection в идентификаторах `index-operation`. Введён модуль
  [src/utils/sql-identifier.ts](src/utils/sql-identifier.ts) (`quoteIdent`,
  `quoteQualified`) с экранированием по стандарту PostgreSQL и проверкой
  длины 63 байта. Заодно поправлен порядок `IF EXISTS` в `DROP INDEX`.
- **S2**: запись `filePath` ограничена белым списком (модуль
  [src/utils/safe-path.ts](src/utils/safe-path.ts), env
  `POSTGRES_MCP_OUTPUT_DIRS`).

### P2 — высокий приоритет (все done)

- **L3+L4**: read-only исполнение запроса теперь на уровне сессии (`options:
  '-c default_transaction_read_only=on'` в `PoolConfig` — см. P1 ниже),
  поэтому per-query `BEGIN/SET/COMMIT` и rollback-обвязка более не нужны.
- **L10**: расширены типы `params` для `execute-sql` — допустимы массивы и
  plain-объекты (для ARRAY/JSONB), не-сериализуемые значения отклоняются с
  явной ошибкой.
- **L12**: `tool-response.ts` теперь возвращает и `content` (текст), и
  `structuredContent` — совместимо с обоими режимами AGENTS.md.
- **C13** (тесты): добавлены тесты `test/tools/index-operation.test.ts`,
  `test/tools/list-objects.test.ts`, `test/utils/sql-identifier.test.ts`,
  `test/utils/safe-path.test.ts`, `test/utils/redact.test.ts`, расширен
  `test/tools/execute-sql.test.ts`. Всего 78 тестов.

### P3 — средний приоритет (все done)

- **C1**: вычищен мёртвый код в `src/utils/date.ts` (~200 строк).
- **C2**: удалён неиспользуемый `enrichConfigWithRedaction`.
- **C3**: убран дублирующий `POSTGRES_MCP_POOL_SIZE` из конфигурации (CLI
  `--pool-size` — единственный источник истины). README обновлён.
- **C5+C6**: устранена дубликация между `writeResultsToFile` и
  `streamPostgresQueryToFile`; ветки readonly/rw в `streamQuery` объединены.
- **C7**: убран singleton `PostgreSQLClient.getInstance()`, клиенты передаются
  параметром во все `register*Tool`.
- **C8 + S3 + P3** (одной правкой): `src/utils/streaming.ts` теперь использует
  `mkdtempSync(os.tmpdir())` — кросс-платформенно, исключает symlink/TOCTOU,
  убраны sync `existsSync/mkdirSync`.
- **C9**: удалён дубль `test/jest.config.ts`.
- **P1**: read-only mode применяется на уровне сессии через
  `options: '-c default_transaction_read_only=on'` в `PoolConfig`. Каждый
  запрос — 1 round-trip вместо 4. Смена режима в runtime требует реконнекта,
  это задокументировано.
- **P2**: пагинация (`limit`/`offset`/`hasMore`) добавлена в `list-schemas`,
  `list-objects`, `index-operation list`. Default 100, max 1000.
- **P5**: для `pgsql-parser` добавлен LRU-кэш на 256 запросов и regex
  fast-path по первому ключевому слову (отсекает явный non-SELECT без WASM).
- **S4+S9**: модуль [src/utils/redact.ts](src/utils/redact.ts) маскирует
  пароль во всех `postgres(?:ql)?://user:pass@host` URL; применяется в
  `tool-response.ts.toolError` и в stderr-логах `server.ts`.
- **S6**: README/README-ru дополнены разделом **Limitations of Read-Only
  Mode** (системные каталоги, SECURITY DEFINER, lo_export, COPY TO PROGRAM).
- **U1**: `readOnlyHint` для `connect`/`disconnect` исправлен на `false` —
  оба меняют состояние сервера.
- **U2**: описания всех 8 инструментов расширены до формата AGENTS.md
  (Purpose / Use cases / Returns / Limitations).
- **U6+U7**: для `index-operation list` добавлен параметр `table` (канонический);
  `tableName` оставлен как deprecated alias.
- **U9**: исправлены MongoDB-примеры в `AGENTS.md` (`Postgres://localhost:27017`
  → `postgresql://...:5432/...`, `find` → `connect`/`execute-sql`).

### P4 — низкий приоритет (все done)

- **C10**: удалён устаревший `importsNotUsedAsValues` из `tsconfig.test.json`.
- **C11**: убраны non-null asserts (`!` и `eslint-disable`) в `postgres-client.ts`
  (`ensureConnected()` теперь возвращает `Pool`) и `show-object.ts`.
- **C12**: graceful shutdown через SIGINT/SIGTERM в `index.ts`; добавлен
  `PostgreSQLServer.shutdown()`.
- **U3**: убраны self-referencing TOC-записи в README.md/README-ru.md.
- **U4**: создан [CHANGELOG.md](CHANGELOG.md) в формате Keep a Changelog.
- **U5**: `saveToFile` теперь имеет явный `.default(false)`.
- **U8**: README таблицы инструментов переписаны в виде секций со списками
  параметров (читабельно в исходнике, не «гигантская строка»).
- **U10**: README/README-ru документируют CLI-флаги `--read-only`,
  `--pool-size`, `--idle-timeout`, `--connection-timeout`, `--auto-connect`.
- **U11**: ответ `toolError` теперь включает `code`, `detail`, `hint`,
  `severity` для pg-ошибок (с redaction `detail`).
- **S5+S7+S8**: оговорки про SECURITY DEFINER и pgsql-parser WASM покрыты в
  Limitations; в `connect.test.ts` корректное `process.env`
  snapshot/restore.
- **P6+P8**: README дополнен разделом **Connection Pool Behavior**.
- **CI**: добавлен `timeout-minutes: 15` в `.github/workflows/ci.yml`.

### Тестовое окружение

- Миграция Jest → Vitest 4 (см. [CHANGELOG.md](CHANGELOG.md)).
  Конфиг — [vitest.config.ts](vitest.config.ts), лимиты `maxWorkers: '10%'`,
  `testTimeout: 30000`, `hookTimeout: 30000`. Время прогона упало с ~4.7 с
  (Jest) до ~1.2 с (Vitest), предупреждение «worker failed to exit
  gracefully» исчезло. `npm test`/`test:watch`/`test:coverage`.

### Release / Versioning

- `src/version.ts` теперь использует native ESM import attributes
  (`import pkg from '../package.json' with { type: 'json' }`).
  `package.json` копируется в `dist/package.json` шагом `postbuild`,
  поэтому runtime-резолв `dist/src/version.js → ../package.json` работает
  после публикации в npm. Tests читают `package.json` напрямую из корня.

## Pending verification

- Финальная сборка: `npx eslint .`, `npx tsc -p tsconfig.json --noEmit`,
  `npm test`, `npm run build`. На последнем замере: 78 тестов зелёные,
  lint=0, tsc=0. Build успешен.
- Известные не-блокирующие диагностики IDE (typescript 6133) про
  `name`/`config` в моках `registerTool` в тестовых файлах — относятся к
  старому коду тестов, не правлены, чтобы не разрастаться. Уйдут при
  миграции на Vitest или после массового rename `_name`/`_config`.

## Deferred tasks

- **Secret scanning в CI** — подключить gitleaks/gitleaks-action job в
  `.github/workflows/ci.yml` либо включить GitHub native secret scanning в
  Settings → Code security and analysis. Превентивная мера: предотвращает
  случайный коммит реальных DSN/токенов в репозиторий. Решение об инструменте
  отложено.
- **Пагинация overload и `includeDefinition` в `show-object`** — для имени
  функции с большим числом перегрузок (особенно сгенерированных) текущая
  реализация возвращает все `pg_get_functiondef(p.oid)` сразу, что может
  раздуть ответ до многомегабайтного. Добавить параметры `limit`/`offset` по
  overload-ам и опциональный `includeDefinition` (по умолчанию `false`),
  оставляющий в первой выдаче только `arguments`/`identityArguments`/
  `returnType`. Тело подтягивается отдельным вызовом по конкретному
  `identityArguments`. Изменит публичный API тула, поэтому отложено до
  появления реального кейса.

## Integration tests

- Поднимаются через `podman-compose -f compose.yaml up -d` (PG 18.3
  на 127.0.0.1:55432). Команды:
  - `npm run test:integration:up` — старт контейнера.
  - `npm run test:integration` — vitest на `test-integration/`
    (отдельный конфиг [vitest.integration.config.ts](vitest.integration.config.ts),
    `fileParallelism: false`, чтобы тесты не конфликтовали по схемам).
  - `npm run test:integration:down` — остановка.
- Покрывают: SELECT/INSERT/UPDATE/DDL под readonly (PG 25006);
  CREATE/DROP/LIST индексов с обычными и патологическими именами
  (`weird"tbl` для S1+L2); `list-objects` с function (для L5 prokind);
  пагинация; `show-object` для table/view/function.
