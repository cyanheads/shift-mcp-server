/**
 * @fileoverview Workspace selection through the production stdio entry point.
 * @module tests/integration/project-workspace.int.test
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
let launcher: string;

beforeEach(() => {
  launcher = realpathSync(mkdtempSync(join(tmpdir(), 'shift-launcher-')));
});

afterEach(() => {
  rmSync(launcher, { recursive: true, force: true });
});

async function checkIn(gist: string, projectDir = '', configured = '', workspace?: string) {
  const child = spawn(
    'bun',
    ['run', '--tsconfig-override', join(root, 'tsconfig.json'), join(root, 'src/index.ts')],
    {
      cwd: launcher,
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: projectDir,
        SHIFT_WORKSPACE: configured,
        SHIFT_STATE_DIR: join(launcher, 'state'),
        LOGS_DIR: join(launcher, 'logs'),
        MCP_TRANSPORT_TYPE: 'stdio',
        MCP_AUTH_MODE: 'none',
        OTEL_ENABLED: 'false',
      },
      signal: AbortSignal.timeout(5_000),
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  let diagnostics = '';
  child.stderr.on('data', (data) => {
    diagnostics += data;
  });
  child.on('error', (error) => {
    diagnostics += error.message;
  });
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  const lines = createInterface({ input: child.stdout });
  function send(method: string, params?: Record<string, unknown>, id?: number) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params, id })}\n`);
  }

  try {
    send(
      'initialize',
      {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      },
      1,
    );
    for await (const line of lines) {
      const reply = JSON.parse(line);
      if (reply.id === 1) {
        expect(reply.error).toBeUndefined();
        send('notifications/initialized');
        send('tools/call', { name: 'shift_check_in', arguments: { gist, workspace } }, 2);
      }
      if (reply.id === 2) {
        expect(reply.error).toBeUndefined();
        expect(reply.result.isError, JSON.stringify(reply.result)).not.toBe(true);
        return reply.result;
      }
    }
    throw new Error(`No check-in reply over stdio: ${diagnostics}`);
  } finally {
    lines.close();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await closed;
  }
}

it('uses the real launcher directory outside Git and honors caller and configured overrides', async () => {
  expect((await checkIn('local')).structuredContent.workspace).toBe(launcher);
  const missing = join(launcher, 'missing');
  expect((await checkIn('configured', missing, 'shared')).structuredContent.workspace).toBe(
    'shared',
  );
  const caller = await checkIn('caller', missing, 'shared', 'explicit');
  expect(caller.structuredContent).toMatchObject({
    workspace: 'explicit',
    statusUri: 'shift://status?workspace=explicit',
  });
  expect(caller.content[0].text).toContain('**Workspace:** explicit');
});

it.each(['regular file', 'missing path'])(
  'rejects a project hint pointing to a %s at startup unless a workspace is configured',
  async (kind) => {
    const invalid = join(launcher, 'invalid-project');
    if (kind === 'regular file') writeFileSync(invalid, '');

    await expect(checkIn('invalid project', invalid)).rejects.toThrow(
      'CLAUDE_PROJECT_DIR must point to an accessible directory. Fix the directory or set SHIFT_WORKSPACE.',
    );
    expect((await checkIn('using override', invalid, 'shared')).structuredContent.workspace).toBe(
      'shared',
    );
  },
);

it('isolates projects launched from a common directory and converges on the real Git root', async () => {
  const alpha = join(launcher, 'alpha');
  const beta = join(launcher, 'beta');
  const nested = join(alpha, 'src', 'tools');
  mkdirSync(join(alpha, '.git'), { recursive: true });
  mkdirSync(join(beta, '.git'), { recursive: true });
  mkdirSync(nested, { recursive: true });
  const symlink = join(launcher, 'alias');
  symlinkSync(nested, symlink, 'dir');
  const outside = join(launcher, 'outside');
  mkdirSync(outside);

  const first = await checkIn('engineering', alpha);
  expect(first.structuredContent.workspace).toBe(alpha);
  const second = await checkIn('design', beta);
  const alias = await checkIn('review', symlink, `\${user_config.workspace}`);
  expect(first.structuredContent).toMatchObject({
    statusUri: `shift://status?workspace=${encodeURIComponent(alpha)}`,
    activeWorkers: [expect.objectContaining({ gist: 'engineering' })],
  });
  expect(second.structuredContent).toMatchObject({
    workspace: beta,
    activeWorkers: [expect.objectContaining({ gist: 'design' })],
  });
  expect(alias.structuredContent.workspace).toBe(alpha);
  expect(alias.structuredContent.activeWorkers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ gist: 'engineering' }),
      expect.objectContaining({ gist: 'review' }),
    ]),
  );
  expect(alias.content[0].text).toContain('engineering');
  expect(second.content[0].text).not.toContain('engineering');
  expect((await checkIn('outside Git', outside)).structuredContent.workspace).toBe(outside);
});
