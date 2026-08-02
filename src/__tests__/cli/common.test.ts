// CLI Common Helpers Tests
// Test Type: Unit Test
// Tests createVectorStore and createEmbedder factory functions

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// ============================================
// Mock Setup (vi.hoisted for isolate: false)
// ============================================

const mocks = vi.hoisted(() => {
  return {
    VectorStore: vi.fn(),
    PostgreSQLVectordb: vi.fn(),
    Embedder: vi.fn(),
  }
})

// Mock factories — installed via `vi.doMock` in `beforeAll` and removed via
// `vi.doUnmock` in `afterAll`. See `.claude/skills/project-context/SKILL.md`.

const vectordbFactory = () => ({
  VectorStore: mocks.VectorStore,
  PostgreSQLVectordb: mocks.PostgreSQLVectordb,
})

const embedderFactory = () => ({
  Embedder: mocks.Embedder,
})

const MOCKED_PATHS = ['../../vectordb/index.js', '../../embedder/index.js'] as const

// ============================================
// Imports (dynamic, after vi.doMock in beforeAll)
// ============================================

let createEmbedder: typeof import('../../cli/common.js').createEmbedder
let createVectorStore: typeof import('../../cli/common.js').createVectorStore
let formatCliError: typeof import('../../cli/common.js').formatCliError
type ResolvedGlobalConfig = import('../../cli/options.js').ResolvedGlobalConfig

// ============================================
// Test Data
// ============================================

function makeConfig(overrides: Partial<ResolvedGlobalConfig> = {}): ResolvedGlobalConfig {
  return {
    dbPath: './test-db/',
    cacheDir: './test-cache/',
    modelName: 'Xenova/all-MiniLM-L6-v2',
    ...overrides,
  }
}

// ============================================
// Tests
// ============================================

describe('cli/common', () => {
  beforeAll(async () => {
    vi.resetModules()
    vi.doMock('../../vectordb/index.js', vectordbFactory)
    vi.doMock('../../embedder/index.js', embedderFactory)
    ;({ createEmbedder, createVectorStore, formatCliError } = await import('../../cli/common.js'))
  })

  afterAll(() => {
    for (const p of MOCKED_PATHS) vi.doUnmock(p)
    vi.resetModules()
  })

  describe('createVectorStore', () => {
    afterEach(() => {
      mocks.VectorStore.mockReset()
      mocks.PostgreSQLVectordb.mockReset()
    })

    it('should construct VectorStore with dbPath from config', () => {
      createVectorStore(makeConfig({ dbPath: '/data/my-db' }))

      expect(mocks.VectorStore).toHaveBeenCalledOnce()
      expect(mocks.VectorStore).toHaveBeenCalledWith({
        backend: 'lancedb',
        dbPath: '/data/my-db',
        tableName: 'chunks',
      })
    })

    it('should construct PostgreSQLVectordb when vectordbBackend is postgresql', () => {
      process.env['PG_HOST'] = 'pg.example.com'
      process.env['PG_PORT'] = '5433'
      process.env['PG_DATABASE'] = 'mydb'
      process.env['PG_USER'] = 'pguser'
      process.env['PG_PASSWORD'] = 'pgpass'
      process.env['PG_SSL_MODE'] = 'prefer'
      process.env['PG_MAX_POOL_SIZE'] = '30'
      process.env['PG_MIN_POOL_SIZE'] = '5'
      process.env['PG_SCHEMA'] = 'myschema'
      process.env['EMBEDDING_SIZE'] = '768'
      process.env['RAG_IVF_LISTS'] = '200'
      process.env['RAG_HYBRID_WEIGHT'] = '0.8'

      try {
        createVectorStore(makeConfig({ dbPath: '/data/my-db', vectordbBackend: 'postgresql' }))

        expect(mocks.PostgreSQLVectordb).toHaveBeenCalledOnce()
        expect(mocks.PostgreSQLVectordb).toHaveBeenCalledWith({
          backend: 'postgresql',
          tableName: 'chunks',
          embeddingDimension: 768,
          ivfLists: 200,
          hybridWeight: 0.8,
          useHNSWIndex: false,
          useHalfvecIndex: false,
          pgConfig: {
            host: 'pg.example.com',
            port: 5433,
            database: 'mydb',
            user: 'pguser',
            password: 'pgpass',
            sslMode: 'prefer',
            maxPoolSize: 30,
            minPoolSize: 5,
            schema: 'myschema',
          },
        })
      } finally {
        delete process.env['PG_HOST']
        delete process.env['PG_PORT']
        delete process.env['PG_DATABASE']
        delete process.env['PG_USER']
        delete process.env['PG_PASSWORD']
        delete process.env['PG_SSL_MODE']
        delete process.env['PG_MAX_POOL_SIZE']
        delete process.env['PG_MIN_POOL_SIZE']
        delete process.env['PG_SCHEMA']
        delete process.env['EMBEDDING_SIZE']
        delete process.env['RAG_IVF_LISTS']
        delete process.env['RAG_HYBRID_WEIGHT']
      }
    })

    it('should use transformer default dimension (384) when embeddingBackend is transformers', () => {
      delete process.env['RAG_LLAMA_CPP_DIMENSIONS']
      delete process.env['EMBEDDING_SIZE']

      process.env['PG_HOST'] = 'pg.example.com'
      process.env['PG_PORT'] = '5432'
      process.env['PG_DATABASE'] = 'mydb'
      process.env['PG_USER'] = 'pguser'
      process.env['PG_PASSWORD'] = 'pgpass'
      process.env['PG_SSL_MODE'] = 'disable'
      process.env['PG_MAX_POOL_SIZE'] = '20'
      process.env['PG_MIN_POOL_SIZE'] = '0'
      process.env['PG_SCHEMA'] = 'public'
      process.env['RAG_IVF_LISTS'] = '100'
      process.env['RAG_HYBRID_WEIGHT'] = '0.6'

      try {
        createVectorStore(
          makeConfig({
            dbPath: '/data/my-db',
            vectordbBackend: 'postgresql',
            embeddingBackend: 'transformers',
          })
        )

        expect(mocks.PostgreSQLVectordb).toHaveBeenCalledOnce()
        expect(mocks.PostgreSQLVectordb).toHaveBeenCalledWith(
          expect.objectContaining({ embeddingDimension: 384 })
        )
      } finally {
        delete process.env['PG_HOST']
        delete process.env['PG_PORT']
        delete process.env['PG_DATABASE']
        delete process.env['PG_USER']
        delete process.env['PG_PASSWORD']
        delete process.env['PG_SSL_MODE']
        delete process.env['PG_MAX_POOL_SIZE']
        delete process.env['PG_MIN_POOL_SIZE']
        delete process.env['PG_SCHEMA']
        delete process.env['RAG_IVF_LISTS']
        delete process.env['RAG_HYBRID_WEIGHT']
      }
    })

    it('should use llama-cpp default dimension (4096) when embeddingBackend is llama-cpp', () => {
      delete process.env['RAG_LLAMA_CPP_DIMENSIONS']
      delete process.env['EMBEDDING_SIZE']

      process.env['PG_HOST'] = 'pg.example.com'
      process.env['PG_PORT'] = '5432'
      process.env['PG_DATABASE'] = 'mydb'
      process.env['PG_USER'] = 'pguser'
      process.env['PG_PASSWORD'] = 'pgpass'
      process.env['PG_SSL_MODE'] = 'disable'
      process.env['PG_MAX_POOL_SIZE'] = '20'
      process.env['PG_MIN_POOL_SIZE'] = '0'
      process.env['PG_SCHEMA'] = 'public'
      process.env['RAG_IVF_LISTS'] = '100'
      process.env['RAG_HYBRID_WEIGHT'] = '0.6'

      try {
        createVectorStore(
          makeConfig({
            dbPath: '/data/my-db',
            vectordbBackend: 'postgresql',
            embeddingBackend: 'llama-cpp',
          })
        )

        expect(mocks.PostgreSQLVectordb).toHaveBeenCalledOnce()
        expect(mocks.PostgreSQLVectordb).toHaveBeenCalledWith(
          expect.objectContaining({ embeddingDimension: 4096 })
        )
      } finally {
        delete process.env['PG_HOST']
        delete process.env['PG_PORT']
        delete process.env['PG_DATABASE']
        delete process.env['PG_USER']
        delete process.env['PG_PASSWORD']
        delete process.env['PG_SSL_MODE']
        delete process.env['PG_MAX_POOL_SIZE']
        delete process.env['PG_MIN_POOL_SIZE']
        delete process.env['PG_SCHEMA']
        delete process.env['RAG_IVF_LISTS']
        delete process.env['RAG_HYBRID_WEIGHT']
      }
    })

    it('should fall back to LanceDB when PostgreSQL backend is selected but required PG_* env vars are missing', () => {
      delete process.env['PG_HOST']
      delete process.env['PG_DATABASE']
      delete process.env['PG_USER']
      delete process.env['PG_PASSWORD']

      createVectorStore(
        makeConfig({
          dbPath: '/data/my-db',
          vectordbBackend: 'postgresql',
        })
      )

      expect(mocks.PostgreSQLVectordb).not.toHaveBeenCalled()
      expect(mocks.VectorStore).toHaveBeenCalledOnce()
      expect(mocks.VectorStore).toHaveBeenCalledWith({
        backend: 'lancedb',
        dbPath: '/data/my-db',
        tableName: 'chunks',
      })
    })

    it('should prefer EMBEDDING_SIZE over RAG_LLAMA_CPP_DIMENSIONS for llama-cpp', () => {
      process.env['RAG_LLAMA_CPP_DIMENSIONS'] = '2048'
      process.env['EMBEDDING_SIZE'] = '384'

      process.env['PG_HOST'] = 'pg.example.com'
      process.env['PG_PORT'] = '5432'
      process.env['PG_DATABASE'] = 'mydb'
      process.env['PG_USER'] = 'pguser'
      process.env['PG_PASSWORD'] = 'pgpass'
      process.env['PG_SSL_MODE'] = 'disable'
      process.env['PG_MAX_POOL_SIZE'] = '20'
      process.env['PG_MIN_POOL_SIZE'] = '0'
      process.env['PG_SCHEMA'] = 'public'
      process.env['RAG_IVF_LISTS'] = '100'
      process.env['RAG_HYBRID_WEIGHT'] = '0.6'

      try {
        createVectorStore(
          makeConfig({
            dbPath: '/data/my-db',
            vectordbBackend: 'postgresql',
            embeddingBackend: 'llama-cpp',
          })
        )

        expect(mocks.PostgreSQLVectordb).toHaveBeenCalledOnce()
        expect(mocks.PostgreSQLVectordb).toHaveBeenCalledWith(
          expect.objectContaining({ embeddingDimension: 384 })
        )
      } finally {
        delete process.env['RAG_LLAMA_CPP_DIMENSIONS']
        delete process.env['EMBEDDING_SIZE']
        delete process.env['PG_HOST']
        delete process.env['PG_PORT']
        delete process.env['PG_DATABASE']
        delete process.env['PG_USER']
        delete process.env['PG_PASSWORD']
        delete process.env['PG_SSL_MODE']
        delete process.env['PG_MAX_POOL_SIZE']
        delete process.env['PG_MIN_POOL_SIZE']
        delete process.env['PG_SCHEMA']
        delete process.env['RAG_IVF_LISTS']
        delete process.env['RAG_HYBRID_WEIGHT']
      }
    })

    it('should fall back to EMBEDDING_SIZE when RAG_LLAMA_CPP_DIMENSIONS is invalid for llama-cpp', () => {
      process.env['RAG_LLAMA_CPP_DIMENSIONS'] = 'invalid'
      process.env['EMBEDDING_SIZE'] = '768'

      process.env['PG_HOST'] = 'pg.example.com'
      process.env['PG_PORT'] = '5432'
      process.env['PG_DATABASE'] = 'mydb'
      process.env['PG_USER'] = 'pguser'
      process.env['PG_PASSWORD'] = 'pgpass'
      process.env['PG_SSL_MODE'] = 'disable'
      process.env['PG_MAX_POOL_SIZE'] = '20'
      process.env['PG_MIN_POOL_SIZE'] = '0'
      process.env['PG_SCHEMA'] = 'public'
      process.env['RAG_IVF_LISTS'] = '100'
      process.env['RAG_HYBRID_WEIGHT'] = '0.6'

      try {
        createVectorStore(
          makeConfig({
            dbPath: '/data/my-db',
            vectordbBackend: 'postgresql',
            embeddingBackend: 'llama-cpp',
          })
        )

        expect(mocks.PostgreSQLVectordb).toHaveBeenCalledOnce()
        expect(mocks.PostgreSQLVectordb).toHaveBeenCalledWith(
          expect.objectContaining({ embeddingDimension: 768 })
        )
      } finally {
        delete process.env['RAG_LLAMA_CPP_DIMENSIONS']
        delete process.env['EMBEDDING_SIZE']
        delete process.env['PG_HOST']
        delete process.env['PG_PORT']
        delete process.env['PG_DATABASE']
        delete process.env['PG_USER']
        delete process.env['PG_PASSWORD']
        delete process.env['PG_SSL_MODE']
        delete process.env['PG_MAX_POOL_SIZE']
        delete process.env['PG_MIN_POOL_SIZE']
        delete process.env['PG_SCHEMA']
        delete process.env['RAG_IVF_LISTS']
        delete process.env['RAG_HYBRID_WEIGHT']
      }
    })
  })

  describe('formatCliError', () => {
    it('renders the full cause chain with stacks for a nested error', () => {
      // Build a deterministic 3-link chain: outer → mid → root.
      const root = new Error('root disk failure')
      const mid = new Error('vector store write failed', { cause: root })
      const outer = new Error('Failed to ingest file', { cause: mid })

      const rendered = formatCliError(outer)

      // Every link's message appears.
      expect(rendered).toContain('Failed to ingest file')
      expect(rendered).toContain('vector store write failed')
      expect(rendered).toContain('root disk failure')
      // Deeper links are attributed as causes; the outer link is not.
      expect(rendered).toContain('Caused by: ')
      expect(rendered.indexOf('Caused by: ')).toBeGreaterThan(
        rendered.indexOf('Failed to ingest file')
      )
      // The chain is ordered outer → cause → cause.
      expect(rendered.indexOf('Failed to ingest file')).toBeLessThan(
        rendered.indexOf('vector store write failed')
      )
      expect(rendered.indexOf('vector store write failed')).toBeLessThan(
        rendered.indexOf('root disk failure')
      )
      // Stack frames are included for diagnostics (operator-facing).
      expect(rendered).toContain('at ')
    })

    it('renders message and stack for a single Error without a cause', () => {
      const err = new Error('lonely failure')

      const rendered = formatCliError(err)

      expect(rendered).toContain('lonely failure')
      expect(rendered).not.toContain('Caused by: ')
      expect(rendered).toContain('at ')
    })

    it('stringifies a non-Error thrown value', () => {
      const rendered = formatCliError('plain string failure')

      expect(rendered).toContain('plain string failure')
      expect(rendered).not.toContain('Caused by: ')
    })
  })

  describe('createEmbedder', () => {
    const originalDevice = process.env['RAG_DEVICE']
    const originalDtype = process.env['RAG_DTYPE']

    afterEach(() => {
      mocks.Embedder.mockReset()
      if (originalDevice === undefined) {
        delete process.env['RAG_DEVICE']
      } else {
        process.env['RAG_DEVICE'] = originalDevice
      }
      if (originalDtype === undefined) {
        delete process.env['RAG_DTYPE']
      } else {
        process.env['RAG_DTYPE'] = originalDtype
      }
    })

    it('defaults device to cpu when RAG_DEVICE is unset', () => {
      delete process.env['RAG_DEVICE']

      createEmbedder(makeConfig({ modelName: 'custom/model', cacheDir: '/custom/cache' }))

      expect(mocks.Embedder).toHaveBeenCalledOnce()
      expect(mocks.Embedder).toHaveBeenCalledWith({
        modelPath: 'custom/model',
        batchSize: 16,
        cacheDir: '/custom/cache',
        device: 'cpu',
      })
    })

    it('passes RAG_DEVICE through to the Embedder', () => {
      process.env['RAG_DEVICE'] = 'webgpu'

      createEmbedder(makeConfig({ modelName: 'custom/model', cacheDir: '/custom/cache' }))

      expect(mocks.Embedder).toHaveBeenCalledWith(expect.objectContaining({ device: 'webgpu' }))
    })

    it('omits dtype from the Embedder config when RAG_DTYPE is unset', () => {
      delete process.env['RAG_DTYPE']

      createEmbedder(makeConfig({ modelName: 'custom/model', cacheDir: '/custom/cache' }))

      expect(mocks.Embedder).toHaveBeenCalledOnce()
      const passedConfig = mocks.Embedder.mock.calls[0]?.[0]
      expect(passedConfig).not.toHaveProperty('dtype')
    })

    it('passes RAG_DTYPE through to the Embedder when set', () => {
      process.env['RAG_DTYPE'] = 'q8'

      createEmbedder(makeConfig({ modelName: 'custom/model', cacheDir: '/custom/cache' }))

      expect(mocks.Embedder).toHaveBeenCalledWith(expect.objectContaining({ dtype: 'q8' }))
    })

    it('omits dtype when RAG_DTYPE is whitespace-only', () => {
      process.env['RAG_DTYPE'] = '   '

      createEmbedder(makeConfig({ modelName: 'custom/model', cacheDir: '/custom/cache' }))

      const passedConfig = mocks.Embedder.mock.calls[0]?.[0]
      expect(passedConfig).not.toHaveProperty('dtype')
    })
  })
})
