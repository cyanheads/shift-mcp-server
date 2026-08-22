/**
 * @fileoverview Tool-contract integration coverage for the shift tools —
 * validates schemas, invokes the real handlers, and checks both public error
 * surfaces of the unknown-worker path.
 * @module tests/integration/shift-contract.int.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { toolContractSuite } from '@cyanheads/mcp-ts-core/testing/vitest';

import { checkIn } from '@/mcp-server/tools/definitions/check-in.tool.js';
import { checkOut } from '@/mcp-server/tools/definitions/check-out.tool.js';

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
