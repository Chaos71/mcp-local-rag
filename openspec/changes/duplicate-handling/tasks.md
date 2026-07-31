## 1. Создание модуля дубликатов

- [x] 1.1 Создать `src/duplicates/hash.ts` — функция `computeContentHash(filePath: string): string` для вычисления SHA-256
- [x] 1.2 Создать `src/duplicates/types.ts` — типы `DuplicateEntry`, `DuplicateMode`
- [x] 1.3 Создать `src/duplicates/store.ts` — класс `DuplicateStore` с методами `add()`, `findByHash()`, `findDuplicates()`, `getAll()`, `remove()`

## 2. Расширение схемы БД

- [x] 2.1 Добавить поле `status` в таблицу `chunks` для LanceDB (через `addColumns`)
- [x] 2.2 Добавить поле `status` в таблицу `chunks` для PostgreSQL (через `ALTER TABLE`)
- [x] 2.3 Создать таблицу `duplicates` для LanceDB (при первой вставке)
- [x] 2.4 Создать таблицу `duplicates` для PostgreSQL (при `initialize()`)
- [x] 2.5 Добавить методы `getDuplicatesByHash()`, `markDeprecated()`, `cleanupDuplicates()` в `IVectordb`

## 3. Интеграция в ingest pipeline

- [x] 3.1 Добавить вычисление хеша в `handleIngestFile` (MCP-сервер)
- [x] 3.2 Добавить логику проверки дубликатов: skip / update / track
- [x] 3.3 Обновить `IngestResult` — добавить поля `status: 'new' | 'skipped' | 'updated' | 'tracked'`, `duplicateOf?: string`
- [x] 3.4 Аналогичная интеграция в CLI `ingestSingleFile`
- [ ] 3.5 Добавить поле `isDuplicate` в `IngestedFileSummary` для `list_files`

## 4. Новые инструменты MCP

- [ ] 4.1 Добавить инструмент `list_duplicates` — показать все цепочки дубликатов
- [ ] 4.2 Добавить инструмент `cleanup_duplicates` — удалить устаревшие дубликаты
- [ ] 4.3 Обновить `tool-definitions.ts` — добавить определения инструментов
- [ ] 4.4 Обновить `tool-input.ts` — добавить парсеры входных данных

## 5. CLI-подкоманды

- [ ] 5.1 Создать `src/cli/duplicates.ts` — CLI-подкоманды `duplicates list`, `duplicates cleanup`
- [ ] 5.2 Добавить парсинг аргументов: `--include-deprecated`, `--dry-run`
- [ ] 5.3 Вывести результат в формате JSON или human-readable
- [ ] 5.4 Добавить `--help` текст

## 6. Конфигурация

- [ ] 6.1 Добавить переменную окружения `DUPLICATE_MODE` (значения: `skip`, `update`, `track`)
- [ ] 6.2 Добавить валидацию значения в `tool-input.ts`
- [ ] 6.3 Обновить `.env.example` — добавить `DUPLICATE_MODE=skip`
- [ ] 6.4 Обновить `QWEN.md` — документация по режимам дубликатов

## 7. Тестирование

- [ ] 7.1 Unit-тесты для `computeContentHash()` — проверка корректности SHA-256
- [ ] 7.2 Unit-тесты для `DuplicateStore` — add, findByHash, findDuplicates
- [ ] 7.3 Integration-тесты для `handleIngestFile` с дубликатами
- [ ] 7.4 Integration-тесты для CLI-подкоманд `duplicates list` и `duplicates cleanup`

## 8. Документация

- [ ] 8.1 Обновить `README.md` и `README_RUS.md` — раздел про обработку дубликатов
- [ ] 8.2 Обновить `openspec/specs/mcp-local-rag/spec.md` — добавить требования к дубликатам
- [ ] 8.3 Добавить примеры использования CLI-команд в документации
