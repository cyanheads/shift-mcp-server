/**
 * @fileoverview shift_check_in tool — register or update a worker session.
 * @module mcp-server/tools/definitions/check-in.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  formatWorkersTable,
  getWorkerStore,
  notifyWorkspace,
  resolveWorkspace,
  statusUri,
  WORKER_ID_PATTERN,
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
    workspace: z
      .string()
      .optional()
      .describe(
        'Opaque workspace identifier. Omit to use SHIFT_WORKSPACE or the server launch Git root/cwd. HTTP clients sharing a server must select their project explicitly.',
      ),
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
      .toUpperCase()
      .optional()
      .describe(
        'Your worker ID from a previous check-in. Omit on first call to receive a new one. Pass to update your session.',
      ),
  }),
  output: z.object({
    workspace: z.string().describe('Resolved workspace identifier.'),
    statusUri: z.string().describe('Workspace-qualified resource URI for this roster.'),
    workerId: z.string().describe('Your assigned worker ID.'),
    gist: z.string().describe('Your current working gist.'),
    files: z.array(z.string()).describe('Your declared file paths.'),
    checkedInAt: z.string().describe('ISO 8601 timestamp of your check-in.'),
    activeWorkers: z.array(workerSchema).describe('All currently active workers.'),
  }),

  enrichment: {
    notice: z
      .string()
      .optional()
      .describe('Coordination protocol and applicable solo-worker notice.'),
  },

  errors: [
    {
      reason: 'unknown_worker',
      code: JsonRpcErrorCode.NotFound,
      when: 'The supplied workerId has no active session in the selected workspace.',
      recovery:
        'Omit workerId to start a new session, or reuse an ID from the active workers table.',
    },
  ],

  handler(input, ctx) {
    ctx.signal.throwIfAborted();
    const workspace = resolveWorkspace(input.workspace);
    const uri = statusUri(workspace);
    const { session, activeWorkers } = getWorkerStore().checkIn(workspace, input);
    if (!session) {
      throw ctx.fail(
        'unknown_worker',
        `Worker ID ${input.workerId} not found. Omit workerId to start a new session. Read ${uri} for this workspace.\n\n## Active Workers\n${formatWorkersTable(activeWorkers)}`,
        ctx.recoveryFor('unknown_worker'),
      );
    }
    ctx.log.info(input.workerId ? 'Worker session updated' : 'Worker checked in', {
      workerId: session.workerId,
    });
    notifyWorkspace(workspace);
    const solo =
      activeWorkers.length === 1
        ? "\n\nYou're the first to check in. No other agents are currently active."
        : '';
    ctx.enrich.notice(`${COORDINATION_PROTOCOL}${solo}`);

    return {
      workspace,
      statusUri: uri,
      workerId: session.workerId,
      gist: session.gist,
      files: session.files,
      checkedInAt: session.checkedInAt,
      activeWorkers,
    };
  },

  format(result) {
    const session = `## Your Session
- **Worker ID:** ${result.workerId}
- **Workspace:** ${result.workspace}
- **Status:** ${result.statusUri}
- **Gist:** ${result.gist}
- **Files:** ${result.files.length > 0 ? result.files.join(', ') : '—'}
- **Checked in:** ${result.checkedInAt}`;

    return [
      {
        type: 'text',
        text: `${session}\n\n## Active Workers\n${formatWorkersTable(result.activeWorkers)}`,
      },
    ];
  },
});
