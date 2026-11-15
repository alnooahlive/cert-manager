-- Precautions: issuance tracking
ALTER TABLE routers ADD COLUMN IF NOT EXISTS issuing_at TIMESTAMPTZ;
-- Clean up orphaned certs (certs without routers)
DELETE FROM certificates WHERE router_id NOT IN (SELECT id FROM routers);
