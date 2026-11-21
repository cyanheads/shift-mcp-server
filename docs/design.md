# shift-mcp-server — Design

## MCP surface

| Definition | Inputs | Returned data |
|:---|:---|:---|
| `shift_check_in` | Required `gist`; optional `files`, `workerId`, `workspace` | Session, `activeWorkers`, `overlaps`, `recentlyFinished`, resolved `workspace`, qualified `statusUri`, and coordination guidance in `notice` |
| `shift_check_out` | Required `workerId`; optional `summary`, `workspace` | Uppercase ID, summary, `removed`, resolved `workspace`, qualified `statusUri` |
| `shift://status` | Static resource | Default workspace's active roster and recent handoffs |
| `shift://status{?workspace}` | URI-encoded workspace selector | Selected workspace's active roster and recent handoffs |

There are two tools, one static resource, one resource template, and no prompts. Both tools mutate shared state (`readOnlyHint: false`). Check-in is non-idempotent when creating; check-out remains idempotent. Destructive annotations retain their conservative defaults: a caller holding an ID can replace declarations or remove that session.

## Workspace identity

Nonempty explicit `workspace` values are opaque exact-match namespaces. An omitted or empty selector uses `SHIFT_WORKSPACE` if set. Otherwise the server takes the enclosing real Git worktree root of `CLAUDE_PROJECT_DIR` when Claude Code supplies it, or of the launch directory. Outside Git it uses the real directory itself. Subdirectory and symlink launches converge. The Claude Code plugin leaves its override blank by default. Desktop and container installs that launch outside the project need an explicit workspace. Multiplexed HTTP clients must select workspace on each call.

Both tools return `statusUri = shift://status?workspace=<encodeURIComponent(workspace)>`. The template decodes the SDK-extracted variable exactly once, preserving literal percent sequences, plus signs, separators, and Unicode. The static resource remains registered because the SDK's query template does not match the bare URI. Workspace selectors are not authentication or ownership boundaries.

## Storage and lifecycle

`WorkerStore` in `src/services/worker-store/worker-store.ts` owns a `node:sqlite` connection to `SHIFT_STATE_DIR/roster.sqlite`, defaulting to `~/.local/state/shift-mcp-server/roster.sqlite`. SQLite is independent of the framework's tenant KV configuration. Use a shared local filesystem with SQLite locking support; containers need a common writable volume or host bind mount and a common explicit namespace.

The workers table stores `(workspace, workerId)` as its primary key, with `gist`, JSON `files`, and ISO 8601 `checkedInAt`. The migration preserves that table and projects existing rows into a separate activity table with unknown ownership and last-seen time. Triggers maintain join order and pruning for both writer versions. An older process can change a declaration, which clears owner and last-seen metadata until the next check-in by a current server. An older check-out prunes recorded history as needed but does not record its own handoff.

WAL lets readers observe committed state while another process writes. Initialization retries only SQLite busy/locked errors within a single 3-second deadline, including WAL transitions that bypass SQLite's busy handler. Each SQLite wait uses the remaining budget. Normal mutations retain a 3-second busy timeout. Busy exhaustion, corrupt storage, and unwritable paths propagate visibly.

Each mutation uses `BEGIN IMMEDIATE`: acquire the writer lock, inspect the selected roster, allocate/check an ID or patch/delete a row, read the response snapshot, and commit. ID generation retries at most ten collisions while holding the lock; SQL uniqueness protects the key. Exceptions roll back. Separate processes cannot overwrite unrelated changes, and interruption before commit leaves the previous committed state intact. SQLite was chosen over atomic JSON replacement because atomic file replacement alone loses concurrent read-modify-write updates.

`createApp().setup()` parses server configuration, resolves the default namespace, opens storage, and captures `core.notify.resourceUpdated` before serving. `teardown()` closes the connection. Sessions survive restarts until explicit check-out.

Each successful check-in adopts the calling server process and updates `lastSeenAt`. A read sets `orphaned: true` only when the owner PID is missing and the reader can verify a shared PID namespace. A reused PID may leave an exited owner unmarked. Legacy rows, separate namespaces, and inconclusive probes leave ownership unverified. A shared HTTP process can remain live after an individual client disconnects. The status read does not modify ownership or publish a notification.

## Tool behavior

Check-in without an ID creates a six-character uppercase ASCII alphanumeric ID. Both tools validate six ASCII letters/digits before uppercasing, so lowercase/mixed-case copies resolve to the same session without accepting Unicode case expansion, whitespace, or punctuation. No arbitrary gist/file size caps are imposed.

Check-in with a known ID replaces `gist`. Omitted `files` preserve the previous declaration, while `files: []` clears it. Updates preserve the original `checkedInAt` and join order. An unknown ID in the selected workspace throws `unknown_worker` (`NotFound`) with a recovery hint, the qualified status URI, and that workspace's current roster.

File overlap comparison normalizes `.` and `..` lexically. An absolute workspace ID gives it a root for relativizing declarations within that root. Declarations outside the root stay absolute. The comparison covers literal paths from the caller and their peers in the committed snapshot. Each normalized match names each peer once. New empty path strings fail validation. Legacy empty declarations remain in stored and returned file arrays and are skipped for comparison.

Check-out reports the SQL deletion outcome. An actual removal records the final gist, files, optional summary, and check-out time when peers remain. A repeat or unknown ID returns `removed: false` and the qualified roster URI. The caller's optional summary remains in its response for either outcome. Only an actual removal records a handoff.

Deletion, handoff recording, and pruning share one writer transaction. A check-in sees departures after its original join order. Both status resources read active workers and departures in one transaction and show handoffs after the oldest active worker's join order. Persisted mutation order disambiguates events in the same millisecond. Departure records are pruned when no remaining session predates them, including when the workspace empties.

## Output and notifications

Check-in declares string enrichment `notice`. It calls `ctx.enrich.notice()` once with the coordination protocol and any applicable solo, orphan, or overlap guidance. The first-worker wording applies only to a new solo session. Production assembly includes the notice once in structured output and once in the text trailer. The formatter renders the session, roster, and eligible handoffs.

The active table preserves full timestamps and sorts oldest first. The own-session and roster displays flatten CRLF, LF, and CR in gists and files. Tables also escape backslashes and pipes. Stored and structured values retain their original form. Unknown-worker messages include the same active table, which the framework escapes as literal message text in `content[]`.

After each committed create/update/removal, the captured server notifier publishes the qualified URI once. It additionally publishes `shift://status` only when the mutation belongs to the process default. No-op removal and failed calls publish nothing. Request-scoped notification methods are not also called, avoiding duplicate modern events.

The event bus reaches modern `subscriptions/listen` streams for mutations originating in either protocol era and applies subscription filters. This framework's legacy adapter requires polling; the 2025 protocol itself allows unrelated notifications on standalone streams. Push stays process-local: another process's commit is visible on the next read but does not emit into this process's bus.

## Configuration and verification

`src/config/server-config.ts` reads `SHIFT_WORKSPACE`, `SHIFT_STATE_DIR`, and `CLAUDE_PROJECT_DIR` through `parseEnvConfig` at setup. Blank and unsubstituted values use the defaults. With no explicit `SHIFT_WORKSPACE`, a supplied `CLAUDE_PROJECT_DIR` must point to an accessible directory. An invalid path fails startup. Nonempty tool workspace strings retain exact identity. Malformed Unicode fails before mutation, so every successful result can return an encoded status URI.

Tests use scratch SQLite directories exclusively. Coverage includes production tool assembly, raw-value preservation, patch/timestamp invariants, invalid IDs and errors, namespace/URI routing, notification counts, independent processes, concurrent writes, ID collision rollback, interrupted writes, bounded contention, corrupt/unwritable stores, and real Git-root/symlink derivation. Local transport checks exercise legacy mutations reaching modern listeners without duplicate or nonmatching events.
