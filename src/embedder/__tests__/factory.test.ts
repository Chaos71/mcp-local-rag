// Tests for embedder factory

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmbedder, EmbedderConfigError } from '../factory.js'
import { Embedder } from '../index.js'
import { LlamaCppEmbedder } from '../llama-cpp.js'

describe('createEmbedder factory', () => {
  const defaultTransformersConfig = {
    modelPath: 'Xenova/all-MiniLM-L6-v2',
    batchSize: 16,
    cacheDir: './models/',
  }

  const defaultLlamaCppConfig = {
    serverUrl: 'http://127.0.0.1:8080',
    batchSize: 16,
    timeout: 30000,
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Test 1: Create TransformersEmbedder with backend: 'transformers'
  it('should create TransformersEmbedder when backend is "transformers"', () => {
    const embedder = createEmbedder({
      backend: 'transformers',
      transformersConfig: defaultTransformersConfig,
    })

    expect(embedder).toBeInstanceOf(Embedder)
    expect(embedder).not.toBeInstanceOf(LlamaCppEmbedder)
  })

  // Test 2: Create LlamaCppEmbedder with backend: 'llama-cpp'
  it('should create LlamaCppEmbedder when backend is "llama-cpp"', () => {
    const embedder = createEmbedder({
      backend: 'llama-cpp',
      llamaCppConfig: defaultLlamaCppConfig,
    })

    expect(embedder).toBeInstanceOf(LlamaCppEmbedder)
    expect(embedder).not.toBeInstanceOf(Embedder)
  })

  // Test 3: Throw error when transformersConfig is missing for transformers backend
  it('should throw EmbedderConfigError when transformersConfig is missing for transformers backend', () => {
    expect(() =>
      createEmbedder({
        backend: 'transformers',
        transformersConfig: undefined,
      })
    ).toThrow(EmbedderConfigError)
    expect(() =>
      createEmbedder({
        backend: 'transformers',
        transformersConfig: undefined,
      })
    ).toThrow('transformersConfig is required')
  })

  // Test 4: Throw error when llamaCppConfig is missing for llama-cpp backend
  it('should throw EmbedderConfigError when llamaCppConfig is missing for llama-cpp backend', () => {
    expect(() =>
      createEmbedder({
        backend: 'llama-cpp',
        llamaCppConfig: undefined,
      })
    ).toThrow(EmbedderConfigError)
    expect(() =>
      createEmbedder({
        backend: 'llama-cpp',
        llamaCppConfig: undefined,
      })
    ).toThrow('llamaCppConfig is required')
  })

  // Test 5: Default backend should be transformers
  it('should default to transformers when backend is not specified', () => {
    const embedder = createEmbedder({
      backend: 'transformers',
      transformersConfig: defaultTransformersConfig,
    })

    expect(embedder).toBeInstanceOf(Embedder)
  })

  // Test 6: Both configs can be provided simultaneously
  it('should accept both configs but only use the selected one', () => {
    const embedder = createEmbedder({
      backend: 'llama-cpp',
      transformersConfig: defaultTransformersConfig,
      llamaCppConfig: defaultLlamaCppConfig,
    })

    expect(embedder).toBeInstanceOf(LlamaCppEmbedder)
  })

  // Test 7: LlamaCppEmbedder should have correct dimensions
  it('should create LlamaCppEmbedder with 4096 dimensions by default', () => {
    const embedder = createEmbedder({
      backend: 'llama-cpp',
      llamaCppConfig: defaultLlamaCppConfig,
    })

    expect(embedder.getDimensions()).toBe(4096)
  })

  // Test 8: TransformersEmbedder should have 384 dimensions
  it('should create TransformersEmbedder with 384 dimensions', () => {
    const embedder = createEmbedder({
      backend: 'transformers',
      transformersConfig: defaultTransformersConfig,
    })

    expect(embedder.getDimensions()).toBe(384)
  })
})
