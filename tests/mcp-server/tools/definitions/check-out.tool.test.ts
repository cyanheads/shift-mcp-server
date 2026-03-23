/**
 * @fileoverview Tests for the shift_check_out tool.
 * @module tests/mcp-server/tools/definitions/check-out.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { checkOut } from '@/mcp-server/tools/definitions/check-out.tool.js';
import { type WorkerSession, workers } from '@/mcp-server/tools/definitions/worker-store.js';

const SESSION: WorkerSession = {
  workerId: 'ABC123',
  gist: 'Refactoring auth module',
  files: ['src/auth.ts'],
  checkedInAt: '2026-03-23T00:00:00.000Z',
};

describe('shift_check_out', () => {
  beforeEach(() => {
    workers.clear();
  });

  describe('handler', () => {
    it('removes the worker from the map and returns the workerId', () => {
      workers.set(SESSION.workerId, { ...SESSION });
      const ctx = createMockContext();

      const result = checkOut.handler(
        checkOut.input.parse({ workerId: SESSION.workerId }),
        ctx,
      );

      expect(result.workerId).toBe(SESSION.workerId);
      expect(workers.has(SESSION.workerId)).toBe(false);
    });

    it('returns the summary when provided', () => {
      workers.set(SESSION.workerId, { ...SESSION });
      const ctx = createMockContext();

      const result = checkOut.handler(
        checkOut.input.parse({ workerId: SESSION.workerId, summary: 'Finished auth refactor.' }),
        ctx,
      );

      expect(result.summary).toBe('Finished auth refactor.');
    });

    it('returns undefined summary when not provided', () => {
      workers.set(SESSION.workerId, { ...SESSION });
      const ctx = createMockContext();

      const result = checkOut.handler(
        checkOut.input.parse({ workerId: SESSION.workerId }),
        ctx,
      );

      expect(result.summary).toBeUndefined();
    });

    it('throws when the workerId does not exist', () => {
      const ctx = createMockContext();

      expect(() =>
        checkOut.handler(checkOut.input.parse({ workerId: 'NOPE00' }), ctx),
      ).toThrow(/not found/i);
    });

    it('throws when the worker was already checked out', () => {
      workers.set(SESSION.workerId, { ...SESSION });
      const ctx = createMockContext();

      checkOut.handler(checkOut.input.parse({ workerId: SESSION.workerId }), ctx);

      expect(() =>
        checkOut.handler(checkOut.input.parse({ workerId: SESSION.workerId }), ctx),
      ).toThrow(/not found/i);
    });

    it('leaves no trace in the map after checkout', () => {
      workers.set(SESSION.workerId, { ...SESSION });
      workers.set('XYZ789', { ...SESSION, workerId: 'XYZ789', gist: 'Other task' });
      const ctx = createMockContext();

      checkOut.handler(checkOut.input.parse({ workerId: SESSION.workerId }), ctx);

      expect(workers.size).toBe(1);
      expect(workers.has(SESSION.workerId)).toBe(false);
      expect(workers.has('XYZ789')).toBe(true);
    });
  });

  describe('format', () => {
    it('returns a single line without summary', () => {
      const content = checkOut.format({ workerId: 'ABC123' });

      expect(content).toHaveLength(1);
      expect(content[0]).toEqual({
        type: 'text',
        text: 'Checked out Worker ABC123. Session ended.',
      });
    });

    it('includes the summary line when provided', () => {
      const content = checkOut.format({
        workerId: 'ABC123',
        summary: 'Finished auth refactor.',
      });

      expect(content).toHaveLength(1);
      expect(content[0]).toEqual({
        type: 'text',
        text: 'Checked out Worker ABC123. Session ended.\nSummary: Finished auth refactor.',
      });
    });
  });
});
