// The one Cloudflare zone that owns every hotspot domain.
// Networks may use the apex itself or any subdomain under it.
export const BASE_DOMAIN = 'wifiy.link';

// Legacy alias kept for older code paths / imports.
export const FORCED_DOMAIN = BASE_DOMAIN;

// Origin behind Cloudflare (used by DNS audit / repair when no explicit IP is given).
export const ORIGIN_IP = process.env.ORIGIN_IP || '167.233.173.163';

/**
 * Normalize a hotspot domain supplied by the dashboard / API.
 *
 * Accepted:
 *   - wifiy.link            (apex)
 *   - anything.wifiy.link   (one or more labels below the apex)
 *   - empty / undefined     (defaults to apex)
 *
 * Rejected: external domains, wildcards, schemes, paths, malformed labels.
 * Returns null when the value was provided but invalid.
 */
export function normalizeDomain(input: unknown): string | null {
  let value = String(input ?? '').trim().toLowerCase();
  if (!value) return BASE_DOMAIN;

  // Be defensive: strip a scheme, path, port or trailing dot if pasted.
  value = value.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].replace(/\.$/, '');

  if (value === BASE_DOMAIN) return BASE_DOMAIN;
  if (!value.endsWith('.' + BASE_DOMAIN)) return null;

  const prefix = value.slice(0, -(BASE_DOMAIN.length + 1));
  if (!prefix || prefix.includes('*') || prefix.includes('..') ||
      prefix.startsWith('.') || prefix.endsWith('.') ||
      /[^a-z0-9.-]/.test(prefix)) return null;

  // Each label must be valid DNS label (letters/digits/hyphen, no leading/trailing hyphen).
  for (const label of prefix.split('.')) {
    if (!label || label.startsWith('-') || label.endsWith('-') || !/^[a-z0-9-]+$/.test(label)) return null;
  }
  return value;
}

/** Domains covered by the single shared certificate. */
export function certificateNames(): string[] {
  return [BASE_DOMAIN, `*.${BASE_DOMAIN}`];
}
