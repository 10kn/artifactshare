-- Migration: 0090_workspaces_ms_tenant_and_email_domain
-- Description: Add workspaces.ms_tenant_id and workspaces.email_domain that
-- exist in schema.sql / clean-rebuild baselines but were never applied on
-- incremental D1s (0055 is a no-op marker). Session bootstrap selects
-- ms_tenant_id after Google login; without the column authenticated `/`
-- fails with "Oops! An unexpected error occurred."

ALTER TABLE workspaces ADD COLUMN ms_tenant_id TEXT;
ALTER TABLE workspaces ADD COLUMN email_domain TEXT;

CREATE UNIQUE INDEX workspaces_ms_tenant_id
  ON workspaces(ms_tenant_id);
