<p align="center">
  <img src="assets/banner.jpg" alt="MCP Local RAG — Search below the surface." width="600" />
</p>

# MCP Local RAG

[![GitHub stars](https://img.shields.io/github/stars/shinpr/mcp-local-rag?style=social)](https://github.com/shinpr/mcp-local-rag)
[![npm version](https://img.shields.io/npm/v/mcp-local-rag.svg)](https://www.npmjs.com/package/mcp-local-rag)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-green.svg)](https://registry.modelcontextprotocol.io/)

Local RAG for developers via MCP or CLI.
Semantic search with keyword boost for exact technical terms — fully private, zero setup.

## Features

- **Semantic search with keyword boost**
  Vector search first, then keyword matching boosts exact matches. Terms like `useEffect`, error codes, and class names rank higher—not just semantically guessed.

- **Smart semantic chunking**
  Chunks documents by meaning, not character count. Uses embedding similarity to find natural topic boundaries—keeping related content together and splitting where topics change.

- **Quality-first result filtering**
  Groups results by relevance gaps instead of arbitrary top-K cutoffs. Get fewer but more trustworthy chunks.

- **Runs entirely locally**
  No API keys, no cloud, no data leaving your machine. Works fully offline after the first model download.

- **Zero-friction setup**
  One `npx` command. No Docker, no Python, no servers to manage.
  Use via MCP, CLI, or both. Optional [Agent Skills](#agent-skills) help AI assistants form better queries and interpret results.

## Quick Start

Set `BASE_DIR` to the folder you want to search (or `BASE_DIRS` for multiple roots — see [Configuration](#configuration)). Documents must live under one of the configured roots.

Add the MCP server to your AI coding tool:

**For Cursor** — Add to `~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "local-rag": {
      "command": "npx",
      "args": ["-y", "mcp-local-rag"],
      "env": {
        "BASE_DIR": "/path/to/your/documents"
      }
    }
  }
}
```

**For Codex** — Add to `~/.codex/config.toml`:
```toml
[mcp_servers.local-rag]
command = "npx"
args = ["-y", "mcp-local-rag"]

[mcp_servers.local-rag.env]
BASE_DIR = "/path/to/your/documents"
```

**For Claude Code** — Run this command:
```bash
claude mcp add local-rag --scope user --env BASE_DIR=/path/to/your/documents -- npx -y mcp-local-rag
```

Restart your tool, then start using it:

```
You: "Ingest api-spec.pdf"
Assistant: Successfully ingested api-spec.pdf (47 chunks created)

You: "What does the API documentation say about authentication?"
Assistant: Based on the documentation, authentication uses OAuth 2.0 with JWT tokens.
          The flow is described in section 3.2...
```

**Or use directly as CLI** — no MCP server needed:

```bash
npx mcp-local-rag ingest ./docs/
npx mcp-local-rag query "authentication API"
```

That's it. No Docker, no Python, no server setup.

## Why This Exists

You want AI to search your documents—technical specs, research papers, internal docs. But most solutions send your files to external APIs.

**Privacy.** Your documents might contain sensitive data. This runs entirely locally.

**Cost.** External embedding APIs charge per use. This is free after the initial model download.

**Offline.** Works without internet after setup.

**Code search.** Pure semantic search misses exact terms like `useEffect` or `ERR_CONNECTION_REFUSED`. Keyword boost catches both meaning and exact matches.

**Agent reality.** In practice, many AI environments mainly use tool calling. CLI support and Agent Skills make the same workflows available even without full MCP integration.

## Usage

mcp-local-rag provides two interfaces: an **MCP server** for AI coding tools and a **CLI** for direct use from the terminal.

### Using with MCP

The MCP server provides 7 tools: `ingest_file`, `ingest_data`, `query_documents`, `read_chunk_neighbors`, `list_files`, `delete_file`, `status`.

#### Ingesting Documents

```
"Ingest the document at /Users/me/docs/api-spec.pdf"
```

Supports PDF, DOCX, TXT, and Markdown. The server extracts text, splits it into chunks, generates embeddings locally, and stores everything in a local vector database.

Re-ingesting the same file replaces the old version automatically.

##### Ingesting PDFs with figures (visual mode)

PDFs with charts, tables, or diagrams can optionally add local VLM-generated captions to the document index, giving visual content some searchable representation in the same vector + FTS pipeline. Captions are auxiliary text — not image search, not OCR, and not a faithful transcription of the figure.

**Via MCP**:
```
"Ingest /Users/me/docs/api-spec.pdf with visual: true"
```

**Via CLI**:
```bash
npx mcp-local-rag ingest ./docs/spec.pdf --visual
```

Each caption is emitted as its own chunk with the envelope `[Visual content on page N: …]`, alongside the page-body chunks. It flows through the existing embedder and FTS index — no schema differences, no separate index.

Visual mode is opt-in; normal ingest does not load the VLM. Per-page VLM failures are tolerated — that page proceeds with text only.

###### Choosing a visual-quality profile

Visual mode offers two profiles, selected per ingest call:

| Profile | Model | Disk (cache) | Per-page inference | Suited for |
|---|---|---|---|---|
| `fast` (default) | `HuggingFaceTB/SmolVLM-256M-Instruct` | ~250 MB | baseline | Light visual indexing, quick first-run setup. |
| `quality` | `onnx-community/Qwen2.5-VL-3B-Instruct-ONNX` | ~2.9 GB | ~2× `fast` | Figures with in-image text (axis labels, panel sub-labels, annotations) where caption fidelity matters more than inference time. |

The numbers above are measured on CPU during development on the project's probe PDFs; they may shift with model updates or differ on your hardware.

**Via MCP** — `ingest_file` accepts an optional `visualQuality` parameter (enum: `'fast' | 'quality'`, default `'fast'`; ignored when `visual` is false):
```
"Ingest /Users/me/docs/research-paper.pdf with visual: true and visualQuality: 'quality'"
```

**Via CLI** — `--visual-quality fast|quality` (default `fast`; silently ignored when `--visual` is absent):
```bash
npx mcp-local-rag ingest ./docs/research-paper.pdf --visual --visual-quality quality
```

Profile model identifiers and quantization variants are fixed per release. Both profiles share the same `CACHE_DIR` (default: `./models/`); the first run on each profile downloads its model.

> **Behavior change from v0.14.0**: Captions are now emitted as dedicated chunks rather than appended to the page text before chunking. As a side effect, `metadata.fileSize` for visual ingests no longer includes the caption character count — it measures the post-extraction body length only. The underlying PDF is unchanged; only the reported `fileSize` for visual-ingested PDFs may shrink across the release boundary.

> **Security note**: Visual captions are derived from PDF contents and may inherit attacker-controlled text. Downstream LLM consumers should treat retrieved chunks as untrusted data, not as instructions. The `[Visual content on page N: …]` envelope helps consumers distinguish caption text from prose.

#### Ingesting HTML Content

Use `ingest_data` to ingest HTML content retrieved by your AI assistant (via web fetch, curl, browser tools, etc.):

```
"Fetch https://example.com/docs and ingest the HTML"
```

The server extracts main content using Readability (removes navigation, ads, etc.), converts to Markdown, and indexes it. Perfect for:
- Web documentation
- HTML retrieved by the AI assistant
- Clipboard content

HTML is automatically cleaned—you get the article content, not the boilerplate.

> **Note:** The RAG server itself doesn't fetch web content—your AI assistant retrieves it and passes the HTML to `ingest_data`. This keeps the server fully local while letting you index any content your assistant can access. Please respect website terms of service and copyright when ingesting external content.

#### Searching Documents

```
"What does the API documentation say about authentication?"
"Find information about rate limiting"
"Search for error handling best practices"
```

Search uses semantic similarity with keyword boost. This means `useEffect` finds documents containing that exact term, not just semantically similar React concepts.

Results include text content, source file, document title, and relevance score. The document title provides context for each chunk, helping identify which document a result belongs to. Adjust result count with `limit` (1-20, default 10).

Narrow a search to part of your corpus with `scope` — one path prefix or a list of them. Results are restricted to chunks whose file path equals a prefix or sits under it (exact-or-descendant). For example, `"/docs/api"` matches `/docs/api` and `/docs/api/auth.md` but not `/docs/apiv2`; a file prefix like `"/docs/readme.md"` matches just that file. Pass prefixes in the server's OS path style.

#### Expanding Context Around a Result

When a search result needs more surrounding context, use `read_chunk_neighbors` to read the chunks before and after it:

```
"That result about authentication looks relevant — read the surrounding chunks for the full explanation"
```

Pass the `filePath` and `chunkIndex` from the search result. The response includes the target chunk (marked `isTarget: true`) plus its neighbors, sorted by chunk index. Defaults to 2 chunks before and 2 after (adjustable up to 50 each).

#### Managing Files

```
"List all files in configured base directories and their ingested status"   # See what's indexed
"Delete old-spec.pdf from RAG"     # Remove a file
"Show RAG server status"           # Check system health
```

Narrow the listing with `scope` on `list_files` — one path prefix or a list of them. Results are restricted to files reachable at a path equal to or under a prefix (exact-or-descendant); for example, `"/docs/api"` matches `/docs/api` and `/docs/api/auth.md` but not `/docs/apiv2`. Raw-data sources (from `ingest_data`) stay listed regardless of scope. On large volumes, scope also speeds up the listing by skipping out-of-scope directories during the scan.

### Using as CLI

All MCP tools are also available as CLI commands — no MCP server needed:

```bash
npx mcp-local-rag ingest ./docs/               # Bulk ingest files
npx mcp-local-rag query "authentication API"    # Search documents
npx mcp-local-rag query "auth" --scope /docs/api --scope /docs/guide  # Restrict to path prefixes (repeatable)
npx mcp-local-rag read-neighbors --file-path /abs/path.md --chunk-index 5  # Expand context
npx mcp-local-rag list                          # Show ingestion status
npx mcp-local-rag list --scope /docs/api --scope /docs/guide  # Restrict listing to path prefixes (repeatable)
npx mcp-local-rag status                        # Database stats
npx mcp-local-rag delete ./docs/old.pdf         # Remove content
npx mcp-local-rag delete --source "https://..."  # Remove by source URL
npx mcp-local-rag duplicates list               # List duplicate document groups
npx mcp-local-rag duplicates list --include-deprecated --format json  # Include deprecated as JSON
npx mcp-local-rag duplicates cleanup --dry-run  # Preview cleanup without executing
```

`query`, `read-neighbors`, `list`, `status`, and `delete` output JSON to stdout for piping (e.g., `| jq`). `ingest` outputs progress to stderr. Global options (`--db-path`, `--cache-dir`, `--model-name`) go before the subcommand. Run `npx mcp-local-rag --help` for details.

> ⚠️ The CLI does **not** read your MCP client config (`mcp.json`, `config.toml`, etc.). Configure the CLI via flags or environment variables as shown below.

### Command-Line Examples

#### Basic usage

```bash
# Ingest a single file
npx mcp-local-rag ingest ./docs/api-spec.pdf

# Ingest an entire directory
npx mcp-local-rag ingest ./docs/

# Search documents
npx mcp-local-rag query "authentication API"

# Search with custom limit
npx mcp-local-rag query "authentication" --limit 5

# List all ingested files
npx mcp-local-rag list

# Show database statistics
npx mcp-local-rag status
```

#### Using custom paths

```bash
# Use custom database location
npx mcp-local-rag --db-path ./my-db query "authentication"

# Use custom model cache directory
npx mcp-local-rag --cache-dir ./cache query "search term"

# Use custom model (must match MCP server's MODEL_NAME)
npx mcp-local-rag --model-name Xenova/all-MiniLM-L6-v2 query "search"
```

#### Multi-root document directories

```bash
# Ingest with multiple document roots
npx mcp-local-rag ingest --base-dir ./docs --base-dir ./specs ./docs/readme.md

# List files from specific roots
npx mcp-local-rag list --base-dir ./docs --base-dir ./specs

# Search only in API documentation
npx mcp-local-rag query "auth" --scope /docs/api
```

#### Search tuning

```bash
# Search with keyword boost (higher value = stronger keyword matching)
RAG_HYBRID_WEIGHT=0.7 npx mcp-local-rag query "useEffect"

# Get only top result group
RAG_GROUPING=similar npx mcp-local-rag query "error handling"

# Filter by relevance threshold
RAG_MAX_DISTANCE=0.5 npx mcp-local-rag query "authentication"

# Limit to single best file
RAG_MAX_FILES=1 npx mcp-local-rag query "API documentation"
```

#### Using llama.cpp backend

```bash
# Ingest with llama.cpp backend
EMBEDDING_BACKEND=llama-cpp LLAMA_CPP_SERVER_URL=http://127.0.0.1:8080 \
  npx mcp-local-rag ingest ./docs/

# Search with llama.cpp backend
EMBEDDING_BACKEND=llama-cpp LLAMA_CPP_BATCH_SIZE=32 \
  npx mcp-local-rag query "technical terms"
```

#### Visual PDF mode

```bash
# Ingest PDF with visual captions (fast profile)
npx mcp-local-rag ingest ./docs/paper.pdf --visual

# Ingest PDF with quality profile
npx mcp-local-rag ingest ./docs/paper.pdf --visual --visual-quality quality
```

#### Piping results

```bash
# Search and filter with jq
npx mcp-local-rag query "authentication" | jq '.results[] | select(.score > 0.7)'

# Search and count results
npx mcp-local-rag query "error handling" | jq '.results | length'

# Search and extract file paths only
npx mcp-local-rag query "API" | jq -r '.results[].filePath'
```

#### Configuration with environment variables

```bash
# Set all configuration in one command
export BASE_DIR=./docs
export DB_PATH=./lancedb
export RAG_HYBRID_WEIGHT=0.7

npx mcp-local-rag query "authentication"
```

#### Configuration priority

1. **CLI flags** (highest priority) — `npx mcp-local-rag --db-path ./my-db query "auth"`
2. **Environment variables** — `export DB_PATH=./my-db && npx mcp-local-rag query "auth"`
3. **Defaults** — applied when neither flags nor env vars are set

> ⚠️ The CLI does **not** read your MCP client config (`mcp.json`, `config.toml`, etc.). Configure the CLI via flags or environment variables as shown below.

#### Configuration

**CLI flags** — global options go before the subcommand, subcommand options go after:

```bash
npx mcp-local-rag --db-path ./my-db query "auth" --base-dir ./docs
```

The `--base-dir` flag is repeatable on `ingest` and `list`; pass it once per root:

```bash
npx mcp-local-rag ingest --base-dir ./docs --base-dir ./specs ./docs/readme.md
npx mcp-local-rag list --base-dir ./docs --base-dir ./specs
```

The positional path to `ingest` must sit inside one of the configured roots. When at least one `--base-dir` is supplied, CLI roots replace any env-var roots (no merge).

**Environment variables** — set in your shell:

```bash
export DB_PATH=./my-db
export BASE_DIR=./docs
npx mcp-local-rag query "auth"
```

For multiple roots, use `BASE_DIRS` (JSON array of non-empty path strings):

```bash
export BASE_DIRS='["/Users/me/Documents/work","/Users/me/Projects/specs"]'
npx mcp-local-rag list
```

**Sharing config between MCP and CLI** — if your MCP client inherits shell environment variables, you can set them in your shell profile (e.g., `~/.zshrc`) so both use the same values. Otherwise, set them explicitly in your MCP config as well.

```bash
export BASE_DIR=/path/to/your/documents
export DB_PATH=/path/to/lancedb
```

Configuration is resolved in this order:

1. CLI flags (highest priority)
2. Environment variables
3. Defaults

For the full list of CLI flags, environment variables, and defaults, see [Configuration](#configuration).

For CLI-only setups (no MCP server), install [Agent Skills](#agent-skills) so your AI assistant can form better queries and interpret results consistently.

> ⚠️ **CLI `--model-name` must match the MCP server's `MODEL_NAME` env var.** Using a different embedding model against an existing database produces incompatible vectors, silently degrading search quality.

## Search Tuning

Adjust these for your use case:

| Variable | Default | Description |
|----------|---------|-------------|
| `RAG_HYBRID_WEIGHT` | `0.6` | Keyword boost factor. 0 = semantic only, higher = stronger keyword boost. |
| `RAG_GROUPING` | (not set) | `similar` for top group only, `related` for top 2 groups. |
| `RAG_MAX_DISTANCE` | (not set) | Filter out low-relevance results (e.g., `0.5`). |
| `RAG_MAX_FILES` | (not set) | Limit results to top N files (e.g., `1` for single best file). |

### Code-focused tuning

For codebases and API specs, increase keyword boost so exact identifiers (`useEffect`, `ERR_*`, class names) dominate ranking:

```json
"env": {
  "RAG_HYBRID_WEIGHT": "0.7",
  "RAG_GROUPING": "similar"
}
```

- `0.7` — balanced semantic + keyword
- `1.0` — aggressive; exact matches strongly rerank results

Keyword boost is applied *after* semantic filtering, so it improves precision without surfacing unrelated matches.

## How It Works

**TL;DR:**
- Documents are chunked by semantic similarity, not fixed character counts
- Each chunk is embedded locally using Transformers.js
- Search uses semantic similarity with keyword boost for exact matches
- Results are filtered based on relevance gaps, not raw scores

### Details

When you ingest a document, the parser extracts text based on file type (PDF via `mupdf`, DOCX via `mammoth`, text files directly).

The semantic chunker splits text into sentences, then groups them using embedding similarity. It finds natural topic boundaries where the meaning shifts—keeping related content together instead of cutting at arbitrary character limits. This produces chunks that are coherent units of meaning, typically 500-1000 characters. Markdown code blocks are kept intact—never split mid-block—preserving copy-pastable code in search results.

Each chunk goes through a Transformers.js embedding model (default: `all-MiniLM-L6-v2`, configurable via `MODEL_NAME`), converting text into vectors. Vectors are stored in LanceDB, a file-based vector database requiring no server process.

When you search:
1. Your query becomes a vector using the same model
2. Semantic (vector) search finds the most relevant chunks
3. Quality filters apply (distance threshold, grouping)
4. Keyword matches boost rankings for exact term matching

The keyword boost ensures exact terms like `useEffect` or error codes rank higher when they match.

## Agent Skills

[Agent Skills](https://agentskills.io/) provide optimized prompts that help AI assistants use RAG tools more effectively. Install skills for better query formulation, result interpretation, and ingestion workflows:

```bash
# Claude Code (project-level)
npx mcp-local-rag skills install --claude-code

# Claude Code (user-level)
npx mcp-local-rag skills install --claude-code --global

# Codex
npx mcp-local-rag skills install --codex
```

Skills include:
- **Query optimization**: Better search query formulation
- **Result interpretation**: Score thresholds and filtering guidelines
- **HTML ingestion**: Format selection and source naming

### Ensuring Skill Activation

Skills are loaded automatically in most cases—AI assistants scan skill metadata and load relevant instructions when needed. For consistent behavior:

**Option 1: Explicit request (natural language)**
Before RAG operations, request in natural language:
- "Use the mcp-local-rag skill for this search"
- "Apply RAG best practices from skills"

**Option 2: Add to agent instruction file**
Add to your `AGENTS.md`, `CLAUDE.md`, or other agent instruction file:
```
When using query_documents, ingest_file, or ingest_data tools,
apply the mcp-local-rag skill for better query formulation and result interpretation.
```

## Configuration

### Automatic .env Loading

mcp-local-rag automatically loads `.env` from the current working directory on every startup. Variables from `.env` are only applied if they are not already set from the external environment (shell, docker-compose, CI/CD).

The `.env` file is automatically added to `.gitignore` on first load.

**Recommended variables** (warnings shown at startup if missing):

| Variable | Description |
|----------|-------------|
| `BASE_DIR` | Document root directory |
| `DB_PATH` | Vector database location |
| `CACHE_DIR` | Model cache directory |
| `MODEL_NAME` | HuggingFace model ID |
| `EMBEDDING_BACKEND` | Embedding backend: `transformers` or `llama-cpp` |
| `RAG_DEVICE` | Execution device: `cpu` or `webgpu` |

**Disable configuration warnings:**
```bash
export RAG_QUIET_CONFIG=1
```

### Environment Variables and CLI Flags

The MCP server is configured by environment variables only — pass them through your MCP client's `env` block. The CLI accepts the same env vars plus equivalent flags (priority: CLI flag > env > default). CLI flags are not accepted on the bare `mcp-local-rag` (MCP server) launch.

| Environment Variable | CLI Flag | Default | Description |
|---------------------|----------|---------|-------------|
| `BASE_DIR` | `--base-dir` (repeatable) | Current directory | Single document root directory (security boundary). See [Document Roots](#document-roots-base_dir-and-base_dirs) for multi-root setup. |
| `BASE_DIRS` | — | (unset) | JSON array of document roots (security boundary). Takes precedence over `BASE_DIR`. See [Document Roots](#document-roots-base_dir-and-base_dirs). |
| `DB_PATH` | `--db-path` | `./lancedb/` | Vector database location |
| `CACHE_DIR` | `--cache-dir` | `./models/` | Model cache directory |
| `MODEL_NAME` | `--model-name` | `Xenova/all-MiniLM-L6-v2` | HuggingFace model ID ([available models](https://huggingface.co/models?library=transformers.js&pipeline_tag=feature-extraction)) |
| `MAX_FILE_SIZE` | `--max-file-size` | `104857600` (100MB) | Maximum file size in bytes |
| `CHUNK_MIN_LENGTH` | `--chunk-min-length` | `50` | Minimum chunk length in characters (1–10000) |
| `RAG_DEVICE` | — | `cpu` | Execution device. Passed straight to ONNX Runtime. See the [Transformers.js device source code](https://github.com/huggingface/transformers.js/blob/main/packages/transformers/src/utils/devices.js) for the live list of supported backend names. If initialization fails, the server throws an error. |
| `RAG_DTYPE` | — | `fp32` | Embedding quantization dtype. Opt-in and passed straight through; accepts any dtype the chosen model provides (`fp32`, `fp16`, `q8`, `int8`, …). If the model lacks the requested variant, the server throws an error naming the dtypes it does provide. Changing `RAG_DEVICE`/`RAG_DTYPE` changes the embedding space — re-ingest existing data. |

**Model choice tips:**
- Multilingual docs → e.g., `onnx-community/embeddinggemma-300m-ONNX` (100+ languages)
- Scientific papers → e.g., `sentence-transformers/allenai-specter` (citation-aware)
- Code repositories → default often suffices; keyword boost matters more (or `jinaai/jina-embeddings-v2-base-code`)

⚠️ Changing `MODEL_NAME` changes embedding dimensions. Delete `DB_PATH` and re-ingest after switching models.

### llama.cpp Backend (Local LLM)

For users who want to leverage modern embedding models available only in GGUF format (e.g., **Qwen3-Embedding-4B**, **nomic-embed-text-v1.5**), mcp-local-rag supports a secondary embedding backend powered by llama.cpp.

**Supported models:**

| Model | Dimensions | Source |
|-------|------------|--------|
| Qwen/Qwen3-Embedding-4B | 4096 | [HuggingFace](https://huggingface.co/Qwen/Qwen3-Embedding-4B) |
| nomic-ai/nomic-embed-text-v1.5 | 768 | [HuggingFace](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) |

**Setup:**

1. Install llama.cpp and download a GGUF embedding model:
   ```bash
   # Download Qwen3-Embedding-4B
   huggingface-cli download Qwen/Qwen3-Embedding-4B --include "*.gguf"
   ```

2. Start the llama.cpp server:
   ```bash
   llama-server --model ./Qwen3-Embedding-4B.gguf --port 8080 --embedding
   ```

3. Configure mcp-local-rag to use the llama.cpp backend:

   **MCP client (Cursor/Codex/Claude Code):**
   ```json
   {
     "mcpServers": {
       "local-rag": {
         "command": "npx",
         "args": ["-y", "mcp-local-rag"],
         "env": {
           "BASE_DIR": "/path/to/your/documents",
           "EMBEDDING_BACKEND": "llama-cpp",
           "LLAMA_CPP_SERVER_URL": "http://127.0.0.1:8080"
         }
       }
     }
   }
   ```

   **CLI:**
   ```bash
   EMBEDDING_BACKEND=llama-cpp LLAMA_CPP_SERVER_URL=http://127.0.0.1:8080 \
     npx mcp-local-rag ingest ./docs/
   ```

**Configuration options:**

| Environment Variable | CLI Flag | Default | Description |
|---------------------|----------|---------|-------------|
| `EMBEDDING_BACKEND` | `--embedding-backend` | `transformers` | Backend: `transformers` or `llama-cpp` |
| `LLAMA_CPP_SERVER_URL` | — | `http://127.0.0.1:8080` | llama.cpp server URL |
| `LLAMA_CPP_BATCH_SIZE` | — | `16` | Batch size (1–128). Texts are sent in batches via a single HTTP request `input: string[]`. |
| `LLAMA_CPP_BATCH_INTERVAL` | — | `1000` | Interval between batch requests to llama.cpp server (ms). Helps avoid rate limiting under high load. |
| `LLAMA_CPP_TIMEOUT` | — | `30000` | Request timeout in milliseconds (1000–300000) |
| `RAG_LLAMA_CPP_DIMENSIONS` | — | `4096` | Override embedding dimensions (for non-Qwen3 models) |

**Advantages:**
- Access to modern GGUF models not available in Transformers.js
- GPU acceleration via CUDA/Vulkan (if supported by your hardware)
- Server can run on a separate machine

**Limitations:**
- Requires a separate llama.cpp server process
- HTTP latency (~5-15ms per request)
- No automatic model management

### PostgreSQL Vector Database Backend

For enterprise scenarios (distributed storage, replication, SQL filtering), mcp-local-rag supports PostgreSQL as a vector database backend with pgvector extension.

**Requirements:**
- PostgreSQL 14+ with pgvector extension installed:
  ```sql
  CREATE EXTENSION vector;
  ```

**Configuration:**

**MCP client (Cursor/Codex/Claude Code):**
```json
{
  "mcpServers": {
    "local-rag": {
      "command": "npx",
      "args": ["-y", "mcp-local-rag"],
      "env": {
        "BASE_DIR": "/path/to/your/documents",
        "VECTORDB_BACKEND": "postgresql",
        "PG_HOST": "localhost",
        "PG_PORT": "5432",
        "PG_DATABASE": "mcp_local_rag",
        "PG_USER": "postgres",
        "PG_PASSWORD": "postgres",
        "PG_SSL_MODE": "disable"
      }
    }
  }
}
```

**CLI:**
```bash
VECTORDB_BACKEND=postgresql PG_HOST=localhost PG_DATABASE=mcp_local_rag \
  PG_USER=postgres PG_PASSWORD=postgres \
  npx mcp-local-rag ingest ./docs/
```

**Configuration options:**

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `VECTORDB_BACKEND` | `lancedb` | Vector DB backend: `lancedb` or `postgresql` |
| `PG_HOST` | `localhost` | PostgreSQL server host |
| `PG_PORT` | `5432` | PostgreSQL port |
| `PG_DATABASE` | (required) | Database name |
| `PG_USER` | (required) | Database user |
| `PG_PASSWORD` | (required) | Database password |
| `PG_SSL_MODE` | `disable` | SSL mode: disable, allow, prefer, require, verify-ca, verify-full |
| `PG_MAX_POOL_SIZE` | `20` | Maximum connection pool size (1–100) |
| `PG_MIN_POOL_SIZE` | `0` | Minimum connection pool size (0–100) |
| `RAG_EMBEDDING_DIMENSIONS` | `384` | Embedding dimension for pgvector (384 for all-MiniLM-L6-v2, 4096 for Qwen3-Embedding-4B) |
| `RAG_IVF_LISTS` | `100` | IVFFlat index lists count (1–10000) |

**Backend comparison:**

| Feature | LanceDB | PostgreSQL |
|---------|---------|------------|
| Storage | File-based (local) | Server database |
| Scaling | Single-node | Replication, clusters |
| Transactions | None | Full support |
| Connection pooling | None | Built-in |
| SQL filtering | None | Full support |
| Dependencies | ~10 MB (@lancedb/lancedb) | ~100 KB (pg) |
| pgvector index | IVFFlat/HNSW | IVFFlat/HNSW |
| Keyword boost | FTS (ngram) | pg_trgm |

### Duplicate Handling

mcp-local-rag tracks document duplicates using SHA-256 content hashing. When the same file (by content) is ingested multiple times, the system can either skip it, update the existing entry, or track both versions.

**Modes:**

| Mode | Behavior |
|------|----------|
| `skip` (default) | Skip loading, return a warning |
| `update` | Update existing document (mark old chunks as deprecated) |
| `track` | Save both instances with a duplicate mark |

**Configuration:**

Via environment variable:
```bash
export DUPLICATE_MODE=skip
```

Via CLI flag (ingest subcommand):
```bash
npx mcp-local-rag --duplicate-mode update ingest ./docs/
```

**CLI Output:**

When ingesting a duplicate file, the CLI shows the status:
```
[1/3] ./docs/guide.pdf ... OK (42 chunks)
[2/3] ./docs/guide.pdf ... OK (42 chunks) (updated, dup: ./docs/guide.pdf)
[3/3] ./docs/other.pdf ... OK (15 chunks)
```

**Mechanism:**

1. SHA-256 content hash is computed before chunking
2. `vectorStore.getDuplicatesByHash()` checks for existing duplicates in the database
3. When a duplicate is found, the configured mode is applied:
   - `skip`: loading is cancelled, chunks are not inserted
   - `update`: old chunks are marked as deprecated via `vectorStore.markDeprecated()`
   - `track`: both instances are saved without changes

**Schema Changes:**

- **LanceDB:** Added `status` column (active/deprecated) and `contentHash` column to chunks table; creates `duplicates` table on first insertion.
- **PostgreSQL:** Added `status` column to `chunks` table; creates `duplicates` table during `initialize()`.

**CLI Subcommands:**

Two new CLI subcommands manage duplicate documents:

```bash
# List all duplicate groups
npx mcp-local-rag duplicates list

# List with deprecated entries included
npx mcp-local-rag duplicates list --include-deprecated

# Output as JSON for piping
npx mcp-local-rag duplicates list --format json

# Preview cleanup without executing
npx mcp-local-rag duplicates cleanup --dry-run

# Execute cleanup (removes deprecated chunks)
npx mcp-local-rag duplicates cleanup
```

**`duplicates list` options:**

| Option | Description |
|--------|-------------|
| `--include-deprecated` | Include deprecated entries in results |
| `--format <format>` | Output format: `human` or `json` (default: `human`) |
| `-h, --help` | Show help |

**`duplicates cleanup` options:**

| Option | Description |
|--------|-------------|
| `--dry-run` | Show what would be removed without making changes |
| `-h, --help` | Show help |

**Example output (human-readable):**

```
Found 2 duplicate group(s), 5 total duplicate(s)

Hash: a1b2c3d4e5f6...
  Files:
    - /Users/me/docs/api-spec.pdf
    - /Users/me/docs/api-spec-backup.pdf

Hash: f6e5d4c3b2a1...
  Files:
    - /Users/me/docs/guide.pdf
    - /Users/me/docs/guide.pdf [deprecated]
    - /Users/me/docs/guide-old.pdf
```

**Implemented:**

- SHA-256 content hash computation in `handleIngestFile` (MCP server) and `ingestSingleFile` (CLI) via `computeContentHash()`
- `IngestResult.contentHash` field: SHA-256 hex digest (64 characters) or `null` if computation failed
- `IngestResult.status` field: `'new' | 'skipped' | 'updated' | 'tracked'`
- Duplicate detection logic in ingest pipeline with `DUPLICATE_MODE` support (both MCP and CLI)
- CLI `--duplicate-mode` flag for ingest subcommand
- `DuplicateStore` class with `add()`, `findByHash()`, `findDuplicates()`, `getAll()`, `remove()` methods
- `isDuplicate` field in `IngestedFileSummary` for `list_files` — returned in `list_files` tool response and CLI `list` output
- `DUPLICATE_MODE` validation in `tool-input.ts` — rejects invalid values at startup with `McpError(InvalidParams)`

**Pending (next iteration):**

- MCP tools: `list_duplicates`, `cleanup_duplicates`
- Unit tests for `computeContentHash()` and `DuplicateStore`
- Integration tests for `handleIngestFile` with duplicates

### Document Roots (`BASE_DIR` and `BASE_DIRS`)

mcp-local-rag enforces a security boundary: only files under a configured root are accessible to ingest, list, delete, or read-neighbor operations.

**Single root** — use `BASE_DIR`:

```bash
export BASE_DIR=/Users/me/Documents/work
```

**Multiple roots** — use `BASE_DIRS` with a JSON array:

```bash
export BASE_DIRS='["/Users/me/Documents/work","/Users/me/Projects/specs"]'
```

Only JSON-array syntax is supported. Delimiter syntax such as `BASE_DIRS=/a:/b` is intentionally **not** supported (avoids ambiguity with spaces, colons, commas, and Windows paths).

**Resolution order** (highest precedence first):

1. CLI `--base-dir <path>` flags (repeatable on `ingest` and `list`)
2. `BASE_DIRS` environment variable
3. `BASE_DIR` environment variable
4. `process.cwd()` (current working directory)

CLI roots **replace** env roots — they are never merged. `BASE_DIRS` and `BASE_DIR` are never merged either: `BASE_DIRS` wins when both are set.

**Precedence warning** — when `BASE_DIRS` and `BASE_DIR` are both set (and no CLI `--base-dir` is supplied), `BASE_DIR` is ignored and a warning is surfaced. The warning is visible:

- In MCP tool responses (as an additional content block, on every tool — including `status`, `query_documents`, `ingest_file`, `ingest_data`, `list_files`, `delete_file`, `read_chunk_neighbors`).
- On CLI `stderr`.

Unset `BASE_DIR` (or remove `BASE_DIRS`) to silence the warning.

**Nested-root pruning** — if one configured root sits inside another after realpath resolution, the nested child is dropped to avoid duplicate scan results. A pruning warning is surfaced the same way as the precedence warning. The surviving parent root still defines the security boundary.

**Invalid `BASE_DIRS`** — when `BASE_DIRS` is not a valid JSON array of non-empty strings (malformed JSON, empty array, non-string elements, ...), root-dependent MCP tools return a structured error and CLI subcommands exit non-zero. There is **no silent fallback** to `BASE_DIR` or `cwd`. The MCP `status` tool remains callable so you can diagnose the config error through your MCP client.

**MCP client examples** — multi-root setup:

Cursor (`~/.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "local-rag": {
      "command": "npx",
      "args": ["-y", "mcp-local-rag"],
      "env": {
        "BASE_DIRS": "[\"/Users/me/Documents/work\",\"/Users/me/Projects/specs\"]"
      }
    }
  }
}
```

Codex (`~/.codex/config.toml`):
```toml
[mcp_servers.local-rag]
command = "npx"
args = ["-y", "mcp-local-rag"]

[mcp_servers.local-rag.env]
BASE_DIRS = "[\"/Users/me/Documents/work\",\"/Users/me/Projects/specs\"]"
```

Claude Code:
```bash
claude mcp add local-rag --scope user \
  --env BASE_DIRS='["/Users/me/Documents/work","/Users/me/Projects/specs"]' \
  -- npx -y mcp-local-rag
```

**CLI examples** — multi-root invocations:

```bash
# Repeatable --base-dir
npx mcp-local-rag ingest --base-dir /Users/me/work --base-dir /Users/me/specs /Users/me/work/readme.md
npx mcp-local-rag list --base-dir /Users/me/work --base-dir /Users/me/specs

# Or via BASE_DIRS env
BASE_DIRS='["/Users/me/work","/Users/me/specs"]' npx mcp-local-rag list
```

### Client-Specific Setup

**Cursor** — Global: `~/.cursor/mcp.json`, Project: `.cursor/mcp.json`

```json
{
  "mcpServers": {
    "local-rag": {
      "command": "npx",
      "args": ["-y", "mcp-local-rag"],
      "env": {
        "BASE_DIR": "/path/to/your/documents"
      }
    }
  }
}
```

**Codex** — `~/.codex/config.toml` (note: must use `mcp_servers` with underscore)

```toml
[mcp_servers.local-rag]
command = "npx"
args = ["-y", "mcp-local-rag"]

[mcp_servers.local-rag.env]
BASE_DIR = "/path/to/your/documents"
```

**Claude Code**:

```bash
claude mcp add local-rag --scope user \
  --env BASE_DIR=/path/to/your/documents \
  -- npx -y mcp-local-rag
```

### First Run

The embedding model (~90MB) downloads on first use. Takes 1-2 minutes, then works offline.

### Security

- **Path restriction**: Only files within a configured root (`BASE_DIR` or any `BASE_DIRS` / `--base-dir` entry) are accessible. Symlinks resolving outside all configured roots, and sibling-prefix paths (e.g. `/foo/barista` for root `/foo/bar`), are rejected.
- **Local only**: No network requests after model download
- **Model sources** (all official HuggingFace repositories):
  - Embedder: [`Xenova/all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2)
  - Visual `fast` profile: [`HuggingFaceTB/SmolVLM-256M-Instruct`](https://huggingface.co/HuggingFaceTB/SmolVLM-256M-Instruct)
  - Visual `quality` profile: [`onnx-community/Qwen2.5-VL-3B-Instruct-ONNX`](https://huggingface.co/onnx-community/Qwen2.5-VL-3B-Instruct-ONNX)
- **Visual caption fidelity**: The `quality` profile reproduces in-image text more faithfully than `fast`. Both profiles output captions wrapped as `[Visual content on page N: …]`, but a faithful reproduction means attacker-controlled in-image text — including characters like `]` that visually close the envelope — can appear verbatim in retrieved chunks. Downstream LLM consumers should treat retrieved chunks as untrusted data, not as instructions, regardless of envelope shape.

<details>
<summary><strong>Performance</strong></summary>

Tested on MacBook Pro M1 (16GB RAM), Node.js 22:

**Query Speed**: ~1.2 seconds for 10,000 chunks (p90 < 3s)

**Ingestion** (10MB PDF):
- PDF parsing: ~8s
- Chunking: ~2s
- Embedding: ~30s
- DB insertion: ~5s

**Memory**: ~200MB idle, ~800MB peak (50MB file ingestion)

**Concurrency**: Handles 5 parallel queries without degradation.

</details>

<details>
<summary><strong>Troubleshooting</strong></summary>

### "No results found"

Documents must be ingested first. Run `"List all ingested files"` to verify.

### Model download failed

Check internet connection. If behind a proxy, configure network settings. The model can also be [downloaded manually](https://huggingface.co/Xenova/all-MiniLM-L6-v2).

### "File too large"

Default limit is 100MB. Split large files or increase `MAX_FILE_SIZE`.

### Slow queries

Check chunk count with `status`. Large documents with many chunks may slow queries. Consider splitting very large files.

### "Path outside BASE_DIR"

Ensure file paths are within one of the configured roots (`BASE_DIR`, any `BASE_DIRS` entry, or any CLI `--base-dir`). Use absolute paths.

### "BASE_DIRS must be a JSON array..."

`BASE_DIRS` accepts only a JSON array of one or more non-empty path strings. Examples:

- Valid: `BASE_DIRS='["/Users/me/work","/Users/me/specs"]'`
- Invalid: `BASE_DIRS=/a:/b` (delimiter syntax not supported)
- Invalid: `BASE_DIRS='[]'` (empty array)
- Invalid: `BASE_DIRS='["",""]'` (empty string element)

When invalid, root-dependent operations fail with a clear error rather than silently falling back. The MCP `status` tool remains callable so you can inspect the diagnostic.

### MCP client doesn't see tools

1. Verify config file syntax
2. Restart client completely (Cmd+Q on Mac for Cursor)
3. Test directly: `npx mcp-local-rag` should run without errors

</details>

<details>
<summary><strong>FAQ</strong></summary>

**Is this really private?**
Yes. After model download, nothing leaves your machine. Verify with network monitoring.

**Can I use this offline?**
Yes, after the required models are cached locally. Text ingest/search needs the embedding model. PDF visual mode is opt-in and also needs the VLM model on first use; the download is ~250 MB for the default `fast` profile (SmolVLM-256M) or ~2.9 GB for the `quality` profile (Qwen2.5-VL-3B), cached under `CACHE_DIR` (default: `./models/`).

**How does this compare to cloud RAG?**
Cloud services offer better accuracy at scale but require sending data externally. This trades some accuracy for complete privacy and zero runtime cost.

**What file formats are supported?**
PDF, DOCX, TXT, Markdown, and HTML (via `ingest_data`). Not yet: Excel, PowerPoint, images.

**Can I change the embedding model?**
Yes, but you must delete your database and re-ingest all documents. Different models produce incompatible vector dimensions.

**GPU acceleration?**
Opt-in via `RAG_DEVICE`. Devices are passed straight to ONNX Runtime. GPU support is highly dependent on your system, Node.js version, and the underlying ONNX backend. See the [Transformers.js device source code](https://github.com/huggingface/transformers.js/blob/main/packages/transformers/src/utils/devices.js) for the live list of supported backend names. If the requested device fails to initialize, the server throws an error — set `RAG_DEVICE=cpu` to revert.

**Can I change the embedding precision (dtype)?**
Opt-in via `RAG_DTYPE` (default `fp32`); accepted values are in the env-var table above. A recognized dtype the model lacks errors and lists the available ones; an unrecognized value (a typo) silently falls back to `fp32`. Changing `RAG_DEVICE`/`RAG_DTYPE` changes the embedding space — delete `DB_PATH` and re-ingest.

**Multi-user support?**
No. Designed for single-user, local access. Multi-user would require authentication/access control.

**How to backup?**
Copy `DB_PATH` directory (default: `./lancedb/`).

</details>

<details>
<summary><strong>Development</strong></summary>

### Building from Source

```bash
git clone https://github.com/shinpr/mcp-local-rag.git
cd mcp-local-rag
pnpm install
```

### Testing

```bash
pnpm test              # Run all tests
pnpm run test:watch    # Watch mode
```

### Code Quality

```bash
pnpm run type-check    # TypeScript check
pnpm run check:fix     # Lint and format
pnpm run check:deps    # Circular dependency check
pnpm run check:all     # Full quality check
```

### Project Structure

```
src/
  index.ts      # Entry point
  server/       # MCP tool handlers
  cli/          # CLI subcommands (ingest, query, list, delete, read-neighbors, etc.)
  parser/       # PDF, DOCX, TXT, MD parsing
  chunker/      # Text splitting
  embedder/     # Transformers.js embeddings
  vectordb/     # LanceDB operations
  __tests__/    # Test suites
```

</details>

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and guidelines.

## License

MIT License. Free for personal and commercial use.

## Blog Posts

- [Building a Local RAG for Agentic Coding](https://www.norsica.jp/blog/local-rag-agentic-coding) — Technical deep-dive into the semantic chunking and hybrid search design.

## Acknowledgments

Built with [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic, [LanceDB](https://lancedb.com/), and [Transformers.js](https://huggingface.co/docs/transformers.js).
