-- Migration: 0089_drop_users_google_sub
-- Created: 2026-08-26
-- Description: Remove legacy users.google_sub (NOT NULL UNIQUE). The column was
-- in 0001/0019 but dropped from the source-available schema and app insert
-- paths. Clean-rebuild markers 0049/0055 are intentional no-ops, so databases
-- that never ran a real rebuild still require google_sub on INSERT. Better Auth
-- user creates omit the field → SQLITE_CONSTRAINT_NOTNULL and Google OAuth
-- sign-in fails with a generic error. SQLite/D1 rejects ALTER TABLE DROP COLUMN
-- on a UNIQUE column, so rebuild users without google_sub (matches schema.sql).
-- Bot-guard triggers that reference users must be dropped before DROP TABLE
-- users and recreated afterwards (same SQL as 0084_bot_users).

PRAGMA foreign_keys = OFF;

DROP TRIGGER IF EXISTS api_tokens_reject_bot_insert;
DROP TRIGGER IF EXISTS api_tokens_reject_bot_update;
DROP TRIGGER IF EXISTS cli_family_authorities_bot_agent_only_insert;
DROP TRIGGER IF EXISTS cli_family_authorities_bot_agent_only_update;
DROP TRIGGER IF EXISTS users_kind_immutable;

CREATE TABLE users_new (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  name            TEXT,
  image           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id),
  locale          TEXT,
  kind            TEXT NOT NULL DEFAULT 'human' CHECK (kind IN ('human', 'bot')),
  bot_stopped_at  TEXT
);

INSERT INTO users_new (
  id, email, email_verified, name, image, created_at, updated_at,
  workspace_id, locale, kind, bot_stopped_at
)
SELECT
  id, email, email_verified, name, image, created_at, updated_at,
  workspace_id, locale, kind, bot_stopped_at
FROM users;

CREATE TABLE _migration_0089_guard (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _migration_0089_guard (ok)
SELECT CASE
  WHEN (SELECT COUNT(*) FROM users_new) = (SELECT COUNT(*) FROM users)
  THEN 1 ELSE 0 END;
DROP TABLE _migration_0089_guard;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE INDEX users_workspace_id ON users(workspace_id);
CREATE UNIQUE INDEX users_active_bot_name
  ON users(workspace_id, name)
  WHERE kind = 'bot' AND bot_stopped_at IS NULL;

CREATE TRIGGER users_kind_immutable
BEFORE UPDATE OF kind ON users
WHEN OLD.kind <> NEW.kind
BEGIN
  SELECT RAISE(ABORT, 'users.kind is immutable');
END;

CREATE TRIGGER api_tokens_reject_bot_insert
BEFORE INSERT ON api_tokens
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND kind = 'bot')
BEGIN
  SELECT RAISE(ABORT, 'api tokens are not available to bot users');
END;
CREATE TRIGGER api_tokens_reject_bot_update
BEFORE UPDATE ON api_tokens
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND kind = 'bot')
BEGIN
  SELECT RAISE(ABORT, 'api tokens are not available to bot users');
END;

CREATE TRIGGER cli_family_authorities_bot_agent_only_insert
BEFORE INSERT ON cli_family_authorities
WHEN NEW.preset <> 'agent'
  AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND kind = 'bot')
BEGIN
  SELECT RAISE(ABORT, 'bot users only allow agent preset authorities');
END;
CREATE TRIGGER cli_family_authorities_bot_agent_only_update
BEFORE UPDATE ON cli_family_authorities
WHEN NEW.preset <> 'agent'
  AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND kind = 'bot')
BEGIN
  SELECT RAISE(ABORT, 'bot users only allow agent preset authorities');
END;

PRAGMA foreign_keys = ON;
