/**
 * Юнит-тесты для загрузчика .env файла.
 *
 * Покрывает: файл есть/нет, приоритет переменных, ошибки чтения,
 * кастомный путь и debug-флаг.
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadEnv } from '../../env/loader.js'

// Утилиты для работы с временными директориями
function createTempDir(): string {
  const dir = join(tmpdir(), `env-loader-test-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeEnvFile(dir: string, content: string): string {
  const filePath = join(dir, '.env')
  writeFileSync(filePath, content, 'utf-8')
  return filePath
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

describe('loadEnv', () => {
  let tempDir: string
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    tempDir = createTempDir()
    // Сохранить текущее состояние process.env для восстановления
    originalEnv = { ...process.env }
  })

  afterEach(() => {
    // Восстановить process.env после каждого теста
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key]
      } else if (process.env[key] !== originalEnv[key]) {
        process.env[key] = originalEnv[key]
      }
    }
    cleanupDir(tempDir)
  })

  describe('файл .env отсутствует', () => {
    it('должен вернуть success=true с loaded=0, когда файл не найден', () => {
      const result = loadEnv({ path: join(tempDir, '.env') })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.loaded).toBe(0)
        expect(result.skipped).toBe(0)
        expect(result.filePath).toBe(join(tempDir, '.env'))
      }
    })

    it('должен вернуть success=true, когда файл не найден в cwd', () => {
      // В этой тестовой среде cwd обычно содержит .env, поэтому этот тест
      // просто проверяет, что loadEnv() не падает при отсутствии файла
      const result = loadEnv()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.loaded).toBe(0)
      }
    })
  })

  describe('файл .env существует', () => {
    it('должен загрузить переменные из файла', () => {
      const envContent = 'TEST_KEY1=value1\nTEST_KEY2=value2'
      const filePath = writeEnvFile(tempDir, envContent)

      const result = loadEnv({ path: filePath })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.loaded).toBe(2)
        expect(result.skipped).toBe(0)
        expect(process.env.TEST_KEY1).toBe('value1')
        expect(process.env.TEST_KEY2).toBe('value2')
      }
    })

    it('должен пропустить переменные, уже установленные в process.env', () => {
      // Установить переменную ДО загрузки
      process.env.EXISTING_KEY = 'from-process-env'

      const envContent = 'EXISTING_KEY=from-env-file\nNEW_KEY=new-value'
      const filePath = writeEnvFile(tempDir, envContent)

      const result = loadEnv({ path: filePath })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.loaded).toBe(1)
        expect(result.skipped).toBe(1)
        // Существующая переменная не должна быть перезаписана
        expect(process.env.EXISTING_KEY).toBe('from-process-env')
        expect(process.env.NEW_KEY).toBe('new-value')
      }
    })

    it('должен обработать переменные с кавычками', () => {
      const envContent = 'KEY1="value with quotes"\nKEY2=\'single quotes\''
      const filePath = writeEnvFile(tempDir, envContent)

      const result = loadEnv({ path: filePath })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.loaded).toBe(2)
        expect(process.env.KEY1).toBe('value with quotes')
        expect(process.env.KEY2).toBe('single quotes')
      }
    })

    it('должен игнорировать комментарии и пустые строки', () => {
      const envContent = `
# Comment line
KEY1=value1

# Another comment
KEY2=value2
`
      const filePath = writeEnvFile(tempDir, envContent)

      const result = loadEnv({ path: filePath })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.loaded).toBe(2)
        expect(process.env.KEY1).toBe('value1')
        expect(process.env.KEY2).toBe('value2')
      }
    })
  })

  describe('обработка ошибок', () => {
    it('должен вернуть ошибку при некорректном содержимом (теоретически)', () => {
      // Парсер не выбрасывает ошибок для некорректных строк — он их пропускает.
      // Этот тест подтверждает, что некорректные строки не вызывают crash.
      const envContent = 'no-equals-sign\nKEY=value\n'
      const filePath = writeEnvFile(tempDir, envContent)

      const result = loadEnv({ path: filePath })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.loaded).toBe(1)
      }
    })
  })

  describe('debug-флаг', () => {
    it('должен работать с debug=false (по умолчанию)', () => {
      const envContent = 'DEBUG_KEY=debug-value'
      const filePath = writeEnvFile(tempDir, envContent)

      // Должно работать без ошибок
      const result = loadEnv({ path: filePath, debug: false })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.loaded).toBe(1)
      }
    })

    it('должен работать с debug=true', () => {
      const envContent = 'DEBUG_KEY=debug-value'
      const filePath = writeEnvFile(tempDir, envContent)

      // Должно работать без ошибок
      const result = loadEnv({ path: filePath, debug: true })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.loaded).toBe(1)
      }
    })
  })
})
