# Changelog

All notable changes to this project. Each entry links to its full per-version file in [changelog/](changelog/).

## [0.1.6](changelog/0.1.x/0.1.6.md) — 2026-08-22

Rebuilt on @cyanheads/mcp-ts-core ^0.12.3 (from ^0.1.26): every HTTP endpoint now serves protocol revision 2026-07-28, tool inputs are strict, the advertised outputSchema declares the error envelope, and shift://status updates reach subscribers on both protocol eras.

## [0.1.5](changelog/0.1.x/0.1.5.md) — 2026-03-23

shift://status subscribers receive live updates on check-in and check-out.

## [0.1.4](changelog/0.1.x/0.1.4.md) — 2026-03-23

Published under the scoped npm name @cyanheads/shift-mcp-server.

## [0.1.3](changelog/0.1.x/0.1.3.md) — 2026-03-23

workerId is validated against /^[A-Z0-9]{6}$/ on both tools, and shift_check_out is idempotent.

## [0.1.2](changelog/0.1.x/0.1.2.md) — 2026-03-23

Unit test coverage for both tools, the worker store, and the status resource.

## [0.1.1](changelog/0.1.x/0.1.1.md) — 2026-03-23

Packaging and documentation pass — LICENSE, bunfig.toml, reverse-domain server name, Docker OCI source label, and a rewritten README.

## [0.1.0](changelog/0.1.x/0.1.0.md) — 2026-03-23

First release — shift_check_in and shift_check_out tools plus the shift://status resource over an in-memory worker session store.
