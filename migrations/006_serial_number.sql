-- Router serial number support
ALTER TABLE routers ADD COLUMN IF NOT EXISTS serial_number TEXT;
ALTER TABLE routers ADD COLUMN IF NOT EXISTS serial_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE agent_credentials ADD COLUMN IF NOT EXISTS serial_number TEXT;
