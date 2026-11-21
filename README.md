<div align="center">
  <h1>@cyanheads/shift-mcp-server</h1>
  <p><b>Lightweight coordination layer for multiple AI agents working on the same codebase simultaneously.</b>
  <div>2 Tools • 1 Roster Resource • 1 Roster Resource Template • 1 Skill</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.3.0-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.4.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/shift-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/shift-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.4%2B-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/shift-mcp-server/releases/latest/download/shift-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=shift-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvc2hpZnQtbWNwLXNlcnZlciJdfQ==) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22shift-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fshift-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

---

## Overview

Coordination layer for multiple AI agents working on the same codebase at once. Check in with a gist of your task and the files you expect to touch, see the full roster of active peers, and check out when finished.

### Tools

| Tool | Description |
|:---|:---|
| `shift_check_in` | Register or update a session. Returns the worker ID, active peers, declared-file overlaps, and recent check-out handoffs. |
| `shift_check_out` | Remove an active session and leave its final declaration and optional summary for peers. |

### Resources

| Resource | Description |
|:---|:---|
| `shift://status` | Active workers and recent handoffs in the server's default workspace. |
| `shift://status{?workspace}` | Active workers and recent handoffs for a selected workspace. Use the `statusUri` returned by either tool. |

The same roster is returned inline by `shift_check_in`. Modern `subscriptions/listen` streams receive one update per committed check-in, session update, or actual removal at the workspace-qualified URI; the bare alias is also published for the server's default workspace. Mutations from either protocol era publish through the same server event bus. This framework's legacy delivery adapter requires polling; that limitation is not inherent to the 2025 protocol. Notifications stay within one process; reads always observe committed state from other processes.

### Skill

[`shift-guide`](./skills/shift-guide/SKILL.md) covers shared edits, interrupted sessions, and handoffs. The guide ships with plugin, desktop bundle, npm, and Docker installs. MCP clients can discover it through the Skills extension or read `skill://shift-guide/SKILL.md`.

## Capability reference

### `shift_check_in` <sub>tool</sub>

- Required `gist` plus optional `files`, `workspace`, and `workerId` (six ASCII letters/digits, case-insensitive) to update a session. IDs are stored and returned uppercase.
- Returns your session, `activeWorkers`, resolved `workspace`, and qualified `statusUri`. Each check-in updates `lastSeenAt`. Updates preserve omitted files and the original `checkedInAt`. Pass `files: []` to clear the declaration.
- Declare repo-relative file paths. `overlaps` lists normalized files you share with active peers and the corresponding worker IDs. The comparison is lexical. An absolute workspace ID lets paths inside that root match equivalent relative paths. The original declarations stay intact.
- `recentlyFinished` contains handoffs recorded after your original check-in. The coordination protocol and applicable solo, orphan, and overlap guidance appear as `notice` in structured output and as a text trailer.
- An unknown `workerId` fails with reason `unknown_worker` (NotFound), a recovery hint, and the current roster.

---

### `shift_check_out` <sub>tool</sub>

- Required `workerId` (six ASCII letters/digits, case-insensitive), optional `workspace` and one-sentence `summary`.
- Returns `removed`, resolved `workspace`, qualified `statusUri`, and the ID/summary. An unknown or already-removed ID succeeds with `removed: false` and points to that roster without guessing why the ID is absent.
- An actual removal records the final gist, files, optional summary, and check-out time for peers that were already active. Only an actual removal publishes a resource update.

---

### `shift://status` <sub>resource</sub>

- Returns `text/markdown` with the active roster and any handoffs visible to its oldest active session.
- An orphan marker means the server confirmed the owning process was gone in the same PID namespace. Older records, owners outside that namespace, and inconclusive probes can leave ownership unverified. A running shared HTTP server cannot detect individual agent disconnects. Confirm a claim is stale before clearing it with `shift_check_out`.
- The bare resource reads the process default workspace. The qualified template reads the exact identifier encoded in its URI.
- Text output flattens CRLF, LF, and CR in gist and file displays. Table cells also escape backslashes and pipes. Stored declarations and structured fields retain their original values.

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

Coordination-specific:

- Per-user SQLite roster shared across processes, isolated by workspace, durable across restarts until explicitly checked out
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
        "-e", "SHIFT_WORKSPACE=my-project",
        "-v", "shift-state:/var/lib/shift-mcp-server",
        "ghcr.io/cyanheads/shift-mcp-server:latest"
      ]
    }
  }
}
```

Agents coordinating on one project need the same workspace and state directory. Native processes for one OS user share `~/.local/state/shift-mcp-server` by default. To share a roster with a container, bind-mount the native state directory and use the same explicit `SHIFT_WORKSPACE` on both sides.

The server uses the enclosing real Git worktree root of `CLAUDE_PROJECT_DIR` when Claude Code supplies it, or of the launch directory. Outside Git it uses the real directory itself. Subdirectories and symlinks into the same worktree share a roster. Leave the Claude Code plugin's Workspace setting blank to use project detection. If you set Workspace in an earlier version, clear it to enable project detection.

Set `SHIFT_WORKSPACE` when your launcher or container starts outside the project. The Desktop bundle prompts for this setting. The Codex plugin forwards `SHIFT_WORKSPACE` and `SHIFT_STATE_DIR` from your environment. A nonempty tool `workspace` takes precedence over the server default. Explicit identifiers match exactly, so `my-project` and `/path/my-project` are separate workspaces.

A shared HTTP server resolves one default at startup. Multiplexed clients must pass their project's `workspace` on each tool call:

```sh
SHIFT_WORKSPACE=my-project MCP_TRANSPORT_TYPE=http MCP_HTTP_PORT=3010 bun run start:http
# Server listens at http://localhost:3010/mcp
```

### Prerequisites

- [Bun v1.4.4](https://bun.sh/) or higher (or Node.js v24+).
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

The roster uses SQLite independently of the framework's `STORAGE_PROVIDER_TYPE`. State persists until check-out; restarting does not clear abandoned sessions. There is no TTL or automatic reaping. Workspace names and worker IDs are coordination selectors, not authentication boundaries.

WAL and `BEGIN IMMEDIATE` serialize mutations, ID allocation, and the returned roster snapshot. Startup retries SQLite lock contention within one 3-second deadline; a busy mutation also waits at most 3 seconds. Busy, corrupt, or unwritable storage fails visibly without an in-memory fallback. Use a local filesystem supporting SQLite locking for the shared state directory.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `SHIFT_WORKSPACE` | Exact-match default workspace override. | Real Git root of `CLAUDE_PROJECT_DIR` or launch directory, or the real directory outside Git. |
| `SHIFT_STATE_DIR` | Shared writable local directory containing `roster.sqlite`. | `~/.local/state/shift-mcp-server` |
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http`. | `stdio` |
| `MCP_HTTP_PORT` | Port for the HTTP server. | `3010` |
| `MCP_HTTP_HOST` | Hostname for the HTTP server. | `127.0.0.1` |
| `MCP_SESSION_MODE` | HTTP session handling: `auto`, `stateful`, or `stateless`. The server declares `stateless` in `createApp()`, since no handler needs a session; setting this variable overrides that. | `stateless` |
| `MCP_AUTH_MODE` | Auth mode: `none`, `jwt`, or `oauth`. | `none` |
| `MCP_LOG_LEVEL` | Log level (RFC 5424). | `info` |
| `LOGS_DIR` | Directory for log files (Node.js only). Set an absolute path to place logs outside the installed server directory. | `<server-package-root>/logs` |
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
docker run --rm -p 127.0.0.1:3010:3010 -e SHIFT_WORKSPACE=my-project -v shift-state:/var/lib/shift-mcp-server shift-mcp-server
```

The Dockerfile defaults to HTTP transport, stateless session mode, logs at `/var/log/shift-mcp-server`, and roster state at `/var/lib/shift-mcp-server`. Reuse the same writable volume and workspace for every coordinating container. A host bind mount must be writable by the image's `bun` user. OpenTelemetry peer dependencies are installed by default — build with `--build-arg OTEL_ENABLED=false` to omit them.

## Project structure

| Directory | Purpose |
|:----------|:--------|
| `src/index.ts` | `createApp()` entry point — definitions, storage setup/teardown, server notifications. |
| `src/config` | Storage directory and default workspace configuration. |
| `src/mcp-server/tools` | Tool definitions (`check-in.tool.ts`, `check-out.tool.ts`). |
| `src/mcp-server/resources` | Static default roster and workspace-qualified template. |
| `src/services/worker-store` | Transactional SQLite worker store and table formatting. |
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
