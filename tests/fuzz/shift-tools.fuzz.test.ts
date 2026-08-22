/**
 * @fileoverview Property-based fuzz coverage for the shift tools.
 * @module tests/fuzz/shift-tools.fuzz.test
 */

import { fuzzTool } from '@cyanheads/mcp-ts-core/testing/fuzz';
import { expect, it } from 'vitest';

import { checkIn } from '@/mcp-server/tools/definitions/check-in.tool.js';
import { checkOut } from '@/mcp-server/tools/definitions/check-out.tool.js';
import { workers } from '@/services/worker-store/worker-store.js';

it.each([
  ['shift_check_in', checkIn],
  ['shift_check_out', checkOut],
])('keeps %s safe across generated and adversarial inputs', async (_name, definition) => {
  workers.clear();

  const report = await fuzzTool(definition, {
    numRuns: 50,
    numAdversarial: 30,
    seed: 20_260_822,
  });

  expect(report.crashes).toHaveLength(0);
  expect(report.leaks).toHaveLength(0);
  expect(report.prototypePollution).toBe(false);
});
