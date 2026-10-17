/**
 * @fileoverview Real HTTP delivery from legacy mutations to filtered modern streams.
 * @module tests/integration/notifications.int.test
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';

it('delivers legacy and modern mutations once, only to matching workspace subscriptions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'shift-http-'));
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('No loopback port allocated');
  const port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const repo = new URL('../../', import.meta.url).pathname;
  const child = spawn(
    'bun',
    ['run', '--tsconfig-override', join(repo, 'tsconfig.json'), join(repo, 'src/index.ts')],
    {
      cwd: directory,
      env: {
        ...process.env,
        SHIFT_STATE_DIR: join(directory, 'state'),
        SHIFT_WORKSPACE: 'default',
        MCP_TRANSPORT_TYPE: 'http',
        MCP_HTTP_HOST: '127.0.0.1',
        MCP_HTTP_PORT: String(port),
        MCP_SESSION_MODE: 'stateful',
        MCP_AUTH_MODE: 'none',
        OTEL_ENABLED: 'false',
        LOGS_DIR: join(directory, 'logs'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let logs = '';
  child.stderr.on('data', (data) => {
    logs += data;
  });
  child.stdout.on('data', (data) => {
    logs += data;
  });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  const url = `http://127.0.0.1:${port}/mcp`;
  const controllers: AbortController[] = [];
  const consumers: Promise<void>[] = [];
  const meta = {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
    'io.modelcontextprotocol/clientCapabilities': {},
  };
  let sequence = 0;

  async function post(
    method: string,
    params: Record<string, unknown>,
    session?: string,
    modern = false,
  ) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': modern ? '2026-07-28' : '2025-11-25',
        'Mcp-Method': method,
        ...(typeof params.name === 'string' ? { 'Mcp-Name': params.name } : {}),
        ...(session ? { 'Mcp-Session-Id': session } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++sequence,
        method,
        params: { ...params, ...(modern ? { _meta: meta } : {}) },
      }),
      signal: AbortSignal.timeout(5_000),
    });
    const text = await response.text();
    expect(response.status, text).toBe(200);
    const frames = text
      .split('\n')
      .filter((line) => line.startsWith('data:') && line.slice(5).trim());
    const body = frames.length
      ? frames.map((line) => JSON.parse(line.slice(5))).find((message) => message.id === sequence)
      : JSON.parse(text);
    expect(body, text).toBeDefined();
    expect(body.error).toBeUndefined();
    return { body, session: response.headers.get('mcp-session-id') ?? undefined };
  }

  async function listen(uri: string) {
    const controller = new AbortController();
    controllers.push(controller);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': 'subscriptions/listen',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++sequence,
        method: 'subscriptions/listen',
        params: { _meta: meta, notifications: { resourceSubscriptions: [uri] } },
      }),
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    let data = '';
    const consumer = (async () => {
      try {
        for await (const chunk of response.body!) data += new TextDecoder().decode(chunk);
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      }
    })();
    consumers.push(consumer);
    return () => (data.match(/notifications\/resources\/updated/g) ?? []).length;
  }

  try {
    await expect
      .poll(
        async () => {
          try {
            return (
              await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(200) })
            ).ok;
          } catch {
            if (child.exitCode !== null) throw new Error(logs);
            return false;
          }
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    const legacy = await post('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'legacy', version: '1' },
    });
    const qualified = await listen('shift://status?workspace=other');
    const bare = await listen('shift://status');
    const unmatched = await listen('shift://status?workspace=unrelated');
    const created = await post(
      'tools/call',
      { name: 'shift_check_in', arguments: { gist: 'legacy', workspace: 'other' } },
      legacy.session,
    );
    expect(created.body.result.isError).not.toBe(true);
    const workerId = created.body.result.structuredContent.workerId;
    await expect.poll(qualified).toBe(1);
    await post(
      'tools/call',
      {
        name: 'shift_check_in',
        arguments: { gist: 'modern update', workerId, workspace: 'other' },
      },
      undefined,
      true,
    );
    await expect.poll(qualified).toBe(2);
    await post(
      'tools/call',
      { name: 'shift_check_out', arguments: { workerId, workspace: 'other' } },
      legacy.session,
    );
    await expect.poll(qualified).toBe(3);
    await post(
      'tools/call',
      { name: 'shift_check_out', arguments: { workerId, workspace: 'other' } },
      legacy.session,
    );
    await post(
      'tools/call',
      { name: 'shift_check_in', arguments: { gist: 'default' } },
      legacy.session,
    );
    await expect.poll(bare).toBe(1);
    await delay(100);
    expect(qualified()).toBe(3);
    expect(bare()).toBe(1);
    expect(unmatched()).toBe(0);
    const templates = await post('resources/templates/list', {}, legacy.session);
    expect(templates.body.result.resourceTemplates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uriTemplate: 'shift://status{?workspace}' }),
      ]),
    );
    const read = await post(
      'resources/read',
      { uri: 'shift://status?workspace=other' },
      legacy.session,
    );
    expect(read.body.result.contents[0].text).toContain('Active Workers (0)');
  } finally {
    for (const controller of controllers) controller.abort();
    await Promise.all(consumers);
    child.kill('SIGTERM');
    await exited;
    rmSync(directory, { recursive: true });
  }
}, 30_000);
