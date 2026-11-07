import { Router } from 'express';
import { query, one } from '../db';
import { authMiddleware } from '../auth';
import { generateUrlToken, generateAgentSecret } from '../acme';

const router = Router();
router.use(authMiddleware);

router.get('/', async (_req, res) => {
  const rows = await query('SELECT * FROM routers ORDER BY created_at DESC');
  res.json(rows);
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  const rows = await query(
    `INSERT INTO routers(customer_name,phone,email,router_name,ros_major,hotspot_profile,hotspot_local_ip,hotspot_dns_name,subscription_months,network_name,network_number)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [b.owner_name || b.customer_name, b.owner_phone || b.phone, b.email, b.network_name || b.router_name, b.ros_major || 7, b.hotspot_profile, b.hotspot_local_ip, b.hotspot_dns_name, b.subscription_months || 1, b.network_name, b.network_number]
  );
  const r = rows[0];
  const url_token = generateUrlToken();
  const agent_user = 'agent_' + r.id.slice(0,8);
  const agent_secret = generateAgentSecret();
  await query('INSERT INTO agent_credentials(router_id,url_token,agent_user,agent_secret,reveal_until) VALUES($1,$2,$3,$4,now()+interval \'24 hours\')', [r.id, url_token, agent_user, agent_secret]);
  res.json({ router: r, agent: { url_token, agent_user, agent_secret } });
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

export default router;
