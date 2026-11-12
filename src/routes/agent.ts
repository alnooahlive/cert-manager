import { Router } from 'express';
import { query, one } from '../db';

const router = Router();

// resolve creds by url_token, with serial verification
async function resolve(token: string, providedSerial?: string) {
  const cred = await one('SELECT * FROM agent_credentials WHERE url_token=$1', [token]);
  if (!cred) return null;
  const r = await one('SELECT status, renewal_enabled, serial_number FROM routers WHERE id=$1', [cred.router_id]);
  if (!r || r.status !== 'active' || r.renewal_enabled === false) return null;
  // serial verification: if router has a registered serial, the provided one must match
  if (r.serial_number && providedSerial && r.serial_number !== providedSerial) return null;
  return { cred, router: r };
}

function checkAuth(req: any, cred: any) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Basic ')) {
    const dec = Buffer.from(auth.slice(6), 'base64').toString();
    const [uu, pp] = dec.split(':');
    if (uu === cred.agent_user && pp === cred.agent_secret) return true;
  }
  if (req.headers['x-agent-user'] === cred.agent_user && req.headers['x-agent-pass'] === cred.agent_secret) return true;
  if (req.query.fuser === cred.agent_user && req.query.fpass === cred.agent_secret) return true;
  if (req.query.user === cred.agent_user && req.query.password === cred.agent_secret) return true;
  return false;
}

function getSerial(req: any): string | undefined {
  const h = req.headers['x-router-serial'];
  if (h) return String(h).trim();
  if (req.body && req.body.serial) return String(req.body.serial).trim();
  if (req.query.serial) return String(req.query.serial).trim();
  return undefined;
}

router.get('/:token/version.txt', async (req, res) => {
  const serial = getSerial(req);
  const ctx = await resolve(req.params.token, serial);
  if (!ctx) return res.status(404).send('not found');
  if (!checkAuth(req, ctx.cred)) return res.status(403).send('forbidden');
  const cert = await one('SELECT version FROM certificates WHERE router_id=$1 AND status=\'issued\' ORDER BY version DESC LIMIT 1', [ctx.cred.router_id]);
  const ver = cert ? String(cert.version) : '0';
  res.type('text/plain').send(ver);
});

router.get('/:token/fullchain.pem', async (req, res) => {
  const serial = getSerial(req);
  const ctx = await resolve(req.params.token, serial);
  if (!ctx) return res.status(404).send('not found');
  if (!checkAuth(req, ctx.cred)) return res.status(403).send('forbidden');
  const cert = await one('SELECT fullchain_pem FROM certificates WHERE router_id=$1 AND status=\'issued\' ORDER BY version DESC LIMIT 1', [ctx.cred.router_id]);
  res.type('text/plain').send(cert?.fullchain_pem || '');
});

router.get('/:token/privkey.pem', async (req, res) => {
  const serial = getSerial(req);
  const ctx = await resolve(req.params.token, serial);
  if (!ctx) return res.status(404).send('not found');
  if (!checkAuth(req, ctx.cred)) return res.status(403).send('forbidden');
  const cert = await one('SELECT privkey_pem FROM certificates WHERE router_id=$1 AND status=\'issued\' ORDER BY version DESC LIMIT 1', [ctx.cred.router_id]);
  res.type('text/plain').send(cert?.privkey_pem || '');
});

router.get('/:token/update.rsc', async (req, res) => {
  const serial = getSerial(req);
  const ctx = await resolve(req.params.token, serial);
  if (!ctx) return res.status(404).send('not found');
  if (!checkAuth(req, ctx.cred)) return res.status(403).send('forbidden');
  const router = await one('SELECT * FROM routers WHERE id=$1', [ctx.cred.router_id]);
  const agent_host = process.env.AGENT_HOST || 'hotspotmikrotik.alnooah.pro';
  const { updateScript } = await import('../scripts');
  const scrCtx = {
    router_name: router.network_name || router.router_name || 'router',
    ros_major: router.ros_major || 6,
    hotspot_profile: router.hotspot_profile,
    hotspot_dns_name: router.hotspot_dns_name,
    hotspot_local_ip: router.hotspot_local_ip,
    agent_host,
    url_token: ctx.cred.url_token,
    agent_user: ctx.cred.agent_user,
    agent_secret: ctx.cred.agent_secret,
    template_version: '1',
  };
  const script = updateScript(scrCtx as any);
  res.type('text/plain').send(script);
});

// Report serial number (auto-detect from router)
router.post('/:token/serial', async (req, res) => {
  const serial = getSerial(req);
  if (!serial) return res.status(400).json({ error: 'serial required' });
  const cred = await one('SELECT * FROM agent_credentials WHERE url_token=$1', [req.params.token]);
  if (!cred) return res.status(404).json({ error: 'not found' });
  if (!checkAuth(req, cred)) return res.status(403).json({ error: 'forbidden' });
  // store serial if not set; verify if set
  const r = await one('SELECT serial_number FROM routers WHERE id=$1', [cred.router_id]);
  if (r && r.serial_number && r.serial_number !== serial) {
    return res.status(403).json({ error: 'serial mismatch' });
  }
  await query('UPDATE routers SET serial_number=$1, serial_verified=true WHERE id=$2', [serial, cred.router_id]);
  await query('UPDATE agent_credentials SET serial_number=$1 WHERE router_id=$2', [serial, cred.router_id]);
  res.json({ ok: true, serial });
});

router.get('/:token/ack', async (req, res) => {
  const serial = getSerial(req);
  const ctx = await resolve(req.params.token, serial);
  if (!ctx) return res.status(404).send('not found');
  if (!checkAuth(req, ctx.cred)) return res.status(403).send('forbidden');
  const v = parseInt(req.query.v as string, 10) || 0;
  const ok = req.query.ok === '1';
  const step = String(req.query.step || '');
  await query('INSERT INTO acks(router_id,version,ok,step) VALUES($1,$2,$3,$4)', [ctx.cred.router_id, v, ok, step]);
  if (ok && step === 'bind') {
    await query('UPDATE certificates SET last_applied_version=$1 WHERE router_id=$2', [v, ctx.cred.router_id]);
  }
  // verify serial on bind
  if (serial) {
    const r = await one('SELECT serial_number FROM routers WHERE id=$1', [ctx.cred.router_id]);
    if (r && r.serial_number && r.serial_number !== serial) {
      return res.status(403).send('serial mismatch');
    }
    if (!r?.serial_number) {
      await query('UPDATE routers SET serial_number=$1, serial_verified=true WHERE id=$2', [serial, ctx.cred.router_id]);
    }
  }
  res.type('text/plain').send('ok');
});

export default router;
