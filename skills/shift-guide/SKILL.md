---
name: shift-guide
description: Use shift_* tools when coordinating edits with other agents in one workspace, resuming a disconnected session, resolving overlapping file declarations, or leaving and retrieving handoffs.
license: Apache-2.0
metadata:
  author: "cyanheads"
  version: "1.0"
---

## Scope

Shift coordinates agents sharing a codebase and roster. The roster needs no upstream credentials. File declarations are advisory, so agents arrange the order of edits themselves.

## Identifiers

Keep the `workspace`, `workerId`, and `statusUri` returned by `shift_check_in` together. Use the exact workspace string and your worker ID for updates and check-out. Read the returned URI verbatim for that workspace's roster. Bare `shift://status` reads the server default. On a shared HTTP server, agree on the exact workspace key with peers before checking in.

## Gates

- Before editing, check in with the repo-relative paths you expect to change. If Shift reports an overlap, agree with the listed peers on edit order or disjoint files. An empty overlap means the compared declarations shared no matching path at check-in. Reread files immediately before editing.
- Before clearing another worker's claim, confirm it is stale with the worker or whoever assigned the work. `orphaned: true` means Shift confirmed the owning server process was gone. An absent marker and `lastSeenAt` leave the worker's current activity unknown. A shared HTTP process can outlive an individual agent's connection.

## Core chain

Check in before work, update the same session before taking on new files, then check out when finished. Supply the full revised file declaration when scope changes. Omit it to keep the current declaration or send an empty list to release all declared files while staying checked in. On departure, summarize what changed and what peers need for their next step.

## Workflows

**Resume after a disconnect.** Check in with your saved workspace and worker ID to re-adopt the session and preserve its original place in the roster. On `unknown_worker`, check the workspace against your saved key and inspect the intended roster before opening a new session. Reuse a roster ID only if you can establish it belongs to your session. A failed removal (`removed: false`) also calls for checking the workspace and ID before assuming the session ended.

**Read a handoff.** Your check-in shows departures after your original check-in. The status resource uses the oldest active session's window, so it can show a departure you joined too late to receive in your own check-in. Each departure disappears once no active session predates it. Capture actionable handoffs while they are visible and leave anything a future agent will need in the shared workspace.
