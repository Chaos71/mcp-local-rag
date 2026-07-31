// CLI duplicates subcommand — list and cleanup duplicate documents

import { createVectorStore, formatCliError, resolveCliBaseDirsOrExit } from './common.js'
import type { GlobalOptions } from './options.js'
import { requireFlagValue, resolveGlobalConfig } from './options.js'

// ============================================
// Types
// ============================================

interface DuplicatesCliOptions {
  includeDeprecated: boolean
  dryRun: boolean
  format: 'human' | 'json'
  help: boolean
  subcommand: 'list' | 'cleanup' | undefined
}

interface DuplicateGroup {
  contentHash: string
  filePaths: string[]
  deprecatedFilePaths?: string[]
}

interface DuplicateListResult {
  totalGroups: number
  totalDuplicates: number
  groups: DuplicateGroup[]
}

// ============================================
// Help
// ============================================

const DUPLICATES_HELP_TEXT = `Usage: mcp-local-rag [global-options] duplicates <subcommand> [options]

Manage duplicate documents in the vector database.

Subcommands:
  list                 List all duplicate document groups
  cleanup              Remove deprecated (soft-deleted) chunks

Global options for 'list':
  --include-deprecated Include deprecated entries in results
  --format <format>    Output format: "human" or "json" (default: human)
  --dry-run            Show what would be removed without making changes

Global options for 'cleanup':
  --dry-run            Show what would be removed without making changes

Global options (must appear before "duplicates"):
  --db-path <path>     LanceDB database path
  --cache-dir <path>   Model cache directory
  --model-name <name>  Embedding model

Examples:
  mcp-local-rag duplicates list
  mcp-local-rag duplicates list --include-deprecated --format json
  mcp-local-rag duplicates cleanup --dry-run`

// ============================================
// Arg Parsing
// ============================================

/**
 * Parse duplicates subcommand arguments.
 * Flags: list, cleanup, --include-deprecated, --dry-run, --format, -h/--help
 */
export function parseArgs(args: string[]): DuplicatesCliOptions {
  const options: DuplicatesCliOptions = {
    includeDeprecated: false,
    dryRun: false,
    format: 'human',
    help: false,
    subcommand: undefined,
  }

  let i = 0
  while (i < args.length) {
    const arg = args[i]!
    switch (arg) {
      case '-h':
      case '--help':
        options.help = true
        i++
        break
      case 'list':
        options.subcommand = 'list'
        i++
        break
      case 'cleanup':
        options.subcommand = 'cleanup'
        i++
        break
      case '--include-deprecated':
        options.includeDeprecated = true
        i++
        break
      case '--dry-run':
        options.dryRun = true
        i++
        break
      case '--format': {
        const value = requireFlagValue(args, i, '--format').toLowerCase().trim()
        if (value !== 'human' && value !== 'json') {
          console.error(`Invalid --format value: "${value}". Expected "human" or "json".`)
          process.exit(1)
        }
        options.format = value
        i += 2
        break
      }
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`)
          process.exit(1)
        }
        console.error(`Unexpected argument: ${arg}`)
        process.exit(1)
    }
  }

  return options
}

// ============================================
// Output Formatting
// ============================================

/**
 * Format duplicate list result as human-readable text.
 */
function formatHuman(result: DuplicateListResult): string {
  const lines: string[] = []

  lines.push(
    `Found ${result.totalGroups} duplicate group(s), ${result.totalDuplicates} total duplicate(s)\n`
  )

  for (const group of result.groups) {
    const allPaths = [...group.filePaths]
    if (group.deprecatedFilePaths) {
      allPaths.push(...group.deprecatedFilePaths.map((p) => `${p} [deprecated]`))
    }

    lines.push(`Hash: ${group.contentHash}`)
    lines.push(`  Files:`)
    for (const path of allPaths) {
      const isDeprecated = group.deprecatedFilePaths?.includes(path)
      lines.push(`    - ${path}${isDeprecated ? ' (deprecated)' : ''}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

// ============================================
// Main Entry Point
// ============================================

/**
 * Run the duplicates CLI subcommand.
 * @param args - Arguments after "duplicates"
 * @param globalOptions - Global options parsed before the subcommand
 */
export async function runDuplicates(
  args: string[],
  globalOptions: GlobalOptions = {}
): Promise<void> {
  // Parse CLI options
  const options = parseArgs(args)

  // Handle --help
  if (options.help) {
    console.error(DUPLICATES_HELP_TEXT)
    process.exit(0)
  }

  // Validate subcommand
  if (!options.subcommand) {
    console.error('Missing subcommand. Usage: mcp-local-rag duplicates <list|cleanup>')
    console.error(DUPLICATES_HELP_TEXT)
    process.exit(1)
  }

  // Resolve global config
  const globalConfig = resolveGlobalConfig(globalOptions)

  // Resolve effective base directories
  const { warnings: baseDirsWarnings } = await resolveCliBaseDirsOrExit([])
  for (const warning of baseDirsWarnings) {
    console.error(warning.message)
  }

  const vectorStore = createVectorStore(globalConfig)
  try {
    await vectorStore.initialize()

    if (options.subcommand === 'list') {
      await handleList(vectorStore, options)
    } else if (options.subcommand === 'cleanup') {
      await handleCleanup(vectorStore, options)
    }
  } catch (error) {
    const message = formatCliError(error)
    console.error(`Failed to list duplicates: ${message}`)
    process.exitCode = 1
  } finally {
    await vectorStore.close()
  }
}

// ============================================
// List Command
// ============================================

async function handleList(
  vectorStore: ReturnType<typeof createVectorStore>,
  options: DuplicatesCliOptions
): Promise<void> {
  const includeDeprecated = options.includeDeprecated
  const format = options.format

  // Fetch duplicate groups from the database
  let groups: DuplicateGroup[]
  try {
    groups = await vectorStore.getDuplicatesByHash('', includeDeprecated)
  } catch (error) {
    const message = formatCliError(error)
    console.error(`Failed to fetch duplicate groups: ${message}`)
    process.exitCode = 1
    return
  }

  // Filter out groups with only one file (not duplicates)
  const duplicateGroups = groups.filter((g) => g.filePaths.length > 1)

  // Calculate totals
  const totalGroups = duplicateGroups.length
  const totalDuplicates = duplicateGroups.reduce(
    (sum, g) => sum + g.filePaths.length + (g.deprecatedFilePaths?.length ?? 0),
    0
  )

  const result: DuplicateListResult = {
    totalGroups,
    totalDuplicates,
    groups: duplicateGroups,
  }

  // Output
  if (format === 'json') {
    process.stdout.write(JSON.stringify(result, null, 2))
  } else {
    console.error(formatHuman(result))
  }
}

// ============================================
// Cleanup Command
// ============================================

async function handleCleanup(
  vectorStore: ReturnType<typeof createVectorStore>,
  options: DuplicatesCliOptions
): Promise<void> {
  if (options.dryRun) {
    // In dry-run mode, we would show what would be cleaned up
    // For now, just report that cleanup is available
    console.error('Dry run: cleanup would remove deprecated chunks')
    console.error('Run without --dry-run to execute cleanup')
    return
  }

  let removed: number
  try {
    removed = await vectorStore.cleanupDuplicates()
  } catch (error) {
    const message = formatCliError(error)
    console.error(`Failed to cleanup duplicates: ${message}`)
    process.exitCode = 1
    return
  }

  console.error(`Removed ${removed} deprecated chunk(s)`)
}
