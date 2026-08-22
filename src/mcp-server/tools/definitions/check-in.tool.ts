/**
 * @fileoverview shift_check_in tool — register or update a worker session.
 * @module mcp-server/tools/definitions/check-in.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  formatWorkersTable,
  generateWorkerId,
  WORKER_ID_PATTERN,
  type WorkerSession,
  workers,
} from '@/services/worker-store/worker-store.js';

const COORDINATION_PROTOCOL = `## Coordination Protocol
- You are in a multi-agent workspace. Other developers may be modifying files concurrently.
- ALWAYS read the latest version of a file before editing — contents may have changed since your last read.
- Keep your changes focused on your declared scope. If your scope changes significantly, run shift_check_in again with your worker ID to update.
- When your session is complete, run shift_check_out with your worker ID.`;

const workerSchema = z
  .object({
    workerId: z.string().describe('Worker ID.'),
    gist: z.string().describe('What the worker is doing.'),
    files: z.array(z.string()).describe('Declared file paths.'),
    checkedInAt: z.string().describe('ISO 8601 check-in timestamp.'),
  })
  .describe('An active worker session.');

export const checkIn = tool('shift_check_in', {
  description: `This is a multi-agent workspace. Run this tool at the start of every working session to check in and receive coordination instructions. Provide a concise gist of what you're working on and the file paths you expect to modify (if known). If you already have a worker ID from a previous check-in, pass it to update your session.`,
  annotations: { readOnlyHint: false, idempotentHint: false },
  input: z.object({
    gist: z.string().min(1).describe('Concise description of what you are working on.'),
    files: z
      .array(z.string())
      .optional()
      .describe(
        'File paths you expect to modify. Omit if unknown — update later by calling again with your worker ID.',
      ),
    workerId: z
      .string()
      .regex(WORKER_ID_PATTERN)
      .optional()
      .describe(
        'Your worker ID from a previous check-in. Omit on first call to receive a new one. Pass to update your session.',
      ),
  }),
  output: z.object({
    workerId: z.string().describe('Your assigned worker ID.'),
    gist: z.string().describe('Your current working gist.'),
    files: z.array(z.string()).describe('Your declared file paths.'),
    checkedInAt: z.string().describe('ISO 8601 timestamp of your check-in.'),
    activeWorkers: z.array(workerSchema).describe('All currently active workers.'),
  }),

  errors: [
    {
      reason: 'unknown_worker',
      code: JsonRpcErrorCode.NotFound,
      when: 'The supplied workerId has no active session — it was checked out, or the server restarted.',
      recovery:
        'Omit workerId to start a new session, or reuse an ID from the active workers table.',
    },
  ],

  handler(input, ctx) {
    let session: WorkerSession;

    if (input.workerId) {
      const existing = workers.get(input.workerId);
      if (!existing) {
        throw ctx.fail(
          'unknown_worker',
          `Worker ID ${input.workerId} not found. Omit workerId to start a new session.\n\n## Active Workers\n${formatWorkersTable([...workers.values()])}`,
          ctx.recoveryFor('unknown_worker'),
        );
      }
      existing.gist = input.gist;
      if (input.files !== undefined) existing.files = input.files;
      session = existing;
      ctx.log.info('Worker session updated', { workerId: session.workerId });
    } else {
      const workerId = generateWorkerId();
      session = {
        workerId,
        gist: input.gist,
        files: input.files ?? [],
        checkedInAt: new Date().toISOString(),
      };
      workers.set(workerId, session);
      ctx.log.info('Worker checked in', { workerId });
    }

    ctx.notifyResourceUpdated?.('shift://status');

    return {
      workerId: session.workerId,
      gist: session.gist,
      files: session.files,
      checkedInAt: session.checkedInAt,
      activeWorkers: [...workers.values()],
    };
  },

  format(result) {
    const session = `## Your Session
- **Worker ID:** ${result.workerId}
- **Gist:** ${result.gist}
- **Files:** ${result.files.length > 0 ? result.files.join(', ') : '—'}
- **Checked in:** ${result.checkedInAt}`;

    const hasPeers = result.activeWorkers.some((w) => w.workerId !== result.workerId);
    const active = hasPeers
      ? `## Active Workers\n${formatWorkersTable(result.activeWorkers)}`
      : "## Active Workers\nYou're the first to check in. No other agents are currently active.";

    return [{ type: 'text', text: `${session}\n\n${COORDINATION_PROTOCOL}\n\n${active}` }];
  },
});
