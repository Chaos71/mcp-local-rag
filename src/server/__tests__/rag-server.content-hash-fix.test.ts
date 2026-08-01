// Regression test for contentHash persistence bug
// Bug: contentHash was computed but never passed to buildVectorChunks(),
// causing duplicate detection to always fail.
//
// This test verifies:
// 1. contentHash is stored in VectorChunk
// 2. Duplicate detection works after the fix

import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { testModelCacheDir, withTestDevice } from '../../__tests__/test-device.js'
import { RAGServer } from '../index.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

function createFixtureFile(dir: string, name: string, content: string): string {
  const path = resolve(dir, name)
  writeFileSync(path, content)
  return path
}

function parseIngestResult(result: { content: Array<{ text?: string }> }): Record<string, unknown> {
  const text = result.content[0]?.text ?? '{}'
  return JSON.parse(text)
}

/**
 * Generate unique paths for each test case to avoid cross-contamination
 * between tests sharing the same database.
 */
function uniquePaths(): { dbPath: string; testDataDir: string } {
  const id = randomUUID().slice(0, 8)
  return {
    dbPath: resolve(`./tmp/test-lancedb-content-hash-${id}`),
    testDataDir: resolve(`./tmp/test-data-content-hash-${id}`),
  }
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe('contentHash persistence regression test', () => {
  // Track all servers for cleanup
  const servers: RAGServer[] = []
  const paths: { dbPath: string; testDataDir: string }[] = []

  afterAll(async () => {
    process.env.DUPLICATE_MODE = ''
    // Clean up all servers
    for (const server of servers) {
      try {
        await server.close()
      } catch {
        // Ignore close errors
      }
    }
    // Clean up all paths
    for (const p of paths) {
      rmSync(p.dbPath, { recursive: true, force: true })
      rmSync(p.testDataDir, { recursive: true, force: true })
    }
  })

  it('stores contentHash in VectorChunk on first ingestion', async () => {
    const p = uniquePaths()
    paths.push(p)
    process.env.DUPLICATE_MODE = 'skip'
    mkdirSync(p.dbPath, { recursive: true })
    mkdirSync(p.testDataDir, { recursive: true })

    const server = new RAGServer(
      withTestDevice({
        dbPath: p.dbPath,
        modelName: 'Xenova/all-MiniLM-L6-v2',
        cacheDir: testModelCacheDir(),
        baseDir: p.testDataDir,
        maxFileSize: 100 * 1024 * 1024,
      })
    )
    servers.push(server)
    await server.initialize()

    const content = 'Content hash persistence test. '.repeat(60)
    const filePath = createFixtureFile(p.testDataDir, 'content-hash-test.txt', content)

    const result = await server.handleIngestFile({ filePath })
    const summary = parseIngestResult(result)

    // contentHash must be present in the result
    expect(summary.contentHash).toBeDefined()
    expect(typeof summary.contentHash).toBe('string')
    expect((summary.contentHash as string).length).toBe(64) // SHA-256 hex length
    expect(summary.status).toBe('new')
  }, 60000)

  it('detects duplicate with identical content (status: skipped)', async () => {
    const p = uniquePaths()
    paths.push(p)
    process.env.DUPLICATE_MODE = 'skip'
    mkdirSync(p.dbPath, { recursive: true })
    mkdirSync(p.testDataDir, { recursive: true })

    const server = new RAGServer(
      withTestDevice({
        dbPath: p.dbPath,
        modelName: 'Xenova/all-MiniLM-L6-v2',
        cacheDir: testModelCacheDir(),
        baseDir: p.testDataDir,
        maxFileSize: 100 * 1024 * 1024,
      })
    )
    servers.push(server)
    await server.initialize()

    const content = 'Duplicate detection test. '.repeat(60)
    const filePath = createFixtureFile(p.testDataDir, 'duplicate-test.txt', content)

    // First ingestion
    const firstResult = await server.handleIngestFile({ filePath })
    const firstSummary = parseIngestResult(firstResult)
    expect(firstSummary.status).toBe('new')
    const firstHash = firstSummary.contentHash

    // Second ingestion with identical content
    const secondResult = await server.handleIngestFile({ filePath })
    const secondSummary = parseIngestResult(secondResult)

    // After fix: duplicate must be detected
    expect(secondSummary.status).toBe('skipped')
    expect(secondSummary.contentHash).toBe(firstHash) // Same hash
    expect(secondSummary.chunkCount).toBe(0) // No new chunks
    expect(secondSummary.duplicateOf).toBeDefined()
  }, 60000)

  it('detects duplicate across different file paths with same content', async () => {
    const p = uniquePaths()
    paths.push(p)
    process.env.DUPLICATE_MODE = 'skip'
    mkdirSync(p.dbPath, { recursive: true })
    mkdirSync(p.testDataDir, { recursive: true })

    const server = new RAGServer(
      withTestDevice({
        dbPath: p.dbPath,
        modelName: 'Xenova/all-MiniLM-L6-v2',
        cacheDir: testModelCacheDir(),
        baseDir: p.testDataDir,
        maxFileSize: 100 * 1024 * 1024,
      })
    )
    servers.push(server)
    await server.initialize()

    const content = 'Cross-path duplicate test. '.repeat(60)
    const file1 = createFixtureFile(p.testDataDir, 'cross-path-1.txt', content)
    const file2 = createFixtureFile(p.testDataDir, 'cross-path-2.txt', content)

    // Ingest first file
    const firstResult = await server.handleIngestFile({ filePath: file1 })
    const firstSummary = parseIngestResult(firstResult)
    expect(firstSummary.status).toBe('new')
    const firstHash = firstSummary.contentHash

    // Ingest second file with same content
    const secondResult = await server.handleIngestFile({ filePath: file2 })
    const secondSummary = parseIngestResult(secondResult)

    // Same content = same hash = duplicate detected
    expect(secondSummary.contentHash).toBe(firstHash)
    expect(secondSummary.status).toBe('skipped')
  }, 60000)

  it('accepts different content as new file (different hash)', async () => {
    const p = uniquePaths()
    paths.push(p)
    process.env.DUPLICATE_MODE = 'skip'
    mkdirSync(p.dbPath, { recursive: true })
    mkdirSync(p.testDataDir, { recursive: true })

    const server = new RAGServer(
      withTestDevice({
        dbPath: p.dbPath,
        modelName: 'Xenova/all-MiniLM-L6-v2',
        cacheDir: testModelCacheDir(),
        baseDir: p.testDataDir,
        maxFileSize: 100 * 1024 * 1024,
      })
    )
    servers.push(server)
    await server.initialize()

    const originalContent = 'Original content. '.repeat(60)
    const modifiedContent = 'Modified content. '.repeat(60)
    const filePath = createFixtureFile(p.testDataDir, 'modify-test.txt', originalContent)

    // First ingestion
    const firstResult = await server.handleIngestFile({ filePath })
    const firstSummary = parseIngestResult(firstResult)
    expect(firstSummary.status).toBe('new')

    // Modify content
    writeFileSync(filePath, modifiedContent)

    // Second ingestion (different content = different hash)
    const secondResult = await server.handleIngestFile({ filePath })
    const secondSummary = parseIngestResult(secondResult)

    // Different content should be treated as new/updated (not skipped)
    expect(secondSummary.contentHash).not.toBe(firstSummary.contentHash)
    expect(secondSummary.status).not.toBe('skipped')
  }, 60000)
})
