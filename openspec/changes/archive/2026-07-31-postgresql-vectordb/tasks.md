## 1. Подготовка и зависимости

- [x] 1.1 Добавить зависимости `pg` и `pgvector` в package.json
- [x] 1.2 Обновить `.env.example` с новыми переменными окружения PostgreSQL
- [x] 1.3 Создать TypeScript-интерфейс `IVectordb` в `src/vectordb/types.ts`

## 2. Реализация PostgreSQL-бэкенда

- [x] 2.1 Создать `src/vectordb/postgresql.ts` с классом `PostgreSQLVectordb`
- [x] 2.2 Реализовать метод `initialize()` — подключение к PostgreSQL, проверка pgvector, создание таблиц и индексов
- [x] 2.3 Реализовать метод `insertChunks()` — транзакционная вставка чанков
- [x] 2.4 Реализовать метод `deleteChunks()` — удаление по filePath
- [x] 2.5 Реализовать метод `search()` — векторный поиск через pgvector + keyword boost через pg_trgm
- [x] 2.6 Реализовать метод `listFiles()` — агрегация из таблицы files
- [x] 2.7 Реализовать метод `getChunksByRange()` — чтение чанков по диапазону
- [x] 2.8 Реализовать методы `getStatus()`, `optimize()`, `close()`

## 2.9 Реализовать поддержку настраиваемой схемы PostgreSQL

- [x] 2.9.1 Добавить поле `schema` в `PostgreSQLConfig` и `PostgreSQLVectorStoreConfig` в `src/vectordb/types.ts`
- [x] 2.9.2 Обновить `buildSchemaSQL()` — квалифицировать все SQL-запросы схемой
- [x] 2.9.3 Добавить создание схемы при инициализации (`CREATE SCHEMA IF NOT EXISTS`)
- [x] 2.9.4 Обновить все SQL-запросы в классе `PostgreSQLVectordb` — квалифицировать имена таблиц
- [x] 2.9.5 Обновить `.env.example` — добавить переменную `PG_SCHEMA`

## 3. Интеграция с существующим кодом

- [x] 3.1 Обновить `src/vectordb/index.ts` — добавить фабрику `createVectordb()`
- [x] 3.2 Обновить `src/vectordb/types.ts` — добавить `VectorStoreConfig` для PostgreSQL
- [x] 3.3 Обновить `src/index.ts` — поддержка новой конфигурации и feature flag
- [x] 3.4 Обновить `src/server/tool-input.ts` — валидация конфигурации PostgreSQL

## 4. Тестирование

- [ ] 4.1 Написать unit-тесты для `PostgreSQLVectordb` (mock pg)
- [ ] 4.2 Написать integration-тесты с реальным PostgreSQL (Docker)
- [ ] 4.3 Добавить тесты для feature flag переключения бэкендов
- [ ] 4.4 Добавить тесты для безопасности (SQL-инъекции, SSL)

> **Примечание:** Первоначальные тесты были удалены — не прошли запуск из-за проблем с моками pg и инициализацией. К тестам вернёмся позже.

## 5. Документация

- [x] 5.1 Обновить `QWEN.md` — раздел про PostgreSQL-бэкенд
- [x] 5.2 Обновить `README.md` и `README_RUS.md` — документация по настройке
- [x] 5.3 Обновить `openspec/specs/mcp-local-rag/spec.md` — добавить PostgreSQL-бэкенд
- [x] 5.4 Добавить примеры `.env` для PostgreSQL
