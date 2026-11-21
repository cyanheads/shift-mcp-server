/**
 * @fileoverview shift_check_in tool — register or update a worker session.
 * @module mcp-server/tools/definitions/check-in.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { markdown } from '@cyanheads/mcp-ts-core/utils';
import {
  formatRecentlyFinished,
  formatWorkersTable,
  orphanGuidance,
  singleLine,
} from '@/mcp-server/roster-format.js';
import {
  getWorkerStore,
  notifyWorkspace,
  resolveWorkspace,
  statusUri,
  WORKER_ID_PATTERN,
} from '@/services/worker-store/worker-store.js';
import { findFileOverlaps } from './file-overlaps.js';

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
    lastSeenAt: z.string().optional().describe('ISO 8601 timestamp of the most recent check-in.'),
    orphaned: z.literal(true).optional().describe('The owning server process has exited.'),
  })
  .describe('An active worker session.');

function fileLiteral(file: string): string {
  return markdown().inlineCode(JSON.stringify(file)).build();
}

export const checkIn = tool('shift_check_in', {
  description: `This is a multi-agent workspace. Run this tool at the start of every working session to check in and receive coordination instructions. Provide a concise gist of what you're working on and the file paths you expect to modify (if known). If you already have a worker ID from a previous check-in, pass it to update your session.`,
  annotations: { readOnlyHint: false, idempotentHint: false },
  input: z.object({
    workspace: z
      .string()
      .optional()
      .describe(
        'Opaque workspace identifier. Omit to use SHIFT_WORKSPACE or the host project or launch directory’s Git root/cwd. HTTP clients sharing a server must select their project explicitly.',
      ),
    gist: z.string().min(1).describe('Concise description of what you are working on.'),
    files: z
      .array(z.string().min(1))
      .optional()
      .describe(
        'Repo-relative file paths you expect to modify. Omit if unknown — update later by calling again with your worker ID.',
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
    lastSeenAt: z.string().describe('ISO 8601 timestamp of your most recent check-in.'),
    activeWorkers: z.array(workerSchema).describe('All currently active workers.'),
    overlaps: z
      .array(
        z
          .object({
            file: z.string().describe('Normalized path shared with an active peer.'),
            workerIds: z
              .array(z.string())
              .describe('IDs of active peers that also declared the path.'),
          })
          .describe('One shared file and the peers declaring it.'),
      )
      .describe('Your declared files that active peers have also declared.'),
    recentlyFinished: z
      .array(
        z
          .object({
            workerId: z.string().describe('ID of the worker that checked out.'),
            gist: z.string().describe('The departing worker’s last working gist.'),
            files: z.array(z.string()).describe('The departing worker’s last file declarations.'),
            summary: z.string().optional().describe('The worker’s check-out summary, if provided.'),
            checkedOutAt: z.string().describe('ISO 8601 check-out timestamp.'),
          })
          .describe('A worker handoff recorded on check-out.'),
      )
      .describe('Worker handoffs recorded since your original check-in.'),
  }),

  enrichment: {
    notice: z
      .string()
      .optional()
      .describe('Coordination protocol and applicable solo, orphan, and overlap guidance.'),
  },

  errors: [
    {
      reason: 'unknown_worker',
      code: JsonRpcErrorCode.NotFound,
      when: 'The supplied workerId has no active session in the selected workspace.',
      recovery:
        'Use your original workspace and your own saved or confirmed workerId. If you cannot confirm it, omit workerId to start a new session.',
    },
  ],

  handler(input, ctx) {
    ctx.signal.throwIfAborted();
    const workspace = resolveWorkspace(input.workspace);
    const uri = statusUri(workspace);
    const { session, activeWorkers, recentlyFinished } = getWorkerStore().checkIn(workspace, input);
    if (!session) {
      throw ctx.fail(
        'unknown_worker',
        `Worker ID ${input.workerId} not found in the selected workspace. Read ${uri} for its roster.\n\n## Active Workers\n${formatWorkersTable(activeWorkers)}${orphanGuidance(activeWorkers)}`,
        ctx.recoveryFor('unknown_worker'),
      );
    }
    ctx.log.info(input.workerId ? 'Worker session updated' : 'Worker checked in', {
      workerId: session.workerId,
    });
    notifyWorkspace(workspace);
    const overlaps = findFileOverlaps(workspace, session, activeWorkers);
    const solo =
      activeWorkers.length === 1
        ? `\n\n${input.workerId ? '' : "You're the first to check in. "}No other agents are currently active.`
        : '';
    const shared = overlaps
      .map(({ file, workerIds }) => `${fileLiteral(file)} (${workerIds.join(', ')})`)
      .join('; ');
    const sharedNotice = shared
      ? `\n\nCoordinate with the listed workers before editing shared files: ${shared}.`
      : '';
    ctx.enrich.notice(
      `${COORDINATION_PROTOCOL}${solo}${orphanGuidance(activeWorkers)}${sharedNotice}`,
    );

    return {
      workspace,
      statusUri: uri,
      workerId: session.workerId,
      gist: session.gist,
      files: session.files,
      checkedInAt: session.checkedInAt,
      lastSeenAt: session.lastSeenAt,
      activeWorkers,
      overlaps,
      recentlyFinished,
    };
  },

  format(result) {
    const session = `## Your Session
- **Worker ID:** ${result.workerId}
- **Workspace:** ${singleLine(result.workspace)}
- **Status:** ${result.statusUri}
- **Gist:** ${singleLine(result.gist)}
- **Files:** ${result.files.length > 0 ? singleLine(result.files.join(', ')) : '—'}
- **Checked in:** ${result.checkedInAt}
- **Last seen:** ${result.lastSeenAt}`;
    const overlapRows = result.overlaps
      .map(({ file, workerIds }) => `- ${fileLiteral(file)} · ${workerIds.join(', ')}`)
      .join('\n');
    const overlaps = overlapRows ? `\n\n## Shared Files\n${overlapRows}` : '';

    return [
      {
        type: 'text',
        text: `${session}\n\n## Active Workers\n${formatWorkersTable(result.activeWorkers)}${overlaps}${formatRecentlyFinished(result.recentlyFinished)}`,
      },
    ];
  },
});
