/**
 * @fileoverview Roster SQLite schema and startup migrations.
 * @module services/worker-store/roster-schema
 */

import type { DatabaseSync } from 'node:sqlite';

const SCHEMA_VERSION = 1;

/** Install the roster schema under a writer lock, within the startup deadline. */
export function initializeRosterSchema(db: DatabaseSync, deadline: number): void {
  if (schemaIsCurrent(db)) return;
  db.exec(`PRAGMA busy_timeout=${Math.max(0, Math.floor(deadline - performance.now()))}`);
  db.exec('BEGIN IMMEDIATE');
  let committed = false;
  try {
    if (!schemaIsCurrent(db)) {
      /** Keep the five-column workers table writable by v0.2.0 processes.
       * Triggers maintain join order, invalidate stale activity and prune on every writer version. */
      db.exec(`
        CREATE TABLE IF NOT EXISTS workers (
          workspace TEXT NOT NULL, workerId TEXT NOT NULL, gist TEXT NOT NULL,
          files TEXT NOT NULL, checkedInAt TEXT NOT NULL,
          PRIMARY KEY (workspace, workerId)
        );
        CREATE TABLE roster_order (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          lastEvent INTEGER NOT NULL
        );
        INSERT INTO roster_order VALUES (1, 0);
        CREATE TABLE worker_activity (
          workspace TEXT NOT NULL, workerId TEXT NOT NULL, joinedOrder INTEGER NOT NULL,
          lastSeenAt TEXT, ownerScope TEXT, ownerPid INTEGER,
          PRIMARY KEY (workspace, workerId)
        );
        INSERT INTO worker_activity (workspace, workerId, joinedOrder)
          SELECT workspace, workerId, 0 FROM workers;
        CREATE INDEX worker_activity_joined ON worker_activity (workspace, joinedOrder);
        CREATE TABLE departures (
          workspace TEXT NOT NULL, departedOrder INTEGER NOT NULL,
          workerId TEXT NOT NULL, gist TEXT NOT NULL, files TEXT NOT NULL,
          summary TEXT, checkedOutAt TEXT NOT NULL,
          PRIMARY KEY (workspace, departedOrder)
        );
        CREATE TRIGGER workers_check_in AFTER INSERT ON workers BEGIN
          UPDATE roster_order SET lastEvent = lastEvent + 1 WHERE singleton = 1;
          INSERT INTO worker_activity (workspace, workerId, joinedOrder)
            SELECT NEW.workspace, NEW.workerId, lastEvent FROM roster_order WHERE singleton = 1;
        END;
        CREATE TRIGGER workers_update AFTER UPDATE OF gist, files ON workers BEGIN
          UPDATE worker_activity SET lastSeenAt = NULL, ownerScope = NULL, ownerPid = NULL
            WHERE workspace = NEW.workspace AND workerId = NEW.workerId;
        END;
        CREATE TRIGGER workers_check_out AFTER DELETE ON workers BEGIN
          DELETE FROM worker_activity WHERE workspace = OLD.workspace AND workerId = OLD.workerId;
          DELETE FROM departures WHERE workspace = OLD.workspace
            AND departedOrder <= COALESCE(
              (SELECT MIN(joinedOrder) FROM worker_activity WHERE workspace = OLD.workspace),
              (SELECT lastEvent FROM roster_order WHERE singleton = 1)
            );
        END;
        PRAGMA user_version=${SCHEMA_VERSION};
      `);
    }
    db.exec('COMMIT');
    committed = true;
  } finally {
    if (!committed) db.exec('ROLLBACK');
  }
}

function schemaIsCurrent(db: DatabaseSync): boolean {
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
  if (version > SCHEMA_VERSION)
    throw new Error(`Roster database schema ${version} requires a newer shift-mcp-server`);
  return version === SCHEMA_VERSION;
}
