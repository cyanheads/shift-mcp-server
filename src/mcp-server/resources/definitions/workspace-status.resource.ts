/**
 * @fileoverview Workspace-qualified active-worker roster resource.
 * @module mcp-server/resources/definitions/workspace-status.resource
 */
import { resource, z } from '@cyanheads/mcp-ts-core';
import { formatRoster } from '@/mcp-server/roster-format.js';
import { getWorkerStore } from '@/services/worker-store/worker-store.js';

export const workspaceStatusResource = resource('shift://status{?workspace}', {
  name: 'Workspace Active Workers',
  description:
    'Active workers and recent handoffs in the workspace returned by shift_check_in. Use the returned statusUri to preserve URI encoding.',
  mimeType: 'text/markdown',
  params: z.object({
    workspace: z
      .string()
      .describe('Percent-encoded opaque workspace identifier from the resource URI.'),
  }),
  handler(params, ctx) {
    ctx.signal.throwIfAborted();
    const { activeWorkers, recentlyFinished } = getWorkerStore().status(
      decodeURIComponent(params.workspace),
    );
    return formatRoster(activeWorkers, recentlyFinished);
  },
  format: (text, meta) => [{ uri: meta.uri.href, text: text as string, mimeType: meta.mimeType }],
});
