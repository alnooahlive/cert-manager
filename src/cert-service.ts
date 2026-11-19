import { query, one } from './db';
import { issueCertificate as acmeIssue } from './acme-issue';

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

export async function getCertStatus(routerId: string): Promise<CertStatus> {
  const r = await one('SELECT hotspot_dns_name,last_issue_error,last_issue_at FROM routers WHERE id=$1', [routerId]);
  if (!r) return { exists: false, valid: false, version: null, notAfter: null, domain: null, source: null, reason: 'router not found' };
  const c = await one(
    `SELECT version,not_after,source FROM certificates
     WHERE router_id=$1 AND status='issued' AND not_after > now()
     ORDER BY version DESC LIMIT 1`, [routerId]);
  return {
    exists: !!c,
    valid: !!c,
    version: c?.version ?? null,
    notAfter: c?.not_after ?? null,
    domain: r.hotspot_dns_name,
    source: c?.source ?? null,
    reason: c ? undefined : 'لا توجد شهادة صالحة',
    lastError: r.last_issue_error,
    lastIssueAt: r.last_issue_at,
  };
}

// Find a valid certificate for the same domain on ANY router
export async function findReusableCert(domain: string) {
  return one(
    `SELECT c.* FROM certificates c
     JOIN routers r ON r.id=c.router_id
     WHERE r.hotspot_dns_name=$1 AND c.status='issued' AND c.not_after > now()
     ORDER BY c.not_after DESC LIMIT 1`, [domain]);
}

async function reuseCertificate(cert: any, routerId: string) {
  const last = await one('SELECT COALESCE(MAX(version),0) AS v FROM certificates WHERE router_id=$1', [routerId]);
  const version = (last?.v || 0) + 1;
  await query(
    `INSERT INTO certificates(router_id,version,status,source,acme_managed,fullchain_pem,privkey_pem,not_before,not_after)
     VALUES($1,$2,'issued','reused',true,$3,$4,$5,$6)`,
    [routerId, version, cert.fullchain_pem, cert.privkey_pem, cert.not_before, cert.not_after]
  );
  await query('UPDATE routers SET last_issue_error=NULL,last_issue_at=now() WHERE id=$1', [routerId]);
  return version;
}

// Silently reuse an existing valid cert on router creation (never calls ACME)
export async function tryReuseForRouter(routerId: string) {
  const r = await one('SELECT hotspot_dns_name FROM routers WHERE id=$1', [routerId]);
  if (!r) return null;
  const status = await getCertStatus(routerId);
  if (status.valid) return { action: 'already-valid', version: status.version };
  const reusable = await findReusableCert(r.hotspot_dns_name);
  if (!reusable) return null;
  const version = await reuseCertificate(reusable, routerId);
  return { action: 'reused', version, notAfter: reusable.not_after };
}

/**
 * Ensure a valid certificate exists for a router.
 * Order: 1) already valid -> skip. 2) same-domain cert exists -> reuse (no ACME, no TXT).
 *        3) otherwise -> issue new via ACME.
 * force=true skips steps 1 & 2 (used for renewal).
 */
export async function ensureCertificate(routerId: string, opts: { force?: boolean } = {}) {
  const force = opts.force === true;
  const r = await one('SELECT hotspot_dns_name FROM routers WHERE id=$1', [routerId]);
  if (!r) throw new Error('router not found');

  const status = await getCertStatus(routerId);
  if (!force && status.valid) {
    return { action: 'already-valid', version: status.version, notAfter: status.notAfter, domain: status.domain };
  }

  const reusable = await findReusableCert(r.hotspot_dns_name);
  if (!force && reusable && reusable.router_id !== routerId) {
    const version = await reuseCertificate(reusable, routerId);
    return { action: 'reused', version, notAfter: reusable.not_after, domain: r.hotspot_dns_name };
  }

  const res = await acmeIssue(routerId, { force });
  if (res.skipped) return { action: 'busy', ...res };
  return { action: 'issued', ...res };
}
