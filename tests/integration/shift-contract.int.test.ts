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

it('renders escaped rows in check-in, status and unknown-worker errors while retaining raw values', async () => {
  const gist = 'one\\|two\r\nthree\nfour\rfive\\';
  const files = ['a\\\\|b\rc'];
  const first = await runToolContract(checkIn, { gist, files });
  const peer = await runToolContract(checkIn, { gist: 'following' });
  expect(first.structuredContent).toMatchObject({ gist, files });
  const error = await runToolContract(checkIn, { gist: 'missing', workerId: 'ZZZZZZ' });
  const status = await statusResource.handler({}, createMockContext());
  for (const text of [
    String(status),
    peer.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n'),
    error.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n'),
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
