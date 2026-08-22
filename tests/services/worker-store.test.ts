/**
 * @fileoverview Tests for the in-memory worker session store.
 * @module tests/services/worker-store.test
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  formatWorkersTable,
  generateWorkerId,
  WORKER_ID_PATTERN,
  type WorkerSession,
  workers,
} from '@/services/worker-store/worker-store.js';

beforeEach(() => {
  workers.clear();
});

describe('workers map', () => {
  it('starts empty after clear', () => {
    expect(workers.size).toBe(0);
  });
});

describe('generateWorkerId', () => {
  it('returns a 6-character uppercase alphanumeric string', () => {
    expect(generateWorkerId()).toMatch(WORKER_ID_PATTERN);
  });

  it('returns unique IDs across multiple calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateWorkerId()));
    expect(ids.size).toBe(50);
  });

  it('does not collide with existing workers in the map', () => {
    const existing: WorkerSession = {
      workerId: 'AAAAAA',
      gist: 'existing session',
      files: [],
      checkedInAt: '2026-03-23T10:00:00Z',
    };
    workers.set(existing.workerId, existing);

    for (const id of Array.from({ length: 50 }, () => generateWorkerId())) {
      expect(id).not.toBe('AAAAAA');
    }
  });
});

describe('formatWorkersTable', () => {
  it('returns "no agents" message for empty array', () => {
    expect(formatWorkersTable([])).toBe('No agents are currently active.');
  });

  it('produces a markdown table with header and one row', () => {
    const session: WorkerSession = {
      workerId: 'ABC123',
      gist: 'Refactoring auth module',
      files: ['src/auth.ts'],
      checkedInAt: '2026-03-23T14:30:00Z',
    };

    const lines = formatWorkersTable([session]).split('\n');

    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('| Worker | Checked In | Working On | Files |');
    expect(lines[1]).toBe('|--------|------------|------------|-------|');
    expect(lines[2]).toBe(
      '| ABC123 | 2026-03-23T14:30:00Z | Refactoring auth module | src/auth.ts |',
    );
  });

  it('sorts multiple sessions by checkedInAt', () => {
    const sessions: WorkerSession[] = [
      { workerId: 'LATE00', gist: 'late', files: [], checkedInAt: '2026-03-23T16:00:00Z' },
      { workerId: 'EARLY0', gist: 'early', files: [], checkedInAt: '2026-03-23T10:00:00Z' },
      { workerId: 'MID000', gist: 'mid', files: [], checkedInAt: '2026-03-23T13:00:00Z' },
    ];

    const dataRows = formatWorkersTable(sessions).split('\n').slice(2);

    expect(dataRows[0]).toContain('EARLY0');
    expect(dataRows[1]).toContain('MID000');
    expect(dataRows[2]).toContain('LATE00');
  });

  it('escapes pipe characters in gist and files', () => {
    const session: WorkerSession = {
      workerId: 'PIPE00',
      gist: 'fix | operator',
      files: ['src/a|b.ts'],
      checkedInAt: '2026-03-23T12:00:00Z',
    };

    const row = formatWorkersTable([session]).split('\n')[2];

    expect(row).toContain('fix \\| operator');
    expect(row).toContain('src/a\\|b.ts');
  });

  it('shows em-dash when files array is empty', () => {
    const session: WorkerSession = {
      workerId: 'NOFILE',
      gist: 'exploring codebase',
      files: [],
      checkedInAt: '2026-03-23T09:00:00Z',
    };

    const row = formatWorkersTable([session]).split('\n')[2];

    expect(row).toMatch(/\|\s*—\s*\|$/);
  });
});
