// Duplicate handling type definitions

/**
 * Mode for handling duplicate documents during ingestion.
 * - `skip`: Skip loading, return a warning (default)
 * - `update`: Update existing document (current behavior)
 * - `track`: Save both instances with a duplicate mark
 */
export type DuplicateMode = 'skip' | 'update' | 'track'

/**
 * A single entry in the duplicates tracking table.
 * Represents one version of a document identified by its content hash.
 */
export interface DuplicateEntry {
  /** Unique identifier for this entry */
  id: string
  /** SHA-256 hash of the file content */
  contentHash: string
  /** Absolute file path */
  filePath: string
  /** Reference to the original entry this is a duplicate of (null for originals) */
  duplicateOf: string | null
  /** Status: 'original' | 'duplicate' | 'deprecated' */
  status: 'original' | 'duplicate' | 'deprecated'
  /** Ingestion timestamp (ISO 8601 format) */
  createdAt: string
  /** File size in bytes */
  fileSize: number
}

/**
 * Configuration for the DuplicateStore.
 */
export interface DuplicateStoreConfig {
  /** Mode for handling duplicates (default: 'skip') */
  mode?: DuplicateMode
  /** Maximum file size in bytes for hashing (default: 100 MB) */
  maxFileSize?: number
}

/**
 * Default configuration values.
 */
export const DEFAULT_DUPLICATE_MODE: DuplicateMode = 'skip'
export const DEFAULT_MAX_FILE_SIZE = 100 * 1024 * 1024 // 100 MB
