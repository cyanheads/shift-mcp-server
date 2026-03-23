/**
 * @fileoverview Tests for shift://status resource.
 * @module tests/mcp-server/resources/definitions/status.resource.test
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { statusResource } from '@/mcp-server/resources/definitions/status.resource.js';
import { workers, type WorkerSession } from '@/mcp-server/tools/definitions/worker-store.js';

const makeWorker = (overrides: Partial<WorkerSession> = {}): WorkerSession => ({
  workerId: 'ABC123',
  gist: 'Refactoring auth module',
  files: ['src/auth.ts'],
  checkedInAt: '2026-03-23T10:30:00Z',
  ...overrides,
});

describe('statusResource', () => {
  beforeEach(() => {
    workers.clear();
  });

  describe('handler', () => {
    it('returns empty-state markdown when no workers are active', () => {
      const result = statusResource.handler();

      expect(result).toBe('## Active Workers (0)\nNo agents are currently active.');
    });

    it('returns markdown with count and table for a single worker', () => {
      const worker = makeWorker();
      workers.set(worker.workerId, worker);

      const result = statusResource.handler();

      expect(result).toContain('## Active Workers (1)');
      expect(result).toContain('| Worker |');
      expect(result).toContain(worker.workerId);
      expect(result).toContain(worker.gist);
    });

    it('returns correct count and table for multiple workers', () => {
      const w1 = makeWorker({ workerId: 'AAA111', checkedInAt: '2026-03-23T09:00:00Z' });
      const w2 = makeWorker({
        workerId: 'BBB222',
        gist: 'Writing tests',
        files: ['tests/foo.test.ts'],
        checkedInAt: '2026-03-23T09:15:00Z',
      });
      const w3 = makeWorker({
        workerId: 'CCC333',
        gist: 'Updating docs',
        files: [],
        checkedInAt: '2026-03-23T09:30:00Z',
      });
      workers.set(w1.workerId, w1);
      workers.set(w2.workerId, w2);
      workers.set(w3.workerId, w3);

      const result = statusResource.handler();

      expect(result).toContain('## Active Workers (3)');
      expect(result).toContain('AAA111');
      expect(result).toContain('BBB222');
      expect(result).toContain('CCC333');
      expect(result).toContain('Writing tests');
      expect(result).toContain('Updating docs');
    });
  });

  describe('list', () => {
    it('returns a single resource entry with correct uri, name, and mimeType', async () => {
      const listing = await statusResource.list!();

      expect(listing).toEqual({
        resources: [
          { uri: 'shift://status', name: 'Active Workers', mimeType: 'text/markdown' },
        ],
      });
    });
  });

  describe('format', () => {
    it('returns array with uri, text, and mimeType from meta', () => {
      const text = '## Active Workers (0)\nNo agents are currently active.';
      const meta = { uri: new URL('shift://status'), mimeType: 'text/markdown' };

      const blocks = statusResource.format!(text, meta);

      expect(blocks).toEqual([
        { uri: 'shift://status', text, mimeType: 'text/markdown' },
      ]);
    });
  });
});
