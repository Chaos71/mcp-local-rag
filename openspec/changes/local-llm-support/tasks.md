---
name: local-llm-support
artifact: tasks.md
---

# Задачи: Поддержка локальных LLM через llama.cpp

## Фаза 1: Базовая инфраструктура

### Задача 1.1: Добавить интерфейс Embedder

**Файл:** `src/embedder/index.ts` (обновить)

**Описание:** Расширить существующий интерфейс Embedder для поддержки обоих бэкендов.

**Шаги:**
1. Добавить метод `getDimensions(): number` к интерфейсу Embedder
2. Создать базовый интерфейс `IEmbedder` для абстракции
3. Обновить существующий класс `Embedder` (Transformers.js) для реализации нового интерфейса

**Acceptance Criteria:**
- [ ] Интерфейс Embedder содержит метод `getDimensions()`
- [ ] Существующий класс Embedder компилируется без ошибок
- [ ] Все существующие тесты проходят

---

### Задача 1.2: Добавить переменные окружения

**Файл:** `src/server-main.ts`, `src/cli/options.ts`

**Описание:** Добавить парсинг новых переменных окружения для llama.cpp.

**Шаги:**
1. Добавить `EMBEDDING_BACKEND` в `resolveServerConfig()`
2. Добавить парсинг `LLAMA_CPP_*` переменных
3. Добавить валидацию значения `EMBEDDING_BACKEND`
4. Добавить CLI флаг `--embedding-backend`

**Acceptance Criteria:**
- [ ] `EMBEDDING_BACKEND` по умолчанию = `transformers`
- [ ] `LLAMA_CPP_SERVER_URL` по умолчанию = `http://127.0.0.1:8080`
- [ ] `LLAMA_CPP_MODEL_PATH` по умолчанию = `undefined`
- [ ] Валидация: `EMBEDDING_BACKEND` может быть только `transformers` или `llama-cpp`

---

## Фаза 2: Реализация бэкенда llama.cpp

### Задача 2.1: Создать бэкенд llama-cpp

**Файл:** `src/embedder/llama-cpp.ts` (новый)

**Описание:** Реализовать класс `LlamaCppEmbedder` для работы с HTTP-сервером llama.cpp.

**Класс:**
```typescript
export interface LlamaCppConfig {
  serverUrl: string
  batchSize: number
  timeout: number  // миллисекунды
}

export class LlamaCppEmbedder implements IEmbedder {
  private config: LlamaCppConfig
  private dimensions: number = 4096  // Qwen3-Embedding-4B по умолчанию
  
  async initialize(): Promise<void>
  async embed(text: string): Promise<number[]>
  async embedBatch(texts: string[]): Promise<number[][]>
  async dispose(): Promise<void>
  getDimensions(): number
}
```

**Шаги:**
1. Создать интерфейс `LlamaCppConfig`
2. Реализовать метод `initialize()` — опциональная проверка доступности сервера (не обязательно)
3. Реализовать метод `embed()` — один HTTP-запрос к `/embed`
4. Реализовать метод `embedBatch()` — последовательные запросы (llama.cpp не поддерживает батчинг через HTTP)
5. Реализовать метод `getDimensions()` — возврат размерности (4096 для Qwen3-Embedding-4B)
6. Реализовать метод `dispose()` — освобождение ресурсов

**Acceptance Criteria:**
- [ ] Класс `LlamaCppEmbedder` реализует интерфейс `IEmbedder`
- [ ] Метод `embed()` делает HTTP-запрос к `/embed`
- [ ] Метод `embedBatch()` обрабатывает несколько текстов
- [ ] Обработка ошибок: таймаут, недоступность сервера, неверный формат ответа
- [ ] `getDimensions()` возвращает 4096 (для Qwen3-Embedding-4B)

---

### Задача 2.2: Создать фабрику Embedder

**Файл:** `src/embedder/factory.ts` (новый)

**Описание:** Фабричный метод для создания экземпляра Embedder в зависимости от выбранного бэкенда.

**Код:**
```typescript
import { Embedder as TransformersEmbedder } from './transformers.js'
import { LlamaCppEmbedder } from './llama-cpp.js'
import type { EmbedderConfig, LlamaCppConfig } from './types.js'

export type EmbeddingBackend = 'transformers' | 'llama-cpp'

export function createEmbedder(config: {
  backend: EmbeddingBackend
  transformersConfig?: EmbedderConfig
  llamaCppConfig?: LlamaCppConfig
}): IEmbedder {
  switch (config.backend) {
    case 'llama-cpp':
      return new LlamaCppEmbedder(config.llamaCppConfig!)
    case 'transformers':
    default:
      return new TransformersEmbedder(config.transformersConfig!)
  }
}
```

**Примечание:** `LlamaCppConfig` не содержит `modelPath` — модель настраивается при запуске `llama-server` вручную.

**Acceptance Criteria:**
- [ ] Функция `createEmbedder()` возвращает правильный бэкенд
- [ ] Без `llamaCppConfig` бэкенд `llama-cpp` выбрасывает ошибку
- [ ] Без `transformersConfig` бэкенд `transformers` выбрасывает ошибку

---

## Фаза 3: Интеграция в RAGServer

### Задача 3.1: Обновить типы RAGServerConfig

**Файл:** `src/server/types.ts`

**Описание:** Добавить поле `embeddingBackend` в конфигурацию RAGServer.

**Acceptance Criteria:**
- [ ] `RAGServerConfig` содержит поле `embeddingBackend?: EmbeddingBackend`
- [ ] `RAGServerConfig` содержит поле `llamaCppConfig?: LlamaCppConfig` (опционально)

---

### Задача 3.2: Обновить инициализацию RAGServer

**Файл:** `src/server/index.ts`

**Описание:** Использовать фабрику для создания Embedder вместо прямого new.

**Шаги:**
1. Импортировать `createEmbedder` из фабрики
2. Использовать `createEmbedder()` вместо `new Embedder()`
3. Передать конфигурацию llama.cpp если бэкенд выбран

**Acceptance Criteria:**
- [ ] RAGServer создает Embedder через фабрику
- [ ] При `embeddingBackend: 'llama-cpp'` создается `LlamaCppEmbedder`
- [ ] При `embeddingBackend: 'transformers'` создается `TransformersEmbedder`

---

## Фаза 4: Тестирование

### Задача 4.1: Добавить тесты для LlamaCppEmbedder

**Файл:** `src/embedder/__tests__/llama-cpp.test.ts` (новый)

**Описание:** Unit-тесты для бэкенда llama.cpp.

**Тесты:**
1. `initialize()` — успешная инициализация при доступном сервере
2. `embed()` — успешная генерация эмбеддинга
3. `embed()` — обработка таймаута
4. `embed()` — обработка недоступности сервера
5. `embedBatch()` — обработка нескольких текстов
6. `getDimensions()` — возврат правильной размерности
7. `dispose()` — корректное освобождение ресурсов

**Acceptance Criteria:**
- [ ] Все тесты проходят
- [ ] Mock HTTP-запросов через `vi.mock()`

---

### Задача 4.2: Добавить тесты для фабрики

**Файл:** `src/embedder/__tests__/factory.test.ts` (новый)

**Описание:** Тесты фабричного метода.

**Тесты:**
1. Создание TransformersEmbedder при `backend: 'transformers'`
2. Создание LlamaCppEmbedder при `backend: 'llama-cpp'`
3. Ошибка при отсутствии конфигурации для выбранного бэкенда

**Acceptance Criteria:**
- [ ] Все тесты проходят

---

### Задача 4.3: Добавить E2E тесты

**Файл:** `src/__tests__/e2e/llama-cpp-workflow.e2e.test.ts` (новый)

**Описание:** Интеграционные тесты с mock-сервером llama.cpp.

**Acceptance Criteria:**
- [ ] E2E тест запускает mock-сервер
- [ ] E2E тест выполняет ingest и query через llama-cpp бэкенд
- [ ] E2E тест подтверждает корректность результатов

---

## Фаза 5: Документация

### Задача 5.1: Обновить README

**Файл:** `README.md`, `README_RUS.md`

**Описание:** Добавить раздел о поддержке llama.cpp.

**Содержание:**
1. Раздел "Поддержка llama.cpp"
2. Список совместимых моделей (Qwen3-Embedding-4B, nomic-embed-text-v1.5)
3. Инструкция по запуску llama.cpp сервера
4. Пример конфигурации

**Acceptance Criteria:**
- [ ] README содержит раздел о llama.cpp
- [ ] Примеры конфигурации для обоих бэкендов
- [ ] Ссылки на документацию llama.cpp

---

### Задача 5.2: Добавить QWEN.md

**Файл:** `QWEN.md` (обновить)

**Описание:** Обновить документацию проекта.

**Acceptance Criteria:**
- [ ] Обновлен раздел "Конфигурация"
- [ ] Добавлены новые переменные окружения
- [ ] Добавлен раздел "Локальные LLM"

---

## Фаза 6: Финальная проверка

### Задача 6.1: Проверка качества кода

**Команды:**
```bash
pnpm run check:all
pnpm run test
```

**Acceptance Criteria:**
- [ ] Все линтеры проходят
- [ ] Все тесты проходят
- [ ] TypeScript компиляция без ошибок

---

### Задача 6.2: Ручное тестирование

**Шаги:**
1. Запустить llama.cpp сервер (ручно):
   ```bash
   llama-server --model ./models/Qwen3-Embedding-4B.gguf --port 8080 --embedding
   ```
2. Установить переменную окружения:
   ```bash
   export EMBEDDING_BACKEND=llama-cpp
   export LLAMA_CPP_SERVER_URL=http://127.0.0.1:8080
   ```
3. Запустить mcp-local-rag
4. Выполнить ingest и query
5. Проверить результаты

**Acceptance Criteria:**
- [ ] Ingest работает через llama-cpp бэкенд
- [ ] Query возвращает корректные результаты
- [ ] Производительность приемлемая

---

## Итоговый чек-лист

- [ ] Задача 1.1: Интерфейс Embedder
- [ ] Задача 1.2: Переменные окружения
- [ ] Задача 2.1: Бэкенд llama-cpp
- [ ] Задача 2.2: Фабрика Embedder
- [ ] Задача 3.1: Типы RAGServerConfig
- [ ] Задача 3.2: Инициализация RAGServer
- [ ] Задача 4.1: Тесты LlamaCppEmbedder
- [ ] Задача 4.2: Тесты фабрики
- [ ] Задача 4.3: E2E тесты
- [ ] Задача 5.1: Обновить README
- [ ] Задача 5.2: Обновить QWEN.md
- [ ] Задача 6.1: Проверка качества
- [ ] Задача 6.2: Ручное тестирование
