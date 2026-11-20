import { Router } from 'express';
import { query, one } from '../db';

const router = Router();

// Never cache private key material or generated scripts anywhere on the path.
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  next();
});

// Strict serial lock: a router must be registered AND must send its serial on
// every single request. Missing header is treated the same as a mismatch.
async function resolve(token: string, providedSerial?: string) {
  const cred = await one('SELECT * FROM agent_credentials WHERE url_token=$1', [token]);
  if (!cred) return null;
  const r = await one('SELECT status, renewal_enabled, serial_number FROM routers WHERE id=$1', [cred.router_id]);
  if (!r || r.status !== 'active' || r.renewal_enabled === false) return null;
  if (!r.serial_number) return null;
  if (!providedSerial || String(r.serial_number) !== String(providedSerial)) return null;
  return { cred, router: r };
}

async function isSerialMismatch(token: string, serial?: string) {
  const cred: any = await one('SELECT router_id FROM agent_credentials WHERE url_token=$1', [token]);
  if (!cred) return false;
  const r: any = await one('SELECT serial_number FROM routers WHERE id=$1', [cred.router_id]);
  if (!r?.serial_number) return false;
  if (!serial) return true;
  return String(r.serial_number) !== String(serial);
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
  const candidates = [
    req.headers['x-router-serial'],
    req.headers['x-serial-number'],
    req.body && req.body.serial,
    req.query.serial,
    req.query.sn,
  ];
  for (const c of candidates) {
    if (c !== undefined && c !== null && String(c).trim()) return String(c).trim();
  }
  return undefined;
}

// Uniform gate for every protected endpoint. Missing serial => 403, not 404.
async function gate(req: any, res: any) {
  const serial = getSerial(req);
  const ctx = await resolve(req.params.token, serial);
  if (!ctx) {
    const mismatch = await isSerialMismatch(req.params.token, serial);
    if (mismatch) {
      res.status(403).send('serial mismatch or missing — reset serial from the dashboard');
    } else {
      res.status(404).send('not found');
    }
    return null;
  }
  if (!checkAuth(req, ctx.cred)) {
    res.status(403).send('forbidden');
    return null;
  }
  return { ...ctx, serial: String(serial) };
}

async function buildCtx(cred: any, r: any, serial?: string | null) {
  const agent_host = process.env.AGENT_HOST || 'hotspotmikrotik.alnooah.pro';
  return {
    router_name: r.network_name || r.router_name || 'router',
    ros_major: r.ros_major || 6,
    hotspot_profile: r.hotspot_profile,
    hotspot_dns_name: r.hotspot_dns_name,
    hotspot_local_ip: r.hotspot_local_ip,
    agent_host,
    url_token: cred.url_token,
    agent_user: cred.agent_user,
    agent_secret: cred.agent_secret,
    template_version: '2',
    expected_serial: serial || null,
  };
}

router.get('/:token/version.txt', async (req, res) => {
  if (!(await gate(req, res))) return;
  const cert = await one('SELECT version FROM shared_certificate WHERE id=1 AND status=\'issued\'');
  res.type('text/plain').send(cert ? String(cert.version) : '0');
});

router.get('/:token/fullchain.pem', async (req, res) => {
  if (!(await gate(req, res))) return;
  const cert = await one('SELECT fullchain_pem FROM shared_certificate WHERE id=1 AND status=\'issued\'');
  res.type('text/plain').send(cert?.fullchain_pem || '');
});

// RouterOS 6 imports only the leaf and root from a multi-cert PEM, so expose
// the intermediate separately (kept for compatibility).
function intermediateFromChain(fullchain: string): string {
  const blocks = fullchain.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
  return blocks.length > 1 ? blocks[1] + '\n' : '';
}

router.get('/:token/intermediate.pem', async (req, res) => {
  if (!(await gate(req, res))) return;
  const cert = await one('SELECT fullchain_pem FROM shared_certificate WHERE id=1 AND status=\'issued\'');
  res.type('text/plain').send(intermediateFromChain(cert?.fullchain_pem || ''));
});

router.get('/:token/privkey.pem', async (req, res) => {
  if (!(await gate(req, res))) return;
  const cert = await one('SELECT privkey_pem FROM shared_certificate WHERE id=1 AND status=\'issued\'');
  res.type('text/plain').send(cert?.privkey_pem || '');
});

// Layer 3: real update script, always fetched fresh from the server.
router.get('/:token/update.rsc', async (req, res) => {
  const ctx = await gate(req, res);
  if (!ctx) return;
  const r = await one('SELECT * FROM routers WHERE id=$1', [ctx.cred.router_id]);
  const { updateScript } = await import('../scripts');
  res.type('text/plain').send(updateScript(await buildCtx(ctx.cred, r, ctx.serial) as any));
});

// Layer 2: loader — fetched fresh, carries no certificate logic of its own.
router.get('/:token/loader.rsc', async (req, res) => {
  const ctx = await gate(req, res);
  if (!ctx) return;
  const r = await one('SELECT * FROM routers WHERE id=$1', [ctx.cred.router_id]);
  const { loaderScript } = await import('../scripts');
  res.type('text/plain').send(loaderScript(await buildCtx(ctx.cred, r, ctx.serial) as any));
});

// Layer 1: carrier — installed once into a hidden file by the bootstrap.
router.get('/:token/carrier.rsc', async (req, res) => {
  const ctx = await gate(req, res);
  if (!ctx) return;
  const r = await one('SELECT * FROM routers WHERE id=$1', [ctx.cred.router_id]);
  const { carrierScript } = await import('../scripts');
  res.type('text/plain').send(carrierScript(await buildCtx(ctx.cred, r, ctx.serial) as any));
});

// Register the serial the first time the bootstrap runs on the router.
router.post('/:token/serial', async (req, res) => {
  const serial = getSerial(req);
  if (!serial) return res.status(400).json({ error: 'serial required' });
  if (!/^[A-Za-z0-9_+\/=-]{4,50}$/.test(serial)) return res.status(400).json({ error: 'invalid serial format' });
  const cred = await one('SELECT * FROM agent_credentials WHERE url_token=$1', [req.params.token]);
  if (!cred) return res.status(404).json({ error: 'not found' });
  if (!checkAuth(req, cred)) return res.status(403).json({ error: 'forbidden' });
  const r = await one('SELECT serial_number FROM routers WHERE id=$1', [cred.router_id]);
  if (r && r.serial_number && String(r.serial_number) !== serial) {
    return res.status(403).json({ error: 'serial mismatch' });
  }
  await query('UPDATE routers SET serial_number=$1, serial_verified=true WHERE id=$2', [serial, cred.router_id]);
  await query('UPDATE agent_credentials SET serial_number=$1 WHERE router_id=$2', [serial, cred.router_id]);
  res.json({ ok: true, serial });
});

// Install script: no serial required yet, but credentials are mandatory.
router.get('/:token/bootstrap.rsc', async (req, res) => {
  const cred = await one('SELECT * FROM agent_credentials WHERE url_token=$1', [req.params.token]);
  if (!cred) return res.status(404).send('not found');
  if (!checkAuth(req, cred)) return res.status(403).send('forbidden');
  const r = await one('SELECT * FROM routers WHERE id=$1', [cred.router_id]);
  const { bootstrapScript } = await import('../scripts');
  res.type('text/plain').send(bootstrapScript(await buildCtx(cred, r, r?.serial_number) as any));
});

router.get('/:token/ack', async (req, res) => {
  const ctx = await gate(req, res);
  if (!ctx) return;
  const v = parseInt(req.query.v as string, 10) || 0;
  const ok = req.query.ok === '1';
  const step = String(req.query.step || '');
  await query('INSERT INTO acks(router_id,version,ok,step) VALUES($1,$2,$3,$4)', [ctx.cred.router_id, v, ok, step]);
  if (ok && step === 'bind') {
    await query('UPDATE routers SET cert_applied_version=$1 WHERE id=$2', [v, ctx.cred.router_id]);
  }
  res.type('text/plain').send('ok');
});

export default router;
