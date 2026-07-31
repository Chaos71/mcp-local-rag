// Unit tests for DuplicateStore — add, findByHash, findDuplicates, getAll, remove.
//
// Validates the in-memory store behavior for duplicate tracking:
// original entry creation, duplicate detection, chain building, and retrieval.

import { beforeEach, describe, expect, it } from 'vitest'
import { DuplicateStore } from '../store.js'
import type { DuplicateEntry, DuplicateMode } from '../types.js'

// Helpers
function createEntry(
  overrides: Partial<DuplicateEntry> = {}
): Omit<DuplicateEntry, 'id' | 'status' | 'duplicateOf'> {
  return {
    contentHash: overrides.contentHash ?? 'abc123',
    filePath: overrides.filePath ?? '/test/file.txt',
    fileSize: overrides.fileSize ?? 1024,
  }
}

function withTimestamp(entry: DuplicateEntry, timestamp: string): DuplicateEntry {
  return { ...entry, createdAt: timestamp }
}

describe('DuplicateStore', () => {
  let store: DuplicateStore

  beforeEach(() => {
    store = new DuplicateStore()
  })

  // ── add() ──────────────────────────────────────────────────────────────────

  describe('add()', () => {
    it('should create an original entry on first insert', () => {
      const entry = store.add(createEntry({ contentHash: 'hash-1', filePath: '/a.txt' }))

      expect(entry.status).toBe('original')
      expect(entry.duplicateOf).toBeNull()
      expect(entry.contentHash).toBe('hash-1')
      expect(entry.filePath).toBe('/a.txt')
      expect(entry.id).toBeDefined()
    })

    it('should create a duplicate entry when hash already exists', () => {
      const original = store.add(createEntry({ contentHash: 'hash-1', filePath: '/a.txt' }))
      const duplicate = store.add(createEntry({ contentHash: 'hash-1', filePath: '/b.txt' }))

      expect(duplicate.status).toBe('duplicate')
      expect(duplicate.duplicateOf).toBe(original.id)
    })

    it('should mark the original as deprecated when a duplicate is added', () => {
      const original = store.add(createEntry({ contentHash: 'hash-1', filePath: '/a.txt' }))
      store.add(createEntry({ contentHash: 'hash-1', filePath: '/b.txt' }))

      // findByHash returns the latest entry (the duplicate), so we need to
      // access the map directly to verify the original's state.
      const all = store.getAll()
      const originalEntry = all.find((e) => e.id === original.id)
      expect(originalEntry).toBeDefined()
      expect(originalEntry?.status).toBe('deprecated')
    })

    it('should allow multiple duplicates of the same original', () => {
      const original = store.add(createEntry({ contentHash: 'hash-1', filePath: '/a.txt' }))
      const dup1 = store.add(createEntry({ contentHash: 'hash-1', filePath: '/b.txt' }))
      const dup2 = store.add(createEntry({ contentHash: 'hash-1', filePath: '/c.txt' }))

      expect(dup1.duplicateOf).toBe(original.id)
      expect(dup2.duplicateOf).toBe(original.id)
    })

    it('should support different duplicate modes', () => {
      const skipStore = new DuplicateStore('skip')
      const trackStore = new DuplicateStore('track')

      expect(skipStore.getMode()).toBe('skip')
      expect(trackStore.getMode()).toBe('track')
    })

    it('should allow changing the mode', () => {
      store.setMode('track')
      expect(store.getMode()).toBe('track')

      store.setMode('update')
      expect(store.getMode()).toBe('update')
    })
  })

  // ── findByHash() ───────────────────────────────────────────────────────────

  describe('findByHash()', () => {
    it('should return null for non-existent hash', () => {
      expect(store.findByHash('nonexistent')).toBeNull()
    })

    it('should return the latest entry for a given hash', async () => {
      const original = store.add(createEntry({ contentHash: 'hash-1', filePath: '/a.txt' }))
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 2))
      const latest = store.add(createEntry({ contentHash: 'hash-1', filePath: '/b.txt' }))

      const found = store.findByHash('hash-1')
      // findByHash returns the most recent entry (the duplicate, since original is deprecated)
      // Verify it's the duplicate by checking duplicateOf references the original
      expect(found?.duplicateOf).toBe(original.id)
      // The found entry should NOT be the original
      expect(found?.id).not.toBe(original.id)
    })

    it('should return the only entry when there is a single original', () => {
      const original = store.add(createEntry({ contentHash: 'hash-1', filePath: '/a.txt' }))

      const found = store.findByHash('hash-1')
      expect(found?.id).toBe(original.id)
    })

    it('should handle different hashes correctly', () => {
      const entry1 = store.add(createEntry({ contentHash: 'hash-1', filePath: '/a.txt' }))
      const entry2 = store.add(createEntry({ contentHash: 'hash-2', filePath: '/b.txt' }))

      expect(store.findByHash('hash-1')?.id).toBe(entry1.id)
      expect(store.findByHash('hash-2')?.id).toBe(entry2.id)
    })
  })

  // ── findDuplicates() ───────────────────────────────────────────────────────

  describe('findDuplicates()', () => {
    it('should return empty array for non-existent hash', () => {
      expect(store.findDuplicates('nonexistent')).toEqual([])
    })

    it('should return all entries sharing the same hash', () => {
      const original = store.add(createEntry({ contentHash: 'hash-1', filePath: '/a.txt' }))
      const dup1 = store.add(createEntry({ contentHash: 'hash-1', filePath: '/b.txt' }))
      const dup2 = store.add(createEntry({ contentHash: 'hash-1', filePath: '/c.txt' }))

      const duplicates = store.findDuplicates('hash-1')
      expect(duplicates).toHaveLength(3)
      expect(duplicates.map((d) => d.id)).toContain(original.id)
      expect(duplicates.map((d) => d.id)).toContain(dup1.id)
      expect(duplicates.map((d) => d.id)).toContain(dup2.id)
    })

    it('should return entries sorted by creation time (oldest first)', () => {
      const original = store.add(createEntry({ contentHash: 'hash-1', filePath: '/a.txt' }))
      const dup1 = store.add(createEntry({ contentHash: 'hash-1', filePath: '/b.txt' }))

      const duplicates = store.findDuplicates('hash-1')
      expect(duplicates).toHaveLength(2)
      // Use string comparison for ISO timestamps
      expect(duplicates[0].createdAt <= duplicates[1].createdAt).toBe(true)
    })

    it('should not return entries with different hashes', () => {
      store.add(createEntry({ contentHash: 'hash-1', filePath: '/a.txt' }))
      store.add(createEntry({ contentHash: 'hash-2', filePath: '/b.txt' }))

      expect(store.findDuplicates('hash-1')).toHaveLength(1)
      expect(store.findDuplicates('hash-2')).toHaveLength(1)
    })
  })

  // ── getAll() ───────────────────────────────────────────────────────────────

  describe('getAll()', () => {
    it('should return empty array when store is empty', () => {
      expect(store.getAll()).toEqual([])
    })

    it('should return all entries sorted by creation time', () => {
      store.add(createEntry({ contentHash: 'hash-1', filePath: '/a.txt' }))
      store.add(createEntry({ contentHash: 'hash-2', filePath: '/b.txt' }))
      store.add(createEntry({ contentHash: 'hash-1', filePath: '/c.txt' }))

      const all = store.getAll()
      expect(all).toHaveLength(3)
      // Use string comparison for ISO timestamps
      expect(all[0].createdAt <= all[1].createdAt).toBe(true)
      expect(all[1].createdAt <= all[2].createdAt).toBe(true)
    })

    it('should include both originals and duplicates', () => {
      const original = store.add(createEntry({ contentHash: 'hash-1', filePath: '/a.txt' }))
      store.add(createEntry({ contentHash: 'hash-1', filePath: '/b.txt' }))

      const all = store.getAll()
      expect(all).toHaveLength(2)
      expect(all.some((e) => e.id === original.id)).toBe(true)
    })
  })

  // ── remove() ───────────────────────────────────────────────────────────────

  describe('remove()', () => {
    it('should remove an entry by id', () => {
      const original = store.add(createEntry({ contentHash: 'hash-1', filePath: '/a.txt' }))
      const result = store.remove(original.id)

      expect(result).toBe(true)
      expect(store.getAll()).toHaveLength(0)
    })

    it('should return false for non-existent id', () => {
      const result = store.remove('nonexistent-id')
      expect(result).toBe(false)
    })

    it('should allow re-adding a removed entry as original', () => {
      const original = store.add(createEntry({ contentHash: 'hash-1', filePath: '/a.txt' }))
      store.remove(original.id)
      const newOriginal = store.add(createEntry({ contentHash: 'hash-1', filePath: '/a.txt' }))

      expect(newOriginal.status).toBe('original')
      expect(newOriginal.duplicateOf).toBeNull()
    })
  })

  // ── markDeprecated() ───────────────────────────────────────────────────────

  describe('markDeprecated()', () => {
    it('should mark all non-deprecated entries with the given hash', () => {
      const original = store.add(createEntry({ contentHash: 'hash-1', filePath: '/a.txt' }))
      const dup = store.add(createEntry({ contentHash: 'hash-1', filePath: '/b.txt' }))

      // original is already 'deprecated' from add(dup), only dup is 'duplicate'
      const count = store.markDeprecated('hash-1')
      expect(count).toBe(1)

      const all = store.getAll()
      expect(all.every((e) => e.status === 'deprecated')).toBe(true)
    })

    it('should return 0 when no entries match the hash', () => {
      const count = store.markDeprecated('nonexistent')
      expect(count).toBe(0)
    })

    it('should not re-mark already deprecated entries', () => {
      const original = store.add(createEntry({ contentHash: 'hash-1', filePath: '/a.txt' }))
      store.add(createEntry({ contentHash: 'hash-1', filePath: '/b.txt' }))

      // First call marks the duplicate as deprecated (original is already deprecated)
      const first = store.markDeprecated('hash-1')
      expect(first).toBe(1)

      // Second call should not find any non-deprecated entries
      const second = store.markDeprecated('hash-1')
      expect(second).toBe(0)
    })
  })

  // ── getStats() ─────────────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('should return zero stats for empty store', () => {
      const stats = store.getStats()
      expect(stats).toEqual({ total: 0, originals: 0, duplicates: 0, deprecated: 0 })
    })

    it('should count one original after single insert', () => {
      store.add(createEntry({ contentHash: 'hash-1', filePath: '/a.txt' }))

      const stats = store.getStats()
      expect(stats).toEqual({ total: 1, originals: 1, duplicates: 0, deprecated: 0 })
    })

    it('should count original + duplicate after adding duplicate', () => {
      store.add(createEntry({ contentHash: 'hash-1', filePath: '/a.txt' }))
      store.add(createEntry({ contentHash: 'hash-1', filePath: '/b.txt' }))

      const stats = store.getStats()
      expect(stats.total).toBe(2)
      expect(stats.duplicates).toBe(1)
      expect(stats.deprecated).toBe(1)
    })

    it('should count multiple duplicates correctly', () => {
      store.add(createEntry({ contentHash: 'hash-1', filePath: '/a.txt' }))
      store.add(createEntry({ contentHash: 'hash-1', filePath: '/b.txt' }))
      store.add(createEntry({ contentHash: 'hash-1', filePath: '/c.txt' }))

      const stats = store.getStats()
      expect(stats.total).toBe(3)
      expect(stats.duplicates).toBe(2)
      expect(stats.deprecated).toBe(1)
    })

    it('should count entries with different hashes independently', () => {
      store.add(createEntry({ contentHash: 'hash-1', filePath: '/a.txt' }))
      store.add(createEntry({ contentHash: 'hash-2', filePath: '/b.txt' }))
      store.add(createEntry({ contentHash: 'hash-1', filePath: '/c.txt' }))

      const stats = store.getStats()
      expect(stats.total).toBe(3)
      // hash-1: 1 original (becomes deprecated) + 1 duplicate
      // hash-2: 1 original
      expect(stats.originals).toBe(1)
      expect(stats.duplicates).toBe(1)
      expect(stats.deprecated).toBe(1)
    })
  })
})
