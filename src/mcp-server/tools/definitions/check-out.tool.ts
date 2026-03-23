/**
 * @fileoverview shift_check_out tool — end a working session.
 * @module mcp-server/tools/definitions/check-out.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { notFound } from '@cyanheads/mcp-ts-core/errors';
import { formatWorkersTable, workers } from './worker-store.js';

export const checkOut = tool('shift_check_out', {
  description:
    'End your working session. Removes you from the active worker list so other agents no longer see you as active.',
  annotations: { readOnlyHint: false, idempotentHint: true },
  input: z.object({
    workerId: z.string().describe('Your worker ID received at check-in.'),
    summary: z.string().optional().describe('One sentence describing what was accomplished.'),
  }),
  output: z.object({
    workerId: z.string().describe('The worker ID that was checked out.'),
    summary: z.string().optional().describe('The provided session summary.'),
  }),

  handler(input, ctx) {
    if (!workers.has(input.workerId)) {
      throw notFound(
        `Worker ID ${input.workerId} not found. It may have already been checked out.\n\n## Active Workers\n${formatWorkersTable([...workers.values()])}`,
      );
    }
    workers.delete(input.workerId);
    ctx.log.info('Worker checked out', { workerId: input.workerId });
    return { workerId: input.workerId, summary: input.summary };
  },

  format(result) {
    let text = `Checked out Worker ${result.workerId}. Session ended.`;
    if (result.summary) text += `\nSummary: ${result.summary}`;
    return [{ type: 'text' as const, text }];
  },
});
