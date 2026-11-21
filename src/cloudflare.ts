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

// The two records required for apex + subdomain use:
//   wifiy.link     -> origin (proxied)
//   *.wifiy.link   -> origin (proxied)
function expectedNames(domain: string): string[] {
  return [domain, `*.${domain}`];
}

// Detect configuration drift: stray A records, leftover TXT, wrong IP/proxy.
export async function auditDns(domain: string, expectedIp?: string) {
  const recs = await allRecords();
  const names = expectedNames(domain);
  const issues: string[] = [];

  for (const name of names) {
    const matches = recs.filter((r: any) => r.name === name && r.type === 'A');
    if (matches.length !== 1) {
      issues.push(`سجل A للنطاق ${name}: ${matches.length} بدل واحد`);
      continue;
    }
    if (expectedIp && matches[0].content !== expectedIp) {
      issues.push(`عنوان IP الحالي لـ ${name} هو ${matches[0].content} بدل ${expectedIp}`);
    }
    if (matches[0].proxied !== true) issues.push(`سجل ${name} غير محمي بوكيل Cloudflare`);
  }

  const stray = recs.filter((r: any) => r.type === 'A' && !names.includes(r.name));
  if (stray.length) issues.push(`سجلات A فرعية زائدة: ${stray.map((r: any) => r.name).join(', ')}`);
  const txt = recs.filter((r: any) => r.type === 'TXT' && String(r.name).includes('_acme-challenge'));
  if (txt.length) issues.push(`سجلات TXT عالقة: ${txt.length}`);
  return { ok: issues.length === 0, issues, totalRecords: recs.length };
}

// Restore the expected apex + wildcard DNS layout without touching zone settings.
export async function repairDns(domain: string, expectedIp?: string) {
  const recs = await allRecords();
  const names = expectedNames(domain);
  const apex = recs.filter((r: any) => r.name === domain && r.type === 'A');
  const wildcard = recs.filter((r: any) => r.name === `*.${domain}` && r.type === 'A');
  const ip = expectedIp || apex[0]?.content || wildcard[0]?.content;
  if (!ip) throw new Error('لا يوجد عنوان IP معروف — أرسل ip صريحاً');

  for (const r of recs) {
    const keepId = r.name === domain ? apex[0]?.id : wildcard[0]?.id;
    const isStrayA = r.type === 'A' && !names.includes(r.name);
    const isStaleTxt = r.type === 'TXT' && String(r.name).includes('_acme-challenge');
    const isDuplicate = r.type === 'A' && names.includes(r.name) && r.id !== keepId;
    if (isStrayA || isStaleTxt || isDuplicate) {
      await cfRequest(`/zones/${CF_ZONE}/dns_records/${r.id}`, { method: 'DELETE' });
    }
  }

  for (const name of names) {
    const list = name === domain ? apex : wildcard;
    if (list.length === 0) {
      await cfRequest(`/zones/${CF_ZONE}/dns_records`, {
        method: 'POST',
        body: JSON.stringify({ type: 'A', name, content: ip, proxied: true, ttl: 120 }),
      });
    } else if (list[0].content !== ip || list[0].proxied !== true) {
      await cfRequest(`/zones/${CF_ZONE}/dns_records/${list[0].id}`, {
        method: 'PUT',
        body: JSON.stringify({ type: 'A', name, content: ip, proxied: true, ttl: 120 }),
      });
    }
  }
  return auditDns(domain, ip);
}
