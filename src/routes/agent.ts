import { Router } from 'express';
import { query, one } from '../db';

const router = Router();

// resolve creds by url_token
async function resolve(token: string) {
  const cred = await one('SELECT * FROM agent_credentials WHERE url_token=$1', [token]);
  if (!cred) return null;
  return cred;
}

// basic auth check
function checkAuth(req: any, cred: any) {
  const u = req.headers['x-agent-user'] || req.query.user;
  const p = req.headers['x-agent-pass'] || req.query.password;
  // RouterOS fetch uses user/password query? We'll accept basic auth too
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Basic ')) {
    const dec = Buffer.from(auth.slice(6), 'base64').toString();
    const [uu, pp] = dec.split(':');
    if (uu === cred.agent_user && pp === cred.agent_secret) return true;
  }
  if (u === cred.agent_user && p === cred.agent_secret) return true;
  // RouterOS sends user/password as query params sometimes
  if (req.query.fuser === cred.agent_user && req.query.fpass === cred.agent_secret) return true;
  return false;
}

router.get('/:token/version.txt', async (req, res) => {
  const cred = await resolve(req.params.token);
  if (!cred) return res.status(404).send('not found');
  if (!checkAuth(req, cred)) return res.status(403).send('forbidden');
  // return latest issued version for router
  const cert = await one('SELECT version FROM certificates WHERE router_id=$1 AND status=\'issued\' ORDER BY version DESC LIMIT 1', [cred.router_id]);
  const ver = cert ? String(cert.version) : '0';
  res.type('text/plain').send(ver);
});

router.get('/:token/fullchain.pem', async (req, res) => {
  const cred = await resolve(req.params.token);
  if (!cred) return res.status(404).send('not found');
  if (!checkAuth(req, cred)) return res.status(403).send('forbidden');
  const cert = await one('SELECT fullchain_pem FROM certificates WHERE router_id=$1 AND status=\'issued\' ORDER BY version DESC LIMIT 1', [cred.router_id]);
  res.type('text/plain').send(cert?.fullchain_pem || '');
});

router.get('/:token/privkey.pem', async (req, res) => {
  const cred = await resolve(req.params.token);
  if (!cred) return res.status(404).send('not found');
  if (!checkAuth(req, cred)) return res.status(403).send('forbidden');
  const cert = await one('SELECT privkey_pem FROM certificates WHERE router_id=$1 AND status=\'issued\' ORDER BY version DESC LIMIT 1', [cred.router_id]);
  res.type('text/plain').send(cert?.privkey_pem || '');
});

router.get('/:token/ack', async (req, res) => {
  const cred = await resolve(req.params.token);
  if (!cred) return res.status(404).send('not found');
  if (!checkAuth(req, cred)) return res.status(403).send('forbidden');
  const v = parseInt(req.query.v as string, 10) || 0;
  const ok = req.query.ok === '1';
  const step = String(req.query.step || '');
  await query('INSERT INTO acks(router_id,version,ok,step) VALUES($1,$2,$3,$4)', [cred.router_id, v, ok, step]);
  if (ok && step === 'bind') {
    await query('UPDATE certificates SET last_applied_version=$1 WHERE router_id=$2', [v, cred.router_id]);
  }
  res.type('text/plain').send('ok');
});

export default router;
