/**
 * @fileoverview Tests for shift_check_in tool — new sessions, updates, patch semantics, format output.
 * @module tests/mcp-server/tools/definitions/check-in.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { checkIn } from '@/mcp-server/tools/definitions/check-in.tool.js';
import { workers, type WorkerSession } from '@/mcp-server/tools/definitions/worker-store.js';

function parse(input: Record<string, unknown>) {
  return checkIn.input.parse(input);
}

describe('shift_check_in', () => {
  const ctx = createMockContext();

  beforeEach(() => {
    workers.clear();
  });

  describe('new check-in', () => {
    it('creates a session and returns all expected fields', () => {
      const result = checkIn.handler(parse({ gist: 'Refactoring auth module' }), ctx);

      expect(result.workerId).toMatch(/^[A-Z0-9]{6}$/);
      expect(result.gist).toBe('Refactoring auth module');
      expect(result.files).toEqual([]);
      expect(result.checkedInAt).toBeTruthy();
      expect(new Date(result.checkedInAt).toISOString()).toBe(result.checkedInAt);
      expect(result.activeWorkers).toHaveLength(1);
      expect(result.activeWorkers[0].workerId).toBe(result.workerId);
    });

    it('defaults files to empty array when omitted', () => {
      const result = checkIn.handler(parse({ gist: 'Bug fix' }), ctx);

      expect(result.files).toEqual([]);
      expect(workers.get(result.workerId)!.files).toEqual([]);
    });

    it('stores declared files', () => {
      const files = ['src/index.ts', 'src/utils.ts'];
      const result = checkIn.handler(parse({ gist: 'Adding utils', files }), ctx);

      expect(result.files).toEqual(files);
      expect(workers.get(result.workerId)!.files).toEqual(files);
    });
  });

  describe('update existing session', () => {
    let existing: WorkerSession;

    beforeEach(() => {
      const result = checkIn.handler(parse({ gist: 'Initial task', files: ['a.ts'] }), ctx);
      existing = workers.get(result.workerId)!;
    });

    it('updates gist and preserves checkedInAt', () => {
      const result = checkIn.handler(
        parse({ gist: 'Updated task', workerId: existing.workerId }),
        ctx,
      );

      expect(result.gist).toBe('Updated task');
      expect(result.checkedInAt).toBe(existing.checkedInAt);
      expect(result.workerId).toBe(existing.workerId);
    });

    it('replaces files when provided', () => {
      const newFiles = ['b.ts', 'c.ts'];
      const result = checkIn.handler(
        parse({ gist: 'Updated task', files: newFiles, workerId: existing.workerId }),
        ctx,
      );

      expect(result.files).toEqual(newFiles);
    });

    it('preserves existing files when files field is omitted (patch semantics)', () => {
      const result = checkIn.handler(
        parse({ gist: 'Updated task', workerId: existing.workerId }),
        ctx,
      );

      expect(result.files).toEqual(['a.ts']);
    });

    it('throws when workerId does not exist', () => {
      expect(() =>
        checkIn.handler(parse({ gist: 'Anything', workerId: 'ZZZZZZ' }), ctx),
      ).toThrow(/not found/i);
    });
  });

  describe('multiple workers', () => {
    it('activeWorkers includes all checked-in workers', () => {
      checkIn.handler(parse({ gist: 'Task A' }), ctx);
      checkIn.handler(parse({ gist: 'Task B' }), ctx);
      const result = checkIn.handler(parse({ gist: 'Task C' }), ctx);

      expect(result.activeWorkers).toHaveLength(3);
      const gists = result.activeWorkers.map((w) => w.gist);
      expect(gists).toContain('Task A');
      expect(gists).toContain('Task B');
      expect(gists).toContain('Task C');
    });
  });

  describe('format', () => {
    it('returns text content with session info and coordination protocol', () => {
      const result = checkIn.handler(parse({ gist: 'Working on API', files: ['api.ts'] }), ctx);
      const formatted = checkIn.format(result);

      expect(formatted).toHaveLength(1);
      expect(formatted[0].type).toBe('text');
      const text = formatted[0].text;
      expect(text).toContain(result.workerId);
      expect(text).toContain('Working on API');
      expect(text).toContain('api.ts');
      expect(text).toContain('Coordination Protocol');
      expect(text).toContain('shift_check_in');
      expect(text).toContain('shift_check_out');
    });

    it('shows "first to check in" message when solo', () => {
      const result = checkIn.handler(parse({ gist: 'Solo work' }), ctx);
      const formatted = checkIn.format(result);
      const text = formatted[0].text;

      expect(text).toContain('first to check in');
      expect(text).toContain('No other agents are currently active');
    });

    it('shows active workers table when peers exist', () => {
      const first = checkIn.handler(parse({ gist: 'Task A' }), ctx);
      const second = checkIn.handler(parse({ gist: 'Task B' }), ctx);

      const formatted = checkIn.format(second);
      const text = formatted[0].text;

      expect(text).not.toContain('first to check in');
      expect(text).toContain('Active Workers');
      expect(text).toContain(first.workerId);
      expect(text).toContain(second.workerId);
    });
  });
});
