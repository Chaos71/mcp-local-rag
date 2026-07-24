// Factory for creating embedding backends

import type { EmbedderConfig } from './index.js'
import { Embedder } from './index.js'
import { LlamaCppEmbedder } from './llama-cpp.js'
import type { EmbeddingBackend, LlamaCppConfig } from './types.js'

/**
 * Error thrown when required configuration is missing for the selected backend.
 */
export class EmbedderConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmbedderConfigError'
  }
}

/**
 * Create an Embedder instance based on the selected backend.
 *
 * @param config - Backend selection and configuration
 * @returns An IEmbedder instance (either TransformersEmbedder or LlamaCppEmbedder)
 *
 * @example
 * ```typescript
 * // Use Transformers.js (default)
 * const embedder = createEmbedder({ backend: 'transformers', transformersConfig: {...} })
 *
 * // Use llama.cpp
 * const embedder = createEmbedder({
 *   backend: 'llama-cpp',
 *   llamaCppConfig: { serverUrl: 'http://127.0.0.1:8080' }
 * })
 * ```
 */
export function createEmbedder(config: {
  backend: EmbeddingBackend
  transformersConfig?: EmbedderConfig
  llamaCppConfig?: LlamaCppConfig
}): Embedder | LlamaCppEmbedder {
  switch (config.backend) {
    case 'llama-cpp': {
      if (!config.llamaCppConfig) {
        throw new EmbedderConfigError('llamaCppConfig is required when backend is "llama-cpp"')
      }
      return new LlamaCppEmbedder(config.llamaCppConfig)
    }
    default: {
      if (!config.transformersConfig) {
        throw new EmbedderConfigError(
          'transformersConfig is required when backend is "transformers"'
        )
      }
      return new Embedder(config.transformersConfig)
    }
  }
}
