// Smoke verification script
// Usage: BASE_URL=https://... ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/verify.js
const BASE = process.env.BASE_URL || 'https://hotspotmikrotik.alnooah.pro';
const EMAIL = process.env.ADMIN_EMAIL || 'admin@alnooah.pro';
const PASSWORD = process.env.ADMIN_PASSWORD || 'Admin123!ChangeMe';

let token = '';
let passed = 0, failed = 0;

async function req(path, opts = {}) {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d };
}

function check(name, cond, info = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name} ${info}`); }
}

async function main() {
  console.log('Verifying', BASE);
  // health
  let r = await req('/health');
  check('health 200', r.status === 200 && r.data.status === 'ok', JSON.stringify(r.data));

  // login
  r = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  check('login 200', r.status === 200 && r.data.ok, JSON.stringify(r.data));
  token = r.data.token || '';

  // unauth
  const saved = token; token = '';
  r = await req('/api/routers');
  check('unauth 401', r.status === 401);
  token = saved;

  // list routers
  r = await req('/api/routers');
  check('routers list 200', r.status === 200 && Array.isArray(r.data));

  // create router
  r = await req('/api/routers', { method: 'POST', body: JSON.stringify({
    network_name: 'verify-net', network_number: '99', hotspot_local_ip: '192.168.99.1',
    hotspot_dns_name: 'verify.alnooah.pro', hotspot_profile: 'hsprof1', subscription_months: 1,
  }) });
  check('create router 200', r.status === 200 && r.data.router?.id, JSON.stringify(r.data));
  const rid = r.data.router?.id;

  // agent blocked? no, active -> version 0
  if (rid) {
    const cred = r.data.agent;
    const b64 = Buffer.from(cred.agent_user + ':' + cred.agent_secret).toString('base64');
    const ar = await fetch(BASE + '/agent/v1/' + cred.url_token + '/version.txt', { headers: { Authorization: 'Basic ' + b64 } });
    check('agent version.txt 200', ar.status === 200, String(ar.status));

    // disable
    await req('/api/routers/' + rid, { method: 'PATCH', body: JSON.stringify({ status: 'disabled' }) });
    const ar2 = await fetch(BASE + '/agent/v1/' + cred.url_token + '/version.txt', { headers: { Authorization: 'Basic ' + b64 } });
    check('disabled blocks agent (non-200)', ar2.status !== 200, String(ar2.status));

    // re-enable + delete
    await req('/api/routers/' + rid, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) });
    const dr = await req('/api/routers/' + rid, { method: 'DELETE' });
    check('delete router 200', dr.status === 200, JSON.stringify(dr.data));
  }

  // cloudflare check
  r = await req('/api/cloudflare/check?name=hotspotmikrotik.alnooah.pro');
  check('cloudflare check 200', r.status === 200 && r.data.success, JSON.stringify(r.data).slice(0, 120));

  // frontend
  r = await req('/login');
  check('login page 200', r.status === 200);
  r = await req('/dashboard');
  check('dashboard page 200', r.status === 200);
  r = await req('/health');
  check('health page 200', r.status === 200);

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
