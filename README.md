<div align="center">
  <h1>shift-mcp-server</h1>
  <p><b>Lightweight coordination layer for multiple AI agents working on the same codebase. STDIO & Streamable HTTP</b></p>
  <p><b>2 Tools · 1 Resource</b></p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.1.3-blue.svg?style=flat-square)](./CHANGELOG.md) [![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-259?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^1.27.1-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![TypeScript](https://img.shields.io/badge/TypeScript-^5.9.3-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/)

</div>

---

## Tools

Two tools for multi-agent coordination:

| Tool Name | Description |
|:----------|:------------|
| `shift_check_in` | Register or update a worker session. Returns worker ID, coordination instructions, and active peers. |
| `shift_check_out` | End a working session. Removes from active worker list. |

### `shift_check_in`

Register a new worker or update an existing session. Called at the start of every working session.

- Accepts a gist of current work and optional file paths being modified
- Returns a 6-character worker ID, coordination protocol, and the full active workers table
- Pass an existing worker ID to update your session (patch semantics — omitted fields preserved)
- Error responses include the active workers table so agents can self-identify or start fresh

---

### `shift_check_out`

End a working session and remove from the active worker list.

- Accepts a worker ID and optional summary of what was accomplished
- Idempotent — succeeds silently if the worker ID doesn't exist or was already checked out

## Resources

| URI | Description |
|:----|:------------|
| `shift://status` | All currently active workers with gists, declared files, and timestamps. |

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core):

- Declarative tool definitions — single file per tool, framework handles registration and validation
- Unified error handling across all tools
- Structured logging with request-scoped context
- Runs locally (stdio/HTTP) from the same codebase

Coordination-specific:

- In-memory worker session store — no database, no filesystem writes, clears on restart
- Coordination protocol injected on every check-in so agents know how to behave
- Active workers table returned with every response for situational awareness
- Patch semantics on session updates — only provided fields change

## Getting Started

### MCP Client Config

Add to your MCP client config (e.g., `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "shift": {
      "type": "stdio",
      "command": "bunx",
      "args": ["shift-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio"
      }
    }
  }
}
```

### Prerequisites

- [Bun v1.2.0](https://bun.sh/) or higher

### Installation

```sh
git clone https://github.com/cyanheads/shift-mcp-server.git
cd shift-mcp-server
bun install
```

## Configuration

No server-specific environment variables required. Framework defaults:

| Variable | Description | Default |
|:---------|:------------|:--------|
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http`. | `stdio` |
| `MCP_HTTP_PORT` | Port for HTTP server. | `3010` |
| `MCP_HTTP_HOST` | Hostname for HTTP server. | `127.0.0.1` |
| `MCP_LOG_LEVEL` | Log level (RFC 5424). | `info` |

## Running the Server

### Local Development

```sh
bun run build
bun run start:stdio   # or start:http
```

Dev mode with watch:

```sh
bun run dev:stdio     # or dev:http
```

Checks and tests:

```sh
bun run devcheck      # Lints, formats, type-checks
bun test              # Runs test suite
```

### Docker

```sh
docker build -t shift-mcp-server .
docker run -p 3010:3010 shift-mcp-server
```

## Project Structure

| Directory | Purpose |
|:----------|:--------|
| `src/index.ts` | Entry point — registers tools and resources with `createApp()`. |
| `src/mcp-server/tools/definitions/` | Tool definitions (`check-in.tool.ts`, `check-out.tool.ts`). |
| `src/mcp-server/tools/definitions/worker-store.ts` | In-memory worker session store and formatting utilities. |
| `src/mcp-server/resources/definitions/` | Resource definitions (`status.resource.ts`). |

## Development Guide

See [`CLAUDE.md`](./CLAUDE.md) for development guidelines and architectural rules. The short version:

- Handlers throw, framework catches — no `try/catch` in tool logic
- Use `ctx.log` for request-scoped logging
- Register new tools and resources in `src/index.ts`

## Contributing

Issues and pull requests are welcome. Run checks before submitting:

```sh
bun run devcheck
bun test
```

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
