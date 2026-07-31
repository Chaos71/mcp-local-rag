// DuplicateStore — manages duplicate tracking metadata

import { randomUUID } from 'node:crypto'
import { AppError } from '../utils/errors.js'
import { DEFAULT_DUPLICATE_MODE, type DuplicateEntry, type DuplicateMode } from './types.js'

/**
 * In-memory duplicate store for tracking document versions.
 *
 * In production this wraps a database table (`duplicates`); for now
 * it provides the same interface backed by an in-memory Map for testing.
 */
export class DuplicateStore {
  private entries: Map<string, DuplicateEntry>
  private mode: DuplicateMode

  constructor(mode: DuplicateMode = DEFAULT_DUPLICATE_MODE) {
    this.entries = new Map()
    this.mode = mode
  }

  /**
   * Add a new entry to the store.
   * If an entry with the same contentHash already exists, it is marked as
   * 'deprecated' and the new entry references it via `duplicateOf`.
   */
  add(entry: Omit<DuplicateEntry, 'id' | 'status' | 'duplicateOf'>): DuplicateEntry {
    const id = randomUUID()
    const timestamp = new Date().toISOString()

    // Check for existing entry with the same hash
    const existing = this.findByHash(entry.contentHash)
    if (existing) {
      // Mark existing as deprecated/duplicate
      existing.status = 'deprecated'
      // New entry references the old one
      return {
        id,
        contentHash: entry.contentHash,
        filePath: entry.filePath,
        duplicateOf: existing.id,
        status: 'duplicate',
        createdAt: timestamp,
        fileSize: entry.fileSize,
      }
    }

    // First occurrence — original
    return {
      id,
      contentHash: entry.contentHash,
      filePath: entry.filePath,
      duplicateOf: null,
      status: 'original',
      createdAt: timestamp,
      fileSize: entry.fileSize,
    }
  }

  /**
   * Find an entry by its content hash.
   */
  findByHash(contentHash: string): DuplicateEntry | null {
    // Return the most recent entry for this hash
    let latest: DuplicateEntry | null = null
    for (const entry of this.entries.values()) {
      if (entry.contentHash === contentHash) {
        if (!latest || entry.createdAt > latest.createdAt) {
          latest = entry
        }
      }
    }
    return latest
  }

  /**
   * Find all entries that share the same content hash (a duplicate chain).
   */
  findDuplicates(contentHash: string): DuplicateEntry[] {
    const duplicates: DuplicateEntry[] = []
    for (const entry of this.entries.values()) {
      if (entry.contentHash === contentHash) {
        duplicates.push(entry)
      }
    }
    return duplicates.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  /**
   * Get all entries in the store.
   */
  getAll(): DuplicateEntry[] {
    return Array.from(this.entries.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  /**
   * Remove an entry from the store.
   */
  remove(id: string): boolean {
    return this.entries.delete(id)
  }

  /**
   * Mark entries as deprecated (used for soft-deletion).
   */
  markDeprecated(contentHash: string): number {
    let count = 0
    for (const entry of this.entries.values()) {
      if (entry.contentHash === contentHash && entry.status !== 'deprecated') {
        entry.status = 'deprecated'
        count++
      }
    }
    return count
  }

  /**
   * Get the current mode.
   */
  getMode(): DuplicateMode {
    return this.mode
  }

  /**
   * Set the mode.
   */
  setMode(mode: DuplicateMode): void {
    this.mode = mode
  }

  /**
   * Get store statistics.
   */
  getStats(): { total: number; originals: number; duplicates: number; deprecated: number } {
    let originals = 0
    let duplicates = 0
    let deprecated = 0
    for (const entry of this.entries.values()) {
      switch (entry.status) {
        case 'original':
          originals++
          break
        case 'duplicate':
          duplicates++
          break
        case 'deprecated':
          deprecated++
          break
      }
    }
    return {
      total: this.entries.size,
      originals,
      duplicates,
      deprecated,
    }
  }
}

/**
 * Duplicate store error.
 */
export class DuplicateStoreError extends AppError {
  constructor(message: string, cause?: Error) {
    super(message, 'duplicates', 'internal', cause)
    this.name = 'DuplicateStoreError'
  }
}
