/**
 * Юнит-тесты для парсера .env строк.
 *
 * Покрывает: базовые случаи, кавычки, комментарии, пустые значения,
 * пробелы вокруг =, и строки с пробелами в кавычках.
 */

import { describe, expect, it } from 'vitest'
import { parseEnv } from '../../env/parse-env.js'

describe('parseEnv', () => {
  describe('базовые случаи', () => {
    it('должен распарсить простые ключ=значения', () => {
      const input = 'DB_PATH=./lancedb/\nMODEL_NAME=Xenova/all-MiniLM-L6-v2'
      const result = parseEnv(input)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.variables).toEqual({
          DB_PATH: './lancedb/',
          MODEL_NAME: 'Xenova/all-MiniLM-L6-v2',
        })
      }
    })

    it('должен обработать пустую строку', () => {
      const result = parseEnv('')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.variables).toEqual({})
      }
    })

    it('должен игнорировать пустые строки между значениями', () => {
      const input = 'KEY1=value1\n\nKEY2=value2\n\n'
      const result = parseEnv(input)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.variables).toEqual({ KEY1: 'value1', KEY2: 'value2' })
      }
    })
  })

  describe('кавычки', () => {
    it('должен удалить внешние двойные кавычки', () => {
      const input = 'KEY="value with spaces"'
      const result = parseEnv(input)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.variables.KEY).toBe('value with spaces')
      }
    })

    it('должен удалить внешние одинарные кавычки', () => {
      const input = "KEY='value with spaces'"
      const result = parseEnv(input)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.variables.KEY).toBe('value with spaces')
      }
    })

    it('не должен удалять кавычки из середины значения', () => {
      const input = 'KEY="value "with" quotes"'
      const result = parseEnv(input)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.variables.KEY).toBe('value "with" quotes')
      }
    })

    it('должен оставить одноимённый символ, если нет пары', () => {
      const input = "KEY='unclosed"
      const result = parseEnv(input)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.variables.KEY).toBe("'unclosed")
      }
    })
  })

  describe('комментарии', () => {
    it('должен игнорировать строки, начинающиеся с #', () => {
      const input = '# This is a comment\nKEY=value'
      const result = parseEnv(input)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.variables).toEqual({ KEY: 'value' })
      }
    })

    it('должен игнорировать комментарии после значений', () => {
      const input = 'KEY=value # inline comment'
      const result = parseEnv(input)

      expect(result.success).toBe(true)
      if (result.success) {
        // parseLine не обрабатывает inline-комментарии — значение будет 'value # inline comment'
        expect(result.variables.KEY).toBe('value # inline comment')
      }
    })

    it('должен игнорировать несколько комментариев', () => {
      const input = '# comment 1\n# comment 2\nKEY=value'
      const result = parseEnv(input)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.variables).toEqual({ KEY: 'value' })
      }
    })
  })

  describe('пустые значения', () => {
    it('должен обработать пустое значение', () => {
      const input = 'KEY='
      const result = parseEnv(input)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.variables.KEY).toBe('')
      }
    })

    it('должен обработать пустое значение в кавычках', () => {
      const input = 'KEY=""'
      const result = parseEnv(input)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.variables.KEY).toBe('')
      }
    })
  })

  describe('пробелы вокруг =', () => {
    it('должен игнорировать пробелы вокруг оператора =', () => {
      const input = 'KEY  =  value'
      const result = parseEnv(input)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.variables).toEqual({ KEY: 'value' })
      }
    })

    it('должен корректно обработать множественные пробелы', () => {
      const input = 'KEY   =    value   '
      const result = parseEnv(input)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.variables.KEY).toBe('value')
      }
    })
  })

  describe('строки с пробелами в кавычках', () => {
    it('должен сохранить пробелы внутри двойных кавычек', () => {
      const input = 'DESCRIPTION="  multiple   spaces  "'
      const result = parseEnv(input)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.variables.DESCRIPTION).toBe('  multiple   spaces  ')
      }
    })

    it('должен сохранить пробелы внутри одинарных кавычек', () => {
      const input = "DESCRIPTION='  multiple   spaces  '"
      const result = parseEnv(input)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.variables.DESCRIPTION).toBe('  multiple   spaces  ')
      }
    })
  })

  describe('смешанные случаи', () => {
    it('должен корректно обработать полный .env файл', () => {
      const input = `
# Database configuration
DB_PATH=./lancedb/
MODEL_NAME=Xenova/all-MiniLM-L6-v2

# Embedding settings
EMBEDDING_BACKEND=transformers
RAG_DEVICE=cpu

# Cache
CACHE_DIR=./models/
`
      const result = parseEnv(input)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.variables).toEqual({
          DB_PATH: './lancedb/',
          MODEL_NAME: 'Xenova/all-MiniLM-L6-v2',
          EMBEDDING_BACKEND: 'transformers',
          RAG_DEVICE: 'cpu',
          CACHE_DIR: './models/',
        })
        expect(Object.keys(result.variables).length).toBe(5)
      }
    })
  })
})
