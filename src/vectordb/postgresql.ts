// PostgreSQL vector database backend using pgvector extension

import { Pool, types } from 'pg'
import { normalizeScopePrefix } from '../utils/scope-match.js'
import { applyFileFilter, applyGrouping, applyKeywordBoost } from './search-filters.js'
import {
  type ChunkRow,
  type ChunkStatus,
  DatabaseError,
  DEFAULT_HYBRID_WEIGHT,
  DEFAULT_PG_SCHEMA,
  HYBRID_SEARCH_CANDIDATE_MULTIPLIER,
  type IVectordb,
  type PostgreSQLVectorStoreConfig,
  type SearchOptions,
  type SearchResult,
  type VectorChunk,
} from './types.js'

// ============================================
// Type Mappings
// ============================================

/**
 * Map PostgreSQL 'uuid' type to JavaScript string.
 * pg returns UUIDs as strings by default, but we register the type cast
 * for consistency and future-proofing.
 */
types.setTypeParser(25, (value: string) => value) // text → string
types.setTypeParser(114, (value: string) => value) // json → string

/**
 * Register halfvec type parser for pg-driver.
 * halfvec is returned as a string in array format (e.g., '[0.1,0.2]').
 * We parse it as a float32 array for internal use.
 * halfvec OID is 1700 (registered in pgvector >= 0.7.0).
 */
types.setTypeParser(1700, (value: string): number[] => {
  // Parse halfvec string format: '[0.1,0.2,...]'
  const match = value.match(/^\[(.+)\]$/)
  if (!match?.[1]) return []
  return match[1].split(',').map(Number)
})

// ============================================
// PostgreSQL Row Types
// ============================================

/** Row returned from chunks table query */
interface PgChunksRow {
  id: string
  file_path: string
  chunk_index: string
  text: string
  file_title: string | null
  timestamp: string
  embedding: string
  score: string | undefined
  status: string | null
  contentHash: string | null
}

/** Row returned from files table query */
interface PgFilesRow {
  file_path: string
  chunk_count: string
  timestamp: string
}

/** Row returned from FTS/pg_trgm query */
interface PgFtsRow {
  file_path: string
  chunk_index: string
  text: string
  similarity_score: string
}

// ============================================
// SQL Schema
// ============================================

/** Default table names */
const DEFAULT_TABLES = {
  chunks: 'chunks',
  files: 'files',
  metadata: 'metadata',
  duplicates: 'duplicates',
}

/**
 * Qualified table reference: schema.table_name
 */
function qualified(name: string, schema: string): string {
  return `${schema}.${name}`
}

/**
 * SQL schema for PostgreSQL vector storage.
 * Creates tables, indexes, and extensions required for vector search.
 */
export function buildSchemaSQL(config: PostgreSQLVectorStoreConfig): string[] {
  const { chunks, files, metadata } = DEFAULT_TABLES
  const tableName = config.tableName || chunks
  const embeddingDim = config.embeddingDimension ?? 384
  const ivfLists = config.ivfLists ?? 100
  const schema = config.pgConfig.schema || 'public'

  console.error(
    `buildSchemaSQL: embeddingDim=${embeddingDim}, useHNSWIndex=${config.useHNSWIndex ?? false}, useHalfvecIndex=${config.useHalfvecIndex ?? false}, ivfLists=${ivfLists}`
  )

  // halfvec тип поддерживает до 4000 измерений (против 2000 для vector).
  // При useHalfvecIndex=true используем halfvec для индексации.
  // halfvec-индекс строится на выражении-приведении: embedding::halfvec(dim)
  const useHalfvecIndex = config.useHalfvecIndex ?? false

  // PostgreSQL IVFFlat индекс поддерживает размерность максимум 2000.
  // HNSW индекс также имеет лимит 2000 размерностей.
  // Используем IVFFlat для всех размерностей <= 2000.
  const useHNSWIndex = config.useHNSWIndex ?? false

  // Vector index SQL
  const vectorIndexSQL = useHalfvecIndex
    ? // halfvec HNSW индекс — поддерживает до 4000 измерений.
      // Индекс строится на выражении-приведении embedding::halfvec(dim).
      // Требует pgvector >= 0.7.0.
      `CREATE INDEX IF NOT EXISTS ${tableName}_embedding_idx ON ${tableName} USING hnsw ((embedding::halfvec(${embeddingDim})) halfvec_cosine_ops)`
    : useHNSWIndex
      ? // HNSW индекс — более быстрый при поиске, но требует больше памяти
        // Note: pgvector 0.7+ uses simplified syntax without operator classes
        `CREATE INDEX IF NOT EXISTS ${tableName}_embedding_idx ON ${tableName} USING hnsw (embedding vector_cosine_ops)`
      : // IVFFlat индекс — более быстрое построение, но медленнее при поиске
        // Note: CREATE INDEX ... USING ivfflat doesn't support schema-qualified names
        // in PostgreSQL, so we use unqualified names (search_path is set before execution)
        // Note: pgvector 0.7+ uses simplified syntax without operator classes
        `CREATE INDEX IF NOT EXISTS ${tableName}_embedding_idx ON ${tableName} USING ivfflat (embedding) WITH (lists = ${ivfLists})`

  const indexType = useHalfvecIndex ? 'halfvec-HNSW' : useHNSWIndex ? 'HNSW' : 'IVFFlat'
  console.error(
    `buildSchemaSQL: Creating table with embedding dimension ${embeddingDim} and index type ${indexType}`
  )

  return [
    // Create schema if it does not exist
    `CREATE SCHEMA IF NOT EXISTS ${schema}`,

    // Enable pg_trgm extension for keyword boost
    'CREATE EXTENSION IF NOT EXISTS pg_trgm',

    // Enable pgvector extension for vector search
    'CREATE EXTENSION IF NOT EXISTS vector',

    // Chunks table — main storage for vectors and text
    // Note: embedding stored as VECTOR(dim), indexing may use halfvec conversion
    // 2.2: Added 'status' column for soft-deletion (deprecated chunks)
    // 2.2: Added 'contentHash' column for duplicate tracking
    `CREATE TABLE IF NOT EXISTS ${qualified(tableName, schema)} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      file_path TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding vector(${embeddingDim}) NOT NULL,
      file_title TEXT,
      timestamp TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      status TEXT DEFAULT 'active',
      contentHash TEXT
    )`,

    // Vector index for search
    // halfvec индекс поддерживает размерность до 4000 (через приведение embedding::halfvec)
    vectorIndexSQL,

    // Index for fast file path lookup
    `CREATE INDEX IF NOT EXISTS ${tableName}_file_path_idx ON ${tableName} (file_path)`,

    // GIST index for pg_trgm keyword boost
    // Note: PostgreSQL 15+ uses gist_trgm_ops instead of gin_trgm_ops
    `CREATE INDEX IF NOT EXISTS ${tableName}_text_trgm_idx ON ${tableName} USING gist (text gist_trgm_ops)`,

    // Files table — aggregation for list_files (avoids scanning chunks)
    `CREATE TABLE IF NOT EXISTS ${qualified(files, schema)} (
      file_path TEXT PRIMARY KEY,
      chunk_count INTEGER NOT NULL,
      timestamp TIMESTAMP NOT NULL,
      file_size INTEGER NOT NULL,
      file_type TEXT NOT NULL
    )`,

    // Metadata table — additional file metadata
    `CREATE TABLE IF NOT EXISTS ${qualified(metadata, schema)} (
      file_path TEXT PRIMARY KEY,
      file_title TEXT,
      file_size INTEGER,
      file_type TEXT,
      ingested_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (file_path) REFERENCES ${qualified(files, schema)}(file_path)
    )`,

    // 2.4: Duplicates table — tracks document duplicates and their relationships
    // Stores content hash, file paths, and links between duplicate versions
    `CREATE TABLE IF NOT EXISTS ${qualified('duplicates', schema)} (
      id SERIAL PRIMARY KEY,
      content_hash TEXT NOT NULL,
      file_path TEXT NOT NULL,
      duplicate_of TEXT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(content_hash, file_path)
    )`,

    // Index for fast duplicate lookup by hash
    `CREATE INDEX IF NOT EXISTS duplicates_content_hash_idx ON ${qualified('duplicates', schema)} (content_hash)`,

    // Index for finding all versions of a document
    `CREATE INDEX IF NOT EXISTS duplicates_duplicate_of_idx ON ${qualified('duplicates', schema)} (duplicate_of)`,
  ]
}

// ============================================
// Dimension Mismatch Result Type
// ============================================

/**
 * Result of a dimension mismatch check.
 */
interface DimensionMismatchResult {
  current: number
}

// ============================================
// PostgreSQLVectordb Class
// ============================================

/**
 * PostgreSQL vector database backend using pgvector extension.
 *
 * Responsibilities:
 * - PostgreSQL connection pooling with auto-reconnection
 * - Vector storage via pgvector (IVFFlat index)
 * - Keyword boost via pg_trgm
 * - Transactional chunk operations
 * - Schema management (tables, indexes, extensions)
 *
 * Architecture decisions:
 * - Uses pg (node-postgres) for connection pooling
 * - IVFFlat index for vector search (faster build, slower query than HNSW)
 * - pg_trgm for keyword boost (lighter than full-text search)
 * - Separate files table for list_files aggregation (avoids chunk scan)
 */
export class PostgreSQLVectordb implements IVectordb {
  private pool: Pool | null = null
  private config: PostgreSQLVectorStoreConfig
  private initialized = false
  private ftsEnabled = false
  private tableName: string
  private embeddingDim: number
  private schema: string
  private useHNSWIndex: boolean
  private useHalfvecIndex: boolean

  constructor(config: PostgreSQLVectorStoreConfig) {
    this.config = config
    this.tableName = config.tableName || DEFAULT_TABLES.chunks
    this.embeddingDim = config.embeddingDimension ?? 384

    // halfvec индекс поддерживает до 4000 измерений (против 2000 для vector).
    // Если embeddingDim > 2000 и useHalfvecIndex не установлен — предупреждаем.
    this.useHalfvecIndex = config.useHalfvecIndex ?? false

    // IVFFlat и HNSW индексы pgvector поддерживают только размерности <= 2000.
    // Если halfvec не включён и размерность > 2000 — выбрасываем ошибку.
    if (this.embeddingDim > 2000 && !this.useHalfvecIndex) {
      throw new DatabaseError(
        `Embedding dimension ${this.embeddingDim} exceeds PostgreSQL index limit of 2000. ` +
          `Please set USE_HALFVEC_INDEX=true to use halfvec type (requires pgvector >= 0.7.0). ` +
          `halfvec supports up to 4000 dimensions.`
      )
    }

    // IVFFlat используется по умолчанию для размерностей <= 2000
    this.useHNSWIndex = false
    // ivfLists используется только для IVFFlat индекса
    this.schema = config.pgConfig.schema || DEFAULT_PG_SCHEMA
    console.error(
      `PostgreSQLVectordb: Constructor: embeddingDim=${this.embeddingDim}, useHNSWIndex=${this.useHNSWIndex}, useHalfvecIndex=${this.useHalfvecIndex}, config.embeddingDimension=${config.embeddingDimension}`
    )
  }

  /**
   * Получить конфигурацию для buildSchemaSQL, включающую useHNSWIndex и useHalfvecIndex.
   * Это необходимо для TypeScript проверки использования свойства.
   */
  private getConfigForSchema(): PostgreSQLVectorStoreConfig {
    const config: PostgreSQLVectorStoreConfig = {
      ...this.config,
      useHNSWIndex: this.useHNSWIndex,
      useHalfvecIndex: this.useHalfvecIndex,
      // Если useHNSWIndex не установлен явно, но embeddingDimension > 2000,
      // передаём false для предотвращения создания HNSW индекса с недопустимой размерностью
      embeddingDimension: this.embeddingDim,
    }

    // Если useHNSWIndex=false, передаём ivfLists для IVFFlat индекса
    if (!this.useHNSWIndex && this.config.ivfLists !== undefined) {
      config.ivfLists = this.config.ivfLists
    }

    return config
  }

  // ============================================
  // Dimension Mismatch Detection
  // ============================================

  /**
   * Check if the existing table's embedding column has a different dimension
   * than the configured one. Returns null if no mismatch or table doesn't exist.
   *
   * Uses pg_attribute to read the column's typmod, which for pgvector columns
   * encodes the dimension (e.g., vector(384) has typmod = 384).
   */
  private async checkDimensionMismatch(client: any): Promise<null | DimensionMismatchResult> {
    try {
      const result = await client.query(
        `SELECT a.atttypmod FROM pg_attribute a
         JOIN pg_class c ON a.attrelid = c.oid
         JOIN pg_namespace n ON c.relnamespace = n.oid
         WHERE c.relname = $1 AND n.nspname = $2 AND a.attname = 'embedding'`,
        [this.tableName, this.schema]
      )

      if (result.rows.length === 0) {
        // Table doesn't exist yet — no mismatch
        return null
      }

      // pgvector stores dimension as typmod (atttypmod)
      const currentDim = result.rows[0].atttypmod
      if (currentDim === this.embeddingDim) {
        return null
      }

      return { current: currentDim }
    } catch (_error) {
      // If we can't check (e.g., older pgvector without typmod), skip
      return null
    }
  }

  // ============================================
  // Initialization
  // ============================================

  /**
   * Initialize PostgreSQL connection and ensure schema exists.
   * Creates connection pool, verifies pgvector extension, creates tables and indexes.
   */
  async initialize(): Promise<void> {
    try {
      const pgConfig = this.config.pgConfig

      // Validate required configuration
      if (!pgConfig.host) {
        throw new DatabaseError('PG_HOST is required for PostgreSQL backend')
      }
      if (!pgConfig.database) {
        throw new DatabaseError('PG_DATABASE is required for PostgreSQL backend')
      }
      if (!pgConfig.user) {
        throw new DatabaseError('PG_USER is required for PostgreSQL backend')
      }
      if (!pgConfig.password) {
        throw new DatabaseError('PG_PASSWORD is required for PostgreSQL backend')
      }

      // Create connection pool
      // The pg library (8.x) has a bug: when ssl: 'disable' (string) is passed, it does NOT
      // convert it to false. Instead, the string 'disable' remains truthy, causing the library
      // to attempt an SSL connection, which fails with "The server does not support SSL connections".
      //
      // The library only converts ssl: 'true' → true and ssl: 'no-verify' → { rejectUnauthorized: false }.
      // ssl: 'disable' is not handled, so we must explicitly use ssl: false (boolean).
      const sslMode = pgConfig.sslMode ?? 'disable'
      const sslConfig: string | boolean | { rejectUnauthorized: boolean } =
        sslMode === 'disable'
          ? false // Boolean false explicitly disables SSL at the protocol level
          : sslMode === 'allow' || sslMode === 'prefer'
            ? { rejectUnauthorized: false }
            : sslMode === 'require' || sslMode === 'verify-ca' || sslMode === 'verify-full'
              ? { rejectUnauthorized: sslMode !== 'verify-full' }
              : false

      const poolConfig: {
        host: string
        port: number
        database: string
        user: string
        password: string
        max: number
        min: number
        ssl: string | boolean | { rejectUnauthorized: boolean }
        connectionTimeoutMillis: number
        queryTimeout: number
      } = {
        host: pgConfig.host,
        port: pgConfig.port ?? 5432,
        database: pgConfig.database,
        user: pgConfig.user,
        password: pgConfig.password,
        max: pgConfig.maxPoolSize ?? 20,
        min: pgConfig.minPoolSize ?? 0,
        ssl: sslConfig,
        connectionTimeoutMillis: 10000,
        queryTimeout: 30000,
      }

      // Cast to any because the pg type definitions don't include the string
      // 'disable' variant (now replaced with boolean false for reliability).
      this.pool = new Pool(poolConfig as any)

      // Test connection and verify pgvector extension
      const client = await this.pool.connect()
      try {
        // Check pgvector extension
        const extResult = await client.query(
          "SELECT extname FROM pg_extension WHERE extname = 'vector'"
        )
        if (extResult.rows.length === 0) {
          throw new DatabaseError(
            'pgvector extension is not installed. Please install it: CREATE EXTENSION vector;'
          )
        }

        // Verify pgvector is functional by creating a simple vector.
        // When using halfvec, test halfvec casting instead.
        // Note: Using fixed-size vector syntax (e.g., vector(4096)) can cause
        // protocol errors on some PostgreSQL versions, so we use a simpler test.
        const testCast = this.useHalfvecIndex ? 'halfvec' : 'vector'
        await client.query(`SELECT ARRAY[0,0,0]::${testCast}`)
      } finally {
        client.release()
      }

      // Create schema (tables, indexes, extensions)
      // Set search_path to include both the target schema and public (for extensions like pg_trgm)
      // This allows unqualified table names to work with CREATE INDEX ... USING ivfflat
      // (which doesn't support schema-qualified names) while still accessing pg_trgm from public
      await client.query(`SET search_path TO ${this.schema}, public`)

      // Check if the existing table has a different embedding dimension BEFORE creating.
      // This prevents "column cannot have more than 2000 dimensions" errors when trying
      // to create an index on an existing table with incompatible dimension.
      const dimMismatch = await this.checkDimensionMismatch(client)
      console.error(
        `PostgreSQLVectordb: Dimension mismatch check: ${JSON.stringify(dimMismatch)} (expected: ${this.embeddingDim})`
      )
      if (dimMismatch) {
        console.error(
          `PostgreSQLVectordb: Table dimension mismatch detected (${dimMismatch.current} → ${this.embeddingDim}). ` +
            'Dropping and recreating table with correct dimension.'
        )
        // Drop table cascades indexes and constraints automatically
        await client.query(`DROP TABLE IF EXISTS ${qualified(this.tableName, this.schema)} CASCADE`)
      }

      // Create table and indexes with the correct dimension
      const schemaSQL = buildSchemaSQL(this.getConfigForSchema())
      console.error(`PostgreSQLVectordb: Creating schema with ${schemaSQL.length} SQL statements`)
      for (const sql of schemaSQL) {
        console.error(`PostgreSQLVectordb: Executing SQL: ${sql.substring(0, 100)}...`)
        await client.query(sql)
      }

      this.initialized = true
      this.ftsEnabled = true // pg_trgm is always enabled after schema creation
      console.error(
        `PostgreSQLVectordb: Initialized connection to ${pgConfig.host}:${pgConfig.port}/${pgConfig.database}`
      )
      console.error(
        `PostgreSQLVectordb: Using schema "${this.schema}", table "${this.tableName}", embedding dimension ${this.embeddingDim}`
      )
    } catch (error) {
      // Clean up pool on failure
      if (this.pool) {
        await this.pool.end()
        this.pool = null
      }
      throw new DatabaseError('Failed to initialize PostgreSQLVectordb', error as Error)
    }
  }

  // ============================================
  // Chunk Operations
  // ============================================

  /**
   * Batch insert vector chunks into PostgreSQL.
   * Uses transactional insert with UPSERT semantics to handle re-ingestion.
   */
  async insertChunks(chunks: VectorChunk[]): Promise<void> {
    if (chunks.length === 0) {
      return
    }

    if (!this.pool || !this.initialized) {
      throw new DatabaseError('PostgreSQLVectordb is not initialized. Call initialize() first.')
    }

    console.error(
      `PostgreSQLVectordb: Inserting ${chunks.length} chunks with embedding dimension ${chunks[0]?.vector.length ?? 'unknown'}`
    )

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')

      // Prepare UPSERT statement
      const insertSQL = `
        INSERT INTO ${qualified(this.tableName, this.schema)} (
          id, file_path, chunk_index, text, embedding, file_title, timestamp,
          status, contentHash
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          text = EXCLUDED.text,
          embedding = EXCLUDED.embedding,
          file_title = EXCLUDED.file_title,
          timestamp = EXCLUDED.timestamp,
          status = EXCLUDED.status,
          contentHash = EXCLUDED.contentHash
      `

      // Prepare duplicates UPSERT statement
      const duplicatesSQL = `
        INSERT INTO ${qualified('duplicates', this.schema)} (content_hash, file_path, status)
        VALUES ($1, $2, 'active')
        ON CONFLICT (content_hash, file_path) DO UPDATE SET
          status = 'active'
      `

      // Prepare files table update
      const filesSQL = `
        INSERT INTO ${qualified('files', this.schema)} (file_path, chunk_count, timestamp, file_size, file_type)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (file_path) DO UPDATE SET
          chunk_count = files.chunk_count + 1,
          timestamp = EXCLUDED.timestamp,
          file_size = EXCLUDED.file_size,
          file_type = EXCLUDED.file_type
      `

      // Batch insert chunks
      for (const chunk of chunks) {
        // Convert embedding array to PostgreSQL vector string format
        const embeddingStr = `[${chunk.vector.join(',')}]`

        await client.query(insertSQL, [
          chunk.id,
          chunk.filePath,
          chunk.chunkIndex,
          chunk.text,
          embeddingStr,
          chunk.fileTitle,
          chunk.timestamp,
          'active',
          chunk.contentHash,
        ])

        // Запись в duplicates таблицу (только если contentHash вычислен)
        if (chunk.contentHash) {
          await client.query(duplicatesSQL, [chunk.contentHash, chunk.filePath])
        }
      }

      // Update files table with aggregated counts
      const fileAggregation = new Map<
        string,
        { count: number; timestamp: string; size: number; type: string }
      >()
      for (const chunk of chunks) {
        const existing = fileAggregation.get(chunk.filePath)
        if (existing) {
          existing.count += 1
          if (chunk.timestamp > existing.timestamp) {
            existing.timestamp = chunk.timestamp
          }
        } else {
          fileAggregation.set(chunk.filePath, {
            count: 1,
            timestamp: chunk.timestamp,
            size: chunk.metadata.fileSize,
            type: chunk.metadata.fileType,
          })
        }
      }

      for (const [filePath, info] of fileAggregation) {
        await client.query(filesSQL, [filePath, info.count, info.timestamp, info.size, info.type])
      }

      await client.query('COMMIT')
      console.error(`PostgreSQLVectordb: Inserted ${chunks.length} chunks`)
    } catch (error) {
      await client.query('ROLLBACK')
      throw new DatabaseError('Failed to insert chunks', error as Error)
    } finally {
      client.release()
    }
  }

  /**
   * Delete all chunks for a specified file path.
   * Also updates the files table to remove the entry.
   */
  async deleteChunks(filePath: string): Promise<number> {
    if (!this.pool || !this.initialized) {
      console.error('PostgreSQLVectordb: Skipping deletion as not initialized')
      return 0
    }

    const client = await this.pool.connect()
    try {
      // Delete from chunks table and return count
      const deleteResult = await client.query(
        `DELETE FROM ${qualified(this.tableName, this.schema)} WHERE file_path = $1 RETURNING id`,
        [filePath]
      )
      const deletedCount = deleteResult.rowCount ?? 0

      // Delete from files table
      await client.query(`DELETE FROM ${qualified('files', this.schema)} WHERE file_path = $1`, [
        filePath,
      ])

      // Delete from metadata table
      await client.query(`DELETE FROM ${qualified('metadata', this.schema)} WHERE file_path = $1`, [
        filePath,
      ])

      console.error(`PostgreSQLVectordb: Deleted ${deletedCount} chunks for file "${filePath}"`)
      return deletedCount
    } catch (error) {
      throw new DatabaseError(`Failed to delete chunks for file: ${filePath}`, error as Error)
    } finally {
      client.release()
    }
  }

  /**
   * Return every stored chunk for a file as a full {@link VectorChunk},
   * suitable for backup/restore.
   */
  async getChunksByFilePath(filePath: string): Promise<VectorChunk[]> {
    if (!this.pool || !this.initialized) {
      return []
    }

    try {
      const result = await this.pool.query(
        `SELECT id, file_path, chunk_index, text, embedding, file_title, timestamp, status, contentHash FROM ${qualified(this.tableName, this.schema)} WHERE file_path = $1 ORDER BY chunk_index`,
        [filePath]
      )

      return result.rows.map((row: PgChunksRow) => this.rowToVectorChunk(row))
    } catch (error) {
      throw new DatabaseError(`Failed to read chunks for file: ${filePath}`, error as Error)
    }
  }

  /**
   * Return chunk rows for a single file whose chunkIndex is within the
   * inclusive [minIdx, maxIdx] range, sorted ascending by chunkIndex.
   */
  async getChunksByRange(filePath: string, minIdx: number, maxIdx: number): Promise<ChunkRow[]> {
    if (!this.pool || !this.initialized) {
      console.error('PostgreSQLVectordb: Skipping range read as not initialized')
      return []
    }

    if (!Number.isInteger(minIdx) || !Number.isInteger(maxIdx) || minIdx < 0 || maxIdx < minIdx) {
      throw new DatabaseError(
        'getChunksByRange requires non-negative integer range bounds with minIdx <= maxIdx'
      )
    }

    try {
      const result = await this.pool.query(
        `SELECT file_path, chunk_index, text, file_title FROM ${qualified(this.tableName, this.schema)} WHERE file_path = $1 AND chunk_index >= $2 AND chunk_index <= $3 ORDER BY chunk_index`,
        [filePath, minIdx, maxIdx]
      )

      return result.rows.map((row: PgChunksRow) => this.rowToChunkRow(row))
    } catch (error) {
      throw new DatabaseError('Failed to read chunks by range', error as Error)
    }
  }

  // ============================================
  // Search
  // ============================================

  /**
   * Execute vector search with quality filtering.
   * Architecture: Vector search (pgvector IVFFlat) → Filter → Keyword boost (pg_trgm) → File filter
   */
  async search(queryVector: number[], options: SearchOptions = {}): Promise<SearchResult[]> {
    const { queryText, limit = 10, scope } = options
    if (!this.pool || !this.initialized) {
      console.error('PostgreSQLVectordb: Returning empty results as not initialized')
      return []
    }

    if (limit < 1 || limit > 20) {
      throw new DatabaseError(`Invalid limit: expected 1-20, got ${limit}`)
    }

    const t0 = performance.now()

    try {
      // Convert query vector to PostgreSQL vector string format
      const queryVectorStr = `[${queryVector.join(',')}]`
      const candidateLimit = limit * HYBRID_SEARCH_CANDIDATE_MULTIPLIER

      // Determine cast type for query vector: halfvec when using halfvec index, vector otherwise.
      // halfvec supports up to 4000 dimensions, enabling search with models like Qwen3-Embedding-4B.
      // For halfvec, we must specify the dimension in the cast expression.
      // Note: pg-driver cannot determine the type of $1::halfvec(...) so we embed the literal
      // directly into the SQL string instead of using it as a parameter.
      // This matches the working approach in vector-loader/search-pgvector.ts.
      // Important: PostgreSQL halfvec requires ARRAY[...] syntax, not [...] array literal.
      let vectorExpr: string
      if (this.useHalfvecIndex) {
        // Embed the vector literal directly in SQL — avoids pg-driver type inference issues.
        // Use ARRAY[...] syntax for halfvec (PostgreSQL requires this for halfvec literals).
        // The HNSW index is built on (embedding::halfvec(dim)), so we use the same cast.
        const halfvecLiteral = `ARRAY[${queryVectorStr.slice(1, -1)}]`
        vectorExpr = `(embedding::halfvec(${this.embeddingDim})) <=> (${halfvecLiteral}::halfvec(${this.embeddingDim}))`
      } else {
        vectorExpr = `embedding <=> ${queryVectorStr}::vector`
      }

      // Step 1: Vector search using pgvector IVFFlat/HNSW index
      let vectorSQL = `
        SELECT file_path, chunk_index, text, file_title,
               1 - (${vectorExpr}) AS score
        FROM ${qualified(this.tableName, this.schema)}
      `

      // Scope prefilter
      if (scope && scope.length > 0) {
        const predicates = scope.map((prefix) => this.buildScopePredicate(prefix))
        vectorSQL += ` WHERE (${predicates.join(' OR ')})`
      }

      // Distance threshold — uses $1 when maxDistance is set, otherwise no threshold param
      if (this.config.maxDistance !== undefined) {
        vectorSQL += ` AND (1 - (${vectorExpr})) <= $1`
      }

      // LIMIT param — always $1 when no maxDistance, $2 when maxDistance is set
      const limitParam = this.config.maxDistance !== undefined ? '$2' : '$1'
      vectorSQL += ` ORDER BY ${vectorExpr} LIMIT ${limitParam}`

      const vectorParams: (string | number)[] = []
      if (this.config.maxDistance !== undefined) {
        vectorParams.push(String(1 - this.config.maxDistance))
      }
      vectorParams.push(candidateLimit)

      const vectorResult = await this.pool.query(vectorSQL, vectorParams)

      // Convert to SearchResult format
      let results: SearchResult[] = vectorResult.rows.map((row: PgChunksRow) => ({
        filePath: row.file_path,
        chunkIndex: parseInt(row.chunk_index, 10),
        text: row.text,
        score: row.score !== undefined ? parseFloat(row.score) : 0,
        metadata: {
          fileName: row.file_path.split('/').pop() || '',
          fileSize: 0,
          fileType: '',
        },
        fileTitle: row.file_title || null,
      }))

      // Step 2: Apply grouping filter on vector distances
      if (this.config.grouping && results.length > 1) {
        results = applyGrouping(results, this.config.grouping)
      }

      // Step 3: Apply keyword boost using pg_trgm
      const hybridWeight = this.config.hybridWeight ?? DEFAULT_HYBRID_WEIGHT
      if (
        this.ftsEnabled &&
        queryText &&
        queryText.trim().length > 0 &&
        hybridWeight > 0 &&
        results.length > 0
      ) {
        try {
          // Build pg_trgm query for keyword boost
          const uniqueFilePaths = [...new Set(results.map((r) => r.filePath))]
          const escapedPaths = uniqueFilePaths.map((p) => `'${p.replace(/'/g, "''")}'`)
          const whereClause = `file_path IN (${escapedPaths.join(', ')})`

          // pg_trgm similarity search
          const ftsSQL = `
            SELECT file_path, chunk_index, text,
                   similarity(text, $1::text) AS similarity_score
            FROM ${qualified(this.tableName, this.schema)}
            WHERE ${whereClause}
              AND text ILIKE '%' || $1 || '%'
            ORDER BY similarity_score DESC
            LIMIT $2
          `

          const ftsResult = await this.pool.query(ftsSQL, [queryText, results.length * 2])

          // Convert FTS results to the format expected by applyKeywordBoost
          const ftsResults = ftsResult.rows.map((row: PgFtsRow) => ({
            filePath: row.file_path,
            chunkIndex: parseInt(row.chunk_index, 10),
            text: row.text,
            _score: parseFloat(row.similarity_score),
          }))

          results = applyKeywordBoost(results, ftsResults, hybridWeight)
        } catch (ftsError) {
          console.error(
            'PostgreSQLVectordb: pg_trgm search failed, using vector-only results:',
            ftsError
          )
        }
      }

      // Step 4: Apply file filter after keyword boost
      if (this.config.maxFiles !== undefined && results.length > 0) {
        results = applyFileFilter(results, this.config.maxFiles)
      }

      // Return top results after all filtering and boosting
      const elapsed = performance.now() - t0
      const mode = this.ftsEnabled && queryText && hybridWeight > 0 ? 'hybrid' : 'vector-only'
      console.error(
        `PostgreSQLVectordb: search() completed in ${elapsed.toFixed(1)}ms (${mode}, ${results.length} hits)`
      )
      return results.slice(0, limit)
    } catch (error) {
      throw new DatabaseError('Failed to search vectors', error as Error)
    }
  }

  /**
   * Build a WHERE predicate restricting file_path to the
   * exact-or-descendant set of the given prefixes (OR'd).
   */
  private buildScopePredicate(prefix: string): string {
    const { exact, descendant } = normalizeScopePrefix(prefix)
    const exactTerm = `file_path = '${this.escapeQuotes(exact)}'`
    const descendantTerm = `file_path LIKE '${this.escapeLike(descendant)}%' ESCAPE '\\'`
    // Note: table qualification is handled by the caller in the SQL template
    return `(${exactTerm} OR ${descendantTerm})`
  }

  private escapeQuotes(value: string): string {
    return value.replace(/'/g, "''")
  }

  private escapeLike(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_')
      .replace(/'/g, "''")
  }

  // ============================================
  // File Listing
  // ============================================

  /**
   * Return a list of ingested files with their chunk counts.
   * Queries the dedicated files table (no aggregation over chunks).
   * Also checks the duplicates table to mark duplicate files.
   */
  async listFiles(): Promise<
    { filePath: string; chunkCount: number; timestamp: string; isDuplicate: boolean }[]
  > {
    if (!this.pool || !this.initialized) {
      return []
    }

    try {
      const result = await this.pool.query(
        `SELECT file_path, chunk_count, timestamp FROM ${qualified('files', this.schema)} ORDER BY file_path`
      )

      // Fetch duplicate info from the duplicates table
      const duplicateFilePaths = new Set<string>()
      try {
        const dupResult = await this.pool.query(
          `SELECT file_path FROM ${qualified('duplicates', this.schema)} WHERE status = 'duplicate' OR status = 'deprecated'`
        )
        for (const row of dupResult.rows) {
          duplicateFilePaths.add(row.file_path)
        }
      } catch {
        // duplicates table doesn't exist yet — skip duplicate detection
      }

      return result.rows.map((row: PgFilesRow) => ({
        filePath: row.file_path,
        chunkCount: parseInt(row.chunk_count, 10),
        timestamp: row.timestamp,
        isDuplicate: duplicateFilePaths.has(row.file_path),
      }))
    } catch (error) {
      throw new DatabaseError('Failed to list files', error as Error)
    }
  }

  // ============================================
  // Status and Maintenance
  // ============================================

  /**
   * Get system status information.
   */
  async getStatus(): Promise<{
    documentCount: number
    chunkCount: number
    memoryUsage: number
    uptime: number
    ftsIndexEnabled: boolean
    searchMode: 'hybrid' | 'vector-only'
    backend: 'postgresql'
  }> {
    if (!this.pool || !this.initialized) {
      return {
        documentCount: 0,
        chunkCount: 0,
        memoryUsage: 0,
        uptime: process.uptime(),
        ftsIndexEnabled: false,
        searchMode: 'vector-only',
        backend: 'postgresql',
      }
    }

    try {
      // Total chunk count
      const chunkResult = await this.pool.query(
        `SELECT COUNT(*) AS count FROM ${qualified(this.tableName, this.schema)}`
      )
      const chunkCount = parseInt(chunkResult.rows[0].count, 10)

      // Distinct document count
      const docResult = await this.pool.query(
        `SELECT COUNT(DISTINCT file_path) AS count FROM ${qualified(this.tableName, this.schema)}`
      )
      const documentCount = parseInt(docResult.rows[0].count, 10)

      // Get memory usage (in MB)
      const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024

      // Get uptime (in seconds)
      const uptime = process.uptime()

      const hybridWeight = this.config.hybridWeight ?? DEFAULT_HYBRID_WEIGHT

      return {
        documentCount,
        chunkCount,
        memoryUsage,
        uptime,
        ftsIndexEnabled: this.ftsEnabled,
        searchMode: this.ftsEnabled && hybridWeight > 0 ? 'hybrid' : 'vector-only',
        backend: 'postgresql',
      }
    } catch (error) {
      throw new DatabaseError('Failed to get status', error as Error)
    }
  }

  /**
   * Optimize the database: rebuild indexes and vacuum tables.
   */
  async optimize(): Promise<void> {
    if (!this.pool || !this.initialized) {
      return
    }

    try {
      // Rebuild IVFFlat index
      await this.pool.query(
        `REINDEX INDEX ${qualified(`${this.tableName}_embedding_idx`, this.schema)}`
      )

      // Rebuild pg_trgm index
      await this.pool.query(
        `REINDEX INDEX ${qualified(`${this.tableName}_text_trgm_idx`, this.schema)}`
      )

      // Vacuum tables to reclaim space
      await this.pool.query(`VACUUM ANALYZE ${qualified(this.tableName, this.schema)}`)
      await this.pool.query(`VACUUM ANALYZE ${qualified('files', this.schema)}`)
      await this.pool.query(`VACUUM ANALYZE ${qualified('metadata', this.schema)}`)

      console.error('PostgreSQLVectordb: Database optimized')
    } catch (error) {
      console.warn('PostgreSQLVectordb: Optimization failed:', error)
      // Don't throw — optimization is best-effort
    }
  }

  // ============================================
  // Connection Management
  // ============================================

  /**
   * Close the database connection and release resources.
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end()
      this.pool = null
      this.initialized = false
      this.ftsEnabled = false
      console.error('PostgreSQLVectordb connection closed')
    }
  }

  // ============================================
  // Duplicate tracking methods (Section 2.5)
  // ============================================

  /**
   * Find all chunks sharing the same content hash (duplicates).
   * Uses the dedicated `duplicates` table for efficient lookup.
   *
   * @param contentHash — SHA-256 hash of file content
   * @param includeDeprecated — include deprecated chunks in results (default: false)
   * @returns Array of duplicate groups, each with shared hash and list of chunk paths
   */
  async getDuplicatesByHash(
    contentHash: string,
    includeDeprecated = false
  ): Promise<
    {
      contentHash: string
      filePaths: string[]
      deprecatedFilePaths?: string[]
    }[]
  > {
    if (!this.pool || !this.initialized) {
      return []
    }

    try {
      const dupTable = qualified('duplicates', this.schema)
      let whereClause = `content_hash = $1`
      const params: (string | boolean)[] = [contentHash]

      if (!includeDeprecated) {
        whereClause += " AND (status IS NULL OR status = 'active')"
      }

      const result = await this.pool.query(
        `SELECT DISTINCT file_path, status FROM ${dupTable} WHERE ${whereClause}`,
        params
      )

      // Group by contentHash and separate active/deprecated filePaths
      const groups = new Map<string, { active: string[]; deprecated: string[] }>()

      for (const row of result.rows) {
        const filePath = row.file_path
        const status = row.status

        if (typeof filePath !== 'string') continue

        if (!groups.has(contentHash)) {
          groups.set(contentHash, { active: [], deprecated: [] })
        }
        const group = groups.get(contentHash)!
        if (status === 'deprecated') {
          group.deprecated.push(filePath)
        } else {
          group.active.push(filePath)
        }
      }

      return Array.from(groups.entries()).map(([hash, group]) => {
        const result: {
          contentHash: string
          filePaths: string[]
          deprecatedFilePaths?: string[]
        } = {
          contentHash: hash,
          filePaths: group.active,
        }
        if (group.deprecated.length > 0) {
          result.deprecatedFilePaths = group.deprecated
        }
        return result
      })
    } catch (error) {
      console.error('PostgreSQLVectordb: getDuplicatesByHash failed:', error)
      return []
    }
  }

  /**
   * Mark all chunks for a given file path as 'deprecated' (soft-delete).
   * Updates the status column in the chunks table.
   * Also updates the duplicates table if entries exist.
   *
   * @param filePath — file path to mark as deprecated
   * @returns Number of chunks marked as deprecated
   */
  async markDeprecated(filePath: string): Promise<number> {
    if (!this.pool || !this.initialized) {
      console.error('PostgreSQLVectordb: Skipping markDeprecated as not initialized')
      return 0
    }

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')

      // Mark chunks as deprecated
      const chunksResult = await client.query(
        `UPDATE ${qualified(this.tableName, this.schema)} SET status = 'deprecated' WHERE file_path = $1 RETURNING id`,
        [filePath]
      )
      const deprecatedChunkCount = chunksResult.rowCount ?? 0

      // Mark duplicates table entries as deprecated
      const dupTable = qualified('duplicates', this.schema)
      await client.query(
        `UPDATE ${dupTable} SET status = 'deprecated' WHERE file_path = $1 AND (status IS NULL OR status = 'active')`,
        [filePath]
      )

      await client.query('COMMIT')

      if (deprecatedChunkCount > 0) {
        console.error(
          `PostgreSQLVectordb: Marked ${deprecatedChunkCount} chunks as deprecated for "${filePath}"`
        )
      }
      return deprecatedChunkCount
    } catch (error) {
      await client.query('ROLLBACK')
      throw new DatabaseError(
        `Failed to mark chunks as deprecated for file: ${filePath}`,
        error as Error
      )
    } finally {
      client.release()
    }
  }

  /**
   * Remove all deprecated chunks from the database.
   * Cleans up storage occupied by soft-deleted chunks.
   *
   * @returns Number of chunks removed
   */
  async cleanupDuplicates(): Promise<number> {
    if (!this.pool || !this.initialized) {
      console.error('PostgreSQLVectordb: Skipping cleanupDuplicates as not initialized')
      return 0
    }

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')

      // Delete deprecated chunks from chunks table
      const chunksResult = await client.query(
        `DELETE FROM ${qualified(this.tableName, this.schema)} WHERE status = 'deprecated' RETURNING id`
      )
      const deprecatedChunkCount = chunksResult.rowCount ?? 0

      // Delete deprecated entries from duplicates table
      const dupTable = qualified('duplicates', this.schema)
      const dupResult = await client.query(`DELETE FROM ${dupTable} WHERE status = 'deprecated'`)
      const deprecatedDupCount = dupResult.rowCount ?? 0

      await client.query('COMMIT')

      const totalRemoved = deprecatedChunkCount + deprecatedDupCount
      console.error(
        `PostgreSQLVectordb: Cleaned up ${totalRemoved} deprecated entries (${deprecatedChunkCount} chunks, ${deprecatedDupCount} duplicates)`
      )
      return totalRemoved
    } catch (error) {
      await client.query('ROLLBACK')
      throw new DatabaseError('Failed to cleanup duplicates', error as Error)
    } finally {
      client.release()
    }
  }

  // ============================================
  // Row-to-Object Converters
  // ============================================

  private rowToVectorChunk(row: PgChunksRow): VectorChunk {
    const embeddingStr = row.embedding
    const vector = embeddingStr.replace(/^\[/, '').replace(/\]$/, '').split(',').map(Number)

    return {
      id: row.id,
      filePath: row.file_path,
      chunkIndex: parseInt(row.chunk_index, 10),
      text: row.text,
      vector,
      metadata: {
        fileName: row.file_path.split('/').pop() || '',
        fileSize: 0,
        fileType: '',
      },
      fileTitle:
        typeof row.file_title === 'string' && row.file_title.length > 0 ? row.file_title : null,
      timestamp: row.timestamp,
      status:
        row.status === 'active' || row.status === 'deprecated'
          ? (row.status as ChunkStatus)
          : undefined,
      contentHash: row.contentHash ?? undefined,
    } as VectorChunk
  }

  private rowToChunkRow(row: PgChunksRow): ChunkRow {
    const rawFileTitle = row.file_title
    const fileTitle =
      typeof rawFileTitle === 'string' && rawFileTitle.length > 0 ? rawFileTitle : null
    return {
      filePath: row.file_path as string,
      chunkIndex: parseInt(row.chunk_index as string, 10),
      text: row.text as string,
      fileTitle,
    }
  }
}
