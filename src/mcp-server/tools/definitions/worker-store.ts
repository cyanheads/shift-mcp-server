/**
 * @fileoverview In-memory worker session store for shift coordination.
 * @module mcp-server/tools/definitions/worker-store
 */

export interface WorkerSession {
  checkedInAt: string;
  files: string[];
  gist: string;
  workerId: string;
}

const ID_LENGTH = 6;
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Active worker sessions keyed by workerId. */
export const workers = new Map<string, WorkerSession>();

/** Generate a unique 6-character uppercase alphanumeric worker ID. */
export function generateWorkerId(): string {
  for (let attempt = 0; attempt < 10; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH));
    const id = Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join('');
    if (!workers.has(id)) return id;
  }
  throw new Error('Failed to generate unique worker ID after 10 attempts');
}

/** Format HH:MM from an ISO 8601 timestamp. */
function formatTime(iso: string): string {
  return iso.slice(11, 16);
}

/** Escape pipe characters for markdown table cells. */
function escPipe(s: string): string {
  return s.replaceAll('|', '\\|');
}

/** Format worker sessions as a markdown table. */
export function formatWorkersTable(sessions: WorkerSession[]): string {
  if (sessions.length === 0) return 'No agents are currently active.';

  const rows = [...sessions]
    .sort((a, b) => a.checkedInAt.localeCompare(b.checkedInAt))
    .map(
      (w) =>
        `| ${w.workerId} | ${formatTime(w.checkedInAt)} | ${escPipe(w.gist)} | ${escPipe(w.files.join(', ')) || '—'} |`,
    )
    .join('\n');

  return `| Worker | Checked In | Working On | Files |\n|--------|------------|------------|-------|\n${rows}`;
}
