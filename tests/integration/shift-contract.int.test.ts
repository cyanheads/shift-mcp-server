/**
 * @fileoverview Tool-contract integration coverage for the shift tools —
 * validates schemas, invokes the real handlers, and checks both public error
 * surfaces of the unknown-worker path.
 * @module tests/integration/shift-contract.int.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  createMockContext,
  runToolContract as executeToolContract,
} from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, expect, it } from 'vitest';
import { statusResource } from '@/mcp-server/resources/definitions/status.resource.js';
import { workspaceStatusResource } from '@/mcp-server/resources/definitions/workspace-status.resource.js';
import { notify, workers } from '../worker-fixture.js';

beforeEach(() => workers.clear());

import { toolContractSuite } from '@cyanheads/mcp-ts-core/testing/vitest';

import { checkIn } from '@/mcp-server/tools/definitions/check-in.tool.js';
import { checkOut } from '@/mcp-server/tools/definitions/check-out.tool.js';

async function runToolContract(...args: Parameters<typeof executeToolContract>) {
  const result = await executeToolContract(...args);
  return { ...result, structuredContent: result.structuredContent as Record<string, unknown> };
}

const textOf = (result: Awaited<ReturnType<typeof runToolContract>>) =>
  result.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');

it('keeps multiline session fields on one line and uses accurate solo update wording', async () => {
  const workspace = 'project\nnotes';
  const gist = 'writing\r\nunit\ntests\rtoday';
  const files = ['src/line\r\nwith\nbreaks\rhere.ts'];
  const first = await runToolContract(checkIn, { workspace, gist, files });
  const peer = await runToolContract(checkIn, { workspace, gist: 'peer' });
  const checkout = await runToolContract(checkOut, {
    workspace,
    workerId: peer.structuredContent.workerId,
    summary: 'finished\r\nunit\ntests\rtoday',
  });
  const update = await runToolContract(checkIn, {
    workspace,
    workerId: first.structuredContent.workerId,
    gist,
  });

  expect(first.structuredContent).toMatchObject({ workspace, gist, files });
  expect(textOf(first)).toContain('- **Workspace:** project notes');
  expect(textOf(first)).toContain('- **Gist:** writing unit tests today');
  expect(textOf(first)).toContain('- **Files:** src/line with breaks here.ts');
  expect(checkout.structuredContent).toMatchObject({ summary: 'finished\r\nunit\ntests\rtoday' });
  expect(textOf(checkout)).toContain('Summary: "finished\\r\\nunit\\ntests\\rtoday"');
  expect(textOf(checkout)).toContain('Workspace: project notes');
  expect(update.structuredContent).toMatchObject({ gist, files });
  expect(update.structuredContent.notice).toContain('No other agents are currently active.');
  expect(update.structuredContent.notice).not.toContain('first to check in');
  expect(textOf(update).match(/No other agents are currently active\./g)).toHaveLength(1);
  expect(textOf(update)).not.toContain('first to check in');
});

it('compares literal workspace paths and deduplicates claims without changing declarations', async () => {
  const workspace = '/repo/project';
  const files = ['./src/dir/../shared.ts', 'src/shared.ts', '/repo/project-other/adjacent.ts'];
  const first = await runToolContract(checkIn, { workspace, gist: 'first', files });
  const second = await runToolContract(checkIn, {
    workspace,
    gist: 'second',
    files: ['/repo/project/src/shared.ts', '/repo/project/src/shared.ts'],
  });
  await runToolContract(checkIn, { workspace: 'other', gist: 'third', files: ['src/shared.ts'] });
  const caller = await runToolContract(checkIn, {
    workspace,
    gist: 'caller',
    files: ['src/shared.ts', 'adjacent.ts', './src/shared.ts'],
  });
  const overlap = [
    {
      file: 'src/shared.ts',
      workerIds: expect.arrayContaining([
        first.structuredContent.workerId,
        second.structuredContent.workerId,
      ]),
    },
  ];
  expect(first.structuredContent).toMatchObject({ files, overlaps: [] });
  expect(caller.structuredContent.overlaps).toEqual(overlap);
  expect(caller.structuredContent.overlaps).toEqual([
    { file: 'src/shared.ts', workerIds: [expect.any(String), expect.any(String)] },
  ]);
  expect(caller.structuredContent.notice).toContain('src/shared.ts');
  expect(caller.structuredContent.notice).toContain(String(first.structuredContent.workerId));
  expect(caller.structuredContent.notice).toContain(String(second.structuredContent.workerId));
  const guidance = String(caller.structuredContent.notice).split('\n\n').at(-1);
  expect(textOf(caller)).toContain(String(guidance));
  const update = await runToolContract(checkIn, {
    workspace,
    gist: 'updating',
    workerId: caller.structuredContent.workerId,
  });
  expect(update.structuredContent.overlaps).toEqual(overlap);
  const clear = await runToolContract(checkIn, {
    workspace,
    gist: 'cleared',
    workerId: caller.structuredContent.workerId,
    files: [],
  });
  expect(clear.structuredContent).toMatchObject({ files: [], overlaps: [] });
  expect(clear.structuredContent.notice).not.toContain('src/shared.ts');
});

it('rejects new empty claims and ignores stored legacy empty entries during comparison', async () => {
  workers.set('LEGACY', {
    workerId: 'LEGACY',
    gist: 'legacy',
    checkedInAt: '2026-03-23T09:00:00Z',
    files: ['', 'src/shared.ts', 'src/shared.ts'],
  });
  const invalid = await runToolContract(checkIn, { gist: 'invalid', files: [''] });
  expect(invalid.structuredContent).toMatchObject({
    error: { code: JsonRpcErrorCode.InvalidParams },
  });
  expect(notify).not.toHaveBeenCalled();
  const peer = await runToolContract(checkIn, {
    gist: 'peer',
    files: ['./src/shared.ts', `${process.cwd()}/src/other.ts`],
  });
  const relative = await runToolContract(checkIn, { gist: 'relative', files: ['src/other.ts'] });
  expect(relative.structuredContent.overlaps).toEqual([]);
  const legacy = await runToolContract(checkIn, { gist: 'adopted', workerId: 'LEGACY' });
  expect(legacy.structuredContent).toMatchObject({
    files: ['', 'src/shared.ts', 'src/shared.ts'],
    overlaps: [{ file: 'src/shared.ts', workerIds: [peer.structuredContent.workerId] }],
  });
  expect(workers.get('LEGACY')?.files).toEqual(['', 'src/shared.ts', 'src/shared.ts']);
});

it('renders a multiline overlap as a round-trippable path literal', async () => {
  const file = 'src/notes\nfrom review.ts';
  const peer = await runToolContract(checkIn, { gist: 'peer', files: [file] });
  const caller = await runToolContract(checkIn, { gist: 'caller', files: [`./${file}`] });
  const workerId = peer.structuredContent.workerId;
  expect(caller.structuredContent.overlaps).toEqual([{ file, workerIds: [workerId] }]);
  const pathLiteral = JSON.stringify(file);
  expect(caller.structuredContent.notice).toContain(pathLiteral);
  expect(textOf(caller)).toContain(`- \`${pathLiteral}\` · ${workerId}`);
});

it('renders last-seen times while keeping unverified legacy owners unmarked', async () => {
  workers.set('LEGACY', {
    workerId: 'LEGACY',
    gist: 'legacy',
    checkedInAt: '2026-03-23T09:00:00Z',
    files: [],
  });
  const result = await runToolContract(checkIn, { gist: 'live' });
  expect(result.structuredContent.lastSeenAt).toEqual(expect.any(String));
  expect(result.structuredContent).toMatchObject({
    activeWorkers: [
      { workerId: 'LEGACY' },
      {
        workerId: result.structuredContent.workerId,
        lastSeenAt: result.structuredContent.lastSeenAt,
      },
    ],
  });
  expect(result.structuredContent.activeWorkers).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ orphaned: true })]),
  );
  expect(textOf(result)).toContain(String(result.structuredContent.lastSeenAt));
  const status = await statusResource.handler({}, createMockContext());
  expect(status).toContain('Last Seen');
  expect(status).toContain(String(result.structuredContent.lastSeenAt));
});

it('returns a removed worker’s handoff to existing peers and both status resources', async () => {
  const staying = await runToolContract(checkIn, { gist: 'staying' });
  const departing = await runToolContract(checkIn, { gist: 'departing', files: ['src/main.ts'] });
  const workerId = departing.structuredContent.workerId;
  const summary = 'Updated\nunit \\| tests';
  await runToolContract(checkOut, { workerId, summary });
  await runToolContract(checkOut, { workerId, summary: 'repeated summary' });
  const update = await runToolContract(checkIn, {
    workerId: staying.structuredContent.workerId,
    gist: 'still here',
  });
  expect(update.structuredContent.recentlyFinished).toEqual([
    {
      workerId,
      checkedOutAt: expect.any(String),
      gist: 'departing',
      files: ['src/main.ts'],
      summary,
    },
  ]);
  const [departure] = update.structuredContent.recentlyFinished as [{ checkedOutAt: string }];
  const later = await runToolContract(checkIn, { gist: 'later' });
  expect(later.structuredContent.recentlyFinished).toEqual([]);
  expect(textOf(later)).not.toContain('Updated unit tests');
  notify.mockClear();
  const staticStatus = await statusResource.handler({}, createMockContext());
  const qualifiedStatus = await workspaceStatusResource.handler(
    { workspace: 'test' },
    createMockContext(),
  );
  expect(qualifiedStatus).toBe(staticStatus);
  expect(notify).not.toHaveBeenCalled();
  for (const text of [textOf(update), staticStatus]) {
    expect(text).toContain('Recently Finished');
    expect(text).toContain(String(workerId));
    expect(text).toContain(departure.checkedOutAt);
    expect(text).toContain('src/main.ts');
    const row = String(text)
      .split('\n')
      .find((line) => line.startsWith(`| ${workerId} |`));
    expect(row).toContain('"Updated\\nunit');
    expect(row).toContain('| tests"');
    expect(row?.match(/(?:^|[^\\])(?:\\\\)*\|/g)).toHaveLength(6);
    expect(text).not.toContain('repeated summary');
  }
});

it('characterizes patch semantics, timestamp stability and distinct session IDs', async () => {
  const first = await runToolContract(checkIn, { gist: 'first', files: ['a.ts'] });
  const second = await runToolContract(checkIn, { gist: 'second' });
  const updated = await runToolContract(checkIn, {
    workerId: first.structuredContent?.workerId,
    gist: 'updated',
  });
  expect(second.structuredContent?.workerId).not.toBe(first.structuredContent?.workerId);
  expect(updated.structuredContent).toMatchObject({
    files: ['a.ts'],
    checkedInAt: first.structuredContent?.checkedInAt,
  });
});

it('delivers protocol enrichment on both production output surfaces', async () => {
  const result = await runToolContract(checkIn, { gist: 'notice' });
  expect(result.structuredContent?.notice).toContain('Coordination Protocol');
  expect(result.structuredContent?.notice).toContain('first to check in');
  const text = JSON.stringify(result.content);
  expect(text.match(/Coordination Protocol/g)).toHaveLength(1);
  expect(text.match(/first to check in/g)).toHaveLength(1);
  const peer = await runToolContract(checkIn, { gist: 'peer' });
  const updated = await runToolContract(checkIn, {
    gist: 'updated',
    workerId: result.structuredContent?.workerId,
  });
  for (const response of [peer, updated]) {
    expect(response.structuredContent?.notice).toContain('Coordination Protocol');
    expect(JSON.stringify(response.content).match(/Coordination Protocol/g)).toHaveLength(1);
    expect(JSON.stringify(response)).not.toContain('first to check in');
  }
});

it('distinguishes an idempotent removal from a missing session', async () => {
  const result = await runToolContract(checkOut, { workerId: 'ZZZZZZ' });
  expect(result.structuredContent?.removed).toBe(false);
  expect(JSON.stringify(result.content)).toContain('already checked out or unknown');
  expect(JSON.stringify(result.content)).toContain('shift://status?workspace=test');
  expect(notify).not.toHaveBeenCalled();
  const checkedIn = await runToolContract(checkIn, { gist: 'remove' });
  notify.mockClear();
  const removed = await runToolContract(checkOut, {
    workerId: checkedIn.structuredContent?.workerId,
    summary: 'done',
  });
  expect(removed.structuredContent).toMatchObject({ removed: true, summary: 'done' });
  expect(JSON.stringify(removed.content)).toContain('Session ended.');
  expect(JSON.stringify(removed.content)).toContain('done');
  expect(notify).toHaveBeenCalledTimes(2);
  notify.mockClear();
  const repeated = await runToolContract(checkOut, {
    workerId: checkedIn.structuredContent?.workerId,
  });
  expect(repeated.structuredContent?.removed).toBe(false);
  expect(notify).not.toHaveBeenCalled();
});

it('normalizes ASCII worker IDs before lookup', () => {
  expect(checkOut.input.parse({ workerId: 'aBc123' }).workerId).toBe('ABC123');
});

it('selects isolated workspace rosters and returns a qualified status URI', async () => {
  await runToolContract(checkIn, { gist: 'namespace A', workspace: 'a' });
  const result = await runToolContract(checkIn, { gist: 'namespace B', workspace: 'b' });
  expect(result.structuredContent).toMatchObject({
    workspace: 'b',
    statusUri: 'shift://status?workspace=b',
    activeWorkers: [expect.objectContaining({ gist: 'namespace B' })],
  });
});

it('publishes committed mutations through the server notifier without request notifications', async () => {
  const requestNotify = () => {
    throw new Error('request-scoped duplicate notification');
  };
  const context = { notifyResourceUpdated: requestNotify };
  const first = await runToolContract(checkIn, { gist: 'start', workspace: 'other' }, { context });
  expect(first.isError).not.toBe(true);
  expect(notify.mock.calls).toEqual([['shift://status?workspace=other']]);
  const workerId = first.structuredContent?.workerId;
  notify.mockClear();
  await runToolContract(checkIn, { gist: 'update', workerId, workspace: 'other' }, { context });
  await runToolContract(checkOut, { workerId, workspace: 'other' }, { context });
  await runToolContract(checkOut, { workerId, workspace: 'other' }, { context });
  expect(notify.mock.calls).toEqual([
    ['shift://status?workspace=other'],
    ['shift://status?workspace=other'],
  ]);
});

it('normalizes mixed-case updates/removals and rejects Unicode expansion without mutation', async () => {
  const first = await runToolContract(checkIn, { gist: 'first', files: ['a'] });
  const id = String(first.structuredContent?.workerId);
  const updated = await runToolContract(checkIn, { gist: 'patch', workerId: id.toLowerCase() });
  expect(updated.structuredContent).toMatchObject({
    workerId: id,
    files: ['a'],
    checkedInAt: first.structuredContent?.checkedInAt,
  });
  for (const workerId of ['ßabc1', 'ABC12 ', ' ABC12', 'ABC-12', 'ＡBC123', 'ABC12', 'ABC1234']) {
    for (const definition of [checkIn, checkOut]) {
      const result = await runToolContract(definition, {
        workerId,
        ...(definition === checkIn ? { gist: 'invalid' } : {}),
      });
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.InvalidParams },
      });
    }
  }
  expect(workers.get(id)?.gist).toBe('patch');
  const removed = await runToolContract(checkOut, { workerId: id.toLowerCase() });
  expect(removed.structuredContent).toMatchObject({ workerId: id, removed: true });
});

it('renders escaped roster rows and preserves the roster as literal text in unknown-worker errors', async () => {
  const gist = 'one\\|two\r\nthree\nfour\rfive\\';
  const files = ['a\\\\|b\rc'];
  const first = await runToolContract(checkIn, { gist, files });
  const peer = await runToolContract(checkIn, { gist: 'following' });
  expect(first.structuredContent).toMatchObject({ gist, files });
  const error = await runToolContract(checkIn, { gist: 'missing', workerId: 'ZZZZZZ' });
  const status = await statusResource.handler({}, createMockContext());
  const table = String(status)
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .join('\n');
  expect(error.structuredContent).toMatchObject({
    error: {
      code: JsonRpcErrorCode.NotFound,
      message: expect.stringContaining(table),
      data: {
        reason: 'unknown_worker',
        recovery: {
          hint: expect.stringContaining('your own saved or confirmed workerId'),
        },
      },
    },
  });
  const errorText = error.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n');
  expect(errorText).toContain(`\\| ${first.structuredContent.workerId} \\|`);
  expect(errorText).toContain(
    `\\| ${peer.structuredContent.workerId} \\| ${peer.structuredContent.checkedInAt} \\| following \\|`,
  );
  expect(errorText).toContain('Recovery: Use your original workspace');
  for (const text of [
    String(status),
    peer.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n'),
  ]) {
    const rows = text.split('\n').filter((line) => line.startsWith('|'));
    expect(rows).toHaveLength(4);
    expect(rows.find((row) => row.startsWith(`| ${first.structuredContent.workerId} |`))).toContain(
      'one\\\\\\|two three four five\\\\',
    );
    expect(rows.find((row) => row.startsWith(`| ${peer.structuredContent.workerId} |`))).toContain(
      'following',
    );
  }
});

it('decodes a qualified workspace once, keeping percent signs, plus and Unicode exact', async () => {
  const workspace = 'project%2F + ?#研究';
  const result = await runToolContract(checkIn, { gist: 'opaque', workspace });
  expect(result.structuredContent?.statusUri).toBe(
    `shift://status?workspace=${encodeURIComponent(workspace)}`,
  );
  const text = await workspaceStatusResource.handler(
    { workspace: encodeURIComponent(workspace) },
    createMockContext(),
  );
  expect(text).toContain('opaque');
  expect(await statusResource.handler({}, createMockContext())).not.toContain('opaque');
});

it('directs a worker in the wrong workspace to resume only its own session', async () => {
  const session = await runToolContract(checkIn, { gist: 'my task', workspace: 'original' });
  const peer = await runToolContract(checkIn, { gist: 'peer task', workspace: 'other' });
  notify.mockClear();

  const error = await runToolContract(checkIn, {
    gist: 'resume my task',
    workspace: 'other',
    workerId: session.structuredContent.workerId,
  });
  const hint =
    'Use your original workspace and your own saved or confirmed workerId. If you cannot confirm it, omit workerId to start a new session.';
  expect(error.structuredContent).toMatchObject({
    error: {
      code: JsonRpcErrorCode.NotFound,
      data: { reason: 'unknown_worker', recovery: { hint } },
    },
  });
  expect(textOf(error)).toContain(`Recovery: ${hint}`);
  expect(textOf(error)).toContain(String(peer.structuredContent.workerId));
  expect(notify).not.toHaveBeenCalled();
});

it('keeps multiline and special checkout summaries distinct', async () => {
  const summaries = [
    'Updated\nunit tests',
    'Updated\\nunit tests',
    'Updated unit tests',
    '',
    '—',
    'Done\tchecking',
  ];
  const responses = [];
  await runToolContract(checkIn, { gist: 'reading handoffs' });
  for (const summary of summaries) {
    const checkInResult = await runToolContract(checkIn, { gist: 'testing' });
    const checkout = await runToolContract(checkOut, {
      workerId: checkInResult.structuredContent.workerId,
      summary,
    });
    expect(checkout.structuredContent).toMatchObject({ removed: true, summary });
    responses.push(textOf(checkout));
  }
  expect(responses[0]).toContain('Summary: "Updated\\nunit tests"');
  expect(responses[1]).toContain('Summary: "Updated\\\\\\nunit tests"');
  expect(responses[2]).toContain('Summary: Updated unit tests');
  expect(responses[3]).toContain('Summary: ""');
  expect(responses[4]).toContain('Summary: "—"');
  expect(responses[5]).toContain('Summary: "Done\\tchecking"');
  const status = await statusResource.handler({}, createMockContext());
  expect(status).toContain('| "Updated\\nunit tests" |');
  expect(status).toContain('| "Updated\\\\\\nunit tests" |');
});

it('does not mutate or notify on pre-cancelled calls or an ID from another workspace', async () => {
  const first = await runToolContract(checkIn, { gist: 'alive', workspace: 'a' });
  notify.mockClear();
  const missing = await runToolContract(checkOut, {
    workerId: first.structuredContent.workerId,
    workspace: 'b',
  });
  expect(missing.structuredContent).toMatchObject({ removed: false });
  const controller = new AbortController();
  controller.abort();
  const cancelled = await runToolContract(
    checkIn,
    { gist: 'cancelled', workspace: 'a' },
    { context: { signal: controller.signal } },
  );
  expect(cancelled.structuredContent).toMatchObject({
    error: { code: JsonRpcErrorCode.RequestCancelled },
  });
  expect(notify).not.toHaveBeenCalled();
  const status = await workspaceStatusResource.handler({ workspace: 'a' }, createMockContext());
  expect(status).toContain('alive');
  expect(status).not.toContain('cancelled');
});

it('uses the default for an empty form selector and rejects malformed Unicode before commit', async () => {
  const valid = await runToolContract(checkIn, { gist: 'default', workspace: '' });
  expect(valid.structuredContent).toMatchObject({
    workspace: 'test',
    statusUri: 'shift://status?workspace=test',
  });
  notify.mockClear();
  const invalid = await runToolContract(checkIn, { gist: 'invalid', workspace: '\uD800' });
  expect(invalid.structuredContent).toMatchObject({
    error: { code: JsonRpcErrorCode.ValidationError },
  });
  expect(workers.size).toBe(1);
  expect(notify).not.toHaveBeenCalled();
});

toolContractSuite(checkIn, {
  success: [
    {
      name: 'validates, invokes, and formats a new check-in',
      input: { gist: 'integration', files: ['src/index.ts'] },
    },
  ],
  errors: [
    {
      name: 'returns the declared dual-surface envelope for an unknown worker ID',
      input: { gist: 'integration', workerId: 'ZZZZZZ' },
      code: JsonRpcErrorCode.NotFound,
      reason: 'unknown_worker',
    },
  ],
});

toolContractSuite(checkOut, {
  success: [
    {
      name: 'validates, invokes, and formats an idempotent check-out',
      input: { workerId: 'ZZZZZZ', summary: 'integration' },
    },
  ],
});
