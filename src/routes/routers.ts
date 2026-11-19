import { Router } from 'express';
import { query, one } from '../db';
import { authMiddleware } from '../auth';
import { generateUrlToken, generateAgentSecret } from '../acme';
import { bootstrapScript, updateScript, allInOne, ScriptContext } from '../scripts';
import { ensureCertificate, getCertStatus, tryReuseForRouter } from '../cert-service';
import { FORCED_DOMAIN } from '../config';

const router = Router();
router.use(authMiddleware);

router.get('/', async (_req, res) => {
  const rows = await query(`SELECT r.*, c.name AS customer_name_full FROM routers r LEFT JOIN customers c ON c.id=r.customer_id ORDER BY r.created_at DESC`);
  res.json(rows);
});

// One-time repair: force every router to the apex domain and attach a valid apex certificate (no ACME, no TXT)
router.post('/force-apex', async (req, res) => {
  const domain = FORCED_DOMAIN;
  const source = await one(
    `SELECT c.* FROM certificates c JOIN routers r ON r.id=c.router_id
     WHERE r.hotspot_dns_name=$1 AND c.status='issued' AND c.not_after>now()
     ORDER BY c.not_after DESC LIMIT 1`, [domain]);
  const rows = await query('SELECT id,hotspot_dns_name FROM routers');
  const explicit: string[] = Array.isArray(req.body?.router_ids) ? req.body.router_ids : [];
  const changed = Array.from(new Set([...rows.filter(r => r.hotspot_dns_name !== domain).map(r => r.id), ...explicit]));
  if (!source && changed.length) return res.status(400).json({ error: 'لا توجد شهادة صالحة للنطاق الأساسي' });
  await query("INSERT INTO settings(key,value) VALUES('main_domain',$1) ON CONFLICT (key) DO UPDATE SET value=$1", [domain]);
  if (changed.length) {
    await query('UPDATE routers SET hotspot_dns_name=$1 WHERE hotspot_dns_name IS DISTINCT FROM $1', [domain]);
  }
  let certsReplaced = 0;
  for (const cid of changed) {
    await query("UPDATE certificates SET status='revoked',renewal_enabled=false WHERE router_id=$1 AND status='issued'", [cid]);
    const last = await one('SELECT COALESCE(MAX(version),0) AS v FROM certificates WHERE router_id=$1', [cid]);
    await query(
      `INSERT INTO certificates(router_id,version,status,source,acme_managed,fullchain_pem,privkey_pem,not_before,not_after,renewal_enabled)
       VALUES($1,$2,'issued','reused',true,$3,$4,$5,$6,true)`,
      [cid, (last?.v || 0) + 1, source.fullchain_pem, source.privkey_pem, source.not_before, source.not_after]
    );
    certsReplaced++;
  }
  res.json({ ok: true, domain, routers: rows.length, renamed: changed.length, certsReplaced });
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  if (!b.network_name && !b.router_name) return res.status(400).json({ error: 'network_name required' });
  if (!b.hotspot_local_ip) return res.status(400).json({ error: 'hotspot_local_ip required' });
  // unified apex domain: any subdomain input is ignored
  b.hotspot_dns_name = FORCED_DOMAIN;
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
  // NO automatic ACME issuance. Only reuse an existing valid cert for the same domain.
  let cert: any = null;
  try { cert = await tryReuseForRouter(r.id); }
  catch (e: any) { console.error('[router] reuse check failed', r.id, e.message); }
  res.json({ router: r, agent: { url_token, agent_user, agent_secret }, cert });
});

router.patch('/:id', async (req, res) => {
  const b = req.body || {};
  b.hotspot_dns_name = FORCED_DOMAIN;
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

// Check current certificate state (used by the UI button before any action)
router.get('/:id/certificate', async (req, res) => {
  res.json(await getCertStatus(req.params.id));
});

// Create server certificate: validates first, reuses same-domain cert, or issues new (never blind duplicate)
router.post('/:id/issue', async (req, res) => {
  const force = req.body?.force === true;
  const before = await getCertStatus(req.params.id);
  if (!force && before.valid) {
    return res.json({ ok: true, status: 'already-valid', certificate: before });
  }
  res.json({ ok: true, status: 'started', force });
  ensureCertificate(req.params.id, { force })
    .then(r => console.log('[issue] completed for', req.params.id, r))
    .catch(e => console.error('[issue] FAILED for', req.params.id, e.message));
});

export default router;
