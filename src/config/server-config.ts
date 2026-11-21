/**
 * @fileoverview Shift storage and default workspace configuration.
 * @module config/server-config
 */
import { statSync } from 'node:fs';
import { z } from '@cyanheads/mcp-ts-core';
import { parseEnvConfig } from '@cyanheads/mcp-ts-core/config';
import { configurationError } from '@cyanheads/mcp-ts-core/errors';
import { deriveWorkspace } from '@/services/worker-store/worker-store.js';

const schema = z.object({
  stateDir: z.string().optional().describe('Directory containing the shared SQLite roster.'),
  workspace: z.string().optional().describe('Opaque default workspace identifier.'),
  projectDir: z.string().optional().describe('Project directory supplied by Claude Code.'),
});

/** Parse at setup so invalid configuration prevents transport startup. */
export function getServerConfig() {
  const { stateDir, workspace, projectDir } = parseEnvConfig(schema, {
    stateDir: 'SHIFT_STATE_DIR',
    workspace: 'SHIFT_WORKSPACE',
    projectDir: 'CLAUDE_PROJECT_DIR',
  });
  if (workspace !== undefined || projectDir === undefined) return { stateDir, workspace };

  const remedy =
    'CLAUDE_PROJECT_DIR must point to an accessible directory. Fix the directory or set SHIFT_WORKSPACE.';
  try {
    if (statSync(projectDir, { throwIfNoEntry: false })?.isDirectory()) {
      return { stateDir, workspace: deriveWorkspace(projectDir) };
    }
  } catch (error) {
    throw configurationError(remedy, undefined, { cause: error });
  }
  throw configurationError(remedy);
}
