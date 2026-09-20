<div align="center">
  <h1>@cyanheads/shift-mcp-server</h1>
  <p><b>Lightweight coordination layer for multiple AI agents working on the same codebase simultaneously.</b>
  <div>2 Tools • 1 Resource</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.1.7-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.0.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/shift-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/shift-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.0%2B-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/shift-mcp-server/releases/latest/download/shift-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=shift-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvc2hpZnQtbWNwLXNlcnZlciJdfQ==) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22shift-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fshift-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

---

## Overview

Coordination layer for multiple AI agents working on the same codebase at once. Check in with a gist of your task and the files you expect to touch, see the full roster of active peers, and check out when finished — all from any MCP client. Runs as a stdio process or a local Streamable HTTP server.

### Tools

| Tool | Description |
|:---|:---|
| `shift_check_in` | Register or update a worker session. Returns a worker ID, the coordination protocol, and the active peers. |
| `shift_check_out` | End a working session and remove it from the active worker list. |

### Resources

| Resource | Description |
|:---|:---|
| `shift://status` | All currently active workers with their gists, declared files, and check-in timestamps. |

The same roster is returned inline by `shift_check_in`; subscribers to `shift://status` also receive `notifications/resources/updated` on every check-in, session update, and check-out.

## Capability reference

### `shift_check_in` <sub>tool</sub>

- Required `gist` (what you're working on) plus optional `files` you expect to modify
- Optional `workerId` (6-char uppercase alphanumeric) re-enters an existing session with patch semantics — omitted fields and the original `checkedInAt` are preserved
- Output carries your session plus `activeWorkers`, the full roster of every checked-in session
- An unrecognized `workerId` fails with typed reason `unknown_worker` (NotFound) — recovery: omit `workerId` to start fresh, or reuse an ID from the active-workers table embedded in the error
- Every check-in or update calls `notifyResourceUpdated('shift://status')`

---

### `shift_check_out` <sub>tool</sub>

- Required `workerId` (6-char uppercase alphanumeric), optional one-sentence `summary`
- Idempotent — an unknown or already-checked-out `workerId` succeeds silently rather than erroring
- Notifies `shift://status` subscribers only when a session actually existed and was removed

---

### `shift://status` <sub>resource</sub>

- Returns `text/markdown` — the active-workers table, or "No agents are currently active." when the roster is empty
- `workerId` comes from `shift_check_in`
- Updates push via `notifications/resources/updated` on every check-in, session update, and check-out

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

Coordination-specific:

- In-memory worker session store — no database, no filesystem writes, cleared on restart
- The coordination protocol ships in every check-in response, so ground rules reach the agent without client-side configuration
- The active-workers table rides along with every check-in for situational awareness
- Patch semantics on session updates — only the fields provided change

Agent-friendly output:

- Both client surfaces carry the same data — `structuredContent` from the output schema, markdown from `format()`
- `shift_check_in` declares a typed error contract, so an unknown worker ID arrives with `data.reason` and a recovery hint
- Failure responses embed the current roster, so an agent recovers in the same turn instead of calling again to orient

## Getting started

Add the following to your MCP client configuration file:

```json
{
  "mcpServers": {
    "shift-mcp-server": {
      "type": "stdio",
      "command": "bunx",
      "args": ["@cyanheads/shift-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Or with npx (no Bun required):

```json
{
  "mcpServers": {
    "shift-mcp-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cyanheads/shift-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Or with Docker:

```json
{
  "mcpServers": {
    "shift-mcp-server": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "MCP_TRANSPORT_TYPE=stdio",
        "ghcr.io/cyanheads/shift-mcp-server:latest"
      ]
    }
  }
}
```

Every agent sharing a codebase must reach the same server process for the roster to be shared. Over stdio each client spawns its own process, so point concurrent agents at one Streamable HTTP instance instead:

```sh
MCP_TRANSPORT_TYPE=http MCP_HTTP_PORT=3010 bun run start:http
# Server listens at http://localhost:3010/mcp
```

### Prerequisites

- [Bun v1.4.0](https://bun.sh/) or higher (or Node.js v24+).
- No API keys, accounts, or external services.

### Installation

1. **Clone the repository:**

```sh
git clone https://github.com/cyanheads/shift-mcp-server.git
```

2. **Navigate into the directory:**

```sh
cd shift-mcp-server
```

3. **Install dependencies:**

```sh
bun install
```

4. **Configure environment:**

```sh
cp .env.example .env
# edit .env if you need to override a framework default
```

## Configuration

No server-specific environment variables. Framework defaults worth knowing:

| Variable | Description | Default |
|:---------|:------------|:--------|
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http`. | `stdio` |
| `MCP_HTTP_PORT` | Port for the HTTP server. | `3010` |
| `MCP_HTTP_HOST` | Hostname for the HTTP server. | `127.0.0.1` |
| `MCP_SESSION_MODE` | HTTP session handling: `auto`, `stateful`, or `stateless`. The server declares `stateless` in `createApp()`, since no handler needs a session; setting this variable overrides that. | `stateless` |
| `MCP_AUTH_MODE` | Auth mode: `none`, `jwt`, or `oauth`. | `none` |
| `MCP_LOG_LEVEL` | Log level (RFC 5424). | `info` |
| `LOGS_DIR` | Directory for log files (Node.js only). | `<project-root>/logs` |
| `OTEL_ENABLED` | Enable [OpenTelemetry instrumentation](https://github.com/cyanheads/mcp-ts-core/tree/main/docs/telemetry). | `false` |

See [`.env.example`](./.env.example) for the full list of optional overrides.

## Running the server

### Local development

- **Build and run:**

  ```sh
  bun run rebuild
  bun run start:stdio
  # or
  bun run start:http
  ```

- **Run checks and tests:**

  ```sh
  bun run devcheck   # Lint, format, typecheck, security, packaging
  bun run test       # Vitest suites: unit, smoke, integration, fuzz
  bun run lint:mcp   # Validate MCP definitions against spec
  ```

### Docker

```sh
docker build -t shift-mcp-server .
docker run --rm -p 3010:3010 shift-mcp-server
```

The Dockerfile defaults to HTTP transport, stateless session mode, and logs to `/var/log/shift-mcp-server`. OpenTelemetry peer dependencies are installed by default — build with `--build-arg OTEL_ENABLED=false` to omit them.

## Project structure

| Directory | Purpose |
|:----------|:--------|
| `src/index.ts` | `createApp()` entry point — registers the tools and the resource. |
| `src/mcp-server/tools` | Tool definitions (`check-in.tool.ts`, `check-out.tool.ts`). |
| `src/mcp-server/resources` | Resource definitions (`status.resource.ts`). |
| `src/services/worker-store` | In-memory worker session store and table formatting. |
| `tests/` | Unit, smoke, integration, and fuzz suites mirroring `src/`. |

## Development guide

See [`CLAUDE.md`/`AGENTS.md`](./CLAUDE.md) for development guidelines and architectural rules. The short version:

- Handlers throw, framework catches — no `try/catch` in tool logic
- Use `ctx.log` for request-scoped logging, `ctx.state` for tenant-scoped storage
- Register new tools and resources in `src/index.ts`
- `format()` must render every field in the output schema — both client surfaces carry the same data

## Contributing

Issues are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
