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
        `import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(process.argv[1]); db.exec(process.argv[2]); console.log('locked'); process.stdin.once('data',()=>setTimeout(()=>{ db.exec('ROLLBACK'); db.close(); process.exit(0); },250));`,
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
      if (release) child.stdin.write('release after delay');
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
      child.kill('SIGTERM');
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
