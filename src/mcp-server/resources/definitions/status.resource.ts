/**
 * @fileoverview shift://status resource — active workers list.
 * @module mcp-server/resources/definitions/status.resource
 */

import { resource } from '@cyanheads/mcp-ts-core';
import { formatRoster } from '@/mcp-server/roster-format.js';
import { getWorkerStore, resolveWorkspace } from '@/services/worker-store/worker-store.js';

export const statusResource = resource('shift://status', {
  name: 'Active Workers',
  description: 'Active workers and recent handoffs in the default workspace.',
  mimeType: 'text/markdown',

  handler(_params, ctx) {
    ctx.signal.throwIfAborted();
    const { activeWorkers, recentlyFinished } = getWorkerStore().status(resolveWorkspace());
    return formatRoster(activeWorkers, recentlyFinished);
  },

  format: (text, meta) => [{ uri: meta.uri.href, text: text as string, mimeType: meta.mimeType }],

  list: () => ({
    resources: [{ uri: 'shift://status', name: 'Active Workers', mimeType: 'text/markdown' }],
  }),
});
