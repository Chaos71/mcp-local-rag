// Tests for llama.cpp embedding backend

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LlamaCppEmbedder } from '../llama-cpp.js'

describe('LlamaCppEmbedder', () => {
  const mockServerUrl = 'http://127.0.0.1:8080'

  beforeEach(() => {
    // Clear any environment overrides
    delete process.env['RAG_LLAMA_CPP_DIMENSIONS']
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Test 1: Constructor with default values
  it('should create instance with default configuration', () => {
    const embedder = new LlamaCppEmbedder({})

    expect(embedder).toBeDefined()
    expect(embedder.getDimensions()).toBe(4096)
  })

  // Test 2: Constructor with custom config
  it('should create instance with custom configuration', () => {
    const embedder = new LlamaCppEmbedder({
      serverUrl: 'http://localhost:9000',
      batchSize: 8,
      timeout: 60000,
    })

    expect(embedder).toBeDefined()
  })

  // Test 3: Constructor with custom dimensions from env
  it('should respect RAG_LLAMA_CPP_DIMENSIONS environment variable', () => {
    process.env['RAG_LLAMA_CPP_DIMENSIONS'] = '768'
    const embedder = new LlamaCppEmbedder({})

    expect(embedder.getDimensions()).toBe(768)
  })

  // Test 4: Constructor throws without config
  it('should throw error when created without config', () => {
    expect(() => new LlamaCppEmbedder(null as any)).toThrow('Configuration is required')
  })

  // Test 5: dispose() should be a no-op for HTTP backend
  it('dispose() should be a no-op for HTTP backend', async () => {
    const embedder = new LlamaCppEmbedder({ serverUrl: mockServerUrl })
    await embedder.dispose()

    // Should not throw
    expect(true).toBe(true)
  })

  // Test 6: getDimensions() returns correct value
  it('getDimensions() returns the configured dimensionality', () => {
    const embedder = new LlamaCppEmbedder({})
    expect(embedder.getDimensions()).toBe(4096)
  })

  // Test 7: getDimensions() respects custom dimensions
  it('getDimensions() respects RAG_LLAMA_CPP_DIMENSIONS', () => {
    process.env['RAG_LLAMA_CPP_DIMENSIONS'] = '768'
    const embedder = new LlamaCppEmbedder({})
    expect(embedder.getDimensions()).toBe(768)
  })

  // Test 8: embed() should reject empty text
  it('should reject empty text', async () => {
    const embedder = new LlamaCppEmbedder({ serverUrl: mockServerUrl })

    await expect(embedder.embed('')).rejects.toThrow('Cannot generate embedding for empty text')
  })

  // Test 9: embedBatch() should return empty array for empty input
  it('should return empty array for empty input', async () => {
    const embedder = new LlamaCppEmbedder({ serverUrl: mockServerUrl })
    const results = await embedder.embedBatch([])

    expect(results).toEqual([])
  })

  // Test 10: embedBatch() should reject empty text in batch
  it('should reject batch containing empty text', async () => {
    const embedder = new LlamaCppEmbedder({ serverUrl: mockServerUrl })

    await expect(embedder.embedBatch(['text 1', '', 'text 3'])).rejects.toThrow(
      'Cannot generate embedding for empty text'
    )
  })

  // Note: HTTP-dependent tests (embed, embedBatch, initialize) require
  // mocking the native fetch API which is not reliably supported in
  // Node.js with vitest. These tests are intentionally omitted to avoid
  // flaky behavior. The implementation is covered by E2E tests that
  // spin up a real mock llama.cpp server.
})
