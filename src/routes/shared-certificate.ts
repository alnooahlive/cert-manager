import { Router } from 'express';
import { query, one } from '../db';
import { authMiddleware } from '../auth';
import { getSharedCertStatus, ensureSharedCertificate } from '../cert-service';
import { BASE_DOMAIN, certificateNames } from '../config';

const router = Router();
router.use(authMiddleware);

// ACME issuance can take longer than the reverse-proxy timeout, so it runs in
// the background and the caller polls GET /api/shared-certificate for the result.
let issuingInFlight = false;

router.get('/', async (_req, res) => {
  res.json({ ...(await getSharedCertStatus()), domain: BASE_DOMAIN, covers: certificateNames() });
});

// Create (first time) or renew the ONE shared certificate. No router id involved.
router.post('/issue', async (req, res) => {
  const force = req.body?.force === true;
  const before = await getSharedCertStatus();
  if (!force && before.valid) {
    return res.json({ ok: true, status: 'already-valid', certificate: before, domain: BASE_DOMAIN, covers: certificateNames() });
  }
  if (issuingInFlight) {
    return res.json({ ok: true, status: 'queued', message: 'إصدار الشهادة جارٍ بالفعل — انتظر النتيجة', domain: BASE_DOMAIN, covers: certificateNames() });
  }
  issuingInFlight = true;
  // Do not await: the HTTP response must return before ACME finishes.
  void ensureSharedCertificate({ force }).catch(e => console.error('[shared-certificate] background issue failed', e?.message || e)).finally(() => {
    issuingInFlight = false;
  });
  res.json({
    ok: true,
    status: 'queued',
    message: 'بدأ إصدار الشهادة المشتركة — جارٍ المتابعة...',
    domain: BASE_DOMAIN,
    covers: certificateNames(),
  });
});

// Restore/import an existing valid certificate for the unified domain (no ACME call).
router.post('/import', async (req, res) => {
  const { fullchain_pem, privkey_pem, not_before, not_after } = req.body || {};
  if (!fullchain_pem || !privkey_pem) {
    return res.status(400).json({ error: 'fullchain_pem و privkey_pem مطلوبان' });
  }
  if (!String(fullchain_pem).includes('BEGIN CERTIFICATE') || !String(privkey_pem).includes('PRIVATE KEY')) {
    return res.status(400).json({ error: 'صيغة الشهادة أو المفتاح غير صحيحة' });
  }
  const last = await one('SELECT version FROM shared_certificate WHERE id=1');
  const version = (last?.version || 0) + 1;
  await query(
    `UPDATE shared_certificate SET
       version=$1,status='issued',source='restored',fullchain_pem=$2,privkey_pem=$3,
       not_before=COALESCE($4,now()),not_after=COALESCE($5,now()+interval '80 days'),
       last_error=NULL,issuing_at=NULL,updated_at=now()
     WHERE id=1`,
    [version, fullchain_pem, privkey_pem, not_before || null, not_after || null]
  );
  res.json({ ok: true, status: 'imported', domain: BASE_DOMAIN, covers: certificateNames(), certificate: await getSharedCertStatus() });
});

export default router;
