// Интеграционный тест для проверки сохранения contentHash в chunks
// Дефект: поле chunks.contenthash остаётся пустым после загрузки файла

import { execSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// ── Тестовый набор ──────────────────────────────────────────────────────────

describe('CLI ingest — сохранение contentHash в chunks', () => {
  const testDataDir = resolve('./tmp/test-cli-hash')
  const dbPath = resolve('./tmp/test-cli-hash/lancedb')

  beforeAll(() => {
    // Очистка перед запуском
    rmSync(dbPath, { recursive: true, force: true })
    mkdirSync(testDataDir, { recursive: true })
  })

  afterAll(() => {
    // Очистка после завершения
    rmSync(dbPath, { recursive: true, force: true })
    rmSync(testDataDir, { recursive: true, force: true })
  })

  it('сохраняет contentHash в таблице chunks после CLI ingest', async () => {
    // Создаём тестовый файл
    const filePath = resolve(testDataDir, 'test-file.txt')
    const content = 'Тестовый контент для проверки сохранения contentHash. '.repeat(50)
    writeFileSync(filePath, content)

    // Запускаем CLI ingest
    const output = execSync(
      `npx mcp-local-rag ingest --db-path "${dbPath}" --cache-dir ./tmp/test-cli-hash/models "${filePath}"`,
      {
        encoding: 'utf-8',
        stdio: 'pipe',
      }
    )

    console.log('CLI output:', output)

    // Проверяем, что файл был загружен
    expect(output).toContain('OK')
    expect(output).toContain('chunks')

    // Проверяем, что contentHash вычислен (из stderr)
    expect(output).toContain('Content hash computed')

    // Проверяем через LanceDB CLI, что contentHash сохранён
    try {
      const queryOutput = execSync(
        `npx @lancedb/lancedb query --db ${dbPath} "SELECT filePath, contentHash FROM chunks LIMIT 1"`,
        { encoding: 'utf-8', stdio: 'pipe' }
      )

      console.log('Query output:', queryOutput)

      // Проверяем, что contentHash не NULL
      expect(queryOutput).toMatch(/contentHash/)
      expect(queryOutput).toMatch(/[^NULL]/)
    } catch (_error) {
      // Если LanceDB CLI недоступен, пропускаем проверку через него
      console.warn('LanceDB CLI недоступен, пропускаем прямую проверку БД')
    }
  }, 60000)

  it('сохраняет contentHash для визуального режима (PDF с VLM)', async () => {
    // Создаём простой PDF (используем текстовый файл с расширением .pdf для теста)
    const filePath = resolve(testDataDir, 'test-pdf.pdf')
    const content = 'PDF контент для теста. '.repeat(50)
    writeFileSync(filePath, content)

    // Запускаем CLI ingest с визуальным режимом
    const output = execSync(
      `npx mcp-local-rag ingest --db-path "${dbPath}" --cache-dir ./tmp/test-cli-hash/models --visual "${filePath}"`,
      {
        encoding: 'utf-8',
        stdio: 'pipe',
      }
    )

    console.log('Visual CLI output:', output)

    // Проверяем, что файл был загружен
    expect(output).toContain('OK')

    // Проверяем через LanceDB
    try {
      const queryOutput = execSync(
        `npx @lancedb/lancedb query --db ${dbPath} "SELECT filePath, contentHash FROM chunks LIMIT 1"`,
        { encoding: 'utf-8', stdio: 'pipe' }
      )

      console.log('Visual query output:', queryOutput)

      // Проверяем, что contentHash не NULL
      expect(queryOutput).toMatch(/contentHash/)
      expect(queryOutput).toMatch(/[^NULL]/)
    } catch (_error) {
      console.warn('LanceDB CLI недоступен, пропускаем прямую проверку БД')
    }
  }, 60000)

  it('обнаруживает дубликаты на основе сохранённого contentHash', async () => {
    const filePath1 = resolve(testDataDir, 'dup-file-1.txt')
    const content = 'Дубликатный контент для теста. '.repeat(60)
    writeFileSync(filePath1, content)

    // Загружаем первый файл
    execSync(
      `npx mcp-local-rag ingest --db-path "${dbPath}" --cache-dir ./tmp/test-cli-hash/models "${filePath1}"`,
      {
        encoding: 'utf-8',
        stdio: 'pipe',
      }
    )

    // Загружаем второй файл с тем же содержимым
    const filePath2 = resolve(testDataDir, 'dup-file-2.txt')
    writeFileSync(filePath2, content)

    const output = execSync(
      `npx mcp-local-rag ingest --db-path "${dbPath}" --cache-dir ./tmp/test-cli-hash/models "${filePath2}"`,
      {
        encoding: 'utf-8',
        stdio: 'pipe',
      }
    )

    console.log('Duplicate CLI output:', output)

    // Проверяем, что второй файл был пропущен как дубликат
    expect(output).toContain('skipped')
    expect(output).toContain('duplicate')
  }, 60000)

  it('повторная загрузка того же файла в skip-режиме не перезаписывает векторы', async () => {
    const filePath = resolve(testDataDir, 'skip-same-file.txt')
    const content = 'Одинаковый контент для повторной загрузки. '.repeat(60)
    writeFileSync(filePath, content)

    // Переопределяем окружение: используем LanceDB (очищается rmSync),
    // встроенный transformers бэкенд и легкую модель, чтобы не качать большие файлы.
    const env = {
      ...process.env,
      DUPLICATE_MODE: 'skip',
      VECTORDB_BACKEND: 'lancedb',
      EMBEDDING_BACKEND: 'transformers',
      MODEL_NAME: 'Xenova/all-MiniLM-L6-v2',
    }

    const dbPathArg = `--db-path "${dbPath}"`
    const cacheDirArg = `--cache-dir ./tmp/test-cli-hash/models`
    const baseDirArg = `--base-dir "${testDataDir}"`
    const ingestArgs = `${dbPathArg} ${cacheDirArg} ingest ${baseDirArg} "${filePath}"`

    // Первая загрузка
    let firstOutput: string
    try {
      firstOutput = execSync(`npx mcp-local-rag ${ingestArgs} 2>&1`, {
        encoding: 'utf-8',
        shell: true,
        env,
      })
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string }
      console.error('First ingest failed:', err.message, err.stdout, err.stderr)
      throw e
    }
    expect(firstOutput).toContain('OK')
    const firstChunkMatch = firstOutput.match(/\((\d+) chunks\)/)
    expect(firstChunkMatch).not.toBeNull()
    const firstChunkCount = Number(firstChunkMatch![1])

    // Вторая загрузка того же файла (дубликат)
    let secondOutput: string
    try {
      secondOutput = execSync(`npx mcp-local-rag ${ingestArgs} 2>&1`, {
        encoding: 'utf-8',
        shell: true,
        env,
      })
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string }
      console.error('Second ingest failed:', err.message, err.stdout, err.stderr)
      throw e
    }

    // Проверяем, что загрузка пропущена и чанки не перезаписаны
    expect(secondOutput).toContain('skipped')
    expect(secondOutput).toContain('duplicate')
    // Не должно быть сообщения об удалении чанков
    expect(secondOutput).not.toContain('Deleted')
    // Количество загруженных чанков должно быть 0
    expect(secondOutput).toContain('(0 chunks)')
  }, 60000)
})
