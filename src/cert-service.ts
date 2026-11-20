import { query, one } from './db';
import { issueSharedCertificate } from './acme-issue';
import { FORCED_DOMAIN } from './config';

export interface CertStatus {
  exists: boolean;
  valid: boolean;
  version: number | null;
  notAfter: string | null;
  domain: string | null;
  source: string | null;
  reason?: string;
  lastError?: string | null;
  lastIssueAt?: string | null;
}

function mapStatus(s: any): CertStatus {
  return {
    exists: !!s && s.status === 'issued',
    valid: !!s && s.status === 'issued' && !!s.not_after && new Date(s.not_after) > new Date(),
    version: s?.version ?? null,
    notAfter: s?.not_after ?? null,
    domain: FORCED_DOMAIN,
    source: s?.source ?? null,
    reason: s?.status === 'issued' ? undefined : 'لا توجد شهادة مشتركة صالحة',
    lastError: s?.last_error ?? null,
    lastIssueAt: s?.updated_at ?? null,
  };
}

// The single certificate shared by every router — one row, one ACME issuance.
export async function getSharedCertStatus(): Promise<CertStatus> {
  const s = await one('SELECT * FROM shared_certificate WHERE id=1');
  return mapStatus(s);
}

// Kept for existing UI endpoints: status is global, not per-router.
export async function getCertStatus(_routerId: string): Promise<CertStatus> {
  return getSharedCertStatus();
}

/**
 * Ensure the ONE shared certificate exists and is valid.
 * 1) valid and not forced -> skip. 2) otherwise -> single ACME issuance for the apex domain.
 * force=true renews even if still valid.
 */
export async function ensureSharedCertificate(opts: { force?: boolean } = {}) {
  const force = opts.force === true;
  const current = await getSharedCertStatus();
  if (!force && current.valid) {
    return { action: 'already-valid', version: current.version, notAfter: current.notAfter, domain: current.domain };
  }
  const res = await issueSharedCertificate({ force });
  if ((res as any).skipped) return { action: 'busy', ...res };
  return { action: 'issued', ...res };
}

// Called when a network/router is created. No per-router issuance — just report shared state.
export async function tryReuseForRouter(_routerId: string) {
  const s = await getSharedCertStatus();
  if (!s.valid) return null;
  return { action: 'shared', version: s.version, notAfter: s.notAfter };
}
