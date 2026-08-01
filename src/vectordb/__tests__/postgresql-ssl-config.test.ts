// Tests for PostgreSQLVectordb SSL configuration fix
// Regression test for "The server does not support SSL connections" error when PG_SSL_MODE=disable
//
// Root cause: pg library (8.x) does NOT convert ssl: 'disable' (string) to false.
// The string 'disable' remains truthy, causing the library to attempt an SSL
// connection, which fails when the server doesn't support SSL.
//
// Fix: Use ssl: false (boolean) instead of ssl: 'disable' (string) when SSL should be disabled.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// ============================================
// Mock Setup (vi.hoisted for isolate: false)
// ============================================

const mocks = vi.hoisted(() => {
  // Track the client returned by connect()
  let mockClient: any

  const mockPoolInstance = {
    connect: vi.fn(() => Promise.resolve(mockClient)),
    end: vi.fn(),
  }

  // Pool mock must return the poolInstance when called with `new`
  const mockPoolFn = vi.fn(function (this: any, config: any) {
    this.connect = mockPoolInstance.connect
    this.end = mockPoolInstance.end
    this.config = config
    return this
  })

  // Helper to set up the mock client
  const setMockClient = (clientConfig: any) => {
    mockClient = clientConfig
  }

  return {
    Pool: mockPoolFn,
    poolInstance: mockPoolInstance,
    setMockClient,
  }
})

// Mock pg module — installed via vi.doMock in beforeAll
vi.doMock('pg', () => ({
  Pool: mocks.Pool,
  types: {
    setTypeParser: vi.fn(),
  },
}))

// ============================================
// Dynamic import after mocking
// ============================================

let PostgreSQLVectordb: typeof import('../postgresql.js').PostgreSQLVectordb

// ============================================
// Test Suite
// ============================================

describe('PostgreSQLVectordb SSL Configuration', () => {
  beforeAll(async () => {
    // Import after mocking
    const mod = await import('../postgresql.js')
    PostgreSQLVectordb = mod.PostgreSQLVectordb
  })

  beforeEach(() => {
    vi.clearAllMocks()
    // Set up mock client that passes pgvector extension check
    const mockClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('pg_extension') && sql.includes('vector')) {
          // pgvector extension exists
          return Promise.resolve({ rows: [{ extname: 'vector' }] })
        }
        // Schema creation queries
        return Promise.resolve({ rows: [] })
      }),
      release: vi.fn(),
    }
    mocks.setMockClient(mockClient)
    // Make end resolve successfully
    mocks.poolInstance.end.mockResolvedValue(undefined)
  })

  afterAll(() => {
    vi.doUnmock('pg')
  })

  describe('SSL mode handling', () => {
    it('should use boolean false when PG_SSL_MODE is "disable"', async () => {
      const db = new PostgreSQLVectordb({
        backend: 'postgresql',
        pgConfig: {
          host: 'localhost',
          port: 5432,
          database: 'testdb',
          user: 'testuser',
          password: 'testpass',
          sslMode: 'disable',
        },
      })

      await db.initialize()

      // Verify Pool was called with ssl: false (boolean), not 'disable' (string)
      // The pg library does NOT convert ssl: 'disable' (string) to false,
      // so we must use ssl: false (boolean) to prevent SSL connection attempts.
      expect(mocks.Pool).toHaveBeenCalledOnce()
      const poolConfig = mocks.Pool.mock.calls[0][0]
      expect(poolConfig.ssl).toBe(false)
    })

    it('should use boolean false when PG_SSL_MODE is not set (default)', async () => {
      const db = new PostgreSQLVectordb({
        backend: 'postgresql',
        pgConfig: {
          host: 'localhost',
          port: 5432,
          database: 'testdb',
          user: 'testuser',
          password: 'testpass',
          // sslMode not set — should default to 'disable', which becomes false (boolean)
        },
      })

      await db.initialize()

      const poolConfig = mocks.Pool.mock.calls[0][0]
      expect(poolConfig.ssl).toBe(false)
    })

    it('should use object with rejectUnauthorized when PG_SSL_MODE is "allow"', async () => {
      const db = new PostgreSQLVectordb({
        backend: 'postgresql',
        pgConfig: {
          host: 'localhost',
          port: 5432,
          database: 'testdb',
          user: 'testuser',
          password: 'testpass',
          sslMode: 'allow',
        },
      })

      await db.initialize()

      const poolConfig = mocks.Pool.mock.calls[0][0]
      expect(poolConfig.ssl).toEqual({ rejectUnauthorized: false })
    })

    it('should use object with rejectUnauthorized when PG_SSL_MODE is "prefer"', async () => {
      const db = new PostgreSQLVectordb({
        backend: 'postgresql',
        pgConfig: {
          host: 'localhost',
          port: 5432,
          database: 'testdb',
          user: 'testuser',
          password: 'testpass',
          sslMode: 'prefer',
        },
      })

      await db.initialize()

      const poolConfig = mocks.Pool.mock.calls[0][0]
      expect(poolConfig.ssl).toEqual({ rejectUnauthorized: false })
    })

    it('should use object with rejectUnauthorized=true when PG_SSL_MODE is "require"', async () => {
      const db = new PostgreSQLVectordb({
        backend: 'postgresql',
        pgConfig: {
          host: 'localhost',
          port: 5432,
          database: 'testdb',
          user: 'testuser',
          password: 'testpass',
          sslMode: 'require',
        },
      })

      await db.initialize()

      const poolConfig = mocks.Pool.mock.calls[0][0]
      expect(poolConfig.ssl).toEqual({ rejectUnauthorized: true })
    })

    it('should use object with rejectUnauthorized=false when PG_SSL_MODE is "verify-full"', async () => {
      const db = new PostgreSQLVectordb({
        backend: 'postgresql',
        pgConfig: {
          host: 'localhost',
          port: 5432,
          database: 'testdb',
          user: 'testuser',
          password: 'testpass',
          sslMode: 'verify-full',
        },
      })

      await db.initialize()

      const poolConfig = mocks.Pool.mock.calls[0][0]
      expect(poolConfig.ssl).toEqual({ rejectUnauthorized: false })
    })

    it('should use object with rejectUnauthorized=true when PG_SSL_MODE is "verify-ca"', async () => {
      const db = new PostgreSQLVectordb({
        backend: 'postgresql',
        pgConfig: {
          host: 'localhost',
          port: 5432,
          database: 'testdb',
          user: 'testuser',
          password: 'testpass',
          sslMode: 'verify-ca',
        },
      })

      await db.initialize()

      const poolConfig = mocks.Pool.mock.calls[0][0]
      expect(poolConfig.ssl).toEqual({ rejectUnauthorized: true })
    })
  })
})
