/**
 * Загрузчик .env файла для mcp-local-rag.
 *
 * Автоматически ищет .env в текущей рабочей директории,
 * парсит его и загружает переменные в process.env.
 *
 * Приоритет: внешние переменные > .env (не перезаписываются)
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type ParseEnvOutput, parseEnv } from './parse-env.js'

export interface LoadEnvOptions {
  /**
   * Путь к .env файлу. По умолчанию — .env в текущей рабочей директории.
   */
  path?: string
  /**
   * Флаг отладочного логирования.
   * @default false
   */
  debug?: boolean
}

export interface LoadEnvResult {
  /** Загрузка прошла успешно */
  success: true
  /** Количество загруженных переменных */
  loaded: number
  /** Количество переменных, пропущенных из-за существующих значений */
  skipped: number
  /** Путь к загруженному файлу */
  filePath: string
}

export interface LoadEnvError {
  /** Загрузка завершилась ошибкой */
  success: false
  /** Сообщение об ошибке */
  error: string
  /** Путь к файлу, если он был найден */
  filePath?: string
}

export type LoadEnvOutput = LoadEnvResult | LoadEnvError

const DEFAULT_ENV_FILENAME = '.env'

/**
 * Загрузить переменные из .env файла в process.env.
 * Существующие переменные не перезаписываются.
 */
export function loadEnv(options: LoadEnvOptions = {}): LoadEnvOutput {
  const { path: customPath, debug = false } = options

  // Определить путь к .env файлу
  const filePath = customPath ?? join(process.cwd(), DEFAULT_ENV_FILENAME)

  // Проверить существование файла
  if (!existsSync(filePath)) {
    if (debug) {
      console.debug(`[env-loader] Файл .env не найден: ${filePath}`)
    }
    return { success: true, loaded: 0, skipped: 0, filePath }
  }

  // Прочитать файл
  let content: string
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch (cause) {
    return {
      success: false,
      error: `Не удалось прочитать файл .env: ${filePath} — ${String(cause)}`,
      filePath,
    }
  }

  // Распарсить содержимое
  const parsed: ParseEnvOutput = parseEnv(content)
  if (!parsed.success) {
    return {
      success: false,
      error: `Ошибка парсинга .env: ${parsed.error}`,
      filePath,
    }
  }

  // Загрузить переменные с приоритетом внешней среды
  let loaded = 0
  let skipped = 0

  for (const [key, value] of Object.entries(parsed.variables)) {
    if (process.env[key] === undefined) {
      process.env[key] = value as string
      loaded++
    } else {
      skipped++
    }
  }

  if (debug) {
    console.debug(`[env-loader] Загружено ${loaded} переменных, пропущено ${skipped}`)
  }

  return { success: true, loaded, skipped, filePath }
}
