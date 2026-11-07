const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const CF_ZONE = process.env.CLOUDFLARE_ZONE_ID || '';

export async function cfRequest(path: string, init?: any) {
  const res = await (globalThis as any).fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { 'Authorization': `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  return res.json();
}

export async function ensureARecord(name: string, ip: string, proxied = false) {
  // check existing
  const list: any = await cfRequest(`/zones/${CF_ZONE}/dns_records?type=A&name=${encodeURIComponent(name)}`);
  if (list.success && Array.isArray(list.result) && list.result.length > 0) {
    const rec = list.result[0];
    if (rec.content !== ip) {
      await cfRequest(`/zones/${CF_ZONE}/dns_records/${rec.id}`, { method: 'PUT', body: JSON.stringify({ type: 'A', name, content: ip, proxied, ttl: 120 }) });
    }
    return rec.id;
  }
  const created: any = await cfRequest(`/zones/${CF_ZONE}/dns_records`, { method: 'POST', body: JSON.stringify({ type: 'A', name, content: ip, proxied, ttl: 120 }) });
  if (!created.success) throw new Error(JSON.stringify(created.errors));
  return created.result.id;
}

export async function checkDns(name: string) {
  const r: any = await cfRequest(`/zones/${CF_ZONE}/dns_records?type=A&name=${encodeURIComponent(name)}`);
  return r;
}
