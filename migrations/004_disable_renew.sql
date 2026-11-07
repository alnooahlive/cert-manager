-- Disable/revoke and renewal control
ALTER TABLE routers ADD COLUMN IF NOT EXISTS renewal_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS renewal_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE routers ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
