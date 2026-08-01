// Регрессионный тест: contentHash и duplicates заполняются при insertChunks в PostgreSQL
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  let mockClient: any
  const mockPoolInstance = {
    connect: vi.fn(() => Promise.resolve(mockClient)),
    end: vi.fn(),
  }
  const mockPoolFn = vi.fn(function (this: any, config: any) {
    this.connect = mockPoolInstance.connect
    this.end = mockPoolInstance.end
    this.config = config
    return this
  })
  return {
    Pool: mockPoolFn,
    poolInstance: mockPoolInstance,
    setMockClient: (client: any) => {
      mockClient = client
    },
  }
})

vi.doMock('pg', () => ({
  Pool: mocks.Pool,
  types: {
    setTypeParser: vi.fn(),
  },
}))

let PostgreSQLVectordb: typeof import('../postgresql.js').PostgreSQLVectordb

describe('PostgreSQLVectordb — contentHash и duplicates', () => {
  beforeAll(async () => {
    const mod = await import('../postgresql.js')
    PostgreSQLVectordb = mod.PostgreSQLVectordb
  })

  beforeEach(() => {
    vi.clearAllMocks()
    const mockClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('pg_extension') && sql.includes('vector')) {
          return Promise.resolve({ rows: [{ extname: 'vector' }] })
        }
        if (sql.includes('CREATE SCHEMA')) {
          return Promise.resolve({ rows: [] })
        }
        if (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX')) {
          return Promise.resolve({ rows: [] })
        }
        if (sql.includes('INSERT INTO RAG.chunks')) {
          return Promise.resolve({ rows: [] })
        }
        if (sql.includes('INSERT INTO RAG.duplicates')) {
          return Promise.resolve({ rows: [] })
        }
        if (sql.includes('INSERT INTO RAG.files')) {
          return Promise.resolve({ rows: [] })
        }
        return Promise.resolve({ rows: [] })
      }),
      release: vi.fn(),
    }
    mocks.setMockClient(mockClient)
    mocks.poolInstance.end.mockResolvedValue(undefined)
  })

  afterAll(() => {
    vi.doUnmock('pg')
  })

  it('сохраняет contentHash в chunks и заполняет duplicates при insertChunks', async () => {
    const db = new PostgreSQLVectordb({
      backend: 'postgresql',
      pgConfig: {
        host: 'localhost',
        port: 5432,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
        sslMode: 'disable',
        schema: 'RAG',
      },
      embeddingDimension: 384,
    })

    await db.initialize()

    const chunks = [
      {
        id: 'chunk-1',
        filePath: '/docs/test.txt',
        chunkIndex: 0,
        text: 'test content',
        vector: new Array(384).fill(0.1),
        metadata: {
          fileName: 'test.txt',
          fileSize: 1234,
          fileType: 'txt',
        },
        fileTitle: 'Test',
        timestamp: new Date().toISOString(),
        contentHash: 'abcd1234'.padEnd(64, '0'),
      },
    ]

    await db.insertChunks(chunks)

    // Проверяем вызов INSERT для chunks
    const clientPromise = (mocks.poolInstance.connect as any).mock.results[0].value
    const client = await clientPromise
    const chunkInsertCalls = client.query.mock.calls.filter((call: string[]) =>
      call[0].includes('INSERT INTO RAG.chunks')
    )
    expect(chunkInsertCalls.length).toBe(1)
    const chunkParams = chunkInsertCalls[0][1]
    expect(chunkParams[8]).toBe('abcd1234'.padEnd(64, '0')) // contentHash
    expect(chunkParams[7]).toBe('active') // status

    // Проверяем вызов INSERT для duplicates
    const dupInsertCalls = client.query.mock.calls.filter((call: string[]) =>
      call[0].includes('INSERT INTO RAG.duplicates')
    )
    expect(dupInsertCalls.length).toBe(1)
    const dupSql = dupInsertCalls[0][0]
    expect(dupSql).toContain("VALUES ($1, $2, 'active')")
    const dupParams = dupInsertCalls[0][1]
    expect(dupParams[0]).toBe('abcd1234'.padEnd(64, '0')) // content_hash
    expect(dupParams[1]).toBe('/docs/test.txt') // file_path
  })

  it('не вставляет в duplicates при отсутствии contentHash', async () => {
    const db = new PostgreSQLVectordb({
      backend: 'postgresql',
      pgConfig: {
        host: 'localhost',
        port: 5432,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
        sslMode: 'disable',
        schema: 'RAG',
      },
      embeddingDimension: 384,
    })

    await db.initialize()

    const chunks = [
      {
        id: 'chunk-2',
        filePath: '/docs/no-hash.txt',
        chunkIndex: 0,
        text: 'no hash content',
        vector: new Array(384).fill(0.1),
        metadata: {
          fileName: 'no-hash.txt',
          fileSize: 500,
          fileType: 'txt',
        },
        fileTitle: 'No Hash',
        timestamp: new Date().toISOString(),
        contentHash: null,
      },
    ]

    await db.insertChunks(chunks)

    const clientPromise = (mocks.poolInstance.connect as any).mock.results[0].value
    const client = await clientPromise
    const dupInsertCalls = client.query.mock.calls.filter((call: string[]) =>
      call[0].includes('INSERT INTO RAG.duplicates')
    )
    expect(dupInsertCalls.length).toBe(0)
  })

  it('возвращает contentHash и status при чтении чанков через getChunksByFilePath', async () => {
    const db = new PostgreSQLVectordb({
      backend: 'postgresql',
      pgConfig: {
        host: 'localhost',
        port: 5432,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
        sslMode: 'disable',
        schema: 'RAG',
      },
      embeddingDimension: 384,
    })

    await db.initialize()

    db.pool = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('SELECT') && sql.includes('contentHash')) {
          return Promise.resolve({
            rows: [
              {
                id: 'chunk-1',
                file_path: '/docs/test.txt',
                chunk_index: '0',
                text: 'test content',
                embedding: '[0.1]',
                file_title: 'Test',
                timestamp: new Date().toISOString(),
                status: 'active',
                contentHash: 'abcd1234'.padEnd(64, '0'),
              },
            ],
          })
        }
        return Promise.resolve({ rows: [] })
      }),
      connect: vi.fn(() =>
        Promise.resolve({
          query: vi.fn(),
          release: vi.fn(),
        })
      ),
      end: vi.fn(),
    } as any

    const chunks = await db.getChunksByFilePath('/docs/test.txt')

    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.contentHash).toBe('abcd1234'.padEnd(64, '0'))
    expect(chunks[0]!.status).toBe('active')
  })
})
