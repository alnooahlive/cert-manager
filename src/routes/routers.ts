import { Router } from 'express';
import { query, one } from '../db';
import { authMiddleware } from '../auth';
import { generateUrlToken, generateAgentSecret } from '../acme';
import { bootstrapScript, updateScript, allInOne, ScriptContext } from '../scripts';
import { issueCertificate } from '../acme-issue';

const router = Router();
router.use(authMiddleware);

router.get('/', async (_req, res) => {
  const rows = await query(`SELECT r.*, c.name AS customer_name_full FROM routers r LEFT JOIN customers c ON c.id=r.customer_id ORDER BY r.created_at DESC`);
  res.json(rows);
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  if (!b.network_name && !b.router_name) return res.status(400).json({ error: 'network_name required' });
  if (!b.hotspot_local_ip) return res.status(400).json({ error: 'hotspot_local_ip required' });
  // allow empty -> use main domain directly (no subdomain)
  let dns = String(b.hotspot_dns_name || '').trim();
  if (dns === '') {
    const s = await one("SELECT value FROM settings WHERE key='main_domain'");
    dns = s ? s.value : 'wifiy.link';
  } else if (!dns.includes('.')) {
    const s = await one("SELECT value FROM settings WHERE key='main_domain'");
    const md = s ? s.value : 'wifiy.link';
    dns = dns + '.' + md;
  }
  b.hotspot_dns_name = dns;
  const rows = await query(
    `INSERT INTO routers(customer_id,customer_name,phone,email,router_name,ros_major,hotspot_profile,hotspot_local_ip,hotspot_dns_name,subscription_months,network_name,network_number)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [b.customer_id || null, b.owner_name || b.customer_name || null, b.owner_phone || b.phone || null, b.email || null,
     b.network_name || b.router_name || 'router', b.ros_major || null, b.hotspot_profile || 'hsprof1', b.hotspot_local_ip, b.hotspot_dns_name,
     b.subscription_months || 1, b.network_name || b.router_name, b.network_number || null]
  );
  const r = rows[0];
  const url_token = generateUrlToken();
  const agent_user = 'agent_' + r.id.slice(0,8);
  const agent_secret = generateAgentSecret();
  await query('INSERT INTO agent_credentials(router_id,url_token,agent_user,agent_secret,reveal_until) VALUES($1,$2,$3,$4,now()+interval \'24 hours\')', [r.id, url_token, agent_user, agent_secret]);
  // auto-issue certificate in background
  issueCertificate(r.id).then(res => console.log('issued cert for', r.id, res)).catch(e => console.error('issue failed for', r.id, e.message));
  res.json({ router: r, agent: { url_token, agent_user, agent_secret } });
});

router.patch('/:id', async (req, res) => {
  const b = req.body || {};
  const row = await one(
    `UPDATE routers SET
       customer_id=COALESCE($1,customer_id),
       customer_name=COALESCE($2,customer_name),
       phone=COALESCE($3,phone),
       email=COALESCE($4,email),
       router_name=COALESCE($5,router_name),
       ros_major=COALESCE($6,ros_major),
       hotspot_profile=COALESCE($7,hotspot_profile),
       hotspot_local_ip=COALESCE($8,hotspot_local_ip),
       hotspot_dns_name=COALESCE($9,hotspot_dns_name),
       subscription_months=COALESCE($10,subscription_months),
       network_name=COALESCE($11,network_name),
       network_number=COALESCE($12,network_number),
       status=COALESCE($13,status),
       renewal_enabled=COALESCE($14,renewal_enabled),
       revoked_at=CASE WHEN $13='revoked' THEN now() ELSE revoked_at END,
       updated_at=now()
     WHERE id=$15 RETURNING *`,
    [b.customer_id, b.owner_name || b.customer_name, b.owner_phone || b.phone, b.email, b.network_name || b.router_name,
     b.ros_major, b.hotspot_profile, b.hotspot_local_ip, b.hotspot_dns_name, b.subscription_months, b.network_name, b.network_number, b.status, b.renewal_enabled, req.params.id]
  );
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  await query('DELETE FROM routers WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

router.get('/:id', async (req, res) => {
  const row = await one('SELECT * FROM routers WHERE id=$1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

router.get('/:id/agent', async (req, res) => {
  const cred = await one('SELECT url_token, agent_user, agent_secret, reveal_until FROM agent_credentials WHERE router_id=$1', [req.params.id]);
  if (!cred) return res.status(404).json({ error: 'not found' });
  res.json(cred);
});

// Generate RouterOS scripts (bootstrap + update + all-in-one) for v6 or v7
router.get('/:id/scripts', async (req, res) => {
  const ros = parseInt(String(req.query.ros || '7'), 10) === 6 ? 6 : 7;
  const r = await one('SELECT * FROM routers WHERE id=$1', [req.params.id]);
  if (!r) return res.status(404).json({ error: 'not found' });
  const cred = await one('SELECT url_token, agent_user, agent_secret FROM agent_credentials WHERE router_id=$1', [req.params.id]);
  if (!cred) return res.status(404).json({ error: 'agent not found' });
  const ctx: ScriptContext = {
    router_name: r.network_name || r.router_name || 'router',
    ros_major: ros,
    hotspot_profile: r.hotspot_profile,
    hotspot_dns_name: r.hotspot_dns_name,
    hotspot_local_ip: r.hotspot_local_ip,
    agent_host: process.env.AGENT_HOST || 'hotspotmikrotik.alnooah.pro',
    url_token: cred.url_token,
    agent_user: cred.agent_user,
    agent_secret: cred.agent_secret,
    template_version: '1',
  };
  res.json({
    ros,
    bootstrap: bootstrapScript(ctx),
    update: updateScript(ctx),
    allInOne: allInOne(ctx),
  });
});

// (legacy) single script
router.get('/:id/script', async (req, res) => {
  const ros = String(req.query.ros || '7');
  const r = await one('SELECT * FROM routers WHERE id=$1', [req.params.id]);
  if (!r) return res.status(404).json({ error: 'not found' });
  const cred = await one('SELECT url_token, agent_user, agent_secret FROM agent_credentials WHERE router_id=$1', [req.params.id]);
  const agent_host = process.env.AGENT_HOST || 'hotspotmikrotik.alnooah.pro';
  const base = `https://${agent_host}/agent/v1/${cred.url_token}`;
  const ver = ros === '6' ? '6' : '7';
  const script = `# hs-cert bootstrap - ${r.router_name} - ROS ${ver}
# 1) DNS static
/ip dns static add name=${r.hotspot_dns_name} address=${r.hotspot_local_ip} type=A comment="hs-cert"

# 2) Hotspot profile
/ip hotspot profile set [find where name=${r.hotspot_profile}] dns-name=${r.hotspot_dns_name} login-by=https,http-chap
${ros === '6' ? '/ip hotspot profile set [find where name=' + r.hotspot_profile + '] https-redirect=no' : ''}

# 3) Agent fetch credentials (keep secret)
# base=${base}
# user=${cred.agent_user}
# pass=${cred.agent_secret}

# 4) Import script hs-cert-update (see docs) and run once.
# version check:
# /tool fetch url=${base}/version.txt user=${cred.agent_user} password=${cred.agent_secret} check-certificate=yes dst-path=hs-ver.txt
`;
  res.type('text/plain').send(script);
});

router.post('/:id/issue', async (req, res) => {
  // return immediately; run issuance in background
  res.json({ ok: true, status: 'started' });
  issueCertificate(req.params.id)
    .then(r => console.log('[issue] completed for', req.params.id, r))
    .catch(e => console.error('[issue] FAILED for', req.params.id, e.message));
});

export default router;
