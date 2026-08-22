/**
 * @fileoverview Smoke coverage for every definition the server registers.
 * @module tests/smoke/definitions.smoke.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { statusResource } from '@/mcp-server/resources/definitions/status.resource.js';
import { checkIn } from '@/mcp-server/tools/definitions/check-in.tool.js';
import { checkOut } from '@/mcp-server/tools/definitions/check-out.tool.js';
import { workers } from '@/services/worker-store/worker-store.js';

describe('shift definition smoke test', () => {
  beforeEach(() => {
    workers.clear();
  });

  it('runs a full check-in → status → check-out cycle', async () => {
    const resourceCtx = createMockContext({ uri: new URL('shift://status') });

    const checkedIn = await checkIn.handler(
      checkIn.input.parse({ gist: 'smoke', files: ['src/index.ts'] }),
      createMockContext({ errors: checkIn.errors }),
    );
    expect(checkedIn).toEqual(expect.schemaMatching(checkIn.output));
    expect(checkIn.format?.(checkedIn)?.[0]).toMatchObject({ type: 'text' });

    const populated = (await statusResource.handler({}, resourceCtx)) as string;
    expect(populated).toContain('## Active Workers (1)');
    expect(populated).toContain(checkedIn.workerId);

    const checkedOut = await checkOut.handler(
      checkOut.input.parse({ workerId: checkedIn.workerId, summary: 'smoke done' }),
      createMockContext(),
    );
    expect(checkedOut).toEqual(expect.schemaMatching(checkOut.output));
    expect(checkOut.format?.(checkedOut)?.[0]).toEqual({
      type: 'text',
      text: `Checked out Worker ${checkedIn.workerId}. Session ended.\nSummary: smoke done`,
    });

    const emptied = await statusResource.handler({}, resourceCtx);
    expect(emptied).toBe('## Active Workers (0)\nNo agents are currently active.');
  });
});
