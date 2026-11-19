-- Prevent concurrent ACME issuance for the same domain (TXT conflict)
CREATE TABLE IF NOT EXISTS issuance_locks (
  domain TEXT PRIMARY KEY,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  owner TEXT NOT NULL DEFAULT ''
);
-- Track last issuance result for UI validation
ALTER TABLE routers ADD COLUMN IF NOT EXISTS last_issue_error TEXT;
ALTER TABLE routers ADD COLUMN IF NOT EXISTS last_issue_at TIMESTAMPTZ;
-- Faster lookup of certificates by domain via router
CREATE INDEX IF NOT EXISTS idx_routers_dns ON routers(hotspot_dns_name);
CREATE INDEX IF NOT EXISTS idx_certs_status_notafter ON certificates(status, not_after DESC);
