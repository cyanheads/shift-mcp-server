/**
 * @fileoverview Isolated SQLite fixture retaining explicit roster assertions.
 * @module tests/worker-fixture
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, type Mock, vi } from 'vitest';
import {
  closeWorkerStore,
  getWorkerStore,
  initializeWorkerStore,
  type WorkerSession,
} from '@/services/worker-store/worker-store.js';

const directory = mkdtempSync(join(tmpdir(), 'shift-test-'));
export const notify: Mock<(uri: string) => void> = vi.fn();
initializeWorkerStore({ stateDir: directory, workspace: 'test', publish: notify });
const db = new DatabaseSync(join(directory, 'roster.sqlite'));

/** SQL-backed fixture helpers, never Casey's real coordination data. */
export const workers = {
  clear() {
    db.exec('DELETE FROM workers');
    notify.mockClear();
  },
  get(id: string) {
    return getWorkerStore()
      .list('test')
      .find((worker) => worker.workerId === id);
  },
  has(id: string) {
    return this.get(id) !== undefined;
  },
  get size() {
    return getWorkerStore().list('test').length;
  },
  set(id: string, worker: WorkerSession) {
    db.prepare('INSERT OR REPLACE INTO workers VALUES (?, ?, ?, ?, ?)').run(
      'test',
      id,
      worker.gist,
      JSON.stringify(worker.files),
      worker.checkedInAt,
    );
  },
};
afterAll(() => {
  db.close();
  closeWorkerStore();
  rmSync(directory, { recursive: true });
});
