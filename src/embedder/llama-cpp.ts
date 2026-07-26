// llama.cpp HTTP server embedding backend

import { AppError } from '../utils/errors.js'
import { EmbeddingError, type IEmbedder } from './index.js'
import {
  LLAMA_CPP_DEFAULTS,
  type LlamaCppConfig,
  type LlamaCppEmbedRequest,
  type LlamaCppEmbedResponse,
} from './types.js'

// ============================================
// Error Classes
// ============================================

/**
 * llama.cpp server communication error
 */
export class LlamaCppError extends AppError {
  constructor(message: string, cause?: Error) {
    super(message, 'llama-cpp', 'internal', cause)
    this.name = 'LlamaCppError'
  }
}

/**
 * Server unavailable error
 */
export class LlamaCppServerUnavailableError extends LlamaCppError {
  constructor(serverUrl: string, cause?: Error) {
    super(
      `llama.cpp server is not available at ${serverUrl}. Please start the server with: llama-server --model <path> --port <port> --embedding`,
      cause
    )
    this.name = 'LlamaCppServerUnavailableError'
  }
}

// ============================================
// LlamaCppEmbedder Class
// ============================================

/**
 * Embedding generation class using llama.cpp HTTP server.
 *
 * This backend communicates with a manually started llama-server process
 * via HTTP. The server must be started separately with the embedding model:
 *
 * ```bash
 * llama-server --model ./models/Qwen3-Embedding-4B.gguf --port 8080 --embedding
 * ```
 *
 * Responsibilities:
 * - Generate embedding vectors via HTTP requests to llama.cpp server
 * - Handle connection errors and timeouts gracefully
 * - Support batch processing (sequential requests)
 */
export class LlamaCppEmbedder implements IEmbedder {
  private readonly config: Required<LlamaCppConfig>
  /**
   * Embedding dimensionality.
   * Qwen3-Embedding-4B produces 4096-dimensional embeddings.
   * nomic-embed-text-v1.5 produces 768-dimensional embeddings.
   */
  private readonly dimensions: number

  /**
   * Model name for the OpenAI-compatible API.
   */
  private readonly modelName: string

  /**
   * Create a new LlamaCppEmbedder instance.
   *
   * @param config - Configuration for the llama.cpp backend
   */
  constructor(config: LlamaCppConfig) {
    if (!config) {
      throw new LlamaCppError('Configuration is required for llama.cpp backend')
    }

    // Read retry configuration from environment variables with fallback to config
    const envMaxRetries = process.env['LLAMA_CPP_MAX_RETRIES']
    const parsedMaxRetries = envMaxRetries ? Number.parseInt(envMaxRetries, 10) : NaN
    const maxRetries =
      !Number.isNaN(parsedMaxRetries) && parsedMaxRetries > 0
        ? parsedMaxRetries
        : (config.maxRetries ?? LLAMA_CPP_DEFAULTS.maxRetries)

    const envRetryDelay = process.env['LLAMA_CPP_RETRY_BASE_DELAY']
    const parsedRetryDelay = envRetryDelay ? Number.parseInt(envRetryDelay, 10) : NaN
    const retryBaseDelay =
      !Number.isNaN(parsedRetryDelay) && parsedRetryDelay > 0
        ? parsedRetryDelay
        : (config.retryBaseDelay ?? LLAMA_CPP_DEFAULTS.retryBaseDelay)

    // Read batch interval from environment variable with fallback to config
    const envBatchInterval = process.env['LLAMA_CPP_BATCH_INTERVAL']
    const parsedBatchInterval = envBatchInterval ? Number.parseInt(envBatchInterval, 10) : NaN
    const batchInterval =
      !Number.isNaN(parsedBatchInterval) && parsedBatchInterval >= 0
        ? parsedBatchInterval
        : (config.batchInterval ?? LLAMA_CPP_DEFAULTS.batchInterval)

    this.config = {
      serverUrl: config.serverUrl ?? LLAMA_CPP_DEFAULTS.serverUrl,
      batchSize: config.batchSize ?? LLAMA_CPP_DEFAULTS.batchSize,
      batchInterval,
      timeout: config.timeout ?? LLAMA_CPP_DEFAULTS.timeout,
      model: config.model ?? LLAMA_CPP_DEFAULTS.model,
      maxRetries,
      retryBaseDelay,
    }

    this.modelName = this.config.model

    // Default dimensionality for Qwen3-Embedding-4B.
    // Users can override by setting RAG_LLAMA_CPP_DIMENSIONS env var if needed.
    const envDimensions = process.env['RAG_LLAMA_CPP_DIMENSIONS']
    if (envDimensions) {
      const parsed = Number.parseInt(envDimensions, 10)
      if (!Number.isNaN(parsed) && parsed > 0) {
        this.dimensions = parsed
      } else {
        console.warn(
          `Invalid RAG_LLAMA_CPP_DIMENSIONS value: "${envDimensions}". Using default 4096.`
        )
        this.dimensions = 4096
      }
    } else {
      this.dimensions = 4096
    }
  }

  /**
   * Initialize the embedder.
   * For llama.cpp, initialization is optional since the server runs separately.
   * This method can be used to verify server availability.
   */
  async initialize(): Promise<void> {
    // Optional: verify server is reachable
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)
      try {
        await fetch(`${this.config.serverUrl}/health`, {
          method: 'GET',
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeoutId)
      }
      console.error('LlamaCppEmbedder: Server health check passed')
    } catch (_error) {
      // Non-fatal: server may not support /health endpoint
      console.error('LlamaCppEmbedder: Server health check skipped (endpoint may not be available)')
    }
  }

  /**
   * Execute a single embedding request without retry logic.
   *
   * @param text - Text to embed
   * @returns Embedding vector
   * @throws LlamaCppError on non-429 HTTP errors or invalid responses
   */
  private async performEmbed(text: string): Promise<number[]> {
    const requestBody: LlamaCppEmbedRequest = { model: this.modelName, input: text }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout)

    const response = await fetch(`${this.config.serverUrl}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '(unable to read error body)')
      throw new LlamaCppError(`llama.cpp server returned HTTP ${response.status}: ${errorBody}`)
    }

    const data: LlamaCppEmbedResponse = await response.json()

    // OpenAI-compatible response: embeddings are in data[0].embedding
    if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
      throw new LlamaCppError(
        'Invalid response format from llama.cpp server: missing or invalid "data" field'
      )
    }

    const embeddingData = data.data[0]
    if (!embeddingData) {
      throw new LlamaCppError('Invalid response format from llama.cpp server: data[0] is undefined')
    }
    if (!embeddingData.embedding || !Array.isArray(embeddingData.embedding)) {
      throw new LlamaCppError(
        'Invalid response format from llama.cpp server: missing or invalid "embedding" field in data[0]'
      )
    }

    return embeddingData.embedding
  }

  /**
   * Generate embedding vector for a single text.
   *
   * Uses the OpenAI-compatible /v1/embeddings endpoint provided by llama.cpp.
   * Includes exponential backoff retry for HTTP 429 (Too Many Requests) errors.
   *
   * @param text - Text to embed
   * @returns Embedding vector
   */
  async embed(text: string): Promise<number[]> {
    if (text.length === 0) {
      throw new EmbeddingError('Cannot generate embedding for empty text')
    }

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await this.performEmbed(text)
      } catch (error) {
        if (!(error instanceof LlamaCppError)) {
          // Non-LlamaCppError: connection errors, etc. — do not retry
          if (error instanceof TypeError && error.message.includes('fetch')) {
            throw new LlamaCppServerUnavailableError(this.config.serverUrl, error as Error)
          }
          throw new LlamaCppError(
            `Failed to generate embedding: ${(error as Error).message}`,
            error as Error
          )
        }

        // Check if this is a rate-limit error (HTTP 429)
        const statusText = error.message.match(/HTTP (\d+)/)?.[1]
        if (statusText === '429' && attempt < this.config.maxRetries) {
          // Exponential backoff with jitter
          const baseDelay = this.config.retryBaseDelay
          const jitter = Math.random() * 500
          const delay = baseDelay * 2 ** attempt + jitter

          console.warn(
            `[llama-cpp] Rate limited (429). Retry ${attempt + 1}/${this.config.maxRetries} after ${Math.round(delay)}ms`
          )

          await new Promise((resolve) => setTimeout(resolve, delay))
          lastError = error
          continue
        }

        // Non-retryable error or max retries exceeded
        throw error
      }
    }

    // Should not reach here, but TypeScript needs it
    throw lastError ?? new LlamaCppError('Max retries exceeded without error')
  }

  /**
   * Generate embedding vectors for multiple texts.
   *
   * llama.cpp does not support batched inference via HTTP, so requests
   * are processed sequentially with configurable intervals to avoid
   * rate limiting (HTTP 429).
   *
   * @param texts - Array of texts to embed
   * @returns Array of embedding vectors
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return []
    }

    // Preserve embed()'s empty-text contract for batch elements
    if (texts.some((text) => text.length === 0)) {
      throw new EmbeddingError('Cannot generate embedding for empty text')
    }

    console.error(`LlamaCppEmbedder: Starting batch of ${texts.length} texts`)

    const results: number[][] = []
    const batchInterval = this.config.batchInterval

    for (let i = 0; i < texts.length; i++) {
      if (i > 0 && batchInterval > 0) {
        // Wait between requests to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, batchInterval))
      }
      console.error(
        `LlamaCppEmbedder: Processing text ${i + 1}/${texts.length} (${texts[i]!.length} chars)`
      )
      const embedding = await this.embed(texts[i]!)
      results.push(embedding)
    }

    console.error(
      `LlamaCppEmbedder: Batch complete — ${results.length} embeddings generated (${results[0]?.length ?? 0} dims each)`
    )
    return results
  }

  /**
   * Release resources held by the embedder.
   * For llama.cpp, there are no local resources to release.
   */
  async dispose(): Promise<void> {
    // No local resources to release for HTTP-based backend
  }

  /**
   * Return the embedding dimensionality.
   * Qwen3-Embedding-4B: 4096 dimensions
   * nomic-embed-text-v1.5: 768 dimensions
   *
   * @returns Embedding dimensionality
   */
  getDimensions(): number {
    return this.dimensions
  }
}
