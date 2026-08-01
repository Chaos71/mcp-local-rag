// CLI Duplicates Tests
// Test Type: Integration Test
// Tests `duplicates list` and `duplicates cleanup` subcommands with mocked VectorStore

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================
// Mock Setup (vi.hoisted for isolate: false)
// ============================================

const mocks = vi.hoisted(() => {
  return {
    // VectorStore instance methods
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    getDuplicatesByHash: vi.fn().mockResolvedValue([]),
    cleanupDuplicates: vi.fn().mockResolvedValue(0),
    // Shared CLI base-dirs resolver
    resolveCliBaseDirs: vi.fn(),
  }
})

// Mock factories — installed via `vi.doMock` in `beforeAll` and removed via
// `vi.doUnmock` in `afterAll`. See `.claude/skills/project-context/SKILL.md`.

const cliCommonFactory = () => ({
  createVectorStore: vi.fn().mockImplementation(() => ({
    initialize: mocks.initialize,
    close: mocks.close,
    getDuplicatesByHash: mocks.getDuplicatesByHash,
    cleanupDuplicates: mocks.cleanupDuplicates,
  })),
  resolveCliBaseDirsOrExit: vi
    .fn()
    .mockImplementation((cliRoots: string[]) => mocks.resolveCliBaseDirs(cliRoots)),
  // Catch-block renderer; faithful shim preserves the
  // `Failed to list duplicates: <message>` stderr behavior the tests assert.
  formatCliError: formatCliErrorShim,
})

const MOCKED_PATHS = ['../../cli/common.js'] as const

import { formatCliErrorShim } from './cli-error-shim.js'

let parseArgs: typeof import('../../cli/duplicates.js').parseArgs
let runDuplicates: typeof import('../../cli/duplicates.js').runDuplicates

// ============================================
// Helpers
// ============================================

/**
 * Capture stderr output and stdout writes during a function call.
 */
function captureOutput(
  fn: () => Promise<void>
): Promise<{ stderr: string[]; stdout: string[]; error: unknown }> {
  const stderr: string[] = []
  const stdout: string[] = []
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    stderr.push(args.map(String).join(' '))
  })
  const stdoutSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      stdout.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
      return true
    })

  return fn()
    .then(() => ({ stderr, stdout, error: undefined }))
    .catch((error: unknown) => ({ stderr, stdout, error }))
    .finally(() => {
      errorSpy.mockRestore()
      stdoutSpy.mockRestore()
    })
}

// ============================================
// Tests
// ============================================

describe('CLI duplicates', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeAll(async () => {
    vi.resetModules()
    vi.doMock('../../cli/common.js', cliCommonFactory)
    ;({ parseArgs, runDuplicates } = await import('../../cli/duplicates.js'))
  })

  afterAll(() => {
    for (const p of MOCKED_PATHS) vi.doUnmock(p)
    vi.resetModules()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    // Default resolver impl: CLI roots when provided, otherwise the
    // BASE_DIR env value if set (so existing precedence tests continue to
    // verify CLI > env), otherwise cwd. Per-test impls can override before
    // calling `runDuplicates`.
    mocks.resolveCliBaseDirs.mockImplementation((cliRoots: string[]) => {
      const first = cliRoots[0] ?? process.env['BASE_DIR'] ?? process.cwd()
      return Promise.resolve({
        config: { baseDirs: [first], rawBaseDirs: [first] },
        warnings: [],
      })
    })
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((code?: number | string | null | undefined) => {
        throw new Error(`process.exit(${code})`)
      })
  })

  afterEach(() => {
    exitSpy.mockRestore()
    process.exitCode = undefined
  })

  // --------------------------------------------
  // --help
  // --------------------------------------------
  it('should show help text and exit with code 0 when --help is passed', async () => {
    const { stderr, error } = await captureOutput(() => runDuplicates(['--help']))

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('process.exit(0)')

    const joined = stderr.join('\n')
    expect(joined).toContain('Usage: mcp-local-rag')
    expect(joined).toContain('duplicates')
    expect(joined).toContain('list')
    expect(joined).toContain('cleanup')
  })

  it('should show help text and exit with code 0 when -h is passed', async () => {
    const { stderr, error } = await captureOutput(() => runDuplicates(['-h']))

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('process.exit(0)')

    const joined = stderr.join('\n')
    expect(joined).toContain('Usage: mcp-local-rag')
    expect(joined).toContain('duplicates')
  })

  // --------------------------------------------
  // Missing subcommand
  // --------------------------------------------
  it('should exit with code 1 when no subcommand is provided', async () => {
    const { stderr, error } = await captureOutput(() => runDuplicates([]))

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('process.exit(1)')

    const joined = stderr.join('\n')
    expect(joined).toContain('Missing subcommand')
    expect(joined).toContain('list|cleanup')
  })

  // --------------------------------------------
  // Unknown flags cause exit(1)
  // --------------------------------------------
  it('should exit with code 1 on unknown flags', async () => {
    const { stderr, error } = await captureOutput(() => runDuplicates(['--unknown']))

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('process.exit(1)')

    const joined = stderr.join('\n')
    expect(joined).toContain('Unknown option: --unknown')
  })

  it('should exit with code 1 on unexpected positional arguments', async () => {
    const { stderr, error } = await captureOutput(() => runDuplicates(['some-arg']))

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('process.exit(1)')

    const joined = stderr.join('\n')
    expect(joined).toContain('Unexpected argument')
  })

  // --------------------------------------------
  // parseArgs unit tests
  // --------------------------------------------
  describe('parseArgs', () => {
    it('should parse empty args', () => {
      const result = parseArgs([])
      expect(result).toEqual({
        includeDeprecated: false,
        dryRun: false,
        format: 'human',
        help: false,
        subcommand: undefined,
      })
    })

    it('should parse --help flag', () => {
      const result = parseArgs(['--help'])
      expect(result.help).toBe(true)
    })

    it('should parse -h flag', () => {
      const result = parseArgs(['-h'])
      expect(result.help).toBe(true)
    })

    it('should parse list subcommand', () => {
      const result = parseArgs(['list'])
      expect(result.subcommand).toBe('list')
    })

    it('should parse cleanup subcommand', () => {
      const result = parseArgs(['cleanup'])
      expect(result.subcommand).toBe('cleanup')
    })

    it('should parse --include-deprecated flag', () => {
      const result = parseArgs(['list', '--include-deprecated'])
      expect(result.includeDeprecated).toBe(true)
      expect(result.subcommand).toBe('list')
    })

    it('should parse --dry-run flag', () => {
      const result = parseArgs(['cleanup', '--dry-run'])
      expect(result.dryRun).toBe(true)
      expect(result.subcommand).toBe('cleanup')
    })

    it('should parse --format json', () => {
      const result = parseArgs(['list', '--format', 'json'])
      expect(result.format).toBe('json')
      expect(result.subcommand).toBe('list')
    })

    it('should parse --format human', () => {
      const result = parseArgs(['list', '--format', 'human'])
      expect(result.format).toBe('human')
      expect(result.subcommand).toBe('list')
    })

    it('should reject invalid --format value', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        expect(() => parseArgs(['list', '--format', 'xml'])).toThrow('process.exit(1)')
        expect(errorSpy).toHaveBeenCalledWith(
          'Invalid --format value: "xml". Expected "human" or "json".'
        )
      } finally {
        errorSpy.mockRestore()
      }
    })

    it('should accept --format case-insensitively', () => {
      const result = parseArgs(['list', '--format', 'JSON'])
      expect(result.format).toBe('json')
    })

    it('should error on unknown flags', () => {
      expect(() => parseArgs(['list', '--verbose'])).toThrow('process.exit(1)')
    })

    it('should error on positional arguments', () => {
      expect(() => parseArgs(['list', 'extra'])).toThrow('process.exit(1)')
    })

    it('should combine multiple flags', () => {
      const result = parseArgs(['list', '--include-deprecated', '--format', 'json', '--dry-run'])
      expect(result.includeDeprecated).toBe(true)
      expect(result.format).toBe('json')
      expect(result.dryRun).toBe(true)
      expect(result.subcommand).toBe('list')
    })
  })

  // --------------------------------------------
  // List command
  // --------------------------------------------
  describe('list', () => {
    it('should output JSON with duplicate groups when --format json', async () => {
      // Arrange: mock duplicate groups from VectorStore
      mocks.getDuplicatesByHash.mockResolvedValue([
        {
          contentHash: 'abc123',
          filePaths: ['/docs/file1.pdf', '/docs/file1-backup.pdf'],
          deprecatedFilePaths: undefined,
        },
      ])

      // Act
      const { stdout, error } = await captureOutput(() =>
        runDuplicates(['list', '--format', 'json'])
      )

      // Assert
      expect(error).toBeUndefined()
      expect(stdout.length).toBeGreaterThan(0)
      const result = JSON.parse(stdout.join(''))
      expect(result.totalGroups).toBe(1)
      expect(result.totalDuplicates).toBe(2)
      expect(result.groups).toHaveLength(1)
    })

    it('should output human-readable text by default', async () => {
      // Arrange
      mocks.getDuplicatesByHash.mockResolvedValue([
        {
          contentHash: 'abc123',
          filePaths: ['/docs/file1.pdf'],
          deprecatedFilePaths: ['/docs/file1-old.pdf'],
        },
      ])

      // Act
      const { stderr, error } = await captureOutput(() => runDuplicates(['list']))

      // Assert
      expect(error).toBeUndefined()
      const joined = stderr.join('\n')
      expect(joined).toContain('Found 0 duplicate group(s)')
      // Single-file groups are filtered out (not duplicates)
      expect(joined).not.toContain('abc123')
    })

    it('should filter out single-file groups (not duplicates)', async () => {
      // Arrange: groups with only one file each
      mocks.getDuplicatesByHash.mockResolvedValue([
        {
          contentHash: 'hash1',
          filePaths: ['/docs/unique1.pdf'],
          deprecatedFilePaths: undefined,
        },
        {
          contentHash: 'hash2',
          filePaths: ['/docs/unique2.pdf'],
          deprecatedFilePaths: undefined,
        },
      ])

      // Act
      const { stdout, error } = await captureOutput(() =>
        runDuplicates(['list', '--format', 'json'])
      )

      // Assert
      expect(error).toBeUndefined()
      const result = JSON.parse(stdout.join(''))
      expect(result.totalGroups).toBe(0)
      expect(result.groups).toHaveLength(0)
    })

    it('should include groups with multiple files as duplicates', async () => {
      // Arrange: one group with two files
      mocks.getDuplicatesByHash.mockResolvedValue([
        {
          contentHash: 'abc123',
          filePaths: ['/docs/file1.pdf', '/docs/file1-copy.pdf'],
          deprecatedFilePaths: undefined,
        },
      ])

      // Act
      const { stdout, error } = await captureOutput(() =>
        runDuplicates(['list', '--format', 'json'])
      )

      // Assert
      expect(error).toBeUndefined()
      const result = JSON.parse(stdout.join(''))
      expect(result.totalGroups).toBe(1)
      expect(result.totalDuplicates).toBe(2)
    })

    it('should include deprecatedFilePaths in totalDuplicates count (multi-file group)', async () => {
      // Arrange: group with multiple active files + deprecated versions
      mocks.getDuplicatesByHash.mockResolvedValue([
        {
          contentHash: 'abc123',
          filePaths: ['/docs/file1.pdf', '/docs/file1-backup.pdf'],
          deprecatedFilePaths: ['/docs/file1-old.pdf', '/docs/file1-ancient.pdf'],
        },
      ])

      // Act
      const { stdout, error } = await captureOutput(() =>
        runDuplicates(['list', '--format', 'json'])
      )

      // Assert: 2 active + 2 deprecated = 1 group, 4 total
      expect(error).toBeUndefined()
      const result = JSON.parse(stdout.join(''))
      expect(result.totalGroups).toBe(1)
      expect(result.totalDuplicates).toBe(4)
    })

    it('should call getDuplicatesByHash with includeDeprecated flag', async () => {
      // Arrange
      mocks.getDuplicatesByHash.mockResolvedValue([])

      // Act
      await captureOutput(() => runDuplicates(['list', '--include-deprecated']))

      // Assert
      expect(mocks.getDuplicatesByHash).toHaveBeenCalledWith('', true)
    })

    it('should call getDuplicatesByHash without includeDeprecated by default', async () => {
      // Arrange
      mocks.getDuplicatesByHash.mockResolvedValue([])

      // Act
      await captureOutput(() => runDuplicates(['list']))

      // Assert
      expect(mocks.getDuplicatesByHash).toHaveBeenCalledWith('', false)
    })

    it('should exit with code 1 when getDuplicatesByHash fails', async () => {
      // Arrange
      mocks.getDuplicatesByHash.mockRejectedValue(new Error('DB query failed'))

      // Act
      const { stderr, error } = await captureOutput(() => runDuplicates(['list']))

      // Assert
      expect(error).toBeUndefined()
      expect(process.exitCode).toBe(1)
      const joined = stderr.join('\n')
      expect(joined).toContain('DB query failed')
    })
  })

  // --------------------------------------------
  // Cleanup command
  // --------------------------------------------
  describe('cleanup', () => {
    it('should output success message with dry-run', async () => {
      // Act
      const { stderr, error } = await captureOutput(() => runDuplicates(['cleanup', '--dry-run']))

      // Assert
      expect(error).toBeUndefined()
      const joined = stderr.join('\n')
      expect(joined).toContain('Dry run: cleanup would remove deprecated chunks')
      expect(joined).toContain('Run without --dry-run to execute cleanup')
      // cleanupDuplicates should NOT be called in dry-run mode
      expect(mocks.cleanupDuplicates).not.toHaveBeenCalled()
    })

    it('should call cleanupDuplicates and report removed count', async () => {
      // Arrange
      mocks.cleanupDuplicates.mockResolvedValue(5)

      // Act
      const { stderr, error } = await captureOutput(() => runDuplicates(['cleanup']))

      // Assert
      expect(error).toBeUndefined()
      expect(mocks.cleanupDuplicates).toHaveBeenCalledTimes(1)
      const joined = stderr.join('\n')
      expect(joined).toContain('Removed 5 deprecated chunk(s)')
    })

    it('should report 0 removed when no deprecated chunks exist', async () => {
      // Arrange
      mocks.cleanupDuplicates.mockResolvedValue(0)

      // Act
      const { stderr, error } = await captureOutput(() => runDuplicates(['cleanup']))

      // Assert
      expect(error).toBeUndefined()
      const joined = stderr.join('\n')
      expect(joined).toContain('Removed 0 deprecated chunk(s)')
    })

    it('should exit with code 1 when cleanupDuplicates fails', async () => {
      // Arrange
      mocks.cleanupDuplicates.mockRejectedValue(new Error('Cleanup failed'))

      // Act
      const { stderr, error } = await captureOutput(() => runDuplicates(['cleanup']))

      // Assert
      expect(error).toBeUndefined()
      expect(process.exitCode).toBe(1)
      const joined = stderr.join('\n')
      expect(joined).toContain('Cleanup failed')
    })
  })
})
