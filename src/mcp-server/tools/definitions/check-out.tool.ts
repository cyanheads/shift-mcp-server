/**
 * @fileoverview shift_check_out tool — end a working session.
 * @module mcp-server/tools/definitions/check-out.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import {
  getWorkerStore,
  notifyWorkspace,
  resolveWorkspace,
  statusUri,
  WORKER_ID_PATTERN,
} from '@/services/worker-store/worker-store.js';

export const checkOut = tool('shift_check_out', {
  description:
    'End your working session. Removes you from the active worker list so other agents no longer see you as active.',
  annotations: { readOnlyHint: false, idempotentHint: true },
  input: z.object({
    workspace: z
      .string()
      .optional()
      .describe(
        'Opaque workspace identifier. Use the same workspace as your check-in; omit for the server default.',
      ),
    workerId: z
      .string()
      .regex(WORKER_ID_PATTERN)
      .toUpperCase()
      .describe('Your six ASCII letter/digit worker ID received at check-in; case is ignored.'),
    summary: z.string().optional().describe('One sentence describing what was accomplished.'),
  }),
  output: z.object({
    workspace: z.string().describe('Resolved workspace identifier.'),
    statusUri: z.string().describe('Workspace-qualified resource URI for this roster.'),
    removed: z.boolean().describe('Whether an active session was actually removed.'),
    workerId: z.string().describe('The worker ID that was checked out.'),
    summary: z.string().optional().describe('The provided session summary.'),
  }),

  handler(input, ctx) {
    ctx.signal.throwIfAborted();
    const workspace = resolveWorkspace(input.workspace);
    const uri = statusUri(workspace);
    const existed = getWorkerStore().checkOut(workspace, input.workerId);
    ctx.log.info(existed ? 'Worker checked out' : 'Worker already checked out (no-op)', {
      workerId: input.workerId,
    });
    if (existed) notifyWorkspace(workspace);
    return {
      workerId: input.workerId,
      summary: input.summary,
      removed: existed,
      workspace,
      statusUri: uri,
    };
  },

  format(result) {
    let text = result.removed
      ? `Checked out Worker ${result.workerId}. Session ended.`
      : `No active session for Worker ${result.workerId}; already checked out or unknown. Read ${result.statusUri} to inspect active workers.`;
    text += `\nWorkspace: ${result.workspace}\nStatus: ${result.statusUri}\nRemoved: ${result.removed}`;
    if (result.summary) text += `\nSummary: ${result.summary}`;
    return [{ type: 'text', text }];
  },
});
