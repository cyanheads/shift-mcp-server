#!/usr/bin/env node
/**
 * @fileoverview shift-mcp-server MCP server entry point.
 * @module index
 */

import { createApp } from '@cyanheads/mcp-ts-core';
import { statusResource } from './mcp-server/resources/definitions/status.resource.js';
import { checkIn } from './mcp-server/tools/definitions/check-in.tool.js';
import { checkOut } from './mcp-server/tools/definitions/check-out.tool.js';

await createApp({
  tools: [checkIn, checkOut],
  resources: [statusResource],
});
