# Qwen Code — Project Context

## Project Overview

**mcp-local-rag** — локальный RAG-сервер (Retrieval-Augmented Generation) для разработчиков, предоставляющий семантический поиск по документам через MCP (Model Context Protocol) или CLI. Полностью приватный, работает офлайн после первой загрузки модели, не требует внешних API-ключей или облачных сервисов.

**Версия:** 0.16.1

**Автор:** Shinsuke Kagawa
**Лицензия:** MIT
**Репозиторий:** https://github.com/shinpr/mcp-local-rag

## Технологический стек

- **Язык:** TypeScript 6.0 (ES2023)
- **Runtime:** Node.js >= 22
- **Менеджер пакетов:** pnpm 11.9.0
- **Тестирование:** Vitest 4.1
- **Форматирование/Линтинг:** Biome 2.5
- **Векторная БД:** LanceDB (file-based)
- **Эмбеддинги:** Transformers.js (HuggingFace)
- **Парсинг документов:** mupdf (PDF), mammoth (DOCX), turndown (HTML→Markdown)

## Архитектура

Проект имеет два режима работы:

### 1. MCP Сервер
Предоставляет 7 инструментов для AI-ассистентов (Cursor, Codex, Claude Code):
- `ingest_file` — загрузка файла в индекс
- `ingest_data` — загрузка HTML-контента
- `query_documents` — семантический поиск с keyword boost
- `read_chunk_neighbors` — чтение соседних чанков для контекста
- `list_files` — статус индексации
- `delete_file` — удаление из индекса
- `status` — статистика БД

### 2. CLI
Все инструменты MCP доступны как подкоманды:
```bash
npx mcp-local-rag ingest ./docs/
npx mcp-local-rag query "authentication API"
```

## Структура проекта

```
src/
├── index.ts              # Точка входа, роутинг CLI/MCP
├── cli-main.ts           # Обработка CLI подкоманд
├── server-main.ts        # Запуск MCP сервера
├── cli/                  # CLI логика (опции, команды)
├── server/               # MCP обработчики инструментов
│   ├── tool-definitions.ts
│   ├── tool-input.ts
│   ├── list-scanner.ts
│   └── error-utils.ts
├── parser/               # Парсинг документов (PDF, DOCX, TXT, MD, HTML)
├── chunker/              # Семантическое чанкирование текста
├── embedder/             # Эмбеддинги (Transformers.js + llama.cpp)
│   ├── index.ts          # Интерфейс IEmbedder, Transformers.js бэкенд
│   ├── llama-cpp.ts      # llama.cpp HTTP-бэкенд
│   ├── factory.ts        # Фабрика createEmbedder()
│   └── types.ts          # Общие типы
├── duplicates/           # Обработка дубликатов (SHA-256 хеширование)
│   ├── hash.ts           # computeContentHash()
│   ├── types.ts          # DuplicateEntry, DuplicateMode
│   └── store.ts          # DuplicateStore
├── vectordb/             # LanceDB операции
├── features/             # Feature flags
├── pdf-visual/           # Визуальный режим для PDF (VLM)
└── utils/                # Утилиты
```

## Ключевые особенности

### Семантический поиск с keyword boost
Векторный поиск первым, затем keyword-матчи повышают ранжирование точных терминов (`useEffect`, error codes, имена классов).

### Умное чанкирование
Документы разбиваются по смыслу, а не по количеству символов. Markdown-блоки кода никогда не разбиваются посередине.

### Визуальный режим PDF
Опциональная генерация подписей к изображениям/диаграммам через VLM (Vision Language Model):
- **fast:** SmolVLM-256M (~250 MB)
- **quality:** Qwen2.5-VL-3B (~2.9 GB)

### Безопасность
- Только файлы внутри configured root (`BASE_DIR`/`BASE_DIRS`)
- Symlinks за пределами root отклоняются
- Никаких сетевых запросов после загрузки модели

## Конфигурация

### Основные переменные окружения

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| `BASE_DIR` | текущая директория | Корневая директория документов |
| `BASE_DIRS` | (not set) | JSON-массив корневых директорий |
| `DB_PATH` | `./lancedb/` | Путь к векторной БД |
| `CACHE_DIR` | `./models/` | Директория кэша моделей |
| `MODEL_NAME` | `Xenova/all-MiniLM-L6-v2` | HuggingFace модель |
| `RAG_HYBRID_WEIGHT` | `0.6` | Вес keyword boost |
| `RAG_DEVICE` | `cpu` | Устройство выполнения |
| `EMBEDDING_BACKEND` | `transformers` | Бэкенд эмбеддингов: `transformers` или `llama-cpp` |
| `LLAMA_CPP_SERVER_URL` | `http://127.0.0.1:8080` | URL сервера llama.cpp |
| `LLAMA_CPP_BATCH_SIZE` | `16` | Размер батча (1–128). Тексты отправляются пакетно одним HTTP-запросом `input: string[]`. |
| `LLAMA_CPP_TIMEOUT` | `30000` | Таймаут запроса llama.cpp (мс) |
| `LLAMA_CPP_MAX_RETRIES` | `5` | Максимум повторных попыток при HTTP 429 (Too Many Requests) |
| `LLAMA_CPP_RETRY_BASE_DELAY` | `2000` | Базовая задержка между повторными попытками (мс, экспоненциальный backoff) |
| `LLAMA_CPP_BATCH_INTERVAL` | `1000` | Интервал между батчами запросов к серверу llama.cpp (мс). Помогает избежать rate limiting при высокой нагрузке. |
| `RAG_LLAMA_CPP_DIMENSIONS` | `4096` | Размерность эмбеддингов llama.cpp (переопределение) |
| `VECTORDB_BACKEND` | `lancedb` | Бэкенд векторной БД: `lancedb` или `postgresql` |
| `PG_HOST` | `localhost` | Хост PostgreSQL-сервера |
| `PG_PORT` | `5432` | Порт PostgreSQL |
| `PG_DATABASE` | (not set) | Имя базы данных PostgreSQL |
| `PG_USER` | (not set) | Пользователь PostgreSQL |
| `PG_PASSWORD` | (not set) | Пароль PostgreSQL |
| `PG_SSL_MODE` | `disable` | Режим SSL: disable, allow, prefer, require, verify-ca, verify-full |
| `PG_MAX_POOL_SIZE` | `20` | Максимальный размер пула соединений |
| `PG_MIN_POOL_SIZE` | `0` | Минимальный размер пула соединений |
| `PG_SCHEMA` | `public` | Схема PostgreSQL (для мульти-тенантных сценариев) |
| `RAG_EMBEDDING_DIMENSIONS` | `384` | Размерность эмбеддингов для pgvector |
| `RAG_IVF_LISTS` | `100` | Количество списков IVFFlat индекса |
| `DUPLICATE_MODE` | `skip` | Режим обработки дубликатов: `skip` (пропустить), `update` (обновить), `track` (сохранить оба) |

### Локальные LLM через llama.cpp

Для использования современных GGUF-моделей эмбеддингов (Qwen3-Embedding-4B, nomic-embed-text-v1.5):

1. Запустите сервер llama.cpp вручную:
   ```bash
   llama-server --model ./models/Qwen3-Embedding-4B.gguf --port 8080 --embedding
   ```

2. Настройте bэкенд через переменные окружения:
   ```bash
   export EMBEDDING_BACKEND=llama-cpp
   export LLAMA_CPP_SERVER_URL=http://127.0.0.1:8080
   ```

3. Запустите mcp-local-rag как обычно.

**Поддерживаемые модели:**
- **Qwen/Qwen3-Embedding-4B** — 4096 размерность, современная модель от Alibaba
- **nomic-ai/nomic-embed-text-v1.5** — 768 размерность, качественная модель с хорошей семантикой

### PostgreSQL как бэкенд векторной БД

Для корпоративных сценариев (распределённое хранение, репликация, SQL-фильтрация) доступен PostgreSQL-бэкенд с pgvector extension.

**Требования:**
- PostgreSQL 14+ с установленным расширением `pgvector`
- ```sql
  CREATE EXTENSION vector;
  ```

**Настройка через переменные окружения:**
```bash
# Выбрать PostgreSQL-бэкенд
export VECTORDB_BACKEND=postgresql

# Обязательные параметры подключения
export PG_HOST=localhost
export PG_PORT=5432
export PG_DATABASE=mcp_local_rag
export PG_USER=postgres
export PG_PASSWORD=postgres

# Опциональные параметры
export PG_SSL_MODE=disable
export PG_MAX_POOL_SIZE=20
export PG_MIN_POOL_SIZE=0

# Размерность эмбеддингов (по умолчанию 384 для all-MiniLM-L6-v2)
export RAG_EMBEDDING_DIMENSIONS=384

# Количество списков IVFFlat индекса (по умолчанию 100)
export RAG_IVF_LISTS=100

# Схема PostgreSQL (по умолчанию public)
# Используйте для мульти-тенантных сценариев, когда таблицы разнесены по схемам
export PG_SCHEMA=mytenant
```

**Мульти-тенантные сценарии:**

Параметр `PG_SCHEMA` позволяет изолировать таблицы разных клиентов в одном экземпляре PostgreSQL без создания отдельных баз данных. Все SQL-запросы квалифицируются схемой (например, `myschema.chunks`).

При первом подключении схема автоматически создаётся через `CREATE SCHEMA IF NOT EXISTS`.

**Сравнение бэкендов:**

| Характеристика | LanceDB | PostgreSQL |
|----------------|---------|------------|
| Хранение | File-based (локально) | Серверная БД |
| Масштабирование | Single-node | Репликация, кластеры |
| Транзакции | Нет | Полная поддержка |
| Пул соединений | Нет | Встроенный |
| SQL-фильтрация | Нет | Полная поддержка |
| Зависимости | ~10 MB (@lancedb/lancedb) | ~100 KB (pg) |
| pgvector индекс | IVFFlat/HNSW | IVFFlat/HNSW |
| Keyword boost | FTS (ngram) | pg_trgm |

### Обработка дубликатов

mcp-local-rag отслеживает дубликаты документов с помощью хеширования содержимого SHA-256. При повторной загрузке одного и того же файла (по содержимому) система может пропустить его, обновить существующую запись или сохранить обе версии.

**Модули:**

- `src/duplicates/hash.ts` — функция `computeContentHash(filePath: string): string` для вычисления SHA-256
- `src/duplicates/types.ts` — типы `DuplicateEntry`, `DuplicateMode`
- `src/duplicates/store.ts` — класс `DuplicateStore` с методами `add()`, `findByHash()`, `findDuplicates()`, `getAll()`, `remove()`

**Настройка:**

| Переменная окружения | По умолчанию | Описание |
|---------------------|--------------|----------|
| `DUPLICATE_MODE` | `skip` | Режим обработки дубликатов: `skip` (пропустить загрузку), `update` (заменить), `track` (сохранить обе версии с меткой) |

**Изменения схемы:**

- **LanceDB:** Добавлен столбец `status` (active/deprecated) и столбец `contentHash` в таблицу chunks; создаёт таблицу `duplicates` при первой вставке.
- **PostgreSQL:** Добавлен столбец `status` в таблицу `chunks`; создаёт таблицу `duplicates` при `initialize()`.

**В следующей итерации:**

- Инструменты MCP: `list_duplicates`, `cleanup_duplicates`
- Подкоманды CLI: `duplicates list`, `duplicates cleanup`
- Поле `isDuplicate` в `IngestedFileSummary` для `list_files`
- Валидация `DUPLICATE_MODE` в `tool-input.ts`
- Unit-тесты для `computeContentHash()` и `DuplicateStore`
- Integration-тесты для `handleIngestFile` с дубликатами
- Обновление `openspec/specs/mcp-local-rag/spec.md` — добавление требований к дубликатам
- Добавление примеров использования CLI-команд в документацию

> **Примечание:** Основная интеграция обработки дубликатов в конвейер загрузки (Разделы 1–3.3) завершена. Тип `IngestResult` расширен полями `status` и `duplicateOf`. Схема и инфраструктура отслеживания готовы.

### Приоритет конфигурации
1. CLI флаги
2. Переменные окружения
3. Значения по умолчанию

## Build и запуск

```bash
# Установка зависимостей
pnpm install

# Сборка
pnpm run build

# Запуск в режиме разработки
pnpm run dev

# Запуск MCP сервера
pnpm start

# Запуск CLI подкоманды
pnpm start -- query "search term"
```

## Тестирование

```bash
# Все тесты (CPU)
pnpm run test

# Производительность read-neighbors
pnpm run test:perf

# WebGPU тесты
pnpm run test:webgpu

# E2E тесты визуального режима
pnpm run test:e2e

# Тесты с watchdog
pnpm run test:watch
```

### Особенности тестирования
- `vitest.config.mjs` использует `isolate: false`, `pool: 'forks'`, `maxWorkers: 1`
- Требуется из-за `onnxruntime-node`, который хранит native state
- Mock'и через `vi.doMock`/`vi.doUnmock` для изоляции

## Quality Checks

```bash
# Полный чек (как в CI)
pnpm run check:all

# Автофикс lint/format
pnpm run check:fix
```

`check:all` включает:
1. Biome check (lint + format)
2. Lint
3. Format check
4. Knip (unused exports)
5. dpdm (circular dependencies)
6. TypeScript build
7. Type check tests
8. Tests

## Agent Skills

Проект предоставляет Agent Skills для AI-ассистентов:
```bash
# Установка для Claude Code
npx mcp-local-rag skills install --claude-code

# Установка для Codex
npx mcp-local-rag skills install --codex
```

Находятся в `skills/mcp-local-rag/`

## Безопасность

- **pnpm-workspace.yaml:** `minimumReleaseAge: 1440` (24 часа quarantine для новых пакетов)
- **allowBuilds:** Строгий контроль build-скриптов (esbuild, onnxruntime-node, sharp разрешены; protobufjs запрещён)
- **Husky:** Pre-commit хуки через lint-staged

## Поддерживаемые форматы документов
- PDF (mupdf)
- DOCX (mammoth)
- TXT
- Markdown
- HTML (через ingest_data + Readability)

## Лицензия

MIT License. Автор: Shinsuke Kagawa.
