/**
 * Предупреждения о конфигурации для mcp-local-rag.
 *
 * Проверяет, какие рекомендуемые переменные окружения не установлены,
 * и выводит предупреждения при запуске.
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface RecommendedConfigOptions {
  /**
   * Путь к .env.example файлу. По умолчанию — .env.example в текущей директории.
   */
  examplePath?: string
  /**
   * Флаг отключения предупреждений.
   * Устанавливается через переменную окружения RAG_QUIET_CONFIG=1.
   * @default false
   */
  quiet?: boolean
}

export interface RecommendedConfigResult {
  /** Проверка завершена */
  completed: true
  /** Количество предупреждений */
  warnings: number
  /** Список отсутствующих переменных */
  missing: string[]
}

/**
 * Рекомендуемые переменные окружения из .env.example.
 * Включает только переменные, которые обычно требуют настройки.
 */
const RECOMMENDED_VARS = [
  'BASE_DIR',
  'DB_PATH',
  'CACHE_DIR',
  'MODEL_NAME',
  'EMBEDDING_BACKEND',
  'RAG_DEVICE',
]

/**
 * Проверить, установлена ли переменная в process.env.
 */
function isVarSet(key: string): boolean {
  return process.env[key] !== undefined && process.env[key] !== ''
}

/**
 * Проверить, есть ли .env в .gitignore.
 */
function isEnvInGitignore(gitignorePath: string): boolean {
  if (!existsSync(gitignorePath)) {
    return false
  }
  try {
    const content = readFileSync(gitignorePath, 'utf-8')
    // Ищем .env как отдельную строку (не .env.example, не .env.local и т.д.)
    const lines = content.split(/\r?\n/)
    return lines.some((line) => line.trim() === '.env')
  } catch {
    return false
  }
}

/**
 * Добавить .env в .gitignore, если его там нет.
 */
function ensureEnvInGitignore(gitignorePath: string): boolean {
  if (isEnvInGitignore(gitignorePath)) {
    return true
  }

  try {
    appendFileSync(gitignorePath, '\n.env\n', 'utf-8')
    return true
  } catch {
    return false
  }
}

/**
 * Проверить рекомендуемые переменные и вывести предупреждения.
 * Также автоматически добавляет .env в .gitignore при необходимости.
 */
export function checkRecommendedConfig(
  options: RecommendedConfigOptions = {}
): RecommendedConfigResult {
  const { quiet = false } = options

  // Проверить флаг отключения
  const envQuiet = process.env['RAG_QUIET_CONFIG'] === '1'
  if (quiet || envQuiet) {
    return { completed: true, warnings: 0, missing: [] }
  }

  // Проверить .gitignore
  const gitignorePath = join(process.cwd(), '.gitignore')
  const envAddedToGitignore = ensureEnvInGitignore(gitignorePath)
  if (envAddedToGitignore) {
    console.warn('[env-loader] .env добавлен в .gitignore')
  }

  // Собрать список отсутствующих переменных
  const missing: string[] = []
  for (const key of RECOMMENDED_VARS) {
    if (!isVarSet(key)) {
      missing.push(key)
    }
  }

  // Вывести предупреждения
  if (missing.length > 0) {
    console.warn('[env-loader] Не установлены рекомендуемые переменные:')
    for (const key of missing) {
      console.warn(`  - ${key}`)
    }
    console.warn('[env-loader] Создайте .env файл из .env.example и настройте переменные')
  }

  return { completed: true, warnings: missing.length, missing }
}
