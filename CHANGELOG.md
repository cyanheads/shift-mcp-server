# Changelog

## [0.1.5] - 2026-03-23

### Added

- Resource change notifications — `shift://status` subscribers receive live updates on check-in and check-out via `ctx.notifyResourceUpdated`

### Changed

- Bumped `@cyanheads/mcp-ts-core` from `^0.1.25` to `^0.1.26`

## [0.1.4] - 2026-03-23

### Changed

- Package renamed from `shift-mcp-server` to `@cyanheads/shift-mcp-server` (npm scoped package)
- Updated all references in `server.json`, `README.md`, and `CLAUDE.md` to use scoped package name

## [0.1.3] - 2026-03-23

### Changed

- `shift_check_in` and `shift_check_out` now validate `workerId` with regex pattern (`/^[A-Z0-9]{6}$/`)
- `shift_check_out` is now idempotent — succeeds silently when worker ID doesn't exist or was already checked out
- Exported `WORKER_ID_PATTERN` constant from worker store

## [0.1.2] - 2026-03-23

### Added

- Unit tests for `shift_check_in` tool (new sessions, updates, patch semantics, format output)
- Unit tests for `shift_check_out` tool (handler, error cases, format output)
- Unit tests for worker store (`generateWorkerId`, `formatWorkersTable`, `workers` map)
- Unit tests for `shift://status` resource (handler, list, format)

### Changed

- Package keywords expanded with `ai-agents`, `agent-coordination`, `typescript`

## [0.1.1] - 2026-03-23

### Added

- LICENSE file (Apache-2.0)
- `bunfig.toml` for Bun runtime configuration
- OCI source label in Dockerfile
- `lint:mcp` script for MCP definition validation
- Package metadata: `mcpName`, `homepage`, `bugs`, `author`, `packageManager`

### Changed

- README rewritten with badges, detailed tool documentation, getting started guide, configuration table, Docker instructions, and project structure
- CLAUDE.md code examples updated with real tool/resource implementations
- Server name namespaced to `io.github.cyanheads/shift-mcp-server` in `server.json`
- Runtime hint changed from `node` to `bun` in `server.json`
- Worker store escapes pipe characters in markdown table output
- `devcheck.config.json` ignores expanded (`depcheck`, `tsx`)

### Removed

- Echo scaffold test files (replaced by real implementation)

## [0.1.0] - 2026-03-23

### Added

- `shift_check_in` tool — register or update a worker session with gist and file declarations
- `shift_check_out` tool — end a working session and remove from active worker list
- `shift://status` resource — read-only view of all active workers with gists, files, and timestamps
- In-memory worker session store with 6-character alphanumeric ID generation
- Coordination protocol instructions returned on every check-in
- Patch semantics for session updates (omitted fields preserved)
- Error responses include active workers table for self-identification
- Directory structure documentation (`docs/tree.md`)
