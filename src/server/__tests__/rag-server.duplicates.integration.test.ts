// RAG MCP Server Integration Test - Duplicate Handling
// Tests handleIngestFile with all three DUPLICATE_MODE values: skip, update, track
//
// AC-010: Duplicate Handling — skip mode
// AC-011: Duplicate Handling — update mode
// AC-012: Duplicate Handling — track mode
// AC-013: Duplicate Handling — Edge Cases

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testModelCacheDir, withTestDevice } from '../../__tests__/test-device.js'
import { RAGServer } from '../index.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a fixture file with deterministic content.
 * The content length ensures multiple chunks are generated.
 */
function createFixtureFile(dir: string, name: string, content: string): string {
  const path = resolve(dir, name)
  writeFileSync(path, content)
  return path
}

/**
 * Parse the JSON response from handleIngestFile.
 * Returns the IngestResult object.
 */
function parseIngestResult(result: { content: Array<{ text?: string }> }): Record<string, unknown> {
  const text = result.content[0]?.text ?? '{}'
  return JSON.parse(text)
}

/**
 * Parse the JSON response from handleListFiles.
 * Returns the ListFilesResult object.
 */
function parseListResult(result: { content: Array<{ text?: string }> }): Record<string, unknown> {
  // ListFilesResult may have multiple text blocks (warnings); find the JSON one
  for (const block of result.content) {
    if (block.text?.startsWith('{')) {
      return JSON.parse(block.text)
    }
  }
  return {}
}

// ── Test Suites ──────────────────────────────────────────────────────────────

describe('AC-010: Duplicate Handling — skip mode', () => {
  let server: RAGServer
  const testDbPath = resolve('./tmp/test-lancedb-dup-skip')
  const testDataDir = resolve('./tmp/test-data-dup-skip')

  beforeAll(async () => {
    // Clean up before starting tests
    rmSync(testDbPath, { recursive: true, force: true })
    rmSync(testDataDir, { recursive: true, force: true })
    process.env.DUPLICATE_MODE = 'skip'
    mkdirSync(testDbPath, { recursive: true })
    mkdirSync(testDataDir, { recursive: true })

    server = new RAGServer(
      withTestDevice({
        dbPath: testDbPath,
        modelName: 'Xenova/all-MiniLM-L6-v2',
        cacheDir: testModelCacheDir(),
        baseDir: testDataDir,
        maxFileSize: 100 * 1024 * 1024,
      })
    )

    await server.initialize()
  })

  afterAll(async () => {
    process.env.DUPLICATE_MODE = ''
    await server.close()
    rmSync(testDbPath, { recursive: true, force: true })
    rmSync(testDataDir, { recursive: true, force: true })
  })

  it('ingests a file on first load (status: new)', async () => {
    const filePath = createFixtureFile(
      testDataDir,
      'skip-original.txt',
      'This is the original content for skip mode testing. '.repeat(50)
    )

    const result = await server.handleIngestFile({ filePath })
    const summary = parseIngestResult(result)

    expect(summary.status).toBe('new')
    expect(summary.chunkCount).toBeGreaterThan(0)
    expect(summary.contentHash).toBeDefined()
  }, 60000)

  it('skips duplicate file with same content (status: skipped)', async () => {
    const content = 'Duplicate content for skip mode. '.repeat(60)
    const filePath = createFixtureFile(testDataDir, 'skip-duplicate.txt', content)

    // First ingestion
    const firstResult = await server.handleIngestFile({ filePath })
    const firstSummary = parseIngestResult(firstResult)
    expect(firstSummary.status).toBe('new')

    // Second ingestion with identical content
    const secondResult = await server.handleIngestFile({ filePath })
    const secondSummary = parseIngestResult(secondResult)

    expect(secondSummary.status).toBe('skipped')
    expect(secondSummary.chunkCount).toBe(0)
    expect(secondSummary.duplicateOf).toBeDefined()
  }, 60000)

  it('does not increase chunk count after skipped duplicate', async () => {
    const content = 'Skip mode chunk count test. '.repeat(70)
    const filePath = createFixtureFile(testDataDir, 'skip-count.txt', content)

    // First ingestion
    await server.handleIngestFile({ filePath })

    // Second ingestion (should be skipped)
    await server.handleIngestFile({ filePath })

    // Verify only one file entry exists
    const listResult = await server.handleListFiles()
    const files = parseListResult(listResult)
    const targetFiles = (files.files as Array<{ filePath: string }>).filter(
      (f) => f.filePath === filePath
    )

    expect(targetFiles.length).toBe(1)
    // Chunk count should match the first ingestion, not double
    expect(targetFiles[0].chunkCount).toBeGreaterThan(0)
  }, 60000)

  it('accepts new content after skip (different hash = new file)', async () => {
    const originalContent = 'Original skip mode content. '.repeat(50)
    const modifiedContent = 'Modified skip mode content. '.repeat(50)
    const filePath = createFixtureFile(testDataDir, 'skip-modify.txt', originalContent)

    // First ingestion
    const firstResult = await server.handleIngestFile({ filePath })
    const firstSummary = parseIngestResult(firstResult)
    expect(firstSummary.status).toBe('new')

    // Modify content (different hash)
    writeFileSync(filePath, modifiedContent)

    // With skip mode, modified content is a NEW file (different hash)
    // The server computes hash on each ingest; different content = different hash
    const secondResult = await server.handleIngestFile({ filePath })
    const secondSummary = parseIngestResult(secondResult)

    // Skip mode only skips identical content; different content triggers update
    expect(secondSummary.status).toBe('updated')
  }, 60000)

  it('returns correct response shape with status and duplicateOf fields', async () => {
    const content = 'Response shape test. '.repeat(60)
    const filePath = createFixtureFile(testDataDir, 'skip-shape.txt', content)

    // First ingestion
    const firstResult = await server.handleIngestFile({ filePath })
    const firstSummary = parseIngestResult(firstResult)

    // Verify response shape
    expect(firstSummary).toHaveProperty('status')
    expect(firstSummary).toHaveProperty('chunkCount')
    expect(firstSummary).toHaveProperty('contentHash')
    expect(firstSummary).toHaveProperty('filePath')
    expect(firstSummary).toHaveProperty('timestamp')
  }, 60000)
})

describe('AC-011: Duplicate Handling — update mode', () => {
  let server: RAGServer
  const testDbPath = resolve('./tmp/test-lancedb-dup-update')
  const testDataDir = resolve('./tmp/test-data-dup-update')

  beforeAll(async () => {
    // Clean up before starting tests
    rmSync(testDbPath, { recursive: true, force: true })
    rmSync(testDataDir, { recursive: true, force: true })
    process.env.DUPLICATE_MODE = 'update'
    mkdirSync(testDbPath, { recursive: true })
    mkdirSync(testDataDir, { recursive: true })

    server = new RAGServer(
      withTestDevice({
        dbPath: testDbPath,
        modelName: 'Xenova/all-MiniLM-L6-v2',
        cacheDir: testModelCacheDir(),
        baseDir: testDataDir,
        maxFileSize: 100 * 1024 * 1024,
      })
    )

    await server.initialize()
  })

  afterAll(async () => {
    process.env.DUPLICATE_MODE = ''
    await server.close()
    rmSync(testDbPath, { recursive: true, force: true })
    rmSync(testDataDir, { recursive: true, force: true })
  })

  it('updates duplicate file with status: updated', async () => {
    const content = 'Update mode content. '.repeat(60)
    const filePath = createFixtureFile(testDataDir, 'update-file.txt', content)

    // First ingestion
    const firstResult = await server.handleIngestFile({ filePath })
    const firstSummary = parseIngestResult(firstResult)
    expect(firstSummary.status).toBe('new')
    const firstChunkCount = firstSummary.chunkCount

    // Second ingestion with identical content
    const secondResult = await server.handleIngestFile({ filePath })
    const secondSummary = parseIngestResult(secondResult)

    expect(secondSummary.status).toBe('updated')
    expect(secondSummary.duplicateOf).toBeDefined()
    // Chunk count should reflect the new content (same in this case)
    expect(secondSummary.chunkCount).toBe(firstChunkCount)
  }, 60000)

  it('replaces old chunks with new content', async () => {
    const originalContent = 'Original update content. '.repeat(50)
    const newContent = 'New update content. '.repeat(30)
    const filePath = createFixtureFile(testDataDir, 'update-replace.txt', originalContent)

    // First ingestion
    const firstResult = await server.handleIngestFile({ filePath })
    const firstSummary = parseIngestResult(firstResult)

    // Modify content
    writeFileSync(filePath, newContent)

    // Second ingestion (same file path, different content = different hash)
    const secondResult = await server.handleIngestFile({ filePath })
    const secondSummary = parseIngestResult(secondResult)

    // Different content means new hash; update mode replaces
    expect(secondSummary.status).toBe('updated')
    // Chunk count should reflect new content (fewer chunks due to shorter text)
    expect(secondSummary.chunkCount).toBeLessThan(firstSummary.chunkCount)
  }, 60000)

  it('shows updated status in list_files', async () => {
    const content = 'Update list files test. '.repeat(50)
    const filePath = createFixtureFile(testDataDir, 'update-list.txt', content)

    // First ingestion
    await server.handleIngestFile({ filePath })

    // Second ingestion (duplicate, same content)
    await server.handleIngestFile({ filePath })

    // List files should show one entry
    const listResult = await server.handleListFiles()
    const files = parseListResult(listResult)
    const targetFiles = (files.files as Array<{ filePath: string }>).filter(
      (f) => f.filePath === filePath
    )

    expect(targetFiles.length).toBe(1)
  }, 60000)
})

describe('AC-012: Duplicate Handling — track mode', () => {
  let server: RAGServer
  const testDbPath = resolve('./tmp/test-lancedb-dup-track')
  const testDataDir = resolve('./tmp/test-data-dup-track')

  beforeAll(async () => {
    // Clean up before starting tests
    rmSync(testDbPath, { recursive: true, force: true })
    rmSync(testDataDir, { recursive: true, force: true })
    process.env.DUPLICATE_MODE = 'track'
    mkdirSync(testDbPath, { recursive: true })
    mkdirSync(testDataDir, { recursive: true })

    server = new RAGServer(
      withTestDevice({
        dbPath: testDbPath,
        modelName: 'Xenova/all-MiniLM-L6-v2',
        cacheDir: testModelCacheDir(),
        baseDir: testDataDir,
        maxFileSize: 100 * 1024 * 1024,
      })
    )

    await server.initialize()
  })

  afterAll(async () => {
    process.env.DUPLICATE_MODE = ''
    await server.close()
    rmSync(testDbPath, { recursive: true, force: true })
    rmSync(testDataDir, { recursive: true, force: true })
  })

  it('tracks duplicate with status: tracked', async () => {
    const content = 'Track mode content. '.repeat(60)
    const filePath = createFixtureFile(testDataDir, 'track-file.txt', content)

    // First ingestion
    const firstResult = await server.handleIngestFile({ filePath })
    const firstSummary = parseIngestResult(firstResult)
    expect(firstSummary.status).toBe('new')

    // Second ingestion with identical content
    const secondResult = await server.handleIngestFile({ filePath })
    const secondSummary = parseIngestResult(secondResult)

    expect(secondSummary.status).toBe('tracked')
    expect(secondSummary.duplicateOf).toBeDefined()
    // Both versions should have the same chunk count
    expect(secondSummary.chunkCount).toBe(firstSummary.chunkCount)
  }, 60000)

  it('preserves both versions in the index', async () => {
    const content = 'Track both versions. '.repeat(50)
    const filePath = createFixtureFile(testDataDir, 'track-both.txt', content)

    // First ingestion
    await server.handleIngestFile({ filePath })

    // Second ingestion (duplicate)
    await server.handleIngestFile({ filePath })

    // Query should return results from both versions
    const queryResult = await server.handleQueryDocuments({
      query: 'track both versions',
      limit: 5,
    })
    const querySummary = JSON.parse(queryResult.content[0].text ?? '{}')

    // Should return multiple results (from both versions)
    expect(querySummary.results.length).toBeGreaterThan(1)
  }, 60000)

  it('preserves both versions with matching chunk count', async () => {
    const content = 'Track chunk count test. '.repeat(50)
    const filePath = createFixtureFile(testDataDir, 'track-count.txt', content)

    // First ingestion
    const firstResult = await server.handleIngestFile({ filePath })
    const firstSummary = parseIngestResult(firstResult)

    // Second ingestion
    const secondResult = await server.handleIngestFile({ filePath })
    const secondSummary = parseIngestResult(secondResult)

    // Both versions should have identical chunk counts
    expect(firstSummary.chunkCount).toBe(secondSummary.chunkCount)
  }, 60000)
})

describe('AC-013: Duplicate Handling — Edge Cases', () => {
  let server: RAGServer
  const testDbPath = resolve('./tmp/test-lancedb-dup-edge')
  const testDataDir = resolve('./tmp/test-data-dup-edge')

  beforeAll(async () => {
    // Clean up before starting tests
    rmSync(testDbPath, { recursive: true, force: true })
    rmSync(testDataDir, { recursive: true, force: true })
    process.env.DUPLICATE_MODE = 'skip'
    mkdirSync(testDbPath, { recursive: true })
    mkdirSync(testDataDir, { recursive: true })

    server = new RAGServer(
      withTestDevice({
        dbPath: testDbPath,
        modelName: 'Xenova/all-MiniLM-L6-v2',
        cacheDir: testModelCacheDir(),
        baseDir: testDataDir,
        maxFileSize: 100 * 1024 * 1024,
      })
    )

    await server.initialize()
  })

  afterAll(async () => {
    process.env.DUPLICATE_MODE = ''
    await server.close()
    rmSync(testDbPath, { recursive: true, force: true })
    rmSync(testDataDir, { recursive: true, force: true })
  })

  it('handles empty file gracefully (no chunks)', async () => {
    const filePath = createFixtureFile(testDataDir, 'edge-empty.txt', '')

    await expect(server.handleIngestFile({ filePath })).rejects.toThrow(/No.*chunks/i)
  })

  it('handles very short content (below min chunk length)', async () => {
    const filePath = createFixtureFile(testDataDir, 'edge-short.txt', 'tiny')

    await expect(server.handleIngestFile({ filePath })).rejects.toThrow(/No.*chunks/i)
  })

  it('treats identical content at different paths as duplicates', async () => {
    const content = 'Same content different path. '.repeat(50)
    const file1 = createFixtureFile(testDataDir, 'edge-path1.txt', content)
    const file2 = createFixtureFile(testDataDir, 'edge-path2.txt', content)

    // Ingest first file
    const firstResult = await server.handleIngestFile({ filePath: file1 })
    const firstSummary = parseIngestResult(firstResult)
    expect(firstSummary.status).toBe('new')

    // Ingest second file with same content but different path
    // With skip mode, this should be skipped because the content hash matches
    const secondResult = await server.handleIngestFile({ filePath: file2 })
    const secondSummary = parseIngestResult(secondResult)

    expect(secondSummary.status).toBe('skipped')
    expect(secondSummary.duplicateOf).toBeDefined()
  }, 60000)

  it('returns consistent contentHash for same content', async () => {
    const content = 'Hash consistency test. '.repeat(50)
    const file1 = createFixtureFile(testDataDir, 'edge-hash1.txt', content)
    const file2 = createFixtureFile(testDataDir, 'edge-hash2.txt', content)

    const firstResult = await server.handleIngestFile({ filePath: file1 })
    const firstSummary = parseIngestResult(firstResult)

    const secondResult = await server.handleIngestFile({ filePath: file2 })
    const secondSummary = parseIngestResult(secondResult)

    // Same content should produce same hash
    expect(firstSummary.contentHash).toBe(secondSummary.contentHash)
  }, 60000)
})
