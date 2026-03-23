# shift-mcp-server

Lightweight coordination layer for multiple AI agents working on the same codebase simultaneously. Not a project management system — just a "heads up, I'm here and working on X" signal so agents avoid stepping on each other.

## Tools

| Tool | Purpose |
|:-----|:--------|
| `shift_check_in` | Register or update a worker session. Returns worker ID, coordination instructions, and active peers. |
| `shift_check_out` | End a working session. Removes from active worker list. |

## Resources

| URI | Purpose |
|:----|:--------|
| `shift://status` | All currently active workers with gists, declared files, and timestamps. |

## How It Works

1. An agent calls `shift_check_in` with a gist of what it's working on and (optionally) the files it plans to modify.
2. The server assigns a 6-character worker ID and returns the full active workers table plus coordination instructions.
3. Other agents see the table on their own check-ins and can avoid file conflicts.
4. When done, agents call `shift_check_out` with their worker ID.

State is in-memory only — no database, no filesystem writes. Clears on server restart.

## Installation

```bash
bun install
bun run build
```

## Usage

```bash
# stdio transport
bun run start:stdio

# HTTP transport
bun run start:http
```

## Development

```bash
# Dev mode with watch
bun run dev:stdio

# Lint, format, typecheck
bun run devcheck

# Run tests
bun test
```

## License

Apache-2.0
