/**
 * @fileoverview Lexical, workspace-local comparison of declared file paths.
 * @module mcp-server/tools/definitions/file-overlaps
 */
import { isAbsolute, normalize, relative, sep } from 'node:path';
import type { WorkerSession } from '@/services/worker-store/worker-store.js';

/** Compare a caller's files with peers from the same committed roster. */
export function findFileOverlaps(
  workspace: string,
  session: WorkerSession,
  activeWorkers: WorkerSession[],
): { file: string; workerIds: string[] }[] {
  const workspaceRoot = isAbsolute(workspace) ? normalize(workspace) : undefined;
  const comparisonPath = (file: string) => {
    const normalized = normalize(file);
    if (!workspaceRoot || !isAbsolute(normalized)) return normalized;

    const fromRoot = relative(workspaceRoot, normalized);
    if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith(`..${sep}`))
      return normalized;
    return fromRoot || '.';
  };

  const matches = new Map<string, string[]>();
  for (const file of session.files) {
    if (file !== '') matches.set(comparisonPath(file), []);
  }

  for (const worker of activeWorkers) {
    if (worker.workerId === session.workerId) continue;
    const declarations = new Set(worker.files.filter((file) => file !== '').map(comparisonPath));
    for (const file of declarations) {
      matches.get(file)?.push(worker.workerId);
    }
  }

  return Array.from(matches, ([file, workerIds]) => ({ file, workerIds })).filter(
    ({ workerIds }) => workerIds.length > 0,
  );
}
