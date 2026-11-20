-- Issuance safety: cooldown, weekly cap, failure tracking, and history
ALTER TABLE shared_certificate ADD COLUMN IF NOT EXISTS last_renewal_attempt_at TIMESTAMPTZ;
ALTER TABLE shared_certificate ADD COLUMN IF NOT EXISTS renewal_failures INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS issuance_history (
  id BIGSERIAL PRIMARY KEY,
  domain TEXT NOT NULL,
  version INT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_issuance_history_domain_time ON issuance_history(domain, issued_at DESC);
