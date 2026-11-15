-- Initial schema. The live world of an operation is held in memory; these tables persist the
-- things that must survive a restart or be queried afterwards.
-- Columns named `data` hold the full entity as JSON, matching the schema in @bastion/shared.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL,
  authority     TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE rules (
  id          TEXT PRIMARY KEY,
  authority   TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  action_kind TEXT NOT NULL,
  autonomy    TEXT NOT NULL,
  params      TEXT NOT NULL, -- JSON object
  approved_by TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX rules_by_kind ON rules (action_kind, authority);

CREATE TABLE operations (
  id          TEXT PRIMARY KEY,
  region_id   TEXT NOT NULL,
  scenario_id TEXT,
  mode        TEXT NOT NULL,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  ended_at    TEXT
);

CREATE TABLE actions (
  id           TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES operations (id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  authority    TEXT NOT NULL,
  status       TEXT NOT NULL,
  data         TEXT NOT NULL, -- JSON Action
  updated_at   TEXT NOT NULL
);
CREATE INDEX actions_by_operation ON actions (operation_id);

-- Append-only. `seq` gives a total order even when two entries share a timestamp.
CREATE TABLE audit_log (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  id           TEXT NOT NULL UNIQUE,
  operation_id TEXT REFERENCES operations (id) ON DELETE CASCADE,
  at           TEXT NOT NULL,
  sim_time     REAL NOT NULL,
  actor        TEXT NOT NULL,
  verb         TEXT NOT NULL,
  action_id    TEXT,
  detail       TEXT NOT NULL
);
CREATE INDEX audit_by_operation ON audit_log (operation_id, seq);

CREATE TABLE work_orders (
  id           TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES operations (id) ON DELETE CASCADE,
  status       TEXT NOT NULL,
  data         TEXT NOT NULL, -- JSON WorkOrder
  updated_at   TEXT NOT NULL
);
CREATE INDEX work_orders_by_operation ON work_orders (operation_id);

CREATE TABLE signals_log (
  id           TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES operations (id) ON DELETE CASCADE,
  sim_time     REAL NOT NULL,
  source       TEXT NOT NULL,
  data         TEXT NOT NULL -- JSON Signal
);
CREATE INDEX signals_by_operation ON signals_log (operation_id, sim_time);
