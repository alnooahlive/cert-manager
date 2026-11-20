const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const CF_ZONE = process.env.CLOUDFLARE_ZONE_ID || '';

export async function cfRequest(path: string, init?: any) {
  const res = await (globalThis as any).fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { 'Authorization': `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  return res.json();
}

export async function ensureARecord(name: string, ip: string, proxied = (process.env.CLOUDFLARE_PROXIED === 'true')) {
  // check existing
  const list: any = await cfRequest(`/zones/${CF_ZONE}/dns_records?type=A&name=${encodeURIComponent(name)}`);
  if (list.success && Array.isArray(list.result) && list.result.length > 0) {
    const rec = list.result[0];
    if (rec.content !== ip || rec.proxied !== proxied) {
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

async function allRecords() {
  const r: any = await cfRequest(`/zones/${CF_ZONE}/dns_records?per_page=200`);
  if (!r.success) throw new Error(JSON.stringify(r.errors));
  return r.result || [];
}

// Detect configuration drift: stray subdomains, leftover TXT, wrong apex IP/proxy.
export async function auditDns(domain: string, expectedIp?: string) {
  const recs = await allRecords();
  const apex = recs.filter((r: any) => r.name === domain && r.type === 'A');
  const issues: string[] = [];
  if (apex.length !== 1) issues.push(`سجل A للنطاق ${domain}: ${apex.length} بدل واحد`);
  else {
    if (expectedIp && apex[0].content !== expectedIp) issues.push(`عنوان IP الحالي ${apex[0].content} بدل ${expectedIp}`);
    if (apex[0].proxied !== true) issues.push('السجل غير محمي بوكيل Cloudflare');
  }
  const stray = recs.filter((r: any) => r.type === 'A' && r.name !== domain);
  if (stray.length) issues.push(`سجلات A فرعية زائدة: ${stray.map((r: any) => r.name).join(', ')}`);
  const txt = recs.filter((r: any) => r.type === 'TXT' && String(r.name).includes('_acme-challenge'));
  if (txt.length) issues.push(`سجلات TXT عالقة: ${txt.length}`);
  return { ok: issues.length === 0, issues, totalRecords: recs.length };
}

// Restore the expected single-domain DNS layout without touching zone settings.
export async function repairDns(domain: string, expectedIp?: string) {
  const recs = await allRecords();
  const apex = recs.filter((r: any) => r.name === domain && r.type === 'A');
  const ip = expectedIp || apex[0]?.content;
  if (!ip) throw new Error('لا يوجد عنوان IP معروف — أرسل ip صريحاً');

  for (const r of recs) {
    const isStrayA = r.type === 'A' && r.name !== domain;
    const isStaleTxt = r.type === 'TXT' && String(r.name).includes('_acme-challenge');
    const isDuplicateApex = r.type === 'A' && r.name === domain && r.id !== apex[0]?.id;
    if (isStrayA || isStaleTxt || isDuplicateApex) {
      await cfRequest(`/zones/${CF_ZONE}/dns_records/${r.id}`, { method: 'DELETE' });
    }
  }
  if (apex.length === 0) {
    await cfRequest(`/zones/${CF_ZONE}/dns_records`, {
      method: 'POST',
      body: JSON.stringify({ type: 'A', name: domain, content: ip, proxied: true, ttl: 120 }),
    });
  } else if (apex[0].content !== ip || apex[0].proxied !== true) {
    await cfRequest(`/zones/${CF_ZONE}/dns_records/${apex[0].id}`, {
      method: 'PUT',
      body: JSON.stringify({ type: 'A', name: domain, content: ip, proxied: true, ttl: 120 }),
    });
  }
  return auditDns(domain, ip);
}
