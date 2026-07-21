---
name: mcp-local-rag
version: 0.16.1
status: active
description: Локальный RAG-сервер для семантического поиска по документам
---

# MCP Local RAG — Текущая спецификация

## Описание

Локальный RAG-сервер (Retrieval-Augmented Generation) для разработчиков, предоставляющий семантический поиск по документам через MCP (Model Context Protocol) или CLI. Полностью приватный, работает офлайн после первой загрузки модели.

## Архитектура

### Два режима работы

**MCP Сервер** — предоставляет 7 инструментов для AI-ассистентов:
- `ingest_file` — загрузка файла в индекс
- `ingest_data` — загрузка HTML-контента
- `query_documents` — семантический поиск с keyword boost
- `read_chunk_neighbors` — чтение соседних чанков для контекста
- `list_files` — статус индексации
- `delete_file` — удаление из индекса
- `status` — статистика БД

**CLI** — все инструменты MCP доступны как подкоманды:
```bash
npx mcp-local-rag ingest ./docs/
npx mcp-local-rag query "authentication API"
```

## Технологический стек

| Компонент | Технология |
|-----------|------------|
| Язык | TypeScript 6.0 (ES2023) |
| Runtime | Node.js >= 22 |
| Менеджер пакетов | pnpm 11.9.0 |
| Тестирование | Vitest 4.1 |
| Форматирование | Biome 2.5 |
| Векторная БД | LanceDB (file-based) |
| Эмбеддинги | Transformers.js (HuggingFace) |
| Парсинг PDF | mupdf |
| Парсинг DOCX | mammoth |
| HTML→Markdown | turndown + Readability |

## Функциональные возможности

### 1. Ингестация документов

**Поддерживаемые форматы:**
- PDF (через mupdf)
- DOCX (через mammoth)
- TXT
- Markdown
- HTML (через ingest_data + Readability)

**Визуальный режим PDF (v0.16.1+):**
Опциональная генерация подписей к изображениям/диаграммам через VLM:
- **fast:** SmolVLM-256M (~250 MB)
- **quality:** Qwen2.5-VL-3B (~2.9 GB)

### 2. Семантическое чанкирование

- Разбиение по смыслу, а не по количеству символов
- Использование эмбеддингов для определения границ тем
- Markdown-блоки кода никогда не разбиваются посередине
- Размер чанков: 500-1000 символов (настраивается через CHUNK_MIN_LENGTH)

### 3. Поиск с keyword boost

**Алгоритм:**
1. Векторный поиск находит релевантные чанки
2. Keyword-матчи повышают ранжирование точных терминов
3. Фильтрация по релевантности (группировка по разрывам)

**Настройка:**
- `RAG_HYBRID_WEIGHT` (0.6 по умолчанию) — вес keyword boost
- `RAG_GROUPING` — режим группировки результатов
- `RAG_MAX_DISTANCE` — порог релевантности
- `RAG_MAX_FILES` — ограничение по количеству файлов

**Фильтр по области (scope):**
- Ограничение поиска по префиксу пути
- Поддержка нескольких префиксов
- Работает для query, list, delete, read-neighbors

### 4. Безопасность

- Только файлы внутри configured root (`BASE_DIR`/`BASE_DIRS`)
- Symlinks за пределами root отклоняются
- Нет сетевых запросов после загрузки модели
- pnpm quarantine: 24 часа для новых пакетов

## Конфигурация

### Переменные окружения

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| `BASE_DIR` | текущая директория | Корневая директория документов |
| `BASE_DIRS` | (not set) | JSON-массив корневых директорий |
| `DB_PATH` | `./lancedb/` | Путь к векторной БД |
| `CACHE_DIR` | `./models/` | Директория кэша моделей |
| `MODEL_NAME` | `Xenova/all-MiniLM-L6-v2` | HuggingFace модель |
| `MAX_FILE_SIZE` | 100MB | Максимальный размер файла |
| `CHUNK_MIN_LENGTH` | 50 | Минимальная длина чанка |
| `RAG_DEVICE` | `cpu` | Устройство выполнения |
| `RAG_DTYPE` | `fp32` | Квантование эмбеддингов |
| `RAG_HYBRID_WEIGHT` | `0.6` | Вес keyword boost |

### Приоритет конфигурации
1. CLI флаги
2. Переменные окружения
3. Значения по умолчанию

## Структура проекта

```
src/
├── index.ts              # Точка входа, роутинг CLI/MCP
├── cli-main.ts           # Обработка CLI подкоманд
├── server-main.ts        # Запуск MCP сервера
├── cli/                  # CLI логика (опции, команды)
├── server/               # MCP обработчики инструментов
├── parser/               # Парсинг документов
├── chunker/              # Семантическое чанкирование
├── embedder/             # Transformers.js эмбеддинги
├── vectordb/             # LanceDB операции
├── features/             # Feature flags
├── pdf-visual/           # Визуальный режим для PDF
└── utils/                # Утилиты
```

## Клиентская интеграция

### Поддерживаемые клиенты
- **Cursor** — через `~/.cursor/mcp.json`
- **Codex** — через `~/.codex/config.toml`
- **Claude Code** — через `claude mcp add`

### Agent Skills
```bash
# Claude Code (project-level)
npx mcp-local-rag skills install --claude-code

# Claude Code (user-level)
npx mcp-local-rag skills install --claude-code --global

# Codex
npx mcp-local-rag skills install --codex
```

## Тестирование

### Команды
```bash
pnpm run test              # Все тесты (CPU)
pnpm run test:perf         # Производительность read-neighbors
pnpm run test:webgpu       # WebGPU тесты
pnpm run test:e2e          # E2E тесты визуального режима
```

### Особенности
- `vitest.config.mjs`: `isolate: false`, `pool: 'forks'`, `maxWorkers: 1`
- Mock'и через `vi.doMock`/`vi.doUnmock` для изоляции
- Требуется из-за `onnxruntime-node`

## Quality Checks

```bash
pnpm run check:all         # Полный чек (как в CI)
pnpm run check:fix         # Автофикс lint/format
```

Включает: Biome check, lint, format, knip, dpdm, TypeScript build, tests.

## Acceptance Criteria

### AC-001: Полная локальность
**Дано:** Пользователь запускает mcp-local-rag
**Когда:** После первой загрузки модели
**Тогда:** Система работает полностью офлайн, не отправляя данные наружу

### AC-002: Семантический поиск с keyword boost
**Дано:** Документы проиндексированы
**Когда:** Выполняется поиск с термином `useEffect`
**Тогда:** Результаты включают как семантически релевантные чанки, так и точные совпадения термина

### AC-003: Безопасное ограничение путей
**Дано:** Настроен `BASE_DIR=/path/to/docs`
**Когда:** Запрашивается файл за пределами этого пути
**Тогда:** Запрос отклоняется с ошибкой безопасности

### AC-004: Семантическое чанкирование
**Дано:** Документ с несколькими темами
**Когда:** Документ индексируется
**Тогда:** Чанки разбиваются по смысловым границам, а не по фиксированной длине

### AC-005: Поддержка нескольких форматов
**Дано:** Пользователь предоставляет файл
**Когда:** Файл имеет формат PDF, DOCX, TXT, MD или HTML
**Тогда:** Файл успешно индексируется

## Scenarios

### S-001: Базовый поиск
1. Пользователь настраивает `BASE_DIR`
2. Пользователь индексирует документ: `npx mcp-local-rag ingest ./docs/`
3. Пользователь ищет: `npx mcp-local-rag query "authentication API"`
4. Получает релевантные чанки с keyword boost

### S-002: Поиск с ограничением области
1. Пользователь настраивает `BASE_DIRS` с несколькими директориями
2. Выполняет поиск с ограничением: `npx mcp-local-rag query "auth" --scope /docs/api`
3. Результаты ограничены только указанной областью

### S-003: Интеграция с MCP
1. Пользователь добавляет сервер в `~/.cursor/mcp.json`
2. Запускает Cursor
3. Просит ассистента: "Найди информацию об аутентификации в документации"
4. Ассистент использует MCP инструменты для поиска

## Классы и публичные методы

### Диаграмма классов

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              RAGServer                                   │
├─────────────────────────────────────────────────────────────────────────┤
│ - server: Server (MCP)                                                   │
│ - vectorStore: VectorStore                                               │
│ - embedder: Embedder                                                     │
│ - chunker: SemanticChunker                                               │
│ - parser: DocumentParser                                                 │
│ - baseDirs: string[]                                                     │
│ - dbPath: string                                                         │
│ - cacheDir: string                                                       │
├─────────────────────────────────────────────────────────────────────────┤
│ + initialize(): Promise<void>                                            │
│ + run(): Promise<void>                                                   │
│ + handleQueryDocuments(args): { content }                                │
│ + handleIngestFile(raw): { content }                                     │
│ + handleIngestData(args): { content }                                    │
│ + handleDeleteFile(raw): { content }                                     │
│ + handleListFiles(input): { content }                                    │
│ + handleStatus(): { content }                                            │
│ + handleReadChunkNeighbors(raw): { content }                             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐
│    VectorStore      │   │      Embedder       │   │  SemanticChunker    │
├─────────────────────┤   ├─────────────────────┤   ├─────────────────────┤
│ - db: Connection    │   │ - model: unknown    │   │ - config: Config    │
│ - table: Table      │   │ - initPromise       │   │                     │
│ - config: Config    │   │ - config: Config    │   │                     │
│ - ftsEnabled: bool  │   │                     │   │                     │
├─────────────────────┤   ├─────────────────────┤   ├─────────────────────┤
│ + initialize()      │   │ + initialize()      │   │ + chunkText()       │
│ + insertChunks()    │   │ + embed()           │   │                     │
│ + search()          │   │ + embedBatch()      │   │                     │
│ + deleteChunks()    │   │ + dispose()         │   │                     │
│ + listFiles()       │   │                     │   │                     │
│ + getStatus()       │   │                     │   │                     │
│ + close()           │   │                     │   │                     │
│ + optimize()        │   │                     │   │                     │
└─────────────────────┘   └─────────────────────┘   └─────────────────────┘
                                    │                       │
                                    ▼                       ▼
┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐
│  DocumentParser     │   │  PdfVisual (опц.)   │   │   LanceDB (БД)      │
├─────────────────────┤   ├─────────────────────┤   ├─────────────────────┤
│ - config: Config    │   │ - captioner: Cap... │   │ - Connection         │
│ - rawBaseDirs       │   │ - cacheDir: string  │   │ - Table              │
│ - resolvedBaseDirs  │   │ - device: string    │   │                     │
├─────────────────────┤   ├─────────────────────┤   ├─────────────────────┤
│ + parseFile()       │   │ + captionPages()    │   │ + connect()          │
│ + parsePdf()        │   │ + detectFigures()   │   │ + createTable()      │
│ + parseDocx()       │   │ + generateCaptions()│   │ + query()            │
│ + parseTxt()        │   │                     │   │ + add()              │
│ + parseMd()         │   │                     │   │ + delete()           │
│ + validateFilePath()│   │                     │   │ + optimize()         │
│ + validateFileSize()│   │                     │   │ + close()            │
└─────────────────────┘   └─────────────────────┘   └─────────────────────┘
```

### Описание классов

#### RAGServer
Главный класс-оркестратор. Реализует MCP-сервер и управляет всеми компонентами системы.
- **Ответственность:** Роутинг MCP-запросов, координация между компонентами, обработка ошибок
- **Зависимости:** VectorStore, Embedder, SemanticChunker, DocumentParser
- **Жизненный цикл:** Конфигурация → initialize() → run() → graceful shutdown

#### VectorStore
Обёртка над LanceDB для хранения и поиска векторов.
- **Ответственность:** CRUD-операции с чанками, векторный поиск, FTS-индекс, оптимизация
- **Особенности:** Поддержка транзакций (backup/rollback при реингесте), гибридный поиск
- **Схема:** filePath, chunkIndex, text, embedding (вектор), timestamp, fileSize, fileTitle

#### Embedder
Генерация эмбеддингов через Transformers.js.
- **Ответственность:** Создание векторных представлений текста
- **Модель:** Настраивается через `MODEL_NAME` (по умолчанию `Xenova/all-MiniLM-L6-v2`)
- **Особенности:** Lazy initialization, batch processing (batchSize=16), поддержка quantization (fp32, fp16, q8, int8)
- **Устройства:** CPU (по умолчанию), WebGPU (опционально)

#### SemanticChunker
Семантическое разбиение текста на чанки.
- **Алгоритм:** Max-Min (на основе Springer, 2025)
- **Ответственность:** Определение смысловых границ текста
- **Параметры:** hardThreshold=0.6, initConst=1.5, c=0.9, minChunkLength=50
- **Оптимизация:** Окно сравнения 5 предложений, лимит 15 предложений на чанк

#### DocumentParser
Парсинг документов различных форматов.
- **Форматы:** PDF (mupdf), DOCX (mammoth), TXT, MD
- **Безопасность:** Валидация путей (realpath-нормализация), проверка размера (100MB)
- **PDF-специфика:** Фильтрация header/footer через семантическое сравнение, извлечение метаданных

#### PdfVisual (опционально)
Визуальный режим обработки PDF через VLM.
- **Ответственность:** Генерация подписей к изображениям и диаграммам
- **Профили:** fast (SmolVLM-256M, ~250MB), quality (Qwen2.5-VL-3B, ~2.9GB)

---

## Публичные методы API

### MCP Инструменты

#### query_documents
Семантический поиск с keyword boost.

```typescript
interface QueryDocumentsInput {
  query: string;           // Поисковый запрос
  limit?: number;          // Максимум результатов (1-20, по умолчанию 10)
  scope?: string | string[]; // Фильтр по пути (абсолютный префикс)
}

interface QueryResult {
  filePath: string;        // Путь к файлу
  chunkIndex: number;      // Индекс чанка
  text: string;            // Текст чанка
  score: number;           // Оценка релевантности (0 = лучший)
  fileTitle: string | null; // Заголовок файла
  source?: string;         // Идентификатор источника (для ingest_data)
}
```

**Алгоритм:**
1. Генерация эмбеддинга запроса
2. Векторный поиск (кандидаты = limit × 20)
3. Применение scope-фильтра
4. Применение distance threshold
5. Grouping по семантическим разрывам
6. Keyword boost через FTS
7. File filter (maxFiles)
8. Сортировка и ограничение результатов

#### ingest_file
Загрузка файла в индекс.

```typescript
interface IngestFileInput {
  filePath: string;        // Абсолютный путь к файлу
  visual?: boolean;        // Включить VLM-подписи (PDF)
  visualQuality?: 'fast' | 'quality'; // Профиль VLM
}

interface IngestResult {
  filePath: string;
  chunkCount: number;
  timestamp: string;       // ISO 8601
  fileTitle: string | null;
}
```

**Особенности:**
- Transactional re-ingestion: backup → delete → insert → optimize
- При ошибке вставки — автоматический rollback
- Поддержка визуального режима для PDF

#### ingest_data
Загрузка контента из памяти.

```typescript
interface IngestDataInput {
  content: string;         // Текст или HTML
  metadata: {
    source: string;        // Идентификатор источника (URL, "clipboard://...", "chat://...")
    format: 'text' | 'html' | 'markdown';
  };
}
```

**Особенности:**
- HTML автоматически конвертируется в Markdown через Readability
- Контент сохраняется в `dbPath/raw-data/`
- Метаданные сохраняются в `.meta.json`

#### delete_file
Удаление из индекса.

```typescript
interface DeleteFileInput {
  filePath?: string;       // Для ingest_file
  source?: string;         // Для ingest_data
}

interface DeleteFileResult {
  deleted: boolean;        // Операция выполнена
  removedChunks: number;   // Удалённых чанков
  existed: boolean;        // Было ли что удалять
}
```

#### list_files
Список файлов и источников.

```typescript
interface ListFilesInput {
  scope?: string | string[]; // Фильтр по пути
}

interface ListFilesResult {
  baseDirs: string[];        // Все корневые директории
  baseDir?: string;          // Первая директория (legacy)
  files: FileEntry[];        // Файлы из файловой системы
  sources: SourceEntry[];    // Источники из ingest_data
}

interface FileEntry {
  filePath: string;
  chunkCount: number;
  timestamp: string;
  ingested: boolean;
  baseDir: string;           // Директория-источник
}

interface SourceEntry {
  source: string;
  ingested: boolean;
}
```

#### read_chunk_neighbors
Чтение соседних чанков для контекста.

```typescript
interface ReadChunkNeighborsInput {
  filePath?: string;         // Для ingest_file
  source?: string;           // Для ingest_data
  chunkIndex: number;        // Целевой чанк
  before?: number;           // Соседи до (0-50, по умолчанию 2)
  after?: number;            // Соседи после (0-50, по умолчанию 2)
}

interface ReadChunkNeighborsResultItem {
  chunkIndex: number;
  text: string;
  isTarget: boolean;         // true для целевого чанка
}
```

#### status
Статус системы.

```typescript
interface StatusResult {
  documentCount: number;     // Количество файлов
  chunkCount: number;        // Количество чанков
  memoryUsage: number;       // MB
  uptime: number;            // секунды
  ftsIndexEnabled: boolean;  // Включён ли FTS
  searchMode: 'hybrid' | 'vector-only';
}
```

---

## LLM и модели

### Эмбеддинги (основная функция)

| Модель | Размер | Размерность | Описание |
|--------|--------|-------------|----------|
| `Xenova/all-MiniLM-L6-v2` | ~90 MB | 384 | Модель по умолчанию, баланс скорость/качество |
| `sentence-transformers/all-MiniLM-L12-v2` | ~150 MB | 384 | Улучшенная версия, больше слоёв |
| `BAAI/bge-small-en-v1.5` | ~130 MB | 384 | Хорош для английского |
| `Xenova/multilingual-e5-large` | ~1.3 GB | 1024 | Мультиязычная, высокая точность |

**Настройка:** `MODEL_NAME` (HuggingFace путь)

**Квантование:** fp32 (по умолчанию), fp16, q8, int8 — через `RAG_DTYPE`

### VLM для визуального режима PDF

| Профиль | Модель | Размер | Назначение |
|---------|--------|--------|------------|
| `fast` | `HuggingFaceTB/SmolVLM-256M-Instruct` | ~250 MB | Быстрые подписи к изображениям |
| `quality` | `onnx-community/Qwen2.5-VL-3B-Instruct-ONNX` | ~2.9 GB | Высокая точность, текстовые области |

**Настройка:** `visual=true` + `visualQuality=fast|quality`

### Ограничения

- Все модели загружаются из HuggingFace при первом использовании
- После загрузки — полная автономность
- Кэш моделей: `CACHE_DIR` (по умолчанию `./models/`)
- Поддержка устройств: CPU (всегда), WebGPU (опционально, через `RAG_DEVICE=webgpu`)

---

## Способы подключения

### 1. MCP Сервер (для AI-ассистентов)

**Запуск:**
```bash
# Прямо через npx
npx mcp-local-rag

# Или через установленный пакет
mcp-local-rag

# С кастомной конфигурацией через переменные окружения
BASE_DIR=./docs MODEL_NAME=Xenova/all-MiniLM-L6-v2 mcp-local-rag
```

**Подключение клиентов:**

**Cursor:**
```json
{
  "mcpServers": {
    "rag": {
      "command": "npx",
      "args": ["mcp-local-rag"],
      "env": {
        "BASE_DIR": "./docs"
      }
    }
  }
}
```

**Claude Code:**
```bash
claude mcp add rag npx mcp-local-rag --env BASE_DIR=./docs
```

**Codex:**
```toml
# ~/.codex/config.toml
[mcp.rag]
command = "npx"
args = ["mcp-local-rag"]
env = { BASE_DIR = "./docs" }
```

### 2. CLI (командная строка)

**Базовые команды:**
```bash
# Ингестия
npx mcp-local-rag ingest ./docs/
npx mcp-local-rag ingest ./docs/ --visual --visual-quality quality

# Поиск
npx mcp-local-rag query "authentication API"
npx mcp-local-rag query "authentication" --scope /docs/api --limit 5

# Статус
npx mcp-local-rag status
npx mcp-local-rag list

# Удаление
npx mcp-local-rag delete ./docs/manual.pdf
```

### 3. Программный API (для интеграции)

**Импортируемые модули:**
```typescript
import { RAGServer } from 'mcp-local-rag/dist/server/index.js'
import { VectorStore } from 'mcp-local-rag/dist/vectordb/index.js'
import { Embedder } from 'mcp-local-rag/dist/embedder/index.js'
import { SemanticChunker } from 'mcp-local-rag/dist/chunker/index.js'
import { DocumentParser } from 'mcp-local-rag/dist/parser/index.js'
```

**Пример использования:**
```typescript
const server = new RAGServer({
  dbPath: './lancedb/',
  modelName: 'Xenova/all-MiniLM-L6-v2',
  cacheDir: './models/',
  baseDirs: ['./docs/'],
  maxFileSize: 100 * 1024 * 1024,
});

await server.initialize();
await server.run();
```

### 4. Agent Skills (для AI-ассистентов)

**Установка для Claude Code:**
```bash
npx mcp-local-rag skills install --claude-code
npx mcp-local-rag skills install --claude-code --global
```

**Установка для Codex:**
```bash
npx mcp-local-rag skills install --codex
```

---

## Нефункциональные требования

### Производительность
- Загрузка модели при первом запуске: 1-2 минуты (~90MB)
- Векторная БД: file-based, без внешних зависимостей
- Эмбеддинги: CPU по умолчанию, WebGPU опционально

### Надёжность
- Graceful degradation при ошибках парсинга
- Изоляция тестов через forks
- Pre-commit хуки через Husky

### Безопасность
- Нет внешних API-вызовов после загрузки модели
- Строгая проверка путей доступа
- Quarantine для новых npm-пакетов (24 часа)

---

**Автор:** Shinsuke Kagawa
**Лицензия:** MIT
**Репозиторий:** https://github.com/shinpr/mcp-local-rag
