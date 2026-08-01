/**
 * Тест для проверки лимита индексов в pgvector 0.7+
 * Оба индекса (IVFFlat и HNSW) поддерживают размерности <= 2000
 */

import { Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PostgreSQLVectordb } from '../postgresql.js'
import type { PostgreSQLVectorStoreConfig } from '../types.js'

describe('PostgreSQLVectordb HNSW limit (pgvector 0.7+)', () => {
  let pool: Pool | null = null

  beforeEach(() => {
    pool = new Pool({
      host: '192.168.88.221',
      port: 2661,
      database: 'REV',
      user: 'root',
      password: 'ckfdfrgcc',
      ssl: false,
    })
  })

  afterEach(async () => {
    if (pool) {
      await pool.end()
      pool = null
    }
  })

  it('должен упасть с ошибкой при попытке использовать размерность 2048', () => {
    const config: PostgreSQLVectorStoreConfig = {
      backend: 'postgresql',
      pgConfig: {
        host: '192.168.88.221',
        port: 2661,
        database: 'REV',
        user: 'root',
        password: 'ckfdfrgcc',
        sslMode: 'disable',
      },
      embeddingDimension: 2048,
      tableName: 'chunks',
      hybridWeight: 0.6,
    }

    expect(() => new PostgreSQLVectordb(config)).toThrow(
      /Embedding dimension 2048 exceeds PostgreSQL index limit of 2000/
    )
  })

  it('должен успешно инициализировать базу с размерностью 768 (IVFFlat)', async () => {
    const config: PostgreSQLVectorStoreConfig = {
      backend: 'postgresql',
      pgConfig: {
        host: '192.168.88.221',
        port: 2661,
        database: 'REV',
        user: 'root',
        password: 'ckfdfrgcc',
        sslMode: 'disable',
      },
      embeddingDimension: 768,
      tableName: 'chunks',
      ivfLists: 100,
      hybridWeight: 0.6,
    }

    const db = new PostgreSQLVectordb(config)
    await expect(db.initialize()).resolves.not.toThrow()
    await db.insertChunks([
      {
        id: '00000000-0000-0000-0000-000000000001',
        filePath: '/test.txt',
        chunkIndex: 0,
        text: 'Test chunk',
        vector: Array(768).fill(0.5),
        metadata: { fileName: 'test.txt', fileSize: 100, fileType: 'txt' },
        fileTitle: null,
        timestamp: new Date().toISOString(),
      },
    ])
    await db.deleteChunks('/test.txt')
  })

  it('должен автоматически использовать IVFFlat для размерности <= 2000', async () => {
    const config: PostgreSQLVectorStoreConfig = {
      backend: 'postgresql',
      pgConfig: {
        host: '192.168.88.221',
        port: 2661,
        database: 'REV',
        user: 'root',
        password: 'ckfdfrgcc',
        sslMode: 'disable',
      },
      embeddingDimension: 768,
      tableName: 'chunks',
      hybridWeight: 0.6,
    }

    const db = new PostgreSQLVectordb(config)
    expect(db['useHNSWIndex']).toBe(false)
    await expect(db.initialize()).resolves.not.toThrow()
  })

  it('должен упасть с ошибкой при размере 2001', () => {
    const config: PostgreSQLVectorStoreConfig = {
      backend: 'postgresql',
      pgConfig: {
        host: '192.168.88.221',
        port: 2661,
        database: 'REV',
        user: 'root',
        password: 'ckfdfrgcc',
        sslMode: 'disable',
      },
      embeddingDimension: 2001,
      tableName: 'chunks',
      hybridWeight: 0.6,
    }

    expect(() => new PostgreSQLVectordb(config)).toThrow(
      /Embedding dimension 2001 exceeds PostgreSQL index limit of 2000/
    )
  })

  it('должен успешно работать с размерностью 2000 (максимально допустимой)', async () => {
    const config: PostgreSQLVectorStoreConfig = {
      backend: 'postgresql',
      pgConfig: {
        host: '192.168.88.221',
        port: 2661,
        database: 'REV',
        user: 'root',
        password: 'ckfdfrgcc',
        sslMode: 'disable',
      },
      embeddingDimension: 2000,
      tableName: 'chunks',
      ivfLists: 100,
      hybridWeight: 0.6,
    }

    const db = new PostgreSQLVectordb(config)
    expect(db['useHNSWIndex']).toBe(false)
    await expect(db.initialize()).resolves.not.toThrow()
    await db.insertChunks([
      {
        id: '00000000-0000-0000-0000-000000000001',
        filePath: '/test.txt',
        chunkIndex: 0,
        text: 'Test chunk',
        vector: Array(2000).fill(0.5),
        metadata: { fileName: 'test.txt', fileSize: 100, fileType: 'txt' },
        fileTitle: null,
        timestamp: new Date().toISOString(),
      },
    ])
    await db.deleteChunks('/test.txt')
  })
})
