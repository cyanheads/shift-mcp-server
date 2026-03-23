/**
 * @fileoverview shift://status resource — active workers list.
 * @module mcp-server/resources/definitions/status.resource
 */

import { resource } from '@cyanheads/mcp-ts-core';
import { formatWorkersTable, workers } from '@/mcp-server/tools/definitions/worker-store.js';

export const statusResource = resource('shift://status', {
  name: 'Active Workers',
  description:
    'All currently active workers with their gists, declared files, and check-in timestamps.',
  mimeType: 'text/markdown',

  handler() {
    if (workers.size === 0) {
      return '## Active Workers (0)\nNo agents are currently active.';
    }
    return `## Active Workers (${workers.size})\n${formatWorkersTable([...workers.values()])}`;
  },

  format: (text, meta) => [{ uri: meta.uri.href, text: text as string, mimeType: meta.mimeType }],

  list: async () => ({
    resources: [{ uri: 'shift://status', name: 'Active Workers', mimeType: 'text/markdown' }],
  }),
});
