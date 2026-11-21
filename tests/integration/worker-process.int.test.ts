/**
 * @fileoverview Independent-process persistence, contention and failure behavior.
 * @module tests/integration/worker-process.int.test
 */
import { execFile, execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deriveWorkspace, WorkerStore } from '@/services/worker-store/worker-store.js';

const execute = promisify(execFile);
const modulePath = new URL('../../src/services/worker-store/worker-store.ts', import.meta.url).href;
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'shift-process-'));
});
afterEach(() => {
  rmSync(directory, { recursive: true });
});

async function processCall(body: string) {
  const result = await execute(
    'bun',
    [
      '--eval',
      `import {WorkerStore} from ${JSON.stringify(modulePath)}; const store = new WorkerStore(process.argv[1]); try { ${body} } finally { store.close(); }`,
      directory,
    ],
    { timeout: 15_000 },
  );
  return JSON.parse(result.stdout);
}

function seedLegacyRoster(): void {
  const db = new DatabaseSync(join(directory, 'roster.sqlite'));
  try {
    db.exec(`
      CREATE TABLE workers (
        workspace TEXT NOT NULL, workerId TEXT NOT NULL, gist TEXT NOT NULL,
        files TEXT NOT NULL, checkedInAt TEXT NOT NULL,
        PRIMARY KEY (workspace, workerId)
      );
      INSERT INTO workers VALUES ('a', 'OLD001', 'legacy', '["old.ts"]', '2026-03-23T14:30:00.000Z');
    `);
  } finally {
    db.close();
  }
}

it.each(['fresh', 'legacy'] as const)('opens a %s database concurrently', async (kind) => {
  if (kind === 'legacy') seedLegacyRoster();
  const [first, second] = await Promise.all([
    processCall("console.log(JSON.stringify(store.checkIn('a', {gist:'first'})))"),
    processCall("console.log(JSON.stringify(store.checkIn('a', {gist:'second'})))"),
  ]);
  expect(first.session.workerId).not.toBe(second.session.workerId);
  const store = new WorkerStore(directory);
  try {
    expect(store.checkOut('a', first.session.workerId, 'finished')).toBe(true);
    const snapshot = store.status('a');
    expect(snapshot.activeWorkers.map(({ gist }) => gist)).toEqual(
      kind === 'legacy' ? ['legacy', 'second'] : ['second'],
    );
    expect(snapshot.recentlyFinished[0]).toMatchObject({ gist: 'first', summary: 'finished' });
    if (kind === 'legacy') {
      expect(snapshot.activeWorkers[0]).toEqual({
        workerId: 'OLD001',
        gist: 'legacy',
        files: ['old.ts'],
        checkedInAt: '2026-03-23T14:30:00.000Z',
      });
      const adopted = store.checkIn('a', { workerId: 'OLD001', gist: 'adopted' });
      expect(adopted.session).toMatchObject({
        files: ['old.ts'],
        checkedInAt: '2026-03-23T14:30:00.000Z',
        lastSeenAt: expect.any(String),
      });
      expect(adopted.recentlyFinished[0]?.gist).toBe('first');
    }
  } finally {
    store.close();
  }
});

it('keeps positional v0.2.0 writes usable and invalidates stale activity', () => {
  seedLegacyRoster();
  const store = new WorkerStore(directory);
  const old = new DatabaseSync(join(directory, 'roster.sqlite'));
  try {
    const first = store.checkIn('a', { workerId: 'OLD001', gist: 'adopted' });
    expect(first.session?.lastSeenAt).toBeDefined();
    const second = store.checkIn('a', { gist: 'leaving' }).session!;
    expect(store.checkOut('a', second.workerId, '')).toBe(true);
    expect(store.status('a').recentlyFinished[0]?.summary).toBe('');
    old.exec(`
      BEGIN IMMEDIATE;
      INSERT INTO workers VALUES ('a', 'OLD002', 'new via old', '[]', '2026-03-23T14:30:00.000Z');
      UPDATE workers SET gist = 'updated via old', files = '["legacy.ts"]'
        WHERE workspace = 'a' AND workerId = 'OLD001';
      COMMIT;
    `);
    expect(store.list('a').find(({ workerId }) => workerId === 'OLD001')).toEqual({
      workerId: 'OLD001',
      checkedInAt: '2026-03-23T14:30:00.000Z',
      gist: 'updated via old',
      files: ['legacy.ts'],
    });
    old.exec("DELETE FROM workers WHERE workspace = 'a' AND workerId = 'OLD001'");
    expect(store.status('a')).toEqual({
      activeWorkers: [expect.objectContaining({ workerId: 'OLD002' })],
      recentlyFinished: [],
    });
  } finally {
    old.close();
    store.close();
  }
});

it.each([
  { transaction: 'BEGIN; SELECT * FROM seed', release: true },
  { transaction: 'BEGIN IMMEDIATE; UPDATE seed SET value=2', release: true },
  { transaction: 'BEGIN IMMEDIATE; UPDATE seed SET value=2', release: false },
])(
  'bounds real initialization lock handling: $transaction, release=$release',
  async ({ transaction, release }) => {
    const filename = join(directory, 'roster.sqlite');
    const seed = new DatabaseSync(filename);
    seed.exec('CREATE TABLE seed(value INTEGER); INSERT INTO seed VALUES(1)');
    seed.close();
    const child = spawn(
      'bun',
      [
        '--eval',
        `import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(process.argv[1]); db.exec(process.argv[2]); process.once('SIGTERM',()=>{db.exec('ROLLBACK'); db.close(); process.exit(0);}); process.stdin.resume(); console.log('locked');`,
        filename,
        transaction,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('startup fixture never locked')), 5_000);
        child.stdout.once('data', () => {
          clearTimeout(timeout);
          resolve();
        });
        child.once('error', reject);
      });
      if (release) child.kill('SIGTERM');
      const started = performance.now();
      if (release) {
        const store = new WorkerStore(directory);
        try {
          expect(store.checkIn('a', { gist: 'after startup lock' }).activeWorkers).toHaveLength(1);
        } finally {
          store.close();
        }
      } else {
        expect(() => new WorkerStore(directory)).toThrow(/locked|busy/i);
        expect(performance.now() - started).toBeGreaterThanOrEqual(2_800);
      }
      expect(performance.now() - started).toBeLessThan(4_500);
    } finally {
      if (child.exitCode === null) child.kill('SIGTERM');
      await exited;
    }
  },
);

it('shares persisted state across independent processes and isolates namespaces', async () => {
  const first = await processCall(
    "console.log(JSON.stringify(store.checkIn('a', {gist:'first', files:['a.ts']})))",
  );
  const second = await processCall(
    "console.log(JSON.stringify(store.checkIn('a', {gist:'second'})))",
  );
  expect(second.activeWorkers).toHaveLength(2);
  expect(second.session.workerId).not.toBe(first.session.workerId);
  expect(await processCall("console.log(JSON.stringify(store.list('b')))")).toEqual([]);
  const patched = await processCall(
    `console.log(JSON.stringify(store.checkIn('a', {workerId:${JSON.stringify(first.session.workerId)}, gist:'updated'})))`,
  );
  expect(patched.session).toMatchObject({
    files: ['a.ts'],
    checkedInAt: first.session.checkedInAt,
  });
});

it('updates a persisted session across process exits and honors explicit file clearing', async () => {
  const { session } = await processCall(
    "console.log(JSON.stringify(store.checkIn('a', {gist:'first', files:['a.ts']})))",
  );
  const { session: patched } = await processCall(
    `console.log(JSON.stringify(store.checkIn('a', {workerId:${JSON.stringify(session.workerId)}, gist:'resumed', files:[]})))`,
  );
  expect(patched).toMatchObject({
    workerId: session.workerId,
    gist: 'resumed',
    files: [],
    checkedInAt: session.checkedInAt,
  });
  expect(await processCall("console.log(JSON.stringify(store.list('b')))")).toEqual([]);
});

it('marks a departed peer and clears the marker when another process re-adopts it', async () => {
  const { session } = await processCall(
    "console.log(JSON.stringify(store.checkIn('a', {gist:'first', files:['a.ts']})))",
  );
  const store = new WorkerStore(directory);
  try {
    expect(store.list('a')[0]).toMatchObject({
      workerId: session.workerId,
      lastSeenAt: session.checkedInAt,
      ...(process.platform === 'darwin' || process.platform === 'linux' ? { orphaned: true } : {}),
    });
    const adopted = store.checkIn('a', { workerId: session.workerId, gist: 'resumed' });
    expect(adopted.session).toMatchObject({
      workerId: session.workerId,
      files: ['a.ts'],
      checkedInAt: session.checkedInAt,
      lastSeenAt: expect.any(String),
    });
    expect(adopted.activeWorkers[0]?.orphaned).toBeUndefined();
  } finally {
    store.close();
  }
});

it('leaves a foreign or unprobeable owner unmarked', async () => {
  const { session } = await processCall(
    "console.log(JSON.stringify(store.checkIn('a', {gist:'first'})))",
  );
  const store = new WorkerStore(directory);
  const db = new DatabaseSync(join(directory, 'roster.sqlite'));
  try {
    const probe = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('access denied'), { code: 'EPERM' });
    });
    try {
      expect(store.list('a')[0]?.orphaned).toBeUndefined();
      probe.mockClear();
      db.exec("UPDATE worker_activity SET ownerScope = 'another-namespace'");
      expect(store.list('a')[0]).toMatchObject({
        workerId: session.workerId,
        lastSeenAt: session.checkedInAt,
      });
      expect(store.list('a')[0]?.orphaned).toBeUndefined();
      expect(probe).not.toHaveBeenCalled();
    } finally {
      probe.mockRestore();
    }
  } finally {
    db.close();
    store.close();
  }
});

it.runIf(process.platform === 'darwin' || process.platform === 'linux')(
  'uses one roster snapshot when another connection checks a peer out during the read',
  async () => {
    const { session } = await processCall(
      "console.log(JSON.stringify(store.checkIn('a', {gist:'leaving'})))",
    );
    const reader = new WorkerStore(directory);
    const writer = new WorkerStore(directory);
    try {
      writer.checkIn('a', { gist: 'staying' });
      const kill = process.kill;
      const probe = vi.spyOn(process, 'kill').mockImplementationOnce((pid, signal) => {
        expect(writer.checkOut('a', session.workerId, 'done')).toBe(true);
        return kill(pid, signal);
      });
      try {
        const duringCheckout = reader.status('a');
        expect(probe).toHaveBeenCalledOnce();
        expect(duringCheckout.activeWorkers).toHaveLength(2);
        expect(duringCheckout.recentlyFinished).toEqual([]);
        expect(reader.status('a')).toEqual({
          activeWorkers: [expect.objectContaining({ gist: 'staying' })],
          recentlyFinished: [expect.objectContaining({ gist: 'leaving', summary: 'done' })],
        });
      } finally {
        probe.mockRestore();
      }
    } finally {
      writer.close();
      reader.close();
    }
  },
);

it('uses original join order for handoffs at the same timestamp and prunes departed peers', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-21T12:00:00.000Z'));
  const store = new WorkerStore(directory);
  try {
    const older = store.checkIn('a', { gist: 'older' }).session!;
    const leaving = store.checkIn('a', { gist: 'leaving', files: ['a.ts'] }).session!;
    store.checkIn('a', { workerId: leaving.workerId, gist: 'updated first departure' });
    expect(store.checkOut('a', leaving.workerId, 'done')).toBe(true);
    expect(store.checkOut('a', leaving.workerId, 'no-op')).toBe(false);
    const firstDeparture = {
      workerId: leaving.workerId,
      gist: 'updated first departure',
      files: ['a.ts'],
      summary: 'done',
      checkedOutAt: older.checkedInAt,
    };
    const newcomer = store.checkIn('a', { gist: 'newcomer' });
    expect(newcomer.recentlyFinished).toEqual([]);
    expect(
      store.checkIn('a', { workerId: older.workerId, gist: 'updated' }).recentlyFinished,
    ).toEqual([firstDeparture]);
    expect(store.status('a').recentlyFinished).toEqual([firstDeparture]);
    expect(store.status('b')).toEqual({ activeWorkers: [], recentlyFinished: [] });
    store.checkOut('a', older.workerId);
    expect(store.status('a').recentlyFinished).toEqual([
      { workerId: older.workerId, gist: 'updated', files: [], checkedOutAt: older.checkedInAt },
    ]);
    store.checkOut('a', newcomer.session!.workerId);
    expect(store.status('a')).toEqual({ activeWorkers: [], recentlyFinished: [] });
  } finally {
    store.close();
    vi.useRealTimers();
  }
});

it('rolls back removal and pruning if writing the departure fails', () => {
  const store = new WorkerStore(directory);
  const db = new DatabaseSync(join(directory, 'roster.sqlite'));
  try {
    const older = store.checkIn('a', { gist: 'older' }).session!;
    const leaving = store.checkIn('a', { gist: 'leaving' }).session!;
    store.checkOut('a', leaving.workerId);
    store.checkIn('a', { gist: 'newer' });
    const before = store.status('a');
    db.exec(`
      CREATE TRIGGER fail_departure BEFORE INSERT ON departures
        BEGIN SELECT RAISE(ABORT, 'test failure'); END;
    `);
    expect(() => store.checkOut('a', older.workerId)).toThrow('test failure');
    expect(store.status('a')).toEqual(before);
  } finally {
    db.close();
    store.close();
  }
});

it('serializes concurrent creates, updates and removals without lost unrelated writes', async () => {
  const initial = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      processCall(`console.log(JSON.stringify(store.checkIn('a', {gist:'worker-${index}'})))`),
    ),
  );
  const ids = initial.map((result) => result.session.workerId);
  expect(new Set(ids).size).toBe(8);
  await Promise.all(
    ids.map((workerId, index) =>
      processCall(
        index % 2
          ? `console.log(JSON.stringify(store.checkOut('a', ${JSON.stringify(workerId)})))`
          : `console.log(JSON.stringify(store.checkIn('a', {workerId:${JSON.stringify(workerId)}, gist:'updated-${index}'})))`,
      ),
    ),
  );
  const final = await processCall("console.log(JSON.stringify(store.list('a')))");
  expect(final.map((session: { gist: string }) => session.gist).sort()).toEqual([
    'updated-0',
    'updated-2',
    'updated-4',
    'updated-6',
  ]);
});

it('rolls back an interrupted writer and exposes bounded lock contention', async () => {
  const store = new WorkerStore(directory);
  store.checkIn('a', { gist: 'committed' });
  const child = spawn(
    'bun',
    [
      '--eval',
      `import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(process.argv[1]); db.exec("BEGIN IMMEDIATE; UPDATE workers SET gist='uncommitted'"); console.log('locked'); setInterval(()=>db.prepare('SELECT 1').get(),1000);`,
      join(directory, 'roster.sqlite'),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('writer never acquired lock')), 5_000);
      child.stdout.once('data', () => {
        clearTimeout(timeout);
        resolve();
      });
      child.once('error', reject);
    });
    expect(store.list('a')[0]?.gist).toBe('committed');
    const started = performance.now();
    expect(() => store.checkIn('a', { gist: 'blocked' })).toThrow(/locked|busy/i);
    expect(performance.now() - started).toBeLessThan(5_000);
  } finally {
    child.kill('SIGKILL');
    await exited;
  }
  expect(store.list('a').map((session) => session.gist)).toEqual(['committed']);
  expect(store.checkIn('a', { gist: 'after rollback' }).activeWorkers).toHaveLength(2);
  store.close();
});

it('retries generated ID collisions inside the transaction and rolls back exhaustion', () => {
  const store = new WorkerStore(directory);
  const bytes = vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
    (array as Uint8Array).fill(0);
    return array;
  });
  try {
    expect(store.checkIn('a', { gist: 'first' }).session?.workerId).toBe('AAAAAA');
    expect(() => store.checkIn('a', { gist: 'collision' })).toThrow(/10 attempts/);
    expect(store.list('a')).toHaveLength(1);
    bytes.mockRestore();
    expect(store.checkIn('a', { gist: 'recovered' }).activeWorkers).toHaveLength(2);
  } finally {
    bytes.mockRestore();
    store.close();
  }
});

it('fails visibly for corrupt and unwritable stores', () => {
  writeFileSync(join(directory, 'roster.sqlite'), 'not a SQLite database');
  expect(() => new WorkerStore(directory)).toThrow();
  const unwritable = join(directory, 'unwritable');
  mkdirSync(unwritable);
  chmodSync(unwritable, 0o500);
  try {
    expect(() => new WorkerStore(unwritable)).toThrow();
  } finally {
    chmodSync(unwritable, 0o700);
  }
});

it('derives a shared real Git root for subdirectories and symlinks, with cwd fallback', () => {
  expect(deriveWorkspace(directory)).toBe(realpathSync(directory));
  execFileSync('git', ['init', '-q', directory]);
  const nested = join(directory, 'nested');
  mkdirSync(nested);
  const linked = join(directory, 'linked');
  symlinkSync(nested, linked);
  expect(deriveWorkspace(nested)).toBe(realpathSync(directory));
  expect(deriveWorkspace(linked)).toBe(realpathSync(directory));
  const worktree = join(directory, 'worktree');
  mkdirSync(worktree);
  writeFileSync(join(worktree, '.git'), 'gitdir: /example/linked-metadata');
  const inner = join(worktree, 'inner');
  mkdirSync(inner);
  expect(deriveWorkspace(inner)).toBe(realpathSync(worktree));
});
