// Content hash computation using SHA-256

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { AppError } from '../utils/errors.js'

/**
 * Compute SHA-256 hash of a file's contents.
 *
 * @param filePath - Absolute path to the file
 * @returns SHA-256 hex digest (64 characters)
 * @throws HashError if the file cannot be read
 */
export async function computeContentHash(filePath: string): Promise<string> {
  const fileBuffer = await readFile(filePath)
  const hash = createHash('sha256')
  hash.update(fileBuffer)
  return hash.digest('hex')
}

/**
 * Hash error — thrown when file content cannot be hashed.
 */
export class HashError extends AppError {
  constructor(message: string, cause?: Error) {
    super(message, 'duplicates', 'io', cause)
    this.name = 'HashError'
  }
}
