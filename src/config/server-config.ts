/**
 * @fileoverview Shift storage and default workspace configuration.
 * @module config/server-config
 */
import { z } from '@cyanheads/mcp-ts-core';
import { parseEnvConfig } from '@cyanheads/mcp-ts-core/config';

const schema = z.object({
  stateDir: z.string().optional().describe('Directory containing the shared SQLite roster.'),
  workspace: z.string().optional().describe('Opaque default workspace identifier.'),
});

/** Parse at setup so invalid configuration prevents transport startup. */
export function getServerConfig() {
  return parseEnvConfig(schema, { stateDir: 'SHIFT_STATE_DIR', workspace: 'SHIFT_WORKSPACE' });
}
