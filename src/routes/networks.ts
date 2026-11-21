import { Router } from 'express';
import { query, one } from '../db';
import { authMiddleware } from '../auth';
import { generateUrlToken, generateAgentSecret } from '../acme';
import { tryReuseForRouter } from '../cert-service';
import { BASE_DOMAIN, normalizeDomain } from '../config';

const router = Router();
router.use(authMiddleware);

// Add owner + network + credentials in ONE request
router.post('/', async (req, res) => {
  const b = req.body || {};
  const name = String(b.network_name || b.router_name || '').trim();
  if (!name) return res.status(400).json({ error: 'اسم الشبكة مطلوب' });
  if (!b.hotspot_local_ip) return res.status(400).json({ error: 'IP المحلي للموجه مطلوب' });

  // Each network may use the apex or any subdomain under it.
  const dnsName = normalizeDomain(b.hotspot_dns_name);
  if (!dnsName) return res.status(400).json({ error: `الدومين يجب أن يكون ${BASE_DOMAIN} أو نطاقاً فرعياً تحته` });

  const owner = String(b.owner_name || '').trim();
  let customer: any = null;
  if (owner) {
    const c = await query(
      'INSERT INTO customers(name,phone,email,router_count) VALUES($1,$2,$3,1) RETURNING *',
      [owner, b.owner_phone || null, b.owner_email || null]
    );
    customer = c[0];
  }

  const rows = await query(
    `INSERT INTO routers(customer_id,customer_name,phone,email,router_name,ros_major,hotspot_profile,hotspot_local_ip,hotspot_dns_name,subscription_months,network_name,network_number,status,renewal_enabled)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active',true) RETURNING *`,
    [customer?.id || null, owner || null, b.owner_phone || null, b.owner_email || null,
     name, b.ros_major || null, b.hotspot_profile || 'hsprof1', b.hotspot_local_ip,
     dnsName, b.subscription_months || 1, name, b.network_number || null]
  );
  const r = rows[0];

  const url_token = generateUrlToken();
  const agent_user = 'agent_' + r.id.slice(0, 8);
  const agent_secret = generateAgentSecret();
  await query(
    'INSERT INTO agent_credentials(router_id,url_token,agent_user,agent_secret,reveal_until) VALUES($1,$2,$3,$4,now()+interval \'24 hours\')',
    [r.id, url_token, agent_user, agent_secret]
  );

  let cert: any = null;
  try { cert = await tryReuseForRouter(r.id); }
  catch (e: any) { console.error('[network] reuse failed', r.id, e.message); }

  res.json({ router: r, customer, agent: { url_token, agent_user, agent_secret }, cert });
});

// Get combined data for the edit form
router.get('/:id', async (req, res) => {
  const r = await one('SELECT * FROM routers WHERE id=$1', [req.params.id]);
  if (!r) return res.status(404).json({ error: 'not found' });
  const customer = r.customer_id ? await one('SELECT * FROM customers WHERE id=$1', [r.customer_id]) : null;
  res.json({ router: r, customer });
});

// Edit owner + network together
router.patch('/:id', async (req, res) => {
  const b = req.body || {};
  const existing = await one('SELECT * FROM routers WHERE id=$1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'not found' });

  // When a domain is supplied it must belong to the base zone; otherwise keep the current one.
  const dnsName = b.hotspot_dns_name !== undefined
    ? normalizeDomain(b.hotspot_dns_name)
    : existing.hotspot_dns_name;
  if (!dnsName) return res.status(400).json({ error: `الدومين يجب أن يكون ${BASE_DOMAIN} أو نطاقاً فرعياً تحته` });

  const owner = String(b.owner_name || '').trim();
  if (existing.customer_id) {
    await query(
      'UPDATE customers SET name=COALESCE($1,name),phone=COALESCE($2,phone),email=COALESCE($3,email),updated_at=now() WHERE id=$4',
      [owner || null, b.owner_phone || null, b.owner_email || null, existing.customer_id]
    );
  }

  const row = await one(
    `UPDATE routers SET
       customer_name=COALESCE($1,customer_name),
       phone=COALESCE($2,phone),
       email=COALESCE($3,email),
       router_name=COALESCE($4,router_name),
       hotspot_profile=COALESCE($5,hotspot_profile),
       hotspot_local_ip=COALESCE($6,hotspot_local_ip),
       hotspot_dns_name=$7,
       subscription_months=COALESCE($8,subscription_months),
       network_name=COALESCE($9,network_name),
       network_number=COALESCE($10,network_number),
       updated_at=now()
     WHERE id=$11 RETURNING *`,
    [owner || null, b.owner_phone || null, b.owner_email || null,
     b.network_name || null, b.hotspot_profile || null, b.hotspot_local_ip || null,
     dnsName, b.subscription_months || null, b.network_name || null, b.network_number || null,
     req.params.id]
  );
  const customer = row?.customer_id ? await one('SELECT * FROM customers WHERE id=$1', [row.customer_id]) : null;
  res.json({ router: row, customer });
});

export default router;
