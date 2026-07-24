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
   * llama.cpp does not support batched inference via HTTP, so this is used
   * to process requests in smaller groups.
   * Default: 16
   */
  batchSize?: number

  /**
   * Request timeout in milliseconds.
   * Default: 30000
   */
  timeout?: number
}

/**
 * Default configuration values for llama.cpp backend.
 */
export const LLAMA_CPP_DEFAULTS = {
  serverUrl: 'http://127.0.0.1:8080',
  batchSize: 16,
  timeout: 30000,
} as const

/**
 * HTTP response from llama.cpp /embed endpoint.
 */
export interface LlamaCppEmbedResponse {
  /** Embedding vector */
  embedding: number[]
  /** Model name (optional, for informational purposes) */
  model?: string
}

/**
 * HTTP request body for llama.cpp /embed endpoint.
 */
export interface LlamaCppEmbedRequest {
  /** Text to embed */
  input: string
}
