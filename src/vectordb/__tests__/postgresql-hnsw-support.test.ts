// Тесты для поддержки HNSW индекса PostgreSQL для размерностей > 2000

import { describe, expect, it } from 'vitest'
import { buildSchemaSQL, PostgreSQLVectordb } from '../postgresql.js'

describe('PostgreSQLVectordb — HNSW индекс для размерностей > 2000', () => {
  describe('buildSchemaSQL', () => {
    it('должен создавать IVFFlat индекс для размерности <= 2000', () => {
      const config = {
        backend: 'postgresql' as const,
        pgConfig: {
          host: 'localhost',
          port: 5432,
          database: 'test',
          user: 'test',
          password: 'test',
          sslMode: 'disable',
          maxPoolSize: 20,
          minPoolSize: 0,
          schema: 'public',
        },
        embeddingDimension: 384,
      }

      const schemaSQL = buildSchemaSQL(config)

      // Должен содержать IVFFlat индекс
      const createIndexSQL = schemaSQL.find((sql) => sql.includes('_embedding_idx'))
      expect(createIndexSQL).toBeDefined()
      expect(createIndexSQL).toContain('ivfflat')
      expect(createIndexSQL).not.toContain('hnsw')
    })

    it('должен создавать HNSW индекс для размерности > 2000', () => {
      const config = {
        backend: 'postgresql' as const,
        pgConfig: {
          host: 'localhost',
          port: 5432,
          database: 'test',
          user: 'test',
          password: 'test',
          sslMode: 'disable',
          maxPoolSize: 20,
          minPoolSize: 0,
          schema: 'public',
        },
        embeddingDimension: 4096,
      }

      const schemaSQL = buildSchemaSQL(config)

      // Должен содержать HNSW индекс
      const createIndexSQL = schemaSQL.find((sql) => sql.includes('_embedding_idx'))
      expect(createIndexSQL).toBeDefined()
      expect(createIndexSQL).toContain('hnsw')
      expect(createIndexSQL).not.toContain('ivfflat')
    })

    it('должен создавать HNSW индекс для размерности 2001', () => {
      const config = {
        backend: 'postgresql' as const,
        pgConfig: {
          host: 'localhost',
          port: 5432,
          database: 'test',
          user: 'test',
          password: 'test',
          sslMode: 'disable',
          maxPoolSize: 20,
          minPoolSize: 0,
          schema: 'public',
        },
        embeddingDimension: 2001,
      }

      const schemaSQL = buildSchemaSQL(config)

      // Должен содержать HNSW индекс
      const createIndexSQL = schemaSQL.find((sql) => sql.includes('_embedding_idx'))
      expect(createIndexSQL).toBeDefined()
      expect(createIndexSQL).toContain('hnsw')
      expect(createIndexSQL).not.toContain('ivfflat')
    })

    it('должен использовать explicit useHNSWIndex=true', () => {
      const config = {
        backend: 'postgresql' as const,
        pgConfig: {
          host: 'localhost',
          port: 5432,
          database: 'test',
          user: 'test',
          password: 'test',
          sslMode: 'disable',
          maxPoolSize: 20,
          minPoolSize: 0,
          schema: 'public',
        },
        embeddingDimension: 384,
        useHNSWIndex: true,
      }

      const schemaSQL = buildSchemaSQL(config)

      // Должен содержать HNSW индекс
      const createIndexSQL = schemaSQL.find((sql) => sql.includes('_embedding_idx'))
      expect(createIndexSQL).toBeDefined()
      expect(createIndexSQL).toContain('hnsw')
      expect(createIndexSQL).not.toContain('ivfflat')
    })

    it('должен использовать explicit useHNSWIndex=false', () => {
      const config = {
        backend: 'postgresql' as const,
        pgConfig: {
          host: 'localhost',
          port: 5432,
          database: 'test',
          user: 'test',
          password: 'test',
          sslMode: 'disable',
          maxPoolSize: 20,
          minPoolSize: 0,
          schema: 'public',
        },
        embeddingDimension: 4096,
        useHNSWIndex: false,
      }

      const schemaSQL = buildSchemaSQL(config)

      // Должен содержать IVFFlat индекс
      const createIndexSQL = schemaSQL.find((sql) => sql.includes('_embedding_idx'))
      expect(createIndexSQL).toBeDefined()
      expect(createIndexSQL).toContain('ivfflat')
      expect(createIndexSQL).not.toContain('hnsw')
    })
  })

  describe('PostgreSQLVectordb конструктор', () => {
    it('должен вычислять useHNSWIndex=true для размерности > 2000', () => {
      const config = {
        backend: 'postgresql' as const,
        pgConfig: {
          host: 'localhost',
          port: 5432,
          database: 'test',
          user: 'test',
          password: 'test',
          sslMode: 'disable',
          maxPoolSize: 20,
          minPoolSize: 0,
          schema: 'public',
        },
        embeddingDimension: 4096,
      }

      const db = new PostgreSQLVectordb(config)

      expect(db['useHNSWIndex']).toBe(true)
    })

    it('должен вычислять useHNSWIndex=false для размерности <= 2000', () => {
      const config = {
        backend: 'postgresql' as const,
        pgConfig: {
          host: 'localhost',
          port: 5432,
          database: 'test',
          user: 'test',
          password: 'test',
          sslMode: 'disable',
          maxPoolSize: 20,
          minPoolSize: 0,
          schema: 'public',
        },
        embeddingDimension: 384,
      }

      const db = new PostgreSQLVectordb(config)

      expect(db['useHNSWIndex']).toBe(false)
    })

    it('должен использовать explicit useHNSWIndex', () => {
      const config = {
        backend: 'postgresql' as const,
        pgConfig: {
          host: 'localhost',
          port: 5432,
          database: 'test',
          user: 'test',
          password: 'test',
          sslMode: 'disable',
          maxPoolSize: 20,
          minPoolSize: 0,
          schema: 'public',
        },
        embeddingDimension: 384,
        useHNSWIndex: true,
      }

      const db = new PostgreSQLVectordb(config)

      expect(db['useHNSWIndex']).toBe(true)
    })
  })
})
