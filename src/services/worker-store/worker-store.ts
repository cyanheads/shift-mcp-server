/**
 * @fileoverview Durable workspace rosters and Markdown presentation.
 * @module services/worker-store/worker-store
 */

import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { validationError } from '@cyanheads/mcp-ts-core/errors';

/** A single active working session. */
export interface WorkerSession {
  checkedInAt: string;
  files: string[];
  gist: string;
  workerId: string;
}

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

/** Escape presentation delimiters without changing stored domain values. */
function escPipe(s: string): string {
  return s
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replace(/\r\n|[\r\n]/g, ' ');
}

/** Format worker sessions as a markdown table, oldest check-in first. */
export function formatWorkersTable(sessions: WorkerSession[]): string {
  if (sessions.length === 0) return 'No agents are currently active.';

  const rows = [...sessions]
    .sort((a, b) => a.checkedInAt.localeCompare(b.checkedInAt))
    .map(
      (w) =>
        `| ${w.workerId} | ${w.checkedInAt} | ${escPipe(w.gist)} | ${escPipe(w.files.join(', ')) || '—'} |`,
    )
    .join('\n');

  return `| Worker | Checked In | Working On | Files |\n|--------|------------|------------|-------|\n${rows}`;
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

  constructor(stateDir: string) {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(stateDir, 'roster.sqlite'));
    try {
      const deadline = performance.now() + BUSY_TIMEOUT_MS;
      for (;;) {
        const remaining = Math.max(0, Math.floor(deadline - performance.now()));
        this.db.exec(`PRAGMA busy_timeout=${remaining}`);
        try {
          this.db.exec(`PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS workers (
              workspace TEXT NOT NULL, workerId TEXT NOT NULL, gist TEXT NOT NULL,
              files TEXT NOT NULL, checkedInAt TEXT NOT NULL,
              PRIMARY KEY (workspace, workerId)
            );`);
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
        'SELECT workerId, gist, files, checkedInAt FROM workers WHERE workspace = ? ORDER BY checkedInAt, workerId',
      )
      .all(workspace)
      .map((row) => ({
        workerId: row.workerId as string,
        gist: row.gist as string,
        files: JSON.parse(row.files as string) as string[],
        checkedInAt: row.checkedInAt as string,
      }));
  }

  /** Create or patch a session without changing its original check-in timestamp. */
  checkIn(
    workspace: string,
    input: { gist: string; files?: string[] | undefined; workerId?: string | undefined },
  ) {
    return this.transaction(() => {
      const current = this.list(workspace);
      let session: WorkerSession;
      if (input.workerId) {
        const existing = current.find((worker) => worker.workerId === input.workerId);
        if (!existing) return { session: undefined, activeWorkers: current };
        session = { ...existing, gist: input.gist, files: input.files ?? existing.files };
        this.db
          .prepare('UPDATE workers SET gist = ?, files = ? WHERE workspace = ? AND workerId = ?')
          .run(session.gist, JSON.stringify(session.files), workspace, session.workerId);
      } else {
        let workerId: string | undefined;
        for (let attempt = 0; attempt < 10; attempt++) {
          const candidate = generateWorkerId();
          if (!current.some((worker) => worker.workerId === candidate)) {
            workerId = candidate;
            break;
          }
        }
        if (!workerId) throw new Error('Failed to generate unique worker ID after 10 attempts');
        session = {
          workerId,
          gist: input.gist,
          files: input.files ?? [],
          checkedInAt: new Date().toISOString(),
        };
        this.db
          .prepare('INSERT INTO workers VALUES (?, ?, ?, ?, ?)')
          .run(
            workspace,
            session.workerId,
            session.gist,
            JSON.stringify(session.files),
            session.checkedInAt,
          );
      }
      return { session, activeWorkers: this.list(workspace) };
    });
  }

  /** Return the actual deletion outcome, retaining idempotent success. */
  checkOut(workspace: string, workerId: string): boolean {
    return this.transaction(
      () =>
        this.db
          .prepare('DELETE FROM workers WHERE workspace = ? AND workerId = ?')
          .run(workspace, workerId).changes > 0,
    );
  }

  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
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
