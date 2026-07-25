/**
 * Парсер строк формата .env в объект ключ-значение.
 *
 * Поддерживаемые форматы:
 * - Ключ=Значение (без кавычек)
 * - Ключ="Значение" (двойные кавычки)
 * - Ключ='Значение' (одинарные кавычки)
 * - Комментарии начинающиеся с #
 * - Пустые строки
 * - Пробелы вокруг оператора =
 */

export interface ParseEnvResult {
  /** Парсинг прошёл успешно */
  success: true
  /** Объект ключ-значение */
  variables: Record<string, string>
}

export interface ParseEnvError {
  /** Парсинг завершился ошибкой */
  success: false
  /** Сообщение об ошибке */
  error: string
  /** Номер строки, где возникла ошибка (если применимо) */
  line?: number
}

export type ParseEnvOutput = ParseEnvResult | ParseEnvError

/**
 * Удалить внешние кавычки из значения.
 * Поддерживает двойные и одинарные кавычки.
 */
function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

/**
 * Разобрать одну строку .env в ключ-значение.
 * Возвращает null для пустых строк и комментариев.
 */
function parseLine(line: string, _lineNumber: number): { key: string; value: string } | null {
  const trimmed = line.trim()

  // Пропустить пустые строки
  if (trimmed.length === 0) {
    return null
  }

  // Пропустить комментарии
  if (trimmed.startsWith('#')) {
    return null
  }

  // Найти разделитель =
  const equalsIndex = trimmed.indexOf('=')
  if (equalsIndex === -1) {
    return null
  }

  const key = trimmed.slice(0, equalsIndex).trim()
  const rawValue = trimmed.slice(equalsIndex + 1).trim()

  // Ключ не может быть пустым
  if (key.length === 0) {
    return null
  }

  // Удалить кавычки из значения
  const value = stripQuotes(rawValue)

  return { key, value }
}

/**
 * Распарсить содержимое .env файла в объект переменных.
 *
 * @param content — содержимое файла .env
 * @returns результат парсинга с успехом/ошибкой
 */
export function parseEnv(content: string): ParseEnvOutput {
  const variables: Record<string, string> = {}
  const lines = content.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) {
      continue
    }

    const parsed = parseLine(line, i + 1)
    if (parsed === null) {
      continue
    }

    variables[parsed.key] = parsed.value
  }

  return { success: true, variables }
}
