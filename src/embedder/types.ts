// Shared type definitions for embedding backends

/**
 * Supported embedding backends.
 * - `transformers`: Transformers.js (default, local ONNX model)
 * - `llama-cpp`: llama.cpp HTTP server (requires manual server startup)
 */
export type EmbeddingBackend = 'transformers' | 'llama-cpp'

/**
 * Configuration for llama.cpp embedding backend.
 * Model and server parameters are configured when starting llama-server manually.
 */
export interface LlamaCppConfig {
  /**
   * URL of the llama.cpp server.
   * Default: `http://127.0.0.1:8080`
   */
  serverUrl?: string

  /**
   * Batch size for embedding requests.
   * llama.cpp server supports batched embeddings via the OpenAI-compatible
   * /v1/embeddings endpoint: the request body accepts `input: string[]`,
   * and the response returns multiple embeddings in a single HTTP call.
   *
   * Texts are split into batches of this size. Between batches a
   * `batchInterval` delay prevents rate limiting (HTTP 429).
   *
   * Recommended: 16–64 depending on server capacity and text length.
   * Default: 16
   */
  batchSize?: number

  /**
   * Delay in milliseconds between requests within a batch.
   * This prevents rate limiting (HTTP 429) on servers with low throughput.
   * Set to 0 for no delay (parallel processing).
   * Default: 1000 (1 second between requests)
   */
  batchInterval?: number

  /**
   * Request timeout in milliseconds.
   * Default: 30000
   */
  timeout?: number

  /**
   * Model name to use for embeddings (OpenAI-compatible API).
   * This should match the model loaded on the llama.cpp server.
   * Default: `nomic-embed-text`
   */
  model?: string

  /**
   * Maximum number of retry attempts for rate-limited requests (HTTP 429).
   * Default: 5
   */
  maxRetries?: number

  /**
   * Base delay in milliseconds for retry backoff (exponential with jitter).
   * Default: 2000
   */
  retryBaseDelay?: number
}

/**
 * Default configuration values for llama.cpp backend.
 */
export const LLAMA_CPP_DEFAULTS = {
  serverUrl: 'http://127.0.0.1:8080',
  batchSize: 16,
  batchInterval: 1000,
  timeout: 30000,
  model: 'nomic-embed-text',
  maxRetries: 5,
  retryBaseDelay: 2000,
} as const

/**
 * OpenAI-compatible embedding response from llama.cpp /v1/embeddings endpoint.
 */
export interface LlamaCppEmbedResponse {
  /** Array of embedding objects (typically one per input) */
  data: Array<{
    /** Embedding vector */
    embedding: number[]
    /** Object type (always "embedding") */
    object: string
    /** Index in the input array */
    index: number
  }>
  /** Model name that generated the embeddings */
  model: string
  /** Usage statistics */
  usage: {
    /** Number of tokens in the prompt */
    prompt_tokens: number
    /** Total number of tokens */
    total_tokens: number
  }
}

/**
 * OpenAI-compatible embedding request body for llama.cpp /v1/embeddings endpoint.
 */
export interface LlamaCppEmbedRequest {
  /** Model name to use for embeddings */
  model: string
  /** Text or array of texts to embed */
  input: string | string[]
}
