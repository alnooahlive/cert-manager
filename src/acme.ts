// ACME / certificate helpers (skeleton). Real issuance uses a worker + acme client.
export function generateAgentSecret(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export function generateUrlToken(): string {
  return (global as any).crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
}

export function validateCertPem(fullchain: string, privkey: string): { ok: boolean; reason?: string } {
  if (!fullchain.includes('BEGIN CERTIFICATE')) return { ok: false, reason: 'no cert' };
  if (!privkey.includes('PRIVATE KEY')) return { ok: false, reason: 'no key' };
  return { ok: true };
}
