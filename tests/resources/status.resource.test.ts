/**
 * @fileoverview Tests for the shift://status resource — empty vs populated text,
 * listing, and content formatting.
 * @module tests/resources/status.resource.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { statusResource } from '@/mcp-server/resources/definitions/status.resource.js';
import { type WorkerSession, workers } from '@/services/worker-store/worker-store.js';

const makeWorker = (overrides: Partial<WorkerSession> = {}): WorkerSession => ({
  workerId: 'ABC123',
  gist: 'Refactoring auth module',
  files: ['src/auth.ts'],
  checkedInAt: '2026-03-23T10:30:00Z',
  ...overrides,
});

const listExtra = {} as Parameters<NonNullable<typeof statusResource.list>>[0];

const read = async (): Promise<string> =>
  (await statusResource.handler(
    {},
    createMockContext({ uri: new URL('shift://status') }),
  )) as string;

describe('statusResource', () => {
  beforeEach(() => {
    workers.clear();
  });

  describe('handler', () => {
    it('returns empty-state markdown when no workers are active', async () => {
      await expect(read()).resolves.toBe('## Active Workers (0)\nNo agents are currently active.');
    });

    it('returns markdown with count and table for a single worker', async () => {
      const worker = makeWorker();
      workers.set(worker.workerId, worker);

      const result = await read();

      expect(result).toContain('## Active Workers (1)');
      expect(result).toContain('| Worker | Checked In | Working On | Files |');
      expect(result).toContain(worker.workerId);
      expect(result).toContain(worker.gist);
      expect(result).toContain(worker.checkedInAt);
    });

    it('returns correct count and table for multiple workers', async () => {
      for (const w of [
        makeWorker({ workerId: 'AAA111', checkedInAt: '2026-03-23T09:00:00Z' }),
        makeWorker({
          workerId: 'BBB222',
          gist: 'Writing tests',
          files: ['tests/foo.test.ts'],
          checkedInAt: '2026-03-23T09:15:00Z',
        }),
        makeWorker({
          workerId: 'CCC333',
          gist: 'Updating docs',
          files: [],
          checkedInAt: '2026-03-23T09:30:00Z',
        }),
      ]) {
        workers.set(w.workerId, w);
      }

      const result = await read();

      expect(result).toContain('## Active Workers (3)');
      expect(result).toContain('AAA111');
      expect(result).toContain('BBB222');
      expect(result).toContain('CCC333');
      expect(result).toContain('Writing tests');
      expect(result).toContain('Updating docs');
    });
  });

  describe('list', () => {
    it('returns a single resource entry with the expected uri, name, and mimeType', async () => {
      const listing = await statusResource.list?.(listExtra);

      expect(listing).toEqual({
        resources: [{ uri: 'shift://status', name: 'Active Workers', mimeType: 'text/markdown' }],
      });
    });
  });

  describe('format', () => {
    it('returns array with uri, text, and mimeType from meta', () => {
      const text = '## Active Workers (0)\nNo agents are currently active.';

      expect(
        statusResource.format?.(text, {
          uri: new URL('shift://status'),
          mimeType: 'text/markdown',
        }),
      ).toEqual([{ uri: 'shift://status', text, mimeType: 'text/markdown' }]);
    });
  });
});
