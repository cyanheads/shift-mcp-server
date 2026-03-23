# shift-mcp-server — Design

## MCP Surface

### Tools

| Name | Description | Key Inputs | Annotations |
|:-----|:------------|:-----------|:------------|
| `shift_check_in` | Register or update a worker session in a multi-agent workspace. Returns worker ID, coordination instructions, and active peers. | `gist` (required), `files` (optional), `workerId` (optional — omit to create, pass to update) | `readOnlyHint: false`, `idempotentHint: false` |
| `shift_check_out` | End a working session and remove from the active worker list. | `workerId` (required), `summary` (optional) | `readOnlyHint: false`, `idempotentHint: true` |

### Resources

| URI Template | Description | Pagination |
|:-------------|:------------|:-----------|
| `shift://status` | All currently active workers with their gists, declared files, and check-in timestamps. | No — worker count will always be small. |

### Prompts

None. This server is purely operational.

## Overview

Lightweight coordination layer for multiple Claude Code agents (or any MCP-capable agents) working on the same codebase simultaneously. Not a project management system — just a "heads up, I'm here and working on X" signal so agents are aware of concurrent activity and can avoid stepping on each other.

The server runs entirely in-memory. No persistence. State clears on server restart, which is fine — it tracks active working sessions, not historical data.

## Requirements

- In-memory storage only — no database, no filesystem writes
- Worker IDs: 6-character uppercase alphanumeric, randomly generated, unique across active sessions
- Check-in response embeds hardcoded coordination instructions (the delivery mechanism for multi-agent ground rules)
- Resource updates: send `notifications/resources/updated` on every check-in, update, and check-out so subscribed clients stay current
- No auth — this is a local coordination tool, not a shared service

## Design Decisions

- **No file overlap detection.** Agents see the active workers table with declared files/globs on every check-in. They're intelligent enough to recognize overlaps themselves while working in the codebase — no need for the server to compute or inject warnings.
- **No session TTL / reaping.** State is in-memory only and clears on server restart. A crashed agent's session persists until restart, which is acceptable — this is a coordination signal, not a source of truth.

## Tool Detail

### `shift_check_in`

**Description:**
"This is a multi-agent workspace. Run this tool at the start of every working session to check in and receive coordination instructions. Provide a concise gist of what you're working on and the file paths you expect to modify (if known). If you already have a worker ID from a previous check-in, pass it to update your session."

**Input schema:**

| Param | Type | Required | Description |
|:------|:-----|:---------|:------------|
| `gist` | `string` | yes | Concise description of what you're working on. |
| `files` | `string[]` | no | File paths you expect to modify. Omit if unknown — you can update later by calling this tool again with your worker ID. |
| `workerId` | `string` | no | Your worker ID from a previous check-in. Omit on first call to receive a new one. Pass to update your session. |

**Behavior:**

- No `workerId` → generate new 6-char ID (retry on collision), create session, add to map
- With valid `workerId` → patch session: only provided fields are updated, omitted fields are preserved, original `checkedInAt` is always preserved
- With invalid `workerId` → error: "Worker ID {X} not found. Omit workerId to start a new session." Include the active workers table so the agent can self-identify or start fresh.

**Response format** (returned as formatted text content):

```
## Your Session
- **Worker ID:** A7K2M1
- **Gist:** Adding rate limiting to API endpoints
- **Files:** src/middleware/rate-limit.ts, src/api/router.ts
- **Checked in:** 2026-03-23T14:30:00Z

## Coordination Protocol
- You are in a multi-agent workspace. Other developers may be modifying files concurrently.
- ALWAYS read the latest version of a file before editing — contents may have changed since your last read.
- Keep your changes focused on your declared scope. If your scope changes significantly, run shift_check_in again with your worker ID to update.
- When your session is complete, run shift_check_out with your worker ID.

## Active Workers
| Worker | Checked In | Working On | Files |
|--------|------------|------------|-------|
| A7K2M1 | 14:30 | Adding rate limiting to API endpoints | src/middleware/rate-limit.ts, src/api/router.ts |
| B3X9P2 | 14:20 | Refactoring auth middleware | src/auth/*.ts |
```

When no other workers are active:

```
## Active Workers
You're the first to check in. No other agents are currently active.
```

### `shift_check_out`

**Description:**
"End your working session. Removes you from the active worker list so other agents no longer see you as active."

**Input schema:**

| Param | Type | Required | Description |
|:------|:-----|:---------|:------------|
| `workerId` | `string` | yes | Your worker ID received at check-in. |
| `summary` | `string` | no | One sentence describing what was accomplished. |

**Behavior:**

- Valid `workerId` → remove from map, trigger resource update notification
- Invalid `workerId` → error: "Worker ID {X} not found. It may have already been checked out." Include the active workers table so the agent can self-identify or confirm checkout.

**Response:**

```
Checked out Worker A7K2M1. Session ended.
Summary: Added rate limiter middleware with per-route configuration and tests.
```

### Resource: `shift://status`

**MIME type:** `text/markdown`

**Content** — formatted table of all active workers:

```
## Active Workers (2)
| Worker | Checked In | Working On | Files |
|--------|------------|------------|-------|
| A7K2M1 | 14:30 | Adding rate limiting | src/middleware/rate-limit.ts, src/api/router.ts |
| B3X9P2 | 14:20 | Refactoring auth middleware | src/auth/*.ts |
```

When empty:

```
## Active Workers (0)
No agents are currently active.
```

**`list()`** returns: `{ uri: "shift://status", name: "Active Workers", mimeType: "text/markdown" }`.

**Subscriptions:** Server sends `notifications/resources/updated` on every state change (check-in, update, check-out).

## Services

None. The in-memory `Map<string, WorkerSession>` is simple enough to live directly in the tool handlers or as a plain module-level store. No service class needed.

## Data Model

```ts
interface WorkerSession {
  workerId: string;     // 6-char uppercase alphanumeric
  gist: string;         // what they're working on
  files: string[];      // declared file paths (can be empty)
  checkedInAt: string;  // ISO 8601 timestamp
}
```

Storage: `Map<string, WorkerSession>` keyed by `workerId`.

## Config

No server-specific env vars. Uses framework defaults only (`MCP_TRANSPORT_TYPE`, etc.).

## Implementation Order

1. Worker session store (in-memory map + ID generation)
2. `shift_check_in` tool
3. `shift_check_out` tool
4. `shift://status` resource
5. Devcheck + smoke test

Each step is independently testable.
