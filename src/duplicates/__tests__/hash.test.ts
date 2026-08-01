// Unit tests for computeContentHash() — SHA-256 hash correctness.
//
// Validates that the function produces correct SHA-256 digests for known inputs,
// is deterministic across calls, and reports errors for unreadable files.

import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computeContentHash } from '../hash.js'

// Known SHA-256 digests for verification.
const knownHashes: Record<string, string> = {
  '': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  hello: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
  'hello world': 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
}

let tempDir: string

beforeEach(async () => {
  tempDir = join(tmpdir(), `mcp-local-rag-hash-test-${Date.now()}`)
  await mkdir(tempDir, { recursive: true })
})

afterEach(async () => {
  try {
    await rm(tempDir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
})

describe('computeContentHash', () => {
  it('should produce a 64-character hex digest', async () => {
    const filePath = join(tempDir, 'test.txt')
    await writeFile(filePath, 'test content')

    const hash = await computeContentHash(filePath)

    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('should produce the same hash for identical content (deterministic)', async () => {
    const filePath = join(tempDir, 'deterministic.txt')
    const content = 'deterministic test content'
    await writeFile(filePath, content)

    const hash1 = await computeContentHash(filePath)
    const hash2 = await computeContentHash(filePath)

    expect(hash1).toBe(hash2)
  })

  it('should produce different hashes for different content', async () => {
    const file1 = join(tempDir, 'file1.txt')
    const file2 = join(tempDir, 'file2.txt')

    await writeFile(file1, 'content A')
    await writeFile(file2, 'content B')

    const hash1 = await computeContentHash(file1)
    const hash2 = await computeContentHash(file2)

    expect(hash1).not.toBe(hash2)
  })

  it('should produce correct SHA-256 for empty file', async () => {
    const filePath = join(tempDir, 'empty.txt')
    await writeFile(filePath, '')

    const hash = await computeContentHash(filePath)

    // SHA-256 of empty string
    expect(hash).toBe(knownHashes[''])
  })

  it('should produce correct SHA-256 for "hello" content', async () => {
    const filePath = join(tempDir, 'hello.txt')
    await writeFile(filePath, 'hello')

    const hash = await computeContentHash(filePath)

    // SHA-256 of "hello"
    expect(hash).toBe(knownHashes['hello'])
  })

  it('should produce correct SHA-256 for "hello world" content', async () => {
    const filePath = join(tempDir, 'hello-world.txt')
    await writeFile(filePath, 'hello world')

    const hash = await computeContentHash(filePath)

    // SHA-256 of "hello world"
    expect(hash).toBe(knownHashes['hello world'])
  })

  it('should produce correct hash for binary content', async () => {
    const filePath = join(tempDir, 'binary.bin')
    const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd])
    await writeFile(filePath, binaryContent)

    const hash = await computeContentHash(filePath)

    // Verify against known SHA-256 of this binary buffer
    const expected = createHash('sha256').update(binaryContent).digest('hex')
    expect(hash).toBe(expected)
  })

  it('should produce correct hash for large content (1 MB)', async () => {
    const filePath = join(tempDir, 'large.txt')
    // 1 MB of repeated content
    const largeContent = 'x'.repeat(1024 * 1024)
    await writeFile(filePath, largeContent)

    const hash = await computeContentHash(filePath)

    // Verify against known SHA-256
    const expected = createHash('sha256').update(largeContent).digest('hex')
    expect(hash).toBe(expected)
  })

  it('should throw an error for non-existent file', async () => {
    const nonExistentPath = join(tempDir, 'does-not-exist.txt')

    await expect(computeContentHash(nonExistentPath)).rejects.toThrow()
    await expect(computeContentHash(nonExistentPath)).rejects.toThrow(/ENOENT|no such file/i)
  })

  it('should handle files with special characters in names', async () => {
    const filePath = join(tempDir, 'файл-тест-123.txt')
    await writeFile(filePath, 'special filename content')

    const hash = await computeContentHash(filePath)

    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('should handle files with unicode content', async () => {
    const filePath = join(tempDir, 'unicode.txt')
    const unicodeContent = 'Привет мир! 你好世界! 🌍'
    await writeFile(filePath, unicodeContent)

    const hash = await computeContentHash(filePath)

    // Verify against known SHA-256
    const expected = createHash('sha256').update(unicodeContent).digest('hex')
    expect(hash).toBe(expected)
  })

  it('should handle files with newlines and tabs', async () => {
    const filePath = join(tempDir, 'whitespace.txt')
    const content = 'line1\nline2\ttabbed\nline3\r\nwindows\n'
    await writeFile(filePath, content)

    const hash = await computeContentHash(filePath)

    // Verify against known SHA-256
    const expected = createHash('sha256').update(content).digest('hex')
    expect(hash).toBe(expected)
  })
})
