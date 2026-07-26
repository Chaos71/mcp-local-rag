// PostgreSQL vector database backend using pgvector extension

import { Pool, types } from 'pg'
import { normalizeScopePrefix } from '../utils/scope-match.js'
import { applyFileFilter, applyGrouping, applyKeywordBoost } from './search-filters.js'
import {
  type ChunkRow,
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

  return [
    // Create schema if it does not exist
    `CREATE SCHEMA IF NOT EXISTS ${schema}`,

    // Enable pg_trgm extension for keyword boost
    'CREATE EXTENSION IF NOT EXISTS pg_trgm',

    // Enable pgvector extension for vector search
    'CREATE EXTENSION IF NOT EXISTS vector',

    // Chunks table — main storage for vectors and text
    `CREATE TABLE IF NOT EXISTS ${qualified(tableName, schema)} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      file_path TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding vector(${embeddingDim}) NOT NULL,
      file_title TEXT,
      timestamp TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`,

    // IVFFlat index for vector search
    // Note: CREATE INDEX ... USING ivfflat doesn't support schema-qualified names
    // in PostgreSQL, so we use unqualified names (search_path is set before execution)
    // Note: pgvector 0.7+ uses simplified syntax without operator classes
    `CREATE INDEX IF NOT EXISTS ${tableName}_embedding_idx ON ${tableName} USING ivfflat (embedding) WITH (lists = ${ivfLists})`,

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
  ]
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

  constructor(config: PostgreSQLVectorStoreConfig) {
    this.config = config
    this.tableName = config.tableName || DEFAULT_TABLES.chunks
    this.embeddingDim = config.embeddingDimension ?? 384
    // ivfLists is used in schema creation (buildSchemaSQL) but not stored here
    this.schema = config.pgConfig.schema || DEFAULT_PG_SCHEMA
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

        // Verify pgvector is functional by creating a simple vector
        // Note: Using fixed-size vector syntax (e.g., vector(4096)) can cause
        // protocol errors on some PostgreSQL versions, so we use a simpler test.
        await client.query('SELECT ARRAY[0,0,0]::vector')
      } finally {
        client.release()
      }

      // Create schema (tables, indexes, extensions)
      // Set search_path to include both the target schema and public (for extensions like pg_trgm)
      // This allows unqualified table names to work with CREATE INDEX ... USING ivfflat
      // (which doesn't support schema-qualified names) while still accessing pg_trgm from public
      await client.query(`SET search_path TO ${this.schema}, public`)

      const schemaSQL = buildSchemaSQL(this.config)
      for (const sql of schemaSQL) {
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

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')

      // Prepare UPSERT statement
      const insertSQL = `
        INSERT INTO ${qualified(this.tableName, this.schema)} (id, file_path, chunk_index, text, embedding, file_title, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
          text = EXCLUDED.text,
          embedding = EXCLUDED.embedding,
          file_title = EXCLUDED.file_title,
          timestamp = EXCLUDED.timestamp
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
        ])
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
        `SELECT id, file_path, chunk_index, text, embedding, file_title, timestamp FROM ${qualified(this.tableName, this.schema)} WHERE file_path = $1 ORDER BY chunk_index`,
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

    try {
      // Convert query vector to PostgreSQL vector string format
      const queryVectorStr = `[${queryVector.join(',')}]`
      const candidateLimit = limit * HYBRID_SEARCH_CANDIDATE_MULTIPLIER

      // Step 1: Vector search using pgvector IVFFlat index
      let vectorSQL = `
        SELECT file_path, chunk_index, text, file_title,
               1 - (embedding <=> $1::vector) AS score
        FROM ${qualified(this.tableName, this.schema)}
      `

      // Scope prefilter
      if (scope && scope.length > 0) {
        const predicates = scope.map((prefix) => this.buildScopePredicate(prefix))
        vectorSQL += ` WHERE (${predicates.join(' OR ')})`
      }

      // Distance threshold
      if (this.config.maxDistance !== undefined) {
        vectorSQL += ` AND (1 - (embedding <=> $1::vector)) <= $2`
      }

      vectorSQL += ` ORDER BY embedding <=> $1::vector LIMIT $3`

      const vectorParams = [queryVectorStr]
      if (this.config.maxDistance !== undefined) {
        vectorParams.push(String(1 - this.config.maxDistance))
      }
      vectorParams.push(String(candidateLimit))

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
   */
  async listFiles(): Promise<{ filePath: string; chunkCount: number; timestamp: string }[]> {
    if (!this.pool || !this.initialized) {
      return []
    }

    try {
      const result = await this.pool.query(
        `SELECT file_path, chunk_count, timestamp FROM ${qualified('files', this.schema)} ORDER BY file_path`
      )

      return result.rows.map((row: PgFilesRow) => ({
        filePath: row.file_path,
        chunkCount: parseInt(row.chunk_count, 10),
        timestamp: row.timestamp,
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
        `REINDEX INDEX ${qualified(this.tableName + '_embedding_idx', this.schema)}`
      )

      // Rebuild pg_trgm index
      await this.pool.query(
        `REINDEX INDEX ${qualified(this.tableName + '_text_trgm_idx', this.schema)}`
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
    }
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
