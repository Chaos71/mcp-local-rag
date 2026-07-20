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
├── embedder/             # Transformers.js эмбеддинги
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
