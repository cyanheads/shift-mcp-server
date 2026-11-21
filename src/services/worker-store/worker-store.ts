/**
 * @fileoverview Durable workspace rosters and committed snapshots.
 * @module services/worker-store/worker-store
 */

import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from '@cyanheads/mcp-ts-core';
import { validationError } from '@cyanheads/mcp-ts-core/errors';
import { ownerHasExited, processScope } from './process-ownership.js';
import { initializeRosterSchema } from './roster-schema.js';

/** A single active working session. */
export interface WorkerSession {
  checkedInAt: string;
  files: string[];
  gist: string;
  lastSeenAt?: string | undefined;
  orphaned?: true | undefined;
  workerId: string;
}

/** Final declaration for a worker that checked out while a peer was active. */
export interface FinishedWorker {
  checkedOutAt: string;
  files: string[];
  gist: string;
  summary?: string | undefined;
  workerId: string;
}

const declarationRow = z.object({ workerId: z.string(), gist: z.string(), files: z.string() });
const activeRow = declarationRow.extend({
  checkedInAt: z.string(),
  lastSeenAt: z.string().nullable(),
  ownerScope: z.string().nullable(),
  ownerPid: z.number().int().nullable(),
});
const checkoutRow = declarationRow.pick({ gist: true, files: true });
const updatedRow = activeRow.pick({ checkedInAt: true, files: true });
const finishedRow = declarationRow.extend({
  checkedOutAt: z.string(),
  summary: z.string().nullable(),
});
const filesJson = z.array(z.string());

/** Six ASCII alphanumerics; schemas normalize only after this check. */
export const WORKER_ID_PATTERN = /^[A-Za-z0-9]{6}$/;

const BUSY_TIMEOUT_MS = 3_000;
const initializationWait = new Int32Array(new SharedArrayBuffer(4));

/** Generate a six-character uppercase ID; allocation checks uniqueness. */
export function generateWorkerId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from(
    crypto.getRandomValues(new Uint8Array(6)),
    (byte) => chars[byte % chars.length],
  ).join('');
}

/** Canonical resource URI for an opaque workspace identifier. */
export function statusUri(workspace: string): string {
  if (!workspace.isWellFormed())
    throw validationError('Workspace must contain valid Unicode text.', { field: 'workspace' });
  return `shift://status?workspace=${encodeURIComponent(workspace)}`;
}

/** Resolve a launch directory to its real Git root, or real cwd outside Git. */
export function deriveWorkspace(cwd = process.cwd()): string {
  const directory = realpathSync(cwd);
  for (let candidate = directory; ; candidate = dirname(candidate)) {
    // A worktree uses a .git file; an ordinary checkout uses a directory.
    if (existsSync(join(candidate, '.git'))) return candidate;
    if (dirname(candidate) === candidate) return directory;
  }
}

/** SQLite commits a mutation and its returned roster under one writer lock. */
export class WorkerStore {
  private readonly db: DatabaseSync;
  private readonly ownerScope = processScope();

  constructor(stateDir: string) {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(stateDir, 'roster.sqlite'));
    try {
      const deadline = performance.now() + BUSY_TIMEOUT_MS;
      for (;;) {
        const remaining = Math.max(0, Math.floor(deadline - performance.now()));
        this.db.exec(`PRAGMA busy_timeout=${remaining}`);
        try {
          this.db.exec('PRAGMA journal_mode=WAL');
          initializeRosterSchema(this.db, deadline);
          break;
        } catch (error) {
          const wait = Math.min(25, deadline - performance.now());
          if (
            wait <= 0 ||
            typeof error !== 'object' ||
            error === null ||
            !('errcode' in error) ||
            typeof error.errcode !== 'number' ||
            ![5, 6].includes(error.errcode & 0xff)
          )
            throw error;
          /** WAL transitions may bypass SQLite's busy handler; this setup-only
           * wait lets another process release its lock without resetting the budget. */
          Atomics.wait(initializationWait, 0, 0, wait);
        }
      }
      this.db.exec(`PRAGMA busy_timeout=${BUSY_TIMEOUT_MS}`);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  /** Read committed sessions only in the selected namespace. */
  list(workspace: string): WorkerSession[] {
    return this.db
      .prepare(
        `SELECT workerId, gist, files, checkedInAt, lastSeenAt, ownerScope, ownerPid
         FROM workers JOIN worker_activity USING (workspace, workerId)
         WHERE workspace = ? ORDER BY checkedInAt, workerId`,
      )
      .all(workspace)
      .map((raw): WorkerSession => {
        const { files, lastSeenAt, ownerScope, ownerPid, ...session } = activeRow.parse(raw);
        return {
          ...session,
          files: filesJson.parse(JSON.parse(files)),
          ...(lastSeenAt === null ? {} : { lastSeenAt }),
          ...(ownerHasExited(this.ownerScope, ownerScope, ownerPid) ? { orphaned: true } : {}),
        };
      });
  }

  /** Read the roster and eligible departures from the same committed snapshot. */
  status(workspace: string) {
    return this.transaction(
      () => ({ activeWorkers: this.list(workspace), recentlyFinished: this.departures(workspace) }),
      'BEGIN',
    );
  }

  /** Create or patch a session without changing its original check-in timestamp. */
  checkIn(
    workspace: string,
    input: { gist: string; files?: string[] | undefined; workerId?: string | undefined },
  ) {
    return this.transaction(() => {
      const lastSeenAt = new Date().toISOString();
      let session: WorkerSession & { lastSeenAt: string };
      if (input.workerId) {
        const updated = this.db
          .prepare(
            `UPDATE workers SET gist = ?, files = COALESCE(?, files)
             WHERE workspace = ? AND workerId = ? RETURNING checkedInAt, files`,
          )
          .get(
            input.gist,
            input.files === undefined ? null : JSON.stringify(input.files),
            workspace,
            input.workerId,
          );
        if (!updated)
          return { session: undefined, activeWorkers: this.list(workspace), recentlyFinished: [] };
        const { checkedInAt, files } = updatedRow.parse(updated);
        session = {
          workerId: input.workerId,
          gist: input.gist,
          checkedInAt,
          files: filesJson.parse(JSON.parse(files)),
          lastSeenAt,
        };
      } else {
        const occupied = this.db.prepare(
          'SELECT 1 FROM workers WHERE workspace = ? AND workerId = ?',
        );
        let workerId: string | undefined;
        for (let attempt = 0; attempt < 10; attempt++) {
          const candidate = generateWorkerId();
          if (!occupied.get(workspace, candidate)) {
            workerId = candidate;
            break;
          }
        }
        if (!workerId) throw new Error('Failed to generate unique worker ID after 10 attempts');
        session = {
          workerId,
          gist: input.gist,
          files: input.files ?? [],
          checkedInAt: lastSeenAt,
          lastSeenAt,
        };
        this.db
          .prepare(
            'INSERT INTO workers (workspace, workerId, gist, files, checkedInAt) VALUES (?, ?, ?, ?, ?)',
          )
          .run(
            workspace,
            session.workerId,
            session.gist,
            JSON.stringify(session.files),
            session.checkedInAt,
          );
      }
      this.db
        .prepare(
          `UPDATE worker_activity SET lastSeenAt = ?, ownerScope = ?, ownerPid = ?
           WHERE workspace = ? AND workerId = ?`,
        )
        .run(lastSeenAt, this.ownerScope ?? null, process.pid, workspace, session.workerId);
      return {
        session,
        activeWorkers: this.list(workspace),
        recentlyFinished: this.departures(workspace, session.workerId),
      };
    });
  }

  /** Return the actual deletion outcome, retaining idempotent success. */
  checkOut(workspace: string, workerId: string, summary?: string): boolean {
    return this.transaction(() => {
      const removed = this.db
        .prepare('DELETE FROM workers WHERE workspace = ? AND workerId = ? RETURNING gist, files')
        .get(workspace, workerId);
      if (!removed) return false;
      const { gist, files } = checkoutRow.parse(removed);
      this.db.exec('UPDATE roster_order SET lastEvent = lastEvent + 1 WHERE singleton = 1');
      this.db
        .prepare(
          `INSERT INTO departures
             (workspace, departedOrder, workerId, gist, files, summary, checkedOutAt)
           SELECT ?, lastEvent, ?, ?, ?, ?, ? FROM roster_order
           WHERE singleton = 1 AND EXISTS (SELECT 1 FROM worker_activity WHERE workspace = ?)`,
        )
        .run(
          workspace,
          workerId,
          gist,
          files,
          summary ?? null,
          new Date().toISOString(),
          workspace,
        );
      return true;
    });
  }

  private departures(workspace: string, workerId: string | null = null): FinishedWorker[] {
    return this.db
      .prepare(
        `SELECT workerId, gist, files, summary, checkedOutAt FROM departures
         WHERE workspace = ? AND departedOrder > (
           SELECT MIN(joinedOrder) FROM worker_activity WHERE workspace = ?
             AND (? IS NULL OR workerId = ?)
         )
         ORDER BY departedOrder`,
      )
      .all(workspace, workspace, workerId, workerId)
      .map((raw) => {
        const { files, summary, ...departure } = finishedRow.parse(raw);
        return {
          ...departure,
          files: filesJson.parse(JSON.parse(files)),
          ...(summary === null ? {} : { summary }),
        };
      });
  }

  private transaction<T>(run: () => T, begin: 'BEGIN' | 'BEGIN IMMEDIATE' = 'BEGIN IMMEDIATE'): T {
    this.db.exec(begin);
    let committed = false;
    try {
      const result = run();
      this.db.exec('COMMIT');
      committed = true;
      return result;
    } finally {
      if (!committed) this.db.exec('ROLLBACK');
    }
  }

  /** Release the process's database connection. */
  close(): void {
    this.db.close();
  }
}

let store: WorkerStore | undefined;
let defaultWorkspace: string;
let publish: (uri: string) => void;

/** Initialize before accepting requests; configuration errors fail startup. */
export function initializeWorkerStore(options: {
  stateDir?: string | undefined;
  workspace?: string | undefined;
  publish: (uri: string) => void;
}): void {
  defaultWorkspace = options.workspace ?? deriveWorkspace();
  statusUri(defaultWorkspace);
  store = new WorkerStore(options.stateDir ?? join(homedir(), '.local/state/shift-mcp-server'));
  publish = options.publish;
}

/** Access initialized storage without a process-local fallback. */
export function getWorkerStore(): WorkerStore {
  if (!store) throw new Error('Worker store is not initialized');
  return store;
}

/** Select the exact explicit identifier or the configured process default. */
export function resolveWorkspace(workspace?: string): string {
  return workspace === '' ? defaultWorkspace : (workspace ?? defaultWorkspace);
}

/** Publish after commit, once per applicable resource URI. */
export function notifyWorkspace(workspace: string): void {
  publish(statusUri(workspace));
  if (workspace === defaultWorkspace) publish('shift://status');
}

/** Close storage during application teardown. */
export function closeWorkerStore(): void {
  store?.close();
  store = undefined;
}
