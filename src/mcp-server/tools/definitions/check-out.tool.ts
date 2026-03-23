/**
 * @fileoverview shift_check_out tool — end a working session.
 * @module mcp-server/tools/definitions/check-out.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { WORKER_ID_PATTERN, workers } from './worker-store.js';

export const checkOut = tool('shift_check_out', {
  description:
    'End your working session. Removes you from the active worker list so other agents no longer see you as active.',
  annotations: { readOnlyHint: false, idempotentHint: true },
  input: z.object({
    workerId: z.string().regex(WORKER_ID_PATTERN).describe('Your worker ID received at check-in.'),
    summary: z.string().optional().describe('One sentence describing what was accomplished.'),
  }),
  output: z.object({
    workerId: z.string().describe('The worker ID that was checked out.'),
    summary: z.string().optional().describe('The provided session summary.'),
  }),

  handler(input, ctx) {
    const existed = workers.delete(input.workerId);
    ctx.log.info(existed ? 'Worker checked out' : 'Worker already checked out (no-op)', {
      workerId: input.workerId,
    });
    return { workerId: input.workerId, summary: input.summary };
  },

  format(result) {
    let text = `Checked out Worker ${result.workerId}. Session ended.`;
    if (result.summary) text += `\nSummary: ${result.summary}`;
    return [{ type: 'text' as const, text }];
  },
});
