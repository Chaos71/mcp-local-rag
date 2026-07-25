## ADDED Requirements

### Requirement: Поддержка PostgreSQL как бэкенда векторной БД
Система SHALL позволять использовать PostgreSQL с pgvector extension в качестве бэкенда для хранения векторов и метаданных вместо LanceDB.

#### Scenario: Выбор PostgreSQL бэкенда
- **WHEN** пользователь устанавливает `VECTORDB_BACKEND=postgresql`
- **THEN** система инициализирует PostgreSQL-бэкенд вместо LanceDB

#### Scenario: Переключение на LanceDB по умолчанию
- **WHEN** `VECTORDB_BACKEND` не установлен или равен `lancedb`
- **THEN** система использует LanceDB как бэкенд (существующее поведение)

### Requirement: Конфигурация подключения к PostgreSQL
Система SHALL конфигурировать подключение к PostgreSQL через переменные окружения.

#### Scenario: Базовая конфигурация
- **WHEN** установлены `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, `PG_PASSWORD`
- **THEN** система подключается к PostgreSQL с указанными параметрами

#### Scenario: Дополнительные параметры
- **WHEN** установлены `PG_SSL_MODE`, `PG_MAX_POOL_SIZE`, `PG_MIN_POOL_SIZE`
- **THEN** система применяет параметры пула соединений и SSL

#### Scenario: Отсутствующие обязательные параметры
- **WHEN** не установлена хотя бы одна из `PG_HOST`, `PG_DATABASE`, `PG_USER`, `PG_PASSWORD`
- **THEN** система выводит явную ошибку и завершает работу

### Requirement: Поддержка настраиваемой схемы PostgreSQL
Система SHALL позволять указывать произвольную схему PostgreSQL для хранения таблиц.

#### Scenario: Указание схемы
- **WHEN** установлена переменная `PG_SCHEMA`
- **THEN** система использует указанную схему для всех SQL-запросов

#### Scenario: Схема по умолчанию
- **WHEN** `PG_SCHEMA` не установлена
- **THEN** система использует схему `public` по умолчанию

#### Scenario: Автоматическое создание схемы
- **WHEN** PostgreSQL-бэкенд инициализируется и схема не существует
- **THEN** система автоматически создаёт схему через `CREATE SCHEMA IF NOT EXISTS`

#### Scenario: Квалификация SQL-запросов
- **WHEN** выполняются SQL-запросы к таблицам
- **THEN** все имена таблиц квалифицируются схемой (например, `myschema.chunks`)

### Requirement: Инициализация схемы PostgreSQL
Система SHALL автоматически создавать необходимые таблицы и индексы при первом подключении.

#### Scenario: Создание таблиц
- **WHEN** PostgreSQL-бэкенд инициализируется с пустой базой
- **THEN** создаются таблицы `chunks`, `files`, `metadata`

#### Scenario: Создание pgvector индекса
- **WHEN** таблица `chunks` создана
- **THEN** создаётся IVFFlat-индекс на векторном поле `embedding`

#### Scenario: Создание FTS-индекса
- **WHEN** таблица `chunks` создана
- **THEN** создаётся GIN-индекс на текстовом поле `text` через pg_trgm для keyword boost

#### Scenario: Проверка pgvector extension
- **WHEN** инициализация PostgreSQL-бэкенда
- **THEN** система проверяет наличие pgvector extension и выводит ошибку если extension отсутствует

### Requirement: Векторный поиск через PostgreSQL
Система SHALL выполнять векторный поиск через pgvector с поддержкой keyword boost.

#### Scenario: Векторный поиск
- **WHEN** выполняется поиск с эмбеддингом запроса
- **THEN** система использует IVFFlat-индекс для поиска ближайших соседей

#### Scenario: Keyword boost через pg_trgm
- **WHEN** выполняется гибридный поиск с `queryText`
- **THEN** система применяет pg_trgm-индекс для keyword boost результатов

#### Scenario: Scope-фильтрация
- **WHEN** выполняется поиск с `scope`
- **THEN** система применяет SQL-префикс-фильтр к `file_path`

### Requirement: CRUD-операции через PostgreSQL
Система SHALL выполнять все операции вставки, удаления и чтения через PostgreSQL.

#### Scenario: Вставка чанков
- **WHEN** выполняется ингестия файла
- **THEN** чанки вставляются в таблицу `chunks` транзакцией

#### Scenario: Удаление чанков по файлу
- **WHEN** вызывается `deleteChunks(filePath)`
- **THEN** удаляются все записи из `chunks` с указанным `file_path`

#### Scenario: Чтение чанков по диапазону
- **WHEN** вызывается `getChunksByRange(filePath, minIdx, maxIdx)`
- **THEN** возвращаются чанки из `chunks` в указанном диапазоне индексов

#### Scenario: Список файлов
- **WHEN** вызывается `listFiles()`
- **THEN** система агрегирует данные из `files` таблицы (без запроса к `chunks`)

### Requirement: Безопасность и надёжность
Система SHALL обеспечивать безопасное подключение и обработку ошибок.

#### Scenario: Автопересоединение при потере связи
- **WHEN** происходит потеря соединения с PostgreSQL
- **THEN** система пытается переподключиться с экспоненциальной задержкой

#### Scenario: Обработка SQL-инъекций
- **WHEN** выполняются запросы с пользовательскими данными (filePath и т.д.)
- **THEN** система использует параметризованные запросы

#### Scenario: Ограничение размера пула
- **WHEN** `PG_MAX_POOL_SIZE` установлен
- **THEN** система не создаёт больше соединений, чем указано
