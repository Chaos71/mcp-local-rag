## Context

Проект использует LanceDB (file-based) для хранения векторов и метаданных. Для корпоративных сценариев требуется PostgreSQL с pgvector.

**Текущее состояние:**
- `VectorStore` — единственный класс, инкапсулирующий работу с БД
- `VectorStoreConfig` — конфигурация для LanceDB
- Все операции (вставка, поиск, удаление, список файлов) реализованы через LanceDB API

**Ограничения:**
- LanceDB — single-node, file-based
- Нет пула соединений, репликации, распределённого хранения
- Сложно масштабировать на несколько инстансов

## Goals / Non-Goals

**Goals:**
- Поддержка PostgreSQL как альтернативного бэкенда векторной БД
- Единый интерфейс `VectorStore` для обоих бэкендов
- Конфигурация через переменные окружения
- Feature flag для переключения между бэкендами

**Non-Goals:**
- Поддержка других БД (MongoDB, Elasticsearch и т.д.)
- Автоматическая миграция данных из LanceDB в PostgreSQL
- Поддержка pgvector на GPU
- Встроенный миграционный тул между бэкендами

## Decisions

### Решение 1: Интерфейс VectorStoreInterface

**Выбор:** Создать интерфейс `IVectordb` с двумя реализациями

**Альтернативы:**
1. Унаследовать существующий `VectorStore` от `LanceDBVectordb` — не масштабируемо, наследование становится хрупким
2. Создать абстракцию поверх `LanceDBVectordb` — нарушает инкапсуляцию

**Обоснование:** Интерфейс позволяет подменять реализацию без изменения вызывающего кода. Оба бэкенда реализуют одинаковый набор методов.

### Решение 2: pgvector extension

**Выбор:** Использовать pgvector extension для PostgreSQL

**Альтернативы:**
1. Хранить векторы в JSONB и искать через custom functions — медленнее, сложнее
2. Использовать внешний pgvector-сервис — нарушает локальность

**Обоснование:** pgvector — стандарт де-факто для векторного поиска в PostgreSQL. Поддерживает IVFFlat и HNSW индексы.

### Решение 3: Подключение к PostgreSQL

**Выбор:** Пул соединений через `pg` с автопересоединением

**Альтернативы:**
1. Одиночное соединение — не масштабируется, падает при disconnect
2. pgpool — внешняя зависимость, усложняет деплой

**Обоснование:** `pg` (node-postgres) — стандартный драйвер. Автопересоединение через retry-логику обеспечивает надёжность.

### Решение 4: Feature flag

**Выбор:** Переменная `VECTORDB_BACKEND` со значениями `lancedb` (по умолчанию) и `postgresql`

**Альтернативы:**
1. Автоопределение по наличию `DB_PATH` — ненадёжно, требует доп. логики
2. CLI-флаг — неудобно для серверного режима

**Обоснование:** Простая переменная окружения, работает и для CLI, и для MCP-сервера.

### Решение 5: Настраиваемая схема PostgreSQL

**Выбор:** Переменная `PG_SCHEMA` (по умолчанию `public`), все SQL-запросы квалифицируются схемой

**Альтернативы:**
1. Жёстко задать `public` — не работает для мульти-тенантных сценариев
2. Разные базы данных для разных тенантов — сложнее управление, нет общего подключения

**Обоснование:** Схема позволяет изолировать таблицы без создания отдельных баз данных. Все SQL-запросы квалифицируются как `schema.table_name`. При инициализации схема создаётся автоматически, если не существует.

### Решение 7: Схема данных

**Выбор:** Три таблицы — `chunks`, `files`, `metadata` в настраиваемой схеме

```sql
-- Создание схемы (если не существует)
CREATE SCHEMA IF NOT EXISTS <schema_name>;

-- chunks: основной таблица с векторами
CREATE TABLE <schema_name>.chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_path TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    embedding vector(384) NOT NULL,
    file_title TEXT,
    timestamp TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Индекс IVFFlat для векторного поиска
CREATE INDEX <schema_name>.chunks_embedding_idx ON <schema_name>.chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Индекс для быстрого поиска по файлу
CREATE INDEX <schema_name>.chunks_file_path_idx ON <schema_name>.chunks (file_path);

-- FTS-индекс через pg_trgm для keyword boost
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX <schema_name>.chunks_text_trgm_idx ON <schema_name>.chunks USING gin (text gin_trgm_ops);

-- files: агрегация для list_files
CREATE TABLE <schema_name>.files (
    file_path TEXT PRIMARY KEY,
    chunk_count INTEGER NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    file_size INTEGER NOT NULL,
    file_type TEXT NOT NULL
);

-- metadata: дополнительные метаданные
CREATE TABLE <schema_name>.metadata (
    file_path TEXT PRIMARY KEY,
    file_title TEXT,
    file_size INTEGER,
    file_type TEXT,
    ingested_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (file_path) REFERENCES <schema_name>.files(file_path)
);
```

**Обоснование:** Разделение на таблицы позволяет оптимизировать запросы. `files` — для быстрого `list_files`, `metadata` — для хранения заголовков. Квалификация всех объектов схемой позволяет изолировать данные разных клиентов в одном экземпляре PostgreSQL.

## Risks / Trade-offs

### Риск 1: pgvector не установлен в PostgreSQL
→ **Митигация:** Проверка при инициализации, явная ошибка если extension отсутствует

### Риск 2: Производительность pgvector на больших наборах данных
→ **Митигация:** Настройка `lists` для IVFFlat, возможность переключения на HNSW

### Риск 3: Различия в поведении поиска между бэкендами
→ **Митигация:** Абстракция поиска на уровне `search()` — каждая реализация адаптирует результаты

### Риск 4: Увеличение размера зависимостей
→ **Митигация:** `pg` — ~100KB, незначительно по сравнению с `@lancedb/lancedb` (~10MB)

### Риск 5: Схема не существует или недоступна
→ **Митигация:** Автоматическое создание схемы при инициализации через `CREATE SCHEMA IF NOT EXISTS`. Проверка прав доступа к схеме.

## Migration Plan

1. Реализовать `IVectordb` интерфейс
2. Реализовать `PostgreSQLVectordb` класс
3. Обновить `VectorStore` — делегировать через интерфейс
4. Добавить feature flag в конфигурацию
5. Написать тесты для PostgreSQL бэкенда
6. Обновить документацию

## Open Questions

1. Какой размер эмбеддинга по умолчанию для pgvector? (384 для all-MiniLM-L6-v2, 4096 для llama.cpp)
2. Нужен ли pgvector-индекс HNSW как опция вместо IVFFlat?
3. Как обрабатывать транзакции при реингесте? (backup → delete → insert → commit)
