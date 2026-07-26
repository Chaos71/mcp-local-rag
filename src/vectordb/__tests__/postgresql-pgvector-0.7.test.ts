import { describe, expect, it } from 'vitest'
import { buildSchemaSQL } from '../postgresql.js'

describe('PostgreSQLVectordb — pgvector 0.7+ compatibility', () => {
  it('should use simplified pgvector 0.7+ syntax for ivfflat index', () => {
    const sql = buildSchemaSQL({
      pgConfig: {
        host: 'localhost',
        port: 5432,
        database: 'test',
        user: 'test',
        password: 'test',
        sslMode: 'disable',
      },
      embeddingDimension: 384,
      ivfLists: 100,
    })

    const ivfflatIndex = sql.find((s) => s.includes('USING ivfflat'))
    expect(ivfflatIndex).toBeDefined()
    // pgvector 0.7+ uses simplified syntax without operator class
    expect(ivfflatIndex!).toContain('USING ivfflat (embedding)')
    expect(ivfflatIndex!).not.toContain('vector_cosine_ops')
  })

  it('should use gist_trgm_ops for pg_trgm index (PostgreSQL 15+ compatibility)', () => {
    const sql = buildSchemaSQL({
      pgConfig: {
        host: 'localhost',
        port: 5432,
        database: 'test',
        user: 'test',
        password: 'test',
        sslMode: 'disable',
      },
      embeddingDimension: 384,
      ivfLists: 100,
    })

    const pgtrgmIndex = sql.find((s) => s.includes('gist_trgm_ops'))
    expect(pgtrgmIndex).toBeDefined()
    // PostgreSQL 15+ uses gist_trgm_ops instead of gin_trgm_ops
    expect(pgtrgmIndex!).toContain('USING gist (text gist_trgm_ops)')
    expect(pgtrgmIndex!).not.toContain('gin_trgm_ops')
  })

  it('should use unqualified table names for indexes (search_path compatibility)', () => {
    const sql = buildSchemaSQL({
      pgConfig: {
        host: 'localhost',
        port: 5432,
        database: 'test',
        user: 'test',
        password: 'test',
        sslMode: 'disable',
        schema: 'my_schema',
      },
      embeddingDimension: 384,
      ivfLists: 100,
    })

    // Indexes should use unqualified table names
    const indexes = sql.filter((s) => s.includes('CREATE INDEX'))
    for (const index of indexes) {
      // Indexes should use unqualified table names (e.g., ON chunks, not ON RAG.chunks)
      // file_path index doesn't use USING clause, so we check for ON chunks
      expect(index).toMatch(/ON chunks\b/)
    }
  })

  it('should use qualified names for tables in schema', () => {
    const sql = buildSchemaSQL({
      pgConfig: {
        host: 'localhost',
        port: 5432,
        database: 'test',
        user: 'test',
        password: 'test',
        sslMode: 'disable',
        schema: 'my_schema',
      },
      embeddingDimension: 384,
      ivfLists: 100,
    })

    // Tables should use qualified names (e.g., RAG.chunks)
    const tables = sql.filter((s) => s.includes('CREATE TABLE'))
    for (const table of tables) {
      expect(table).toMatch(/CREATE TABLE IF NOT EXISTS my_schema\./)
    }
  })
})
