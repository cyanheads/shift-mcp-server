/**
 * @fileoverview Tests for shift_check_out — removal, idempotency, resource-update
 * notification, and format() output.
 * @module tests/tools/check-out.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { checkOut } from '@/mcp-server/tools/definitions/check-out.tool.js';
import type { WorkerSession } from '@/services/worker-store/worker-store.js';
import { notify, workers } from '../worker-fixture.js';

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
    it('removes the persisted worker and returns the workerId', async () => {
      workers.set(SESSION.workerId, { ...SESSION });

      const result = await checkOut.handler(
        checkOut.input.parse({ workerId: SESSION.workerId }),
        createMockContext(),
      );

      expect(result.workerId).toBe(SESSION.workerId);
      expect(result).toEqual(expect.schemaMatching(checkOut.output));
      expect(workers.has(SESSION.workerId)).toBe(false);
    });

    it('returns the summary when provided', async () => {
      workers.set(SESSION.workerId, { ...SESSION });

      const result = await checkOut.handler(
        checkOut.input.parse({ workerId: SESSION.workerId, summary: 'Finished auth refactor.' }),
        createMockContext(),
      );

      expect(result.summary).toBe('Finished auth refactor.');
    });

    it('returns undefined summary when not provided', async () => {
      workers.set(SESSION.workerId, { ...SESSION });

      const result = await checkOut.handler(
        checkOut.input.parse({ workerId: SESSION.workerId }),
        createMockContext(),
      );

      expect(result.summary).toBeUndefined();
    });

    it('succeeds silently when the workerId does not exist (idempotent)', async () => {
      const result = await checkOut.handler(
        checkOut.input.parse({ workerId: 'NOPE00' }),
        createMockContext(),
      );

      expect(result.workerId).toBe('NOPE00');
    });

    it('succeeds silently when the worker was already checked out (idempotent)', async () => {
      workers.set(SESSION.workerId, { ...SESSION });
      const ctx = createMockContext();

      await checkOut.handler(checkOut.input.parse({ workerId: SESSION.workerId }), ctx);
      const result = await checkOut.handler(
        checkOut.input.parse({ workerId: SESSION.workerId }),
        ctx,
      );

      expect(result.workerId).toBe(SESSION.workerId);
      expect(workers.has(SESSION.workerId)).toBe(false);
    });

    it('leaves other sessions untouched', async () => {
      workers.set(SESSION.workerId, { ...SESSION });
      workers.set('XYZ789', { ...SESSION, workerId: 'XYZ789', gist: 'Other task' });

      await checkOut.handler(
        checkOut.input.parse({ workerId: SESSION.workerId }),
        createMockContext(),
      );

      expect(workers.size).toBe(1);
      expect(workers.has(SESSION.workerId)).toBe(false);
      expect(workers.has('XYZ789')).toBe(true);
    });

    it('notifies shift://status subscribers only when a session was removed', async () => {
      workers.set(SESSION.workerId, { ...SESSION });

      await checkOut.handler(
        checkOut.input.parse({ workerId: SESSION.workerId }),
        createMockContext({ notifyResourceUpdated: notify }),
      );
      expect(notify).toHaveBeenCalledWith('shift://status');

      notify.mockClear();
      await checkOut.handler(
        checkOut.input.parse({ workerId: SESSION.workerId }),
        createMockContext({ notifyResourceUpdated: notify }),
      );
      expect(notify).not.toHaveBeenCalled();
    });

    it('rejects a workerId that does not match the 6-char pattern', () => {
      expect(() => checkOut.input.parse({ workerId: 'abc' })).toThrow();
    });
  });

  describe('format', () => {
    it('returns a single line without summary', () => {
      expect(
        checkOut.format?.({
          workerId: 'ABC123',
          removed: true,
          workspace: 'test',
          statusUri: 'shift://status?workspace=test',
        }),
      ).toEqual([
        {
          type: 'text',
          text: 'Checked out Worker ABC123. Session ended.\nWorkspace: test\nStatus: shift://status?workspace=test\nRemoved: true',
        },
      ]);
    });

    it('includes the summary line when provided', () => {
      expect(
        checkOut.format?.({
          workerId: 'ABC123',
          summary: 'Finished auth refactor.',
          removed: true,
          workspace: 'test',
          statusUri: 'shift://status?workspace=test',
        }),
      ).toEqual([
        {
          type: 'text',
          text: 'Checked out Worker ABC123. Session ended.\nWorkspace: test\nStatus: shift://status?workspace=test\nRemoved: true\nSummary: Finished auth refactor.',
        },
      ]);
    });
  });
});
