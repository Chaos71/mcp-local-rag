// MCP Server entry point
import { resolveDevice, resolveDtype } from './cli/options.js'
import type { EmbeddingBackend } from './embedder/types.js'
import { RAGServer } from './server/index.js'
import { BaseDirsConfigError, parseBaseDirsEnv, resolveBaseDirs } from './utils/base-dirs.js'
import { DEFAULT_MAX_FILE_SIZE } from './utils/limits.js'
import { checkSensitivePath } from './utils/sensitive-path.js'
import type { GroupingMode } from './vectordb/index.js'

// ============================================
// Environment Variable Parsers
// ============================================

/** Result of parsing an environment variable */
export interface ParseResult<T> {
  value: T | undefined
  warning?: string
}

/**
 * Parse grouping mode from environment variable
 */
export function parseGroupingMode(value: string | undefined): ParseResult<GroupingMode> {
  if (!value) return { value: undefined }
  const normalized = value.toLowerCase().trim()
  if (normalized === 'similar' || normalized === 'related') {
    return { value: normalized }
  }
  const warning = `Invalid RAG_GROUPING value: "${value.slice(0, 100)}". Expected "similar" or "related". Ignoring.`
  return { value: undefined, warning }
}

/**
 * Parse max distance from environment variable
 */
export function parseMaxDistance(value: string | undefined): ParseResult<number> {
  if (!value) return { value: undefined }
  const parsed = Number.parseFloat(value)
  if (Number.isNaN(parsed) || parsed <= 0 || !Number.isFinite(parsed)) {
    const warning = `Invalid RAG_MAX_DISTANCE value: "${value.slice(0, 100)}". Expected positive number. Ignoring.`
    return { value: undefined, warning }
  }
  return { value: parsed }
}

/**
 * Parse max files from environment variable
 */
export function parseMaxFiles(value: string | undefined): ParseResult<number> {
  if (!value) return { value: undefined }
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < 1) {
    const warning = `Invalid RAG_MAX_FILES value: "${value.slice(0, 100)}". Expected positive integer (>= 1). Ignoring.`
    return { value: undefined, warning }
  }
  return { value: parsed }
}

/**
 * Parse hybrid weight from environment variable
 */
export function parseHybridWeight(value: string | undefined): ParseResult<number> {
  if (!value) return { value: undefined }
  const parsed = Number.parseFloat(value)
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
    const warning = `Invalid RAG_HYBRID_WEIGHT value: "${value.slice(0, 100)}". Expected 0.0-1.0. Using default (0.6).`
    return { value: undefined, warning }
  }
  return { value: parsed }
}

/**
 * Parse chunk minimum length from environment variable
 */
export function parseChunkMinLength(value: string | undefined): ParseResult<number> {
  if (!value) return { value: undefined }
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 10000) {
    const warning = `Invalid CHUNK_MIN_LENGTH value: "${value.slice(0, 100)}". Expected integer between 1 and 10000. Ignoring.`
    return { value: undefined, warning }
  }
  return { value: parsed }
}

// ============================================
// Embedding Backend Parsers
// ============================================

/**
 * Parse embedding backend from environment variable
 */
export function parseEmbeddingBackend(value: string | undefined): ParseResult<EmbeddingBackend> {
  if (!value) return { value: 'transformers' }
  const normalized = value.toLowerCase().trim()
  if (normalized === 'transformers' || normalized === 'llama-cpp') {
    return { value: normalized }
  }
  const warning = `Invalid EMBEDDING_BACKEND value: "${value.slice(0, 100)}". Expected "transformers" or "llama-cpp". Using default (transformers).`
  return { value: 'transformers', warning }
}

/**
 * Parse llama.cpp server URL from environment variable
 */
export function parseLlamaCppServerUrl(value: string | undefined): ParseResult<string> {
  if (!value) return { value: undefined }
  // Basic URL validation - must start with http:// or https://
  if (!value.startsWith('http://') && !value.startsWith('https://')) {
    const warning = `Invalid LLAMA_CPP_SERVER_URL value: "${value.slice(0, 100)}". Must start with http:// or https://. Ignoring.`
    return { value: undefined, warning }
  }
  return { value }
}

/**
 * Parse llama.cpp batch size from environment variable
 */
export function parseLlamaCppBatchSize(value: string | undefined): ParseResult<number> {
  if (!value) return { value: undefined }
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 128) {
    const warning = `Invalid LLAMA_CPP_BATCH_SIZE value: "${value.slice(0, 100)}". Expected integer between 1 and 128. Ignoring.`
    return { value: undefined, warning }
  }
  return { value: parsed }
}

/**
 * Parse llama.cpp timeout from environment variable
 */
export function parseLlamaCppTimeout(value: string | undefined): ParseResult<number> {
  if (!value) return { value: undefined }
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < 1000 || parsed > 300000) {
    const warning = `Invalid LLAMA_CPP_TIMEOUT value: "${value.slice(0, 100)}". Expected integer between 1000 and 300000 (ms). Ignoring.`
    return { value: undefined, warning }
  }
  return { value: parsed }
}

// ============================================
// Server Startup
// ============================================

/**
 * Resolve the full RAGServer configuration from environment variables.
 *
 * Pure (no process.exit, no transport): `env` and `cwd` are passed in so the
 * entry-point wiring can be exercised directly in tests instead of via a copy.
 * Single source of truth for BASE_DIRS / BASE_DIR / cwd precedence, the
 * sensitive-path policy on both raw and realpath-normalized roots, and the
 * never-fall-back-to-cwd-on-error rule.
 */
export async function resolveServerConfig(
  env: NodeJS.ProcessEnv,
  cwd: string
): Promise<ConstructorParameters<typeof RAGServer>[0]> {
  const device = resolveDevice(env['RAG_DEVICE'])
  // Undefined when RAG_DTYPE is unset — threaded into config only when defined
  // (see below), preserving the unset signal for the embedder's fp32 default.
  const dtype = resolveDtype(env['RAG_DTYPE'])
  const configWarnings: string[] = []

  // Embedding backend configuration
  const embeddingBackend = parseEmbeddingBackend(env['EMBEDDING_BACKEND'])
  const llamaCppServerUrl = parseLlamaCppServerUrl(env['LLAMA_CPP_SERVER_URL'])
  const llamaCppBatchSize = parseLlamaCppBatchSize(env['LLAMA_CPP_BATCH_SIZE'])
  const llamaCppTimeout = parseLlamaCppTimeout(env['LLAMA_CPP_TIMEOUT'])
  if (embeddingBackend.warning) configWarnings.push(embeddingBackend.warning)
  if (llamaCppServerUrl.warning) configWarnings.push(llamaCppServerUrl.warning)
  if (llamaCppBatchSize.warning) configWarnings.push(llamaCppBatchSize.warning)
  if (llamaCppTimeout.warning) configWarnings.push(llamaCppTimeout.warning)

  // Sensitive-path pre-check on the RAW user-supplied paths, before the
  // resolver realpath-normalizes them (on macOS `/etc` → `/private/etc`, which
  // a post-realpath-only check would miss).
  const rawSensitiveErrors: string[] = []
  if (env['BASE_DIRS'] !== undefined && env['BASE_DIRS'].length > 0) {
    const parsed = parseBaseDirsEnv(env['BASE_DIRS'])
    if (parsed.ok) {
      for (const raw of parsed.value) {
        const sensitive = checkSensitivePath(raw, 'BASE_DIRS')
        if (sensitive) rawSensitiveErrors.push(sensitive)
      }
    }
  } else if (env['BASE_DIR'] !== undefined && env['BASE_DIR'].trim().length > 0) {
    const sensitive = checkSensitivePath(env['BASE_DIR'], 'BASE_DIR')
    if (sensitive) rawSensitiveErrors.push(sensitive)
  }

  const baseDirsResult = await resolveBaseDirs({
    envBaseDirs: env['BASE_DIRS'],
    envBaseDir: env['BASE_DIR'],
    cwd,
  })

  let baseDirsForServer: string[]
  // Normal-path roots, index-aligned with baseDirsForServer, for list_files
  // scan/display (see BaseDirsConfig for the path policy).
  let rawBaseDirsForServer: string[]
  let configError: BaseDirsConfigError | undefined
  // Raw sensitive-path matches take precedence over resolver errors.
  if (rawSensitiveErrors.length > 0) {
    baseDirsForServer = []
    rawBaseDirsForServer = []
    configError = new BaseDirsConfigError([...new Set(rawSensitiveErrors)].join('; '))
    configWarnings.push(configError.message)
  } else if (baseDirsResult.ok) {
    const sourceFlag =
      env['BASE_DIRS'] !== undefined && env['BASE_DIRS'].length > 0 ? 'BASE_DIRS' : 'BASE_DIR'
    const sensitiveErrors: string[] = []
    for (const root of baseDirsResult.config.baseDirs) {
      const sensitive = checkSensitivePath(root, sourceFlag)
      if (sensitive) sensitiveErrors.push(sensitive)
    }
    if (sensitiveErrors.length > 0) {
      baseDirsForServer = []
      rawBaseDirsForServer = []
      configError = new BaseDirsConfigError([...new Set(sensitiveErrors)].join('; '))
      configWarnings.push(configError.message)
    } else {
      baseDirsForServer = baseDirsResult.config.baseDirs
      rawBaseDirsForServer = baseDirsResult.config.rawBaseDirs
      for (const warning of baseDirsResult.warnings) {
        configWarnings.push(warning.message)
      }
    }
  } else {
    baseDirsForServer = []
    rawBaseDirsForServer = []
    configError = baseDirsResult.error
    configWarnings.push(baseDirsResult.error.message)
  }

  const config: ConstructorParameters<typeof RAGServer>[0] = {
    dbPath: env['DB_PATH'] || './lancedb/',
    modelName: env['MODEL_NAME'] || 'Xenova/all-MiniLM-L6-v2',
    cacheDir: env['CACHE_DIR'] || './models/',
    baseDirs: baseDirsForServer,
    rawBaseDirs: rawBaseDirsForServer,
    maxFileSize: Number.parseInt(env['MAX_FILE_SIZE'] || String(DEFAULT_MAX_FILE_SIZE), 10),
    device,
  }

  // Quality-filter settings: applied only when defined; invalid values warn.
  const maxDistance = parseMaxDistance(env['RAG_MAX_DISTANCE'])
  const grouping = parseGroupingMode(env['RAG_GROUPING'])
  const maxFiles = parseMaxFiles(env['RAG_MAX_FILES'])
  const hybridWeight = parseHybridWeight(env['RAG_HYBRID_WEIGHT'])
  const chunkMinLength = parseChunkMinLength(env['CHUNK_MIN_LENGTH'])
  if (maxDistance.value !== undefined) config.maxDistance = maxDistance.value
  if (maxDistance.warning) configWarnings.push(maxDistance.warning)
  if (grouping.value !== undefined) config.grouping = grouping.value
  if (grouping.warning) configWarnings.push(grouping.warning)
  if (maxFiles.value !== undefined) config.maxFiles = maxFiles.value
  if (maxFiles.warning) configWarnings.push(maxFiles.warning)
  if (hybridWeight.value !== undefined) config.hybridWeight = hybridWeight.value
  if (hybridWeight.warning) configWarnings.push(hybridWeight.warning)
  if (chunkMinLength.value !== undefined) config.chunkMinLength = chunkMinLength.value
  if (chunkMinLength.warning) configWarnings.push(chunkMinLength.warning)

  // Embedding backend configuration
  if (embeddingBackend.value !== undefined) {
    config.embeddingBackend = embeddingBackend.value
  }
  if (llamaCppServerUrl.value !== undefined) {
    if (!config.llamaCppConfig) config.llamaCppConfig = {}
    config.llamaCppConfig.serverUrl = llamaCppServerUrl.value
  }
  if (llamaCppBatchSize.value !== undefined) {
    if (!config.llamaCppConfig) config.llamaCppConfig = {}
    config.llamaCppConfig.batchSize = llamaCppBatchSize.value
  }
  if (llamaCppTimeout.value !== undefined) {
    if (!config.llamaCppConfig) config.llamaCppConfig = {}
    config.llamaCppConfig.timeout = llamaCppTimeout.value
  }

  // Set dtype only when defined, so config.dtype === undefined keeps meaning
  // "RAG_DTYPE unset" (the embedder then applies its fp32 default).
  if (dtype !== undefined) config.dtype = dtype

  if (configWarnings.length > 0) config.configWarnings = configWarnings
  if (configError !== undefined) config.configError = configError

  return config
}

/**
 * Start the RAG MCP Server
 * Configuration is read from environment variables only (no CLI flags).
 * This ensures the bare `mcp-local-rag` launch is suitable for MCP clients.
 */
export async function startServer(): Promise<void> {
  try {
    const config = await resolveServerConfig(process.env, process.cwd())

    if (config.configWarnings && config.configWarnings.length > 0) {
      console.error('Configuration warnings:', config.configWarnings.join(' | '))
    }

    console.error('Starting RAG MCP Server...')
    console.error('Configuration:', config)

    // Start RAGServer
    const server = new RAGServer(config)
    await server.initialize()
    await server.run()

    console.error('RAG MCP Server started successfully')
  } catch (error) {
    console.error('Failed to start RAG MCP Server:', error)
    process.exit(1)
  }
}
