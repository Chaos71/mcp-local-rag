// VectorDB type definitions, constants, type guards, and error classes

import { AppError } from '../utils/errors.js'

// ============================================
// Constants
// ============================================

/** Multiplier for candidate count in hybrid search (to allow reranking) */
export const HYBRID_SEARCH_CANDIDATE_MULTIPLIER = 2

/** FTS index name (bump version when changing tokenizer settings) */
export const FTS_INDEX_NAME = 'fts_index_v2'

/** Threshold for cleaning up old index versions (1 minute) */
export const FTS_CLEANUP_THRESHOLD_MS = 60 * 1000

/** Default hybrid-search weight (vector vs FTS blend) when not configured */
export const DEFAULT_HYBRID_WEIGHT = 0.6

// ============================================
// Type Definitions
// ============================================

/**
 * Grouping mode for quality filtering
 * - 'similar': Only return the most similar group (stops at first distance jump)
 * - 'related': Include related groups (stops at second distance jump)
 */
export type GroupingMode = 'similar' | 'related'

/**
 * Per-call options for {@link VectorStore.search}.
 * Grouped into an object (instead of positional params) so the caller can pass
 * any subset and so adding options (like `scope`) is not a breaking signature
 * change.
 */
export interface SearchOptions {
  /** Optional query text for keyword boost (BM25) */
  queryText?: string
  /** Number of results to retrieve (default 10, valid range 1-20) */
  limit?: number
  /**
   * Optional path-prefix scope (exact-or-descendant, prefixes unioned). Omitted
   * = no prefilter (backward compatible).
   */
  scope?: string[]
}

/**
 * Document metadata
 */
export interface DocumentMetadata {
  /** File name */
  fileName: string
  /** File size in bytes */
  fileSize: number
  /** File type (extension) */
  fileType: string
}

/**
 * Chunk status — used to mark deprecated/removed chunks without physical deletion.
 * - 'active': chunk is live and searchable
 * - 'deprecated': chunk belongs to a replaced document version (soft-deleted)
 */
export type ChunkStatus = 'active' | 'deprecated'

/**
 * Vector chunk
 */
export interface VectorChunk {
  /** Chunk ID (UUID) */
  id: string
  /** File path (absolute) */
  filePath: string
  /** Chunk index (zero-based) */
  chunkIndex: number
  /** Chunk text */
  text: string
  /** Embedding vector (dimension depends on model) */
  vector: number[]
  /** Metadata */
  metadata: DocumentMetadata
  /** Document title extracted from file content (display-only, not used for scoring) */
  fileTitle: string | null
  /** Ingestion timestamp (ISO 8601 format) */
  timestamp: string
  /** Chunk status — 'active' or 'deprecated' (default: 'active') */
  status?: ChunkStatus
}

/**
 * Search result
 */
export interface SearchResult {
  /** File path */
  filePath: string
  /** Chunk index */
  chunkIndex: number
  /** Chunk text */
  text: string
  /** Distance score using dot product (0 = identical, 1 = orthogonal, 2 = opposite) */
  score: number
  /** Metadata */
  metadata: DocumentMetadata
  /** Document title extracted from file content (display-only, not used for scoring) */
  fileTitle: string | null
}

/**
 * Row returned by VectorStore.getChunksByRange.
 * Distinct from SearchResult: no score (not a ranked result) and no metadata
 * (not needed for index-adjacent retrieval). Consumed by
 * handleReadChunkNeighbors and runReadNeighbors.
 */
export interface ChunkRow {
  /** File path (absolute) */
  filePath: string
  /** Chunk index (zero-based) */
  chunkIndex: number
  /** Chunk text */
  text: string
  /** Document title extracted from file content (display-only, not used for scoring) */
  fileTitle: string | null
}

/**
 * Raw result from LanceDB query (internal type)
 */
export interface LanceDBRawResult {
  filePath: string
  chunkIndex: number
  text: string
  metadata: DocumentMetadata
  /** Document title (optional - existing rows lack this field before migration) */
  fileTitle?: string | null
  _distance?: number
  _score?: number
}

// ============================================
// Type Guards
// ============================================

/**
 * Type guard for DocumentMetadata
 */
function isDocumentMetadata(value: unknown): value is DocumentMetadata {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj['fileName'] === 'string' &&
    typeof obj['fileSize'] === 'number' &&
    typeof obj['fileType'] === 'string'
  )
}

/**
 * Type guard for LanceDB raw search result
 */
export function isLanceDBRawResult(value: unknown): value is LanceDBRawResult {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj['filePath'] === 'string' &&
    typeof obj['chunkIndex'] === 'number' &&
    typeof obj['text'] === 'string' &&
    isDocumentMetadata(obj['metadata'])
  )
}

/**
 * Convert LanceDB raw result to SearchResult with type validation
 * @throws DatabaseError if the result is invalid
 */
export function toSearchResult(raw: unknown): SearchResult {
  if (!isLanceDBRawResult(raw)) {
    throw new DatabaseError('Invalid search result format from LanceDB')
  }
  // Score source: vector search rows carry `_distance` (dot distance, the
  // normal path). `_score` is a defensive fallback for any FTS-shaped row that
  // reaches here (the live FTS path consumes `_score` directly in
  // applyKeywordBoost, not via this mapper). The final `?? 0` is an
  // effectively-unreachable guard: vectorSearch always returns `_distance`. It
  // is kept defensive rather than throwing, since a missing score is not worth
  // failing a whole search over.
  return {
    filePath: raw.filePath,
    chunkIndex: raw.chunkIndex,
    text: raw.text,
    score: raw._distance ?? raw._score ?? 0,
    metadata: raw.metadata,
    fileTitle: raw.fileTitle || null,
  }
}

/**
 * Map a raw LanceDB row to a full {@link VectorChunk}, including the stored
 * embedding vector and metadata. Used for backup/restore (ingest rollback),
 * where the row must round-trip back through `insertChunks` intact — unlike
 * {@link toChunkRow} / {@link toSearchResult}, which drop the vector. The
 * embedding is normalized to `number[]` (LanceDB returns a typed array).
 */
export function toVectorChunk(raw: unknown): VectorChunk {
  if (typeof raw !== 'object' || raw === null) {
    throw new DatabaseError('Invalid chunk row shape from LanceDB')
  }
  const obj = raw as Record<string, unknown>
  const { id, filePath, chunkIndex, text, vector, metadata, fileTitle, timestamp } = obj
  if (
    typeof id !== 'string' ||
    typeof filePath !== 'string' ||
    typeof chunkIndex !== 'number' ||
    typeof text !== 'string' ||
    typeof timestamp !== 'string'
  ) {
    throw new DatabaseError('Invalid chunk row shape from LanceDB (scalar fields)')
  }
  if (!isDocumentMetadata(metadata)) {
    throw new DatabaseError('Invalid chunk row shape from LanceDB (metadata)')
  }
  if (vector == null || typeof (vector as { length?: unknown }).length !== 'number') {
    throw new DatabaseError('Invalid chunk row shape from LanceDB (vector)')
  }
  return {
    id,
    filePath,
    chunkIndex,
    text,
    vector: Array.from(vector as ArrayLike<number>),
    metadata,
    fileTitle: typeof fileTitle === 'string' && fileTitle.length > 0 ? fileTitle : null,
    timestamp,
  }
}

/**
 * Convert LanceDB raw row to ChunkRow with type validation.
 * Mirrors toSearchResult but returns the minimal range-read shape: no score
 * (not ranked) and no metadata (not needed for index-adjacent retrieval).
 *
 * Uses a narrower shape check than isLanceDBRawResult: only
 * filePath/chunkIndex/text are required because getChunksByRange
 * does not project metadata. The empty-string-or-missing fileTitle
 * is normalized to null per §Field Propagation Map.
 *
 * @throws DatabaseError if the raw row is missing required fields
 */
export function toChunkRow(raw: unknown): ChunkRow {
  if (typeof raw !== 'object' || raw === null) {
    throw new DatabaseError('Invalid chunk row shape from LanceDB')
  }
  const obj = raw as Record<string, unknown>
  if (
    typeof obj['filePath'] !== 'string' ||
    typeof obj['chunkIndex'] !== 'number' ||
    typeof obj['text'] !== 'string'
  ) {
    throw new DatabaseError('Invalid chunk row shape from LanceDB')
  }
  const rawFileTitle = obj['fileTitle']
  const fileTitle =
    typeof rawFileTitle === 'string' && rawFileTitle.length > 0 ? rawFileTitle : null
  return {
    filePath: obj['filePath'],
    chunkIndex: obj['chunkIndex'],
    text: obj['text'],
    fileTitle,
  }
}

// ============================================
// PostgreSQL Configuration
// ============================================

/**
 * PostgreSQL connection configuration
 */
export interface PostgreSQLConfig {
  /** PostgreSQL host */
  host: string
  /** PostgreSQL port (default: 5432) */
  port: number
  /** Database name */
  database: string
  /** Username */
  user: string
  /** Password */
  password: string
  /** PostgreSQL schema (default: 'public') — used for multi-tenant scenarios */
  schema?: string
  /** SSL mode: disable, allow, prefer, require, verify-ca, verify-full */
  sslMode?: 'disable' | 'allow' | 'prefer' | 'require' | 'verify-ca' | 'verify-full'
  /** Maximum pool size (default: 20) */
  maxPoolSize?: number
  /** Minimum pool size (default: 0) */
  minPoolSize?: number
}

/**
 * PostgreSQL-specific vector store configuration
 */
export interface PostgreSQLVectorStoreConfig {
  /** Backend discriminator (always 'postgresql') */
  backend: 'postgresql'
  /** PostgreSQL connection configuration */
  pgConfig: PostgreSQLConfig
  /** Table name for chunks (default: 'chunks') */
  tableName?: string
  /** Maximum distance threshold for filtering results (optional) */
  maxDistance?: number
  /** Grouping mode for quality filtering (optional) */
  grouping?: GroupingMode
  /** Hybrid search weight for pg_trgm keyword boost (0.0 = vector only, 1.0 = pg_trgm only, default 0.6) */
  hybridWeight?: number
  /** Maximum number of files to keep in results (optional, filters by best score per file) */
  maxFiles?: number
  /** Embedding dimension (default: 384 for all-MiniLM-L6-v2) */
  embeddingDimension?: number
  /** IVFFlat index lists count (default: 100). Required only for IVFFlat index. */
  ivfLists?: number
  /** Use HNSW index instead of IVFFlat (default: false, IVFFlat used when dimension <= 2000) */
  useHNSWIndex?: boolean
  /**
   * Use halfvec type for indexing (default: false).
   * halfvec supports up to 4000 dimensions vs 2000 for vector type.
   * Required for embedding models with dimension > 2000 (e.g., Qwen3-Embedding-4B: 4096).
   * Requires pgvector >= 0.7.0.
   */
  useHalfvecIndex?: boolean
  /** Schema name (default: 'public') — used for multi-tenant scenarios */
  schema?: string
}

/** Default PostgreSQL schema */
export const DEFAULT_PG_SCHEMA = 'public'

/**
 * Unified vector store configuration — discriminator union based on backend type.
 * The caller selects the backend via the `backend` field; the remaining fields
 * depend on the selected backend.
 */
export type VectorStoreConfig =
  | {
      backend: 'lancedb'
      dbPath: string
      tableName: string
      maxDistance?: number
      grouping?: GroupingMode
      hybridWeight?: number
      maxFiles?: number
    }
  | {
      backend: 'postgresql'
      pgConfig: PostgreSQLConfig
      tableName?: string
      maxDistance?: number
      grouping?: GroupingMode
      hybridWeight?: number
      maxFiles?: number
      embeddingDimension?: number
      ivfLists?: number
      useHNSWIndex?: boolean
      useHalfvecIndex?: boolean
      schema?: string
    }

// ============================================
// IVectordb Interface
// ============================================

/**
 * Interface for vector database backends.
 *
 * Both LanceDB and PostgreSQL implementations must conform to this contract.
 * The interface is intentionally minimal — only the operations required by the
 * RAG pipeline are exposed here; implementation-specific helpers live on the
 * concrete classes.
 */
export interface IVectordb {
  /**
   * Initialize the database connection and ensure schema exists.
   * For PostgreSQL: connect, verify pgvector extension, create tables and indexes.
   * For LanceDB: connect to database path, create or open table.
   */
  initialize(): Promise<void>

  /**
   * Batch insert vector chunks into the database.
   * For PostgreSQL: use transactional insert with UPSERT semantics.
   * For LanceDB: use table.add() or createTable() on first insertion.
   */
  insertChunks(chunks: VectorChunk[]): Promise<void>

  /**
   * Delete all chunks for a given file path.
   * @returns Number of chunks removed
   */
  deleteChunks(filePath: string): Promise<number>

  /**
   * Search for similar vectors with optional keyword boost.
   * For PostgreSQL: use pgvector IVFFlat/HNSW index + pg_trgm for keyword boost.
   * For LanceDB: use vector search + FTS index.
   */
  search(queryVector: number[], options?: SearchOptions): Promise<SearchResult[]>

  /**
   * Return every stored chunk for a file as a full {@link VectorChunk},
   * suitable for backup/restore.
   */
  getChunksByFilePath(filePath: string): Promise<VectorChunk[]>

  /**
   * Return chunk rows for a single file whose chunkIndex is within the
   * inclusive [minIdx, maxIdx] range, sorted ascending by chunkIndex.
   */
  getChunksByRange(filePath: string, minIdx: number, maxIdx: number): Promise<ChunkRow[]>

  /**
   * Return a list of ingested files with their chunk counts.
   * For PostgreSQL: query the dedicated `files` table (no aggregation over chunks).
   * For LanceDB: aggregate from chunk rows in memory.
   */
  listFiles(): Promise<{ filePath: string; chunkCount: number; timestamp: string }[]>

  /**
   * Get system status information.
   */
  getStatus(): Promise<{
    documentCount: number
    chunkCount: number
    memoryUsage: number
    uptime: number
    ftsIndexEnabled: boolean
    searchMode: 'hybrid' | 'vector-only'
    backend: 'lancedb' | 'postgresql'
  }>

  /**
   * Optimize the database (compact fragments, rebuild indexes, etc.).
   */
  optimize(): Promise<void>

  /**
   * Close the database connection and release resources.
   */
  close(): Promise<void>

  // ============================================
  // Duplicate tracking methods (Section 2.5)
  // ============================================

  /**
   * Find all chunks sharing the same content hash (duplicates).
   * Returns groups of chunks where each group shares one `contentHash`.
   * Only returns active (non-deprecated) chunks by default.
   *
   * @param contentHash — SHA-256 hash of file content
   * @param includeDeprecated — include deprecated chunks in results (default: false)
   * @returns Array of duplicate groups, each with shared hash and list of chunk paths
   */
  getDuplicatesByHash(
    contentHash: string,
    includeDeprecated?: boolean
  ): Promise<
    {
      contentHash: string
      filePaths: string[]
      deprecatedFilePaths?: string[]
    }[]
  >

  /**
   * Mark all chunks for a given file path as 'deprecated' (soft-delete).
   * Used when a document is replaced — old version is kept but hidden from search.
   *
   * @param filePath — file path to mark as deprecated
   * @returns Number of chunks marked as deprecated
   */
  markDeprecated(filePath: string): Promise<number>

  /**
   * Remove all deprecated chunks from the database.
   * Cleans up storage occupied by soft-deleted chunks.
   *
   * @returns Number of chunks removed
   */
  cleanupDuplicates(): Promise<number>
}

// ============================================
// Error Classes
// ============================================

/**
 * Database error
 */
export class DatabaseError extends AppError {
  constructor(message: string, cause?: Error) {
    super(message, 'vectordb', 'internal', cause)
    this.name = 'DatabaseError'
  }
}
