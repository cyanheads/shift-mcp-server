/**
 * @fileoverview shift://status resource — active workers list.
 * @module mcp-server/resources/definitions/status.resource
 */

import { resource } from '@cyanheads/mcp-ts-core';
import {
  formatWorkersTable,
  getWorkerStore,
  resolveWorkspace,
} from '@/services/worker-store/worker-store.js';

export const statusResource = resource('shift://status', {
  name: 'Active Workers',
  description:
    'All currently active workers with their gists, declared files, and check-in timestamps.',
  mimeType: 'text/markdown',

  handler() {
    const workers = getWorkerStore().list(resolveWorkspace());
    return `## Active Workers (${workers.length})\n${formatWorkersTable(workers)}`;
  },

  format: (text, meta) => [{ uri: meta.uri.href, text: text as string, mimeType: meta.mimeType }],

  list: () => ({
    resources: [{ uri: 'shift://status', name: 'Active Workers', mimeType: 'text/markdown' }],
  }),
});
