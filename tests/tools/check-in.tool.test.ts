/**
 * @fileoverview Tests for shift_check_in — new sessions, patch semantics on
 * update, the unknown-worker error path, resource-update notification, and
 * both client surfaces (structuredContent shape and format() text).
 * @module tests/tools/check-in.tool.test
 */

import type { HandlerContext, ReasonOf } from '@cyanheads/mcp-ts-core';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkIn } from '@/mcp-server/tools/definitions/check-in.tool.js';
import { type WorkerSession, workers } from '@/services/worker-store/worker-store.js';

type CheckInContext = HandlerContext<ReasonOf<typeof checkIn.errors>>;
type CheckInResult = Awaited<ReturnType<typeof checkIn.handler>>;

const checkInContext = (
  options: { notifyResourceUpdated?: (uri: string) => void } = {},
): CheckInContext => createMockContext({ errors: checkIn.errors, ...options });

const parse = (input: Record<string, unknown>) => checkIn.input.parse(input);

const rendered = (result: CheckInResult): string => {
  const first = checkIn.format?.(result)?.[0];
  return first?.type === 'text' ? first.text : '';
};

describe('shift_check_in', () => {
  const ctx = checkInContext();

  beforeEach(() => {
    workers.clear();
  });

  describe('new check-in', () => {
    it('creates a session and returns all expected fields', async () => {
      const result = await checkIn.handler(parse({ gist: 'Refactoring auth module' }), ctx);

      expect(result.workerId).toMatch(/^[A-Z0-9]{6}$/);
      expect(result.gist).toBe('Refactoring auth module');
      expect(result.files).toEqual([]);
      expect(new Date(result.checkedInAt).toISOString()).toBe(result.checkedInAt);
      expect(result.activeWorkers).toHaveLength(1);
      expect(result.activeWorkers[0]?.workerId).toBe(result.workerId);
    });

    it('output conforms to the declared output schema', async () => {
      const result = await checkIn.handler(parse({ gist: 'Schema check', files: ['a.ts'] }), ctx);

      expect(result).toEqual(expect.schemaMatching(checkIn.output));
    });

    it('defaults files to empty array when omitted', async () => {
      const result = await checkIn.handler(parse({ gist: 'Bug fix' }), ctx);

      expect(result.files).toEqual([]);
      expect(workers.get(result.workerId)?.files).toEqual([]);
    });

    it('stores declared files', async () => {
      const files = ['src/index.ts', 'src/utils.ts'];
      const result = await checkIn.handler(parse({ gist: 'Adding utils', files }), ctx);

      expect(result.files).toEqual(files);
      expect(workers.get(result.workerId)?.files).toEqual(files);
    });

    it('notifies shift://status subscribers', async () => {
      const notify = vi.fn();

      await checkIn.handler(
        parse({ gist: 'Notify me' }),
        checkInContext({ notifyResourceUpdated: notify }),
      );

      expect(notify).toHaveBeenCalledWith('shift://status');
    });
  });

  describe('update existing session', () => {
    let existing: WorkerSession;

    beforeEach(async () => {
      const result = await checkIn.handler(parse({ gist: 'Initial task', files: ['a.ts'] }), ctx);
      existing = workers.get(result.workerId) as WorkerSession;
    });

    it('updates gist and preserves checkedInAt', async () => {
      const result = await checkIn.handler(
        parse({ gist: 'Updated task', workerId: existing.workerId }),
        ctx,
      );

      expect(result.gist).toBe('Updated task');
      expect(result.checkedInAt).toBe(existing.checkedInAt);
      expect(result.workerId).toBe(existing.workerId);
    });

    it('replaces files when provided', async () => {
      const newFiles = ['b.ts', 'c.ts'];
      const result = await checkIn.handler(
        parse({ gist: 'Updated task', files: newFiles, workerId: existing.workerId }),
        ctx,
      );

      expect(result.files).toEqual(newFiles);
    });

    it('preserves existing files when files field is omitted (patch semantics)', async () => {
      const result = await checkIn.handler(
        parse({ gist: 'Updated task', workerId: existing.workerId }),
        ctx,
      );

      expect(result.files).toEqual(['a.ts']);
    });
  });

  describe('unknown worker', () => {
    it('throws not-found and lists the active workers so the agent can self-identify', async () => {
      const active = await checkIn.handler(parse({ gist: 'Live session' }), ctx);

      expect(() => checkIn.handler(parse({ gist: 'Anything', workerId: 'ZZZZZZ' }), ctx)).toThrow(
        /ZZZZZZ not found/,
      );

      try {
        await checkIn.handler(parse({ gist: 'Anything', workerId: 'ZZZZZZ' }), ctx);
        expect.unreachable('expected shift_check_in to throw for an unknown worker ID');
      } catch (error) {
        const err = error as { message: string; data?: Record<string, unknown> };
        expect(err.message).toContain('Omit workerId to start a new session.');
        expect(err.message).toContain('## Active Workers');
        expect(err.message).toContain(active.workerId);
        expect(err.data?.reason).toBe('unknown_worker');
        expect(err.data?.recovery).toEqual({
          hint: 'Omit workerId to start a new session, or reuse an ID from the active workers table.',
        });
      }
    });

    it('rejects a workerId that does not match the 6-char pattern before the handler runs', () => {
      expect(() => parse({ gist: 'Anything', workerId: 'nope' })).toThrow();
    });
  });

  describe('multiple workers', () => {
    it('activeWorkers includes all checked-in workers', async () => {
      await checkIn.handler(parse({ gist: 'Task A' }), ctx);
      await checkIn.handler(parse({ gist: 'Task B' }), ctx);
      const result = await checkIn.handler(parse({ gist: 'Task C' }), ctx);

      expect(result.activeWorkers).toHaveLength(3);
      expect(result.activeWorkers.map((w) => w.gist)).toEqual(
        expect.arrayContaining(['Task A', 'Task B', 'Task C']),
      );
    });
  });

  describe('format', () => {
    it('renders session info, the coordination protocol, and the check-in timestamp', async () => {
      const result = await checkIn.handler(
        parse({ gist: 'Working on API', files: ['api.ts'] }),
        ctx,
      );
      const text = rendered(result);

      expect(text).toContain(result.workerId);
      expect(text).toContain('Working on API');
      expect(text).toContain('api.ts');
      expect(text).toContain(result.checkedInAt);
      expect(text).toContain('Coordination Protocol');
      expect(text).toContain('shift_check_in');
      expect(text).toContain('shift_check_out');
    });

    it('shows "first to check in" message when solo', async () => {
      const text = rendered(await checkIn.handler(parse({ gist: 'Solo work' }), ctx));

      expect(text).toContain('first to check in');
      expect(text).toContain('No other agents are currently active');
    });

    it('shows active workers table when peers exist', async () => {
      const first = await checkIn.handler(parse({ gist: 'Task A' }), ctx);
      const second = await checkIn.handler(parse({ gist: 'Task B' }), ctx);

      const text = rendered(second);

      expect(text).not.toContain('first to check in');
      expect(text).toContain('| Worker | Checked In | Working On | Files |');
      expect(text).toContain(first.workerId);
      expect(text).toContain(second.workerId);
    });
  });
});
