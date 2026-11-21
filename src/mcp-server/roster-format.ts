/**
 * @fileoverview Markdown presentation of active workers and recent departures.
 * @module mcp-server/roster-format
 */
import { escapeMarkdownInline } from '@cyanheads/mcp-ts-core/utils';
import type { FinishedWorker, WorkerSession } from '@/services/worker-store/worker-store.js';

/** Keep a value within its output line without changing its stored form. */
export function singleLine(value: string): string {
  return value.replace(/\r\n|[\r\n]/g, ' ');
}

function tableCell(value: string): string {
  return singleLine(value.replaceAll('\\', '\\\\').replaceAll('|', '\\|'));
}

/** Render a reversible JSON string literal when a summary needs quoting. */
export function formatSummary(summary: string): string {
  const literal = JSON.stringify(summary).replaceAll('\x7f', '\\u007f');
  return escapeMarkdownInline(
    summary === '' || summary === '—' || literal !== `"${summary}"` ? literal : summary,
  );
}

/** Format one physical table row per worker, oldest check-in first. */
export function formatWorkersTable(sessions: WorkerSession[]): string {
  if (sessions.length === 0) return 'No agents are currently active.';

  const rows = sessions
    .toSorted((a, b) => a.checkedInAt.localeCompare(b.checkedInAt))
    .map(
      (worker) =>
        `| ${worker.workerId}${worker.orphaned ? ' (orphaned)' : ''} | ${worker.checkedInAt} | ${tableCell(worker.gist)} | ${tableCell(worker.files.join(', ')) || '—'} | ${worker.lastSeenAt ?? '—'} |`,
    )
    .join('\n');

  return `| Worker | Checked In | Working On | Files | Last Seen |\n|--------|------------|------------|-------|-----------|\n${rows}`;
}

/** Display departures when the snapshot contains any eligible handoffs. */
export function formatRecentlyFinished(departures: FinishedWorker[]): string {
  if (departures.length === 0) return '';

  const rows = departures
    .map(
      (worker) =>
        `| ${worker.workerId} | ${worker.checkedOutAt} | ${tableCell(worker.gist)} | ${tableCell(worker.files.join(', ')) || '—'} | ${worker.summary === undefined ? '—' : formatSummary(worker.summary)} |`,
    )
    .join('\n');

  return `\n\n## Recently Finished\n| Worker | Checked Out | Working On | Files | Summary |\n|--------|-------------|------------|-------|---------|\n${rows}`;
}

/** Explain the marker only when a snapshot contains a confirmed orphan. */
export function orphanGuidance(workers: WorkerSession[]): string {
  return workers.some((worker) => worker.orphaned)
    ? '\n\nAn orphaned worker’s server process has exited. Confirm its claim is stale before clearing it with shift_check_out.'
    : '';
}

/** Render both parts of one committed status snapshot. */
export function formatRoster(
  activeWorkers: WorkerSession[],
  recentlyFinished: FinishedWorker[],
): string {
  return `## Active Workers (${activeWorkers.length})\n${formatWorkersTable(activeWorkers)}${orphanGuidance(activeWorkers)}${formatRecentlyFinished(recentlyFinished)}`;
}
