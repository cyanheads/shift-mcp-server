# Agent Protocol

**Server:** shift-mcp-server
**Version:** 0.1.2
**Framework:** [@cyanheads/mcp-ts-core](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

> **Read the framework docs first:** `node_modules/@cyanheads/mcp-ts-core/CLAUDE.md` contains the full API reference — builders, Context, error codes, exports, patterns. This file covers server-specific conventions only.

---

## What's Next?

When the user asks what to do next, what's left, or needs direction, suggest relevant options based on the current project state:

1. **Re-run the `setup` skill** — ensures CLAUDE.md, skills, structure, and metadata are populated and up to date with the current codebase
2. **Add tools/resources** — scaffold new definitions using the `add-tool`, `add-resource` skills
3. **Add tests** — scaffold tests for existing definitions using the `add-test` skill
4. **Field-test definitions** — exercise tools/resources with real inputs using the `field-test` skill, get a report of issues and pain points
5. **Run `devcheck`** — lint, format, typecheck, and security audit
6. **Run the `polish-docs-meta` skill** — finalize README, CHANGELOG, metadata, and agent protocol for shipping
7. **Run the `maintenance` skill** — sync skills and dependencies after framework updates

Tailor suggestions to what's actually missing or stale — don't recite the full list every time.

---

## Server Overview

Lightweight coordination layer for multiple AI agents working on the same codebase simultaneously. Not a project management system — just a "heads up, I'm here and working on X" signal so agents avoid stepping on each other.

### MCP Surface

| Definition | Name / URI | Purpose |
|:-----------|:-----------|:--------|
| Tool | `shift_check_in` | Register or update a worker session. Returns worker ID, coordination instructions, and active peers. |
| Tool | `shift_check_out` | End a working session. Removes from active worker list. |
| Resource | `shift://status` | All currently active workers with gists, declared files, and timestamps. |

No prompts — this server is purely operational. No services — the in-memory store is simple enough to live as a module-level `Map`.

### Data Model

```ts
interface WorkerSession {
  workerId: string;     // 6-char uppercase alphanumeric
  gist: string;         // what they're working on
  files: string[];      // declared file paths (can be empty)
  checkedInAt: string;  // ISO 8601 timestamp
}
```

Storage: `Map<string, WorkerSession>` keyed by `workerId`. In-memory only — no database, no filesystem writes. State clears on server restart.

### Design Decisions

- **No file overlap detection.** Agents see the active workers table with declared files/globs on every check-in. They're intelligent enough to recognize overlaps themselves — no need for the server to compute or inject warnings.
- **No session TTL / reaping.** State is in-memory only and clears on server restart. A crashed agent's session persists until restart, which is acceptable — this is a coordination signal, not a source of truth.
- **No auth.** Local coordination tool, not a shared service.
- **No server-specific config.** Uses framework defaults only (`MCP_TRANSPORT_TYPE`, etc.).
- **Patch semantics on update.** When `shift_check_in` is called with an existing `workerId`, only provided fields are updated — omitted fields are preserved. `checkedInAt` is always preserved.
- **Error responses include context.** Invalid `workerId` errors include the active workers table so the agent can self-identify or start fresh.

### Full Design

See `docs/design.md` for complete tool schemas, response formats, and behavior specs.

---

## Core Rules

- **Logic throws, framework catches.** Tool/resource handlers are pure — throw on failure, no `try/catch`. Plain `Error` is fine; the framework catches, classifies, and formats. Use error factories (`notFound()`, `validationError()`, etc.) when the error code matters.
- **Use `ctx.log`** for request-scoped logging. No `console` calls.
- **Secrets in env vars only** — never hardcoded.

---

## Patterns

### Tool

```ts
import { tool, z } from '@cyanheads/mcp-ts-core';
import { notFound } from '@cyanheads/mcp-ts-core/errors';
import { workers, generateWorkerId } from './worker-store.js';

export const checkOut = tool('shift_check_out', {
  description: 'End your working session. Removes you from the active worker list.',
  annotations: { readOnlyHint: false, idempotentHint: true },
  input: z.object({
    workerId: z.string().describe('Your worker ID received at check-in.'),
    summary: z.string().optional().describe('One sentence describing what was accomplished.'),
  }),
  output: z.object({
    workerId: z.string().describe('The worker ID that was checked out.'),
    summary: z.string().optional().describe('The provided session summary.'),
  }),

  handler(input, ctx) {
    if (!workers.has(input.workerId)) {
      throw notFound(`Worker ID ${input.workerId} not found.`);
    }
    workers.delete(input.workerId);
    ctx.log.info('Worker checked out', { workerId: input.workerId });
    return { workerId: input.workerId, summary: input.summary };
  },

  format(result) {
    let text = `Checked out Worker ${result.workerId}. Session ended.`;
    if (result.summary) text += `\nSummary: ${result.summary}`;
    return [{ type: 'text' as const, text }];
  },
});
```

### Resource

```ts
import { resource } from '@cyanheads/mcp-ts-core';
import { formatWorkersTable, workers } from '@/mcp-server/tools/definitions/worker-store.js';

export const statusResource = resource('shift://status', {
  name: 'Active Workers',
  description: 'All currently active workers with their gists, declared files, and check-in timestamps.',
  mimeType: 'text/markdown',

  handler() {
    return `## Active Workers (${workers.size})\n${formatWorkersTable([...workers.values()])}`;
  },
});
```

---

## Context

Handlers receive a unified `ctx` object. Key properties:

| Property | Description |
|:---------|:------------|
| `ctx.log` | Request-scoped logger — `.debug()`, `.info()`, `.notice()`, `.warning()`, `.error()`. Auto-correlates requestId, traceId, tenantId. |
| `ctx.signal` | `AbortSignal` for cancellation. |
| `ctx.requestId` | Unique request ID. |

---

## Errors

Handlers throw — the framework catches, classifies, and formats. Three escalation levels:

```ts
// 1. Plain Error — framework auto-classifies from message patterns
throw new Error('Item not found');           // → NotFound
throw new Error('Invalid query format');     // → ValidationError

// 2. Error factories — explicit code, concise
import { notFound, validationError } from '@cyanheads/mcp-ts-core/errors';
throw notFound('Item not found', { itemId });

// 3. McpError — full control over code and data
import { McpError, JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
throw new McpError(JsonRpcErrorCode.DatabaseError, 'Connection failed', { pool: 'primary' });
```

Plain `Error` is fine for most cases. Use factories when the error code matters. See framework CLAUDE.md for the full auto-classification table and all available factories.

---

## Structure

```text
src/
  index.ts                              # createApp() entry point
  mcp-server/
    tools/definitions/
      check-in.tool.ts                  # shift_check_in
      check-out.tool.ts                 # shift_check_out
      worker-store.ts                   # In-memory Map + ID gen + table formatting
    resources/definitions/
      status.resource.ts                # shift://status
```

---

## Naming

| What | Convention | Example |
|:-----|:-----------|:--------|
| Files | kebab-case with suffix | `check-in.tool.ts` |
| Tool/resource names | snake_case | `shift_check_in` |
| Directories | kebab-case | `src/mcp-server/tools/definitions/` |
| Descriptions | Single string or template literal, no `+` concatenation | `'Register or update a worker session.'` |

---

## Skills

Skills are modular instructions in `skills/` at the project root. Read them directly when a task matches — e.g., `skills/add-tool/SKILL.md` when adding a tool.

**Agent skill directory:** Copy skills into the directory your agent discovers (Claude Code: `.claude/skills/`, others: equivalent). This makes skills available as context without needing to reference `skills/` paths manually. After framework updates, re-copy to pick up changes.

Available skills:

| Skill | Purpose |
|:------|:--------|
| `setup` | Post-init project orientation |
| `design-mcp-server` | Design tool surface, resources, and services for a new server |
| `add-tool` | Scaffold a new tool definition |
| `add-resource` | Scaffold a new resource definition |
| `add-test` | Scaffold test file for a tool, resource, or service |
| `field-test` | Exercise tools/resources with real inputs, verify behavior, report issues |
| `devcheck` | Lint, format, typecheck, audit |
| `polish-docs-meta` | Finalize docs, README, metadata, and agent protocol for shipping |
| `maintenance` | Sync skills and dependencies after updates |
| `api-context` | Context interface, logger, state, progress |
| `api-errors` | McpError, JsonRpcErrorCode, error patterns |
| `api-testing` | createMockContext, test patterns |
| `api-utils` | Formatting, parsing, security, pagination, scheduling |

When you complete a skill's checklist, check the boxes and add a completion timestamp at the end (e.g., `Completed: 2026-03-11`).

---

## Commands

| Command | Purpose |
|:--------|:--------|
| `bun run build` | Compile TypeScript |
| `bun run rebuild` | Clean + build |
| `bun run clean` | Remove build artifacts |
| `bun run devcheck` | Lint + format + typecheck + security |
| `bun run tree` | Generate directory structure doc |
| `bun run format` | Auto-fix formatting |
| `bun run lint:mcp` | Validate MCP tool/resource definitions |
| `bun test` | Run tests |
| `bun run dev:stdio` | Dev mode (stdio) |
| `bun run dev:http` | Dev mode (HTTP) |
| `bun run start:stdio` | Production mode (stdio) |
| `bun run start:http` | Production mode (HTTP) |

---

## Imports

```ts
// Framework — z is re-exported, no separate zod import needed
import { tool, z } from '@cyanheads/mcp-ts-core';
import { McpError, JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';

// Server's own code — via path alias
import { workers } from '@/mcp-server/tools/definitions/worker-store.js';
```

---

## Checklist

- [ ] Zod schemas: all fields have `.describe()`, only JSON-Schema-serializable types (no `z.custom()`, `z.date()`, `z.transform()`, etc.)
- [ ] JSDoc `@fileoverview` + `@module` on every file
- [ ] `ctx.log` for logging
- [ ] Handlers throw on failure — error factories or plain `Error`, no try/catch
- [ ] Registered in `createApp()` arrays (directly or via barrel exports)
- [ ] Tests use `createMockContext()` from `@cyanheads/mcp-ts-core/testing`
- [ ] `bun run devcheck` passes
