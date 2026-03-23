# Changelog

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
