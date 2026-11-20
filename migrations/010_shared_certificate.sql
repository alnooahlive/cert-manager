-- One shared certificate for the single apex domain. No per-router issuance.
CREATE TABLE IF NOT EXISTS shared_certificate (
  id INT PRIMARY KEY DEFAULT 1,
  version INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'none',
  source TEXT,
  fullchain_pem TEXT,
  privkey_pem TEXT,
  not_before TIMESTAMPTZ,
  not_after TIMESTAMPTZ,
  last_error TEXT,
  issuing_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO shared_certificate(id, version, status) VALUES (1, 0, 'none') ON CONFLICT (id) DO NOTHING;

-- Track which certificate version each router has applied
ALTER TABLE routers ADD COLUMN IF NOT EXISTS cert_applied_version INT;
