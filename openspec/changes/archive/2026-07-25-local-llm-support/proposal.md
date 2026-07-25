---
name: local-llm-support
description: Добавить поддержку локальных LLM через llama.cpp для генерации эмбеддингов
---

# Предложение: Поддержка локальных LLM через llama.cpp

## Проблема

Сейчас mcp-local-rag использует Transformers.js (`@huggingface/transformers`) для генерации эмбеддингов. Это ограничивает выбор моделей только теми, что поддерживаются Transformers.js (в основном модели от Xenova на HuggingFace).

Пользователи хотят использовать современные модели эмбеддингов, которые доступны только в формате GGUF и требуют llama.cpp для инференса, например:
- **Qwen/Qwen3-Embedding-4B** — современная модель эмбеддингов от Alibaba
- **nomic-ai/nomic-embed-text-v1.5** — качественная модель с хорошей семантикой
- Любые другие GGUF-модели, совместимые с llama.cpp

## Решение

Добавить второй бэкенд для генерации эмбеддингов — **llama.cpp** — параллельно с существующим Transformers.js. Пользователь выбирает бэкенд через переменную окружения `EMBEDDING_BACKEND`.

Сервер llama.cpp запускается **вручную** как отдельный процесс:
```bash
llama-server --model ./models/Qwen3-Embedding-4B.gguf --port 8080 --embedding
```

### Ключевые решения

1. **Двойной бэкенд**: `transformers` (по умолчанию) и `llama-cpp`
2. **Формат модели**: GGUF (стандарт для llama.cpp)
3. **API взаимодействия**: HTTP-сервер llama.cpp (запускается вручную, отдельный процесс)
4. **Единый интерфейс**: Оба бэкенда реализуют один и тот же интерфейс `IEmbedder`
5. **OpenAI-compatible API**: Взаимодействие через стандартный `/v1/embeddings` endpoint llama.cpp
6. **Гибкая конфигурация**: Поддержка переменных окружения для всех параметров

## Архитектура

### Компоненты

| Компонент | Файл | Описание |
|-----------|------|----------|
| LlamaCppEmbedder | `src/embedder/llama-cpp.ts` | Реализация бэкенда llama.cpp |
| Embedder | `src/embedder/index.ts` | Бэкенд Transformers.js (существующий) |
| createEmbedder | `src/embedder/factory.ts` | Фабрика для создания бэкенда |
| Типы | `src/embedder/types.ts` | Общие типы и конфигурация |

### Потоки данных

```
Пользователь (EMBEDDING_BACKEND=llama-cpp)
    ↓
createEmbedder() (фабрика)
    ↓
LlamaCppEmbedder
    ↓
HTTP POST → llama-server (локальный процесс)
    ↓
/v1/embeddings (OpenAI-compatible API)
    ↓
number[] (эмбеддинг)
```

## Конфигурация

### Переменные окружения

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| `EMBEDDING_BACKEND` | `transformers` | Бэкенд: `transformers` или `llama-cpp` |
| `LLAMA_CPP_SERVER_URL` | `http://127.0.0.1:8080` | URL сервера llama.cpp |
| `LLAMA_CPP_MODEL` | `nomic-embed-text` | Модель для OpenAI-compatible API |
| `LLAMA_CPP_BATCH_SIZE` | `16` | Размер батча (1–128) |
| `LLAMA_CPP_TIMEOUT` | `30000` | Таймаут запроса (мс) |
| `RAG_LLAMA_CPP_DIMENSIONS` | `4096` | Размерность эмбеддингов (переопределение) |

### CLI опции

Все параметры llama.cpp доступны через флаги CLI:
```bash
npx mcp-local-rag --backend llama-cpp --llama-cpp-server-url http://127.0.0.1:8080 query "search term"
```

### Поддерживаемые модели

| Модель | Размерность | Размер |
|--------|-------------|--------|
| Qwen/Qwen3-Embedding-4B | 4096 | ~2.9 GB |
| nomic-ai/nomic-embed-text-v1.5 | 768 | ~1.5 GB |

## Реализованные возможности

- [x] Бэкенд llama.cpp для генерации эмбеддингов
- [x] Выбор бэкенда через `EMBEDDING_BACKEND`
- [x] Поддержка GGUF-моделей эмбеддингов
- [x] Обратная совместимость с Transformers.js
- [x] Валидация конфигурации с предупреждениями
- [x] Health check сервера
- [x] Специализированные классы ошибок
- [x] Последовательная обработка батчей
- [x] Полные тесты для llama-cpp бэкенда
- [x] Документация в `.env.example`

## Не-цели

- Поддержка GPU через CUDA в llama.cpp (на первое время только CPU)
- Автоматическая загрузка моделей
- Поддержка других форматов кроме GGUF
- Асинхронная обработка батчей (llama.cpp не поддерживает batched inference via HTTP)
