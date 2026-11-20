import { Router } from 'express';
import { authMiddleware } from '../auth';
import { getSharedCertStatus, ensureSharedCertificate } from '../cert-service';
import { FORCED_DOMAIN } from '../config';

const router = Router();
router.use(authMiddleware);

router.get('/', async (_req, res) => {
  res.json({ ...(await getSharedCertStatus()), domain: FORCED_DOMAIN });
});

// Create (first time) or renew the ONE shared certificate. No router id involved.
router.post('/issue', async (req, res) => {
  const force = req.body?.force === true;
  const before = await getSharedCertStatus();
  if (!force && before.valid) {
    return res.json({ ok: true, status: 'already-valid', certificate: before });
  }
  const result = await ensureSharedCertificate({ force });
  res.json({ ok: true, status: result.action, certificate: await getSharedCertStatus() });
});

export default router;
