# shift-mcp-server — Design

## MCP surface

| Definition | Inputs | Returned data |
|:---|:---|:---|
| `shift_check_in` | Required `gist`; optional `files`, `workerId`, `workspace` | Session, `activeWorkers`, resolved `workspace`, qualified `statusUri`; protocol and applicable solo notice in enrichment `notice` |
| `shift_check_out` | Required `workerId`; optional `summary`, `workspace` | Uppercase ID, summary, `removed`, resolved `workspace`, qualified `statusUri` |
| `shift://status` | Static resource | Default workspace's active-worker table |
| `shift://status{?workspace}` | URI-encoded workspace selector | Selected workspace's active-worker table |

There are two tools, one static resource, one resource template, and no prompts. Both tools mutate shared state (`readOnlyHint: false`). Check-in is non-idempotent when creating; check-out remains idempotent. Destructive annotations retain their conservative defaults: a caller holding an ID can replace declarations or remove that session.

## Workspace identity

Nonempty explicit `workspace` values are opaque exact-match namespaces. An omitted or empty selector uses the default: `SHIFT_WORKSPACE`, or the real path of the enclosing Git worktree root, or real cwd outside Git. Subdirectory and symlink launches converge. A server's launch cwd cannot identify every HTTP client's project, so multiplexed clients must select workspace explicitly. Desktop/plugin installations must configure the common namespace rather than assuming a project launch directory.

Both tools return `statusUri = shift://status?workspace=<encodeURIComponent(workspace)>`. The template decodes the SDK-extracted variable exactly once, preserving literal percent sequences, plus signs, separators, and Unicode. The static resource remains registered because the SDK's query template does not match the bare URI. Workspace selectors are not authentication or ownership boundaries.

## Storage and lifecycle

`WorkerStore` in `src/services/worker-store/worker-store.ts` owns a `node:sqlite` connection to `SHIFT_STATE_DIR/roster.sqlite`, defaulting to `~/.local/state/shift-mcp-server/roster.sqlite`. SQLite is independent of the framework's tenant KV configuration. Use a shared local filesystem with SQLite locking support; containers need a common writable volume or host bind mount and a common explicit namespace.

The table stores `(workspace, workerId)` as its primary key, with `gist`, JSON `files`, and ISO 8601 `checkedInAt`. WAL lets readers observe committed state while another process writes. Initialization retries only SQLite busy/locked errors within a single 3-second deadline, including WAL transitions that bypass SQLite's busy handler; each SQLite wait uses the remaining budget. Normal mutations retain a 3-second busy timeout. Busy exhaustion, corrupt storage, and unwritable paths propagate visibly. There is no memory fallback.

Each mutation uses `BEGIN IMMEDIATE`: acquire the writer lock, inspect the selected roster, allocate/check an ID or patch/delete a row, read the response snapshot, and commit. ID generation retries at most ten collisions while holding the lock; SQL uniqueness protects the key. Exceptions roll back. Separate processes cannot overwrite unrelated changes, and interruption before commit leaves the previous committed state intact. SQLite was chosen over atomic JSON replacement because atomic file replacement alone loses concurrent read-modify-write updates.

`createApp().setup()` parses server configuration, resolves the default namespace, opens storage, and captures `core.notify.resourceUpdated` before serving. `teardown()` closes the connection. Sessions survive restarts until explicit check-out; there is no TTL or reaping. A crashed agent leaves a coordination declaration that another caller can inspect and remove.

## Tool behavior

Check-in without an ID creates a six-character uppercase ASCII alphanumeric ID. Both tools validate six ASCII letters/digits before uppercasing, so lowercase/mixed-case copies resolve to the same session without accepting Unicode case expansion, whitespace, or punctuation. No arbitrary gist/file size caps are imposed.

Check-in with a known ID replaces `gist`; omitted `files` preserve the previous declaration, while `files: []` clears it. `checkedInAt` never changes on update. An unknown ID in the selected workspace throws `unknown_worker` (`NotFound`) with a recovery hint, the qualified status URI, and that workspace's current roster. Other workspaces are neither read nor changed.

Check-out reports the actual SQL deletion outcome. `removed: true` renders “Checked out Worker … Session ended.” A repeat or never-existing ID returns `removed: false` and “No active session for Worker …; already checked out or unknown,” followed by the qualified roster URI. It does not infer the cause of absence. Optional summary survives both outcomes, and other workers remain untouched.

## Output and notifications

Check-in declares optional string enrichment `notice`. It composes the coordination protocol with the solo-worker notice when there are no peers, then calls `ctx.enrich.notice()` once. Production assembly includes the same notice once in structured output and once in the text trailer; `format()` only renders session fields and the active-worker table.

The table preserves full timestamps and sorts oldest first. Presentation escapes backslashes before pipes and flattens CRLF/LF/CR to spaces in gist and file cells. Raw stored and structured values remain unchanged. This shared formatter serves check-in, both status resources, and unknown-worker messages.

After each committed create/update/removal, the captured server notifier publishes the qualified URI once. It additionally publishes `shift://status` only when the mutation belongs to the process default. No-op removal and failed calls publish nothing. Request-scoped notification methods are not also called, avoiding duplicate modern events.

The event bus reaches modern `subscriptions/listen` streams for mutations originating in either protocol era and applies subscription filters. This framework's legacy adapter requires polling; the 2025 protocol itself allows unrelated notifications on standalone streams. Push stays process-local: another process's commit is visible on the next read but does not emit into this process's bus.

## Configuration and verification

`src/config/server-config.ts` maps `SHIFT_WORKSPACE` and `SHIFT_STATE_DIR` through `parseEnvConfig` at setup. Blank/unsubstituted environment placeholders use defaults. Nonempty tool workspace strings retain exact identity. Malformed Unicode fails before mutation, so every successful result can return an encoded status URI.

Tests use scratch SQLite directories exclusively. Coverage includes production tool assembly, raw-value preservation, patch/timestamp invariants, invalid IDs and errors, namespace/URI routing, notification counts, independent processes, concurrent writes, ID collision rollback, interrupted writes, bounded contention, corrupt/unwritable stores, and real Git-root/symlink derivation. Local transport checks exercise legacy mutations reaching modern listeners without duplicate or nonmatching events.
