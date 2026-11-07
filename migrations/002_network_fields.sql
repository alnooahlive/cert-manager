-- Add network info fields and admin seed support
ALTER TABLE routers ADD COLUMN IF NOT EXISTS network_name TEXT;
ALTER TABLE routers ADD COLUMN IF NOT EXISTS network_number TEXT;

-- Ensure settings defaults present (already seeded)
INSERT INTO settings(key,value) VALUES ('admin_email','admin@alnooah.pro')
ON CONFLICT (key) DO NOTHING;
