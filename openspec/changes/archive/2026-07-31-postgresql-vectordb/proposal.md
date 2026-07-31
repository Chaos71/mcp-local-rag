## Why

Текущий стек использует LanceDB (file-based) как единственную векторную БД. Для корпоративных сценариев нужна поддержка PostgreSQL — распределённая БД с транзакциями, репликацией, пулом соединений и встроенной поддержкой векторов (pgvector). Это позволяет масштабировать поиск на несколько инстансов mcp-local-rag, хранить метаданные отдельно от эмбеддингов и использовать SQL-фильтрацию.

## What Changes

- Добавить новый бэкенд векторной БД — PostgreSQL с pgvector
- Все подключения к PostgreSQL настраиваются через переменные окружения
- Поддерживать настраиваемую схему PostgreSQL для мульти-тенантных сценариев
- Добавить feature flag для переключения между LanceDB и PostgreSQL
- CLI и MCP-инструменты работают одинаково с обоими бэкендами
- Сохранить полную обратную совместимость: LanceDB остаётся по умолчанию

## Capabilities

### New Capabilities
- `postgresql-vectordb` — бэкенд векторной БД на PostgreSQL с pgvector

### Modified Capabilities
- (none) — существующие требования к MCP-инструментам не меняются

## Impact

- `src/vectordb/` — новый модуль `postgresql.ts`
- `src/vectordb/types.ts` — расширение `VectorStoreConfig`
- `src/index.ts` — поддержка новой конфигурации
- `package.json` — зависимость `pg` и `pgvector`
- `.env.example` — новые переменные окружения
- `QWEN.md` — документация
- `openspec/specs/mcp-local-rag/spec.md` — обновление спецификации
