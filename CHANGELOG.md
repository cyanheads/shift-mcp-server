# Changelog

## [0.1.0] - 2026-03-23

### Added

- `shift_check_in` tool — register or update a worker session with gist and file declarations
- `shift_check_out` tool — end a working session and remove from active worker list
- `shift://status` resource — read-only view of all active workers with gists, files, and timestamps
- In-memory worker session store with 6-character alphanumeric ID generation
- Coordination protocol instructions returned on every check-in
- Patch semantics for session updates (omitted fields preserved)
- Error responses include active workers table for self-identification
- Directory structure documentation (`docs/tree.md`)
