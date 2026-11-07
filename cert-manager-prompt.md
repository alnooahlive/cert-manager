# برومبت: منصة إدارة شهادات SSL لهوت سبوت ميكروتيك (Cert Manager)

> هذا الملف مكتوب ليُعطى كما هو لوكيل برمجة (مثل Claude Code) أو لمطوّر، لبناء الخدمة كاملة.
> اللغة: التعليمات بالعربية، والأكواد والأسماء التقنية بالإنجليزية.
> الوسوم: **[موثّق]** = وجدت له مصدراً أثناء البحث. **[غير موثّق]** = من معرفة عامة أو من تأليفي، ويجب التحقق منه قبل الاعتماد عليه.

---

## 0. كيف تستخدم هذا الملف

1. افتح مشروعاً جديداً (مستودع Git فارغ) وأعطِ الوكيل هذا الملف كاملاً.
2. قبل أن يبدأ الوكيل بالكتابة يجب أن يقرأ القسم 17 (الأسئلة المفتوحة) ويطلب جوابها منك. إن لم تُجب فليعتمد الافتراضات المكتوبة هناك ويسجلها في `ASSUMPTIONS.md`.
3. اطلب من الوكيل العمل على مراحل (القسم 18) وأن يتوقف بعد كل مرحلة ليعرض ما أنجزه.
4. **لا تقبل من الوكيل عبارة "تم الاختبار" على سكربتات الراوتر** إلا إذا جرّبها فعلاً على RouterOS 6 و7 (CHR على جهاز افتراضي مثلاً). انظر القسم 15.

---

## 1. الهدف والسياق

نريد خدمة ويب خاصة (تُنشر على خادم **Coolify** لدينا) تدير شهادات SSL الموثوقة (Let's Encrypt) لصفحات تسجيل الدخول في **Hotspot ميكروتيك** عند عملاء متعددين، بحيث:

- لوحة تحكم محمية بتسجيل دخول، فيها **المشتركون (العملاء)** بأسمائهم وروابطهم وتواريخ اشتراكاتهم من قاعدة بيانات **PostgreSQL**.
- إضافة مشترك بتاريخ بداية ونهاية، **تجديد يدوي** أو **تجديد تلقائي** (لعميل واحد أو للجميع)، وإيقاف خدمة من انتهى اشتراكه ولم يجدد.
- إصدار الشهادات وتجديدها تلقائياً بتحدي **DNS-01** عبر **Cloudflare API**.
- **توليد سكربتات جاهزة** لكل راوتر (RouterOS 6 وRouterOS 7) تسحب الشهادة من الخدمة وتستوردها وتربطها ببروفايل الهوت سبوت.
- **التحكم في Cloudflare** من اللوحة: فحص التوكن، إنشاء وحذف سجلات DNS اللازمة.
- كل التفاصيل (الأسماء، الروابط، الأوامر) تُولَّد تلقائياً من البيانات المدخلة بحيث لا يكتب المشغّل أي أمر يدوياً.

### الوضع الشبكي (مهم جداً)

- الراوترات **بلا IP عام** (خلف CGNAT)، فلا يمكن للخادم أن يتصل بها. **الراوتر هو من يبدأ الاتصال دائماً** (يسحب).
- الإصدارات **مختلطة**: بعض الراوترات RouterOS 6 وبعضها 7.
- اسم خادم الخدمة (للراوترات): `hotspotmikrotik.alnooah.pro` ويشير إلى IP الخادم.
- أسماء صفحات الهوت سبوت تكون **تحت الدومين الرئيسي مباشرة** مثل `wifi.alnooah.pro` أو `c12-r1.alnooah.pro`، **وليس** تحت `hotspotmikrotik.alnooah.pro`. السبب: الراوتر يحلّ اسم الخادم عبر DNS الخاص به، فلو أضفنا سجلاً محلياً ثابتاً لاسم الهوت سبوت تحت نفس الاسم لانكسر السحب (استنتاجي، **[غير موثّق]**).
- أسماء الهوت سبوت **لا تحتاج سجل A عام**؛ يكفي سجل DNS ثابت داخل كل راوتر يوجّه الاسم إلى عنوان الراوتر المحلي. التحقق بـ DNS-01 يحتاج سجل TXT فقط.

---

## 2. حقائق ملزمة (لا تخالفها في التصميم)

### 2.1 عن RouterOS

1. **[موثّق]** مدير الشهادات المدمج في RouterOS يدعم HTTP-01 فقط ويحتاج منفذ 80 من الإنترنت. **DNS-01 غير مدعوم أصلياً**، والخيار الوحيد هو إصدار الشهادة خارج الراوتر ثم نقلها إليه. لذلك: **لا تحاول جعل الراوتر يصدر الشهادة بنفسه.**
2. **[موثّق]** `/tool fetch` **لا يتحقق من شهادة TLS افتراضياً.** يجب كتابة `check-certificate=yes` في **كل** استدعاء، وإلا يستطيع منتحل أن يعطي الراوتر شهادة ومفتاحاً مزيفين.
3. **[موثّق]** التحقق من مفتاح المضيف في SFTP داخل `fetch` مغلق افتراضياً، لذلك نستخدم **HTTPS فقط** ولا نستخدم SFTP.
4. **[موثّق]** شهادات ECDSA/ECC من Let's Encrypt أعطت مشاكل مع RouterOS (استيراد ناجح لكن انقطاع اتصال في www-ssl)، وشهادة RSA عملت بلا مشاكل. **اطلب دائماً شهادة RSA 2048** (مثلاً `-k rsa2048` في lego، `--key-type rsa` في certbot، **[غير موثّق]** تحقق من الخيار الدقيق).
5. **[موثّق]** RouterOS 6.x لا يدعم مفاتيح SSH من نوع ed25519. لا يهمنا هنا لأن التصميم لا يستخدم SSH، لكن **لا تضف أي ميزة SSH/SCP للراوتر** دون الرجوع للمالك.
6. **[موثّق]** عند استيراد `fullchain.pem` ينتج الراوتر شهادتين: `fullchain.pem_0` (شهادة الدومين وعليها `K` بعد استيراد المفتاح) و`fullchain.pem_1` (الوسيطة).
7. **[موثّق]** في RouterOS 6 أبلغ مستخدم عن فشل استيراد ملف جذر Let's Encrypt المتقاطع على 6.49.13. **اعتبر استيراد الشهادات على v6 نقطة خطر رئيسية** وصمّم لها اختباراً خاصاً.
8. **[موثّق]** RouterOS 7 فيه مخزن شهادات موثوقة مدمج، وفي بعض الإصدارات قد يلزم استيراد جذر ISRG يدوياً. على **RouterOS 6 غالباً لا يوجد مخزن مدمج** **[غير موثّق]**، فيجب أن يتضمن سكربت التهيئة الأولية خطوة استيراد جذر CA والتحقق من بصمته قبل تفعيل `check-certificate=yes`.
9. **[موثّق]** الهوت سبوت: `login-by` يقبل `https` و`http-chap` و`http-pap`؛ `http-pap` ترسل كلمة المرور نصاً واضحاً عبر HTTP، و`dns-name` يجب أن يكون FQDN وهو يُضاف تلقائياً كسجل DNS ثابت في ذاكرة DNS في الراوتر.
10. **[موثّق]** التحذير عند فتح موقع HTTPS قبل الدخول (بسبب اعتراض الهوت سبوت) **لا يزول بشهادة**؛ المعامل الرسمي `https-redirect=no` يرفض الطلب بدل تحويله. اجعله خياراً في اللوحة، لا افتراضاً مفروضاً.
11. **[غير موثّق]** `device-mode` في RouterOS 7 قد يعطّل ميزات مثل `fetch` أو `scheduler` أو `hotspot` حسب النمط. سكربت التهيئة يجب أن يفحص `/system device-mode print` ويطبع تحذيراً.

### 2.2 عن Cloudflare

1. **[موثّق]** سحابة Cloudflare البرتقالية (البروكسي) لا تفيد هنا، والمتصفح يتفاوض مع حافة Cloudflare لا مع الراوتر. وشهادات **Origin CA** لا يثق بها المتصفح (للاتصال Cloudflare↔الخادم فقط). **لا تستخدم Origin CA إطلاقاً لهذا المشروع.**
2. أي سجل DNS تنشئه الخدمة لاسم الهوت سبوت أو لخادم الخدمة يجب أن يكون **DNS only** (`proxied: false`). **[غير موثّق في هذه الجلسة]** لكنه شرط عملي.
3. استخدم توكن API **محدود الصلاحية**: تعديل DNS على منطقة واحدة فقط (`Zone → DNS → Edit` لمنطقة `alnooah.pro`)، ولا تستخدم Global API Key أبداً.

### 2.3 عن Let's Encrypt

1. **[غير موثّق]** حدود المعدل (Rate Limits) تُحتسب على **الدومين المسجّل** `alnooah.pro` مهما كثرت الأسماء الفرعية. اقرأ الحدود الحالية من توثيق Let's Encrypt قبل تحديد سياسة الإصدار، ولا تعتمد على أرقام من ذاكرتك.
2. استخدم **بيئة staging** لكل الاختبارات. لا تُصدر شهادات إنتاج أثناء التطوير.
3. الشهادة صالحة 90 يوماً. جدّد عند بقاء ≤ 30 يوماً (إعداد قابل للتغيير).

---

## 3. نطاق النسخة الأولى (MVP) وما هو خارجها

**داخل النطاق:**
- لوحة إدارة (مشغّل واحد أو عدة مشغّلين) بتسجيل دخول وأدوار.
- عملاء + اشتراكات + راوترات + شهادات.
- إصدار/تجديد/إلغاء شهادات آلياً عبر Cloudflare DNS-01.
- **إضافة شهادة جديدة** بطريقتين: إصدار جديد عبر ACME، أو **استيراد شهادة خارجية** (رفع الشهادة والمفتاح) مع فحوص صارمة (القسم 11.1).
- واجهة السحب للراوترات (HTTPS + مصادقة + رمز لكل راوتر).
- توليد سكربتات v6 وv7 (تهيئة أولية + تحديث دوري).
- تكامل Cloudflare (فحص التوكن، سجلات DNS).
- إشعارات انتهاء الاشتراك والشهادة (بريد أو Telegram، حسب القسم 17).
- سجل تدقيق، لوحة صحة النظام، نسخ احتياطي.

**خارج النطاق (لا تبنِها دون طلب):**
- بوابة دفع أو فوترة. "التجديد التلقائي" في هذا المشروع هو **تمديد تاريخ الاشتراك آلياً** وليس تحصيل مال (انظر القسم 4).
- بوابة للعملاء أنفسهم (قد تأتي في نسخة لاحقة).
- أي اتصال بالراوتر من الخادم (SSH أو API)، لأن الراوتر بلا IP عام.
- تشغيل سكربتات بعيدة على الراوتر (انظر 13.4).

---

## 4. المفاهيم (لا تخلط بينها)

| المفهوم | المعنى | من يتحكم |
|---|---|---|
| **اشتراك العميل** | علاقة تجارية: تاريخ بداية ونهاية، فترة (شهر/3 أشهر/سنة)، تجديد يدوي أو تلقائي | المشغّل |
| **تجديد الاشتراك** | تمديد تاريخ النهاية (يدوياً بزر، أو تلقائياً بعمل مجدول إن كان `auto_renew` مفعّلاً) | المشغّل أو المجدول |
| **شهادة SSL** | شهادة تقنية صالحة 90 يوماً، تُجدد آلياً طالما الاشتراك فعّال | النظام (ACME) |
| **تجديد الشهادة** | إصدار شهادة جديدة قبل انتهاء القديمة | النظام آلياً، ولا علاقة له بتجديد الاشتراك |

**قواعد:**
- تجديد الاشتراك **لا يُصدر** شهادة بالضرورة، وتجديد الشهادة **لا يمدد** الاشتراك.
- الشهادة لا تُجدد لعميل **اشتراكه منتهٍ** (ولو بقيت أيام على شهادته).
- التجديد التلقائي للاشتراك **لا يتحقق من دفع**. يجب أن توضح الواجهة ذلك بعبارة صريحة بجوار الزر: "تمديد تلقائي بدون تحصيل. تحصيل المبلغ مسؤوليتك".

---

## 5. التقنيات المقترحة (يمكن للوكيل تعديلها بمبرر مكتوب)

| الطبقة | الاقتراح | ملاحظة |
|---|---|---|
| اللغة | TypeScript (Node.js LTS) | |
| الواجهة الخلفية والأمامية | Next.js (App Router) أو Fastify + واجهة React منفصلة | الواجهة عربية RTL |
| قاعدة البيانات | PostgreSQL 16 | |
| ORM والهجرات | Drizzle أو Prisma | هجرات مُرقّمة وقابلة للإعادة |
| الطابور والمهام المجدولة | pg-boss (يستخدم Postgres نفسه، بلا Redis) | **[غير موثّق]** بديل: node-cron + جدول مهام |
| عميل ACME | **lego** (ملف تنفيذي Go) يستدعيه العامل، أو مكتبة ACME موثوقة | يدعم Cloudflare DNS-01 **[غير موثّق]**، تحقق |
| الحاويات | Dockerfile + `docker-compose.yml` يصلح لـ Coolify | |
| السجلات | JSON منظّمة مع إخفاء الأسرار | |
| الاختبارات | Vitest/Jest + اختبارات تكامل + Pebble (خادم ACME محلي) أو staging | |

---

## 6. نموذج البيانات (PostgreSQL)

> نقطة انطلاق. يُسمح للوكيل بتحسينها بشرط الحفاظ على المعنى، وأن تكون كل الأعمدة الحساسة مشفّرة (القسم 13).

```sql
create extension if not exists pgcrypto;
create extension if not exists citext;

create table admins (
  id uuid primary key default gen_random_uuid(),
  email citext unique not null,
  password_hash text not null,                 -- argon2id
  totp_secret_enc bytea,                       -- مشفّر
  role text not null check (role in ('owner','operator','viewer')),
  failed_logins int not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  public_ref text unique not null,             -- معرّف قصير غير تسلسلي
  name text not null,
  phone text,
  email text,
  notes text,
  status text not null default 'active'
    check (status in ('active','grace','expired','suspended')),
  created_at timestamptz not null default now()
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  plan_name text not null default 'standard',
  period_months int not null default 1 check (period_months > 0),
  starts_on date not null,
  ends_on date not null,
  auto_renew boolean not null default false,
  grace_days int not null default 3 check (grace_days >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
-- اشتراك حالي واحد لكل عميل (الأحدث)، والتاريخ في subscription_events
create unique index one_current_sub on subscriptions(customer_id);

create table subscription_events (
  id bigserial primary key,
  customer_id uuid not null references customers(id) on delete cascade,
  type text not null check (type in (
    'created','renewed_manual','renewed_auto','grace_started','expired',
    'suspended','reactivated','auto_renew_on','auto_renew_off','dates_edited')),
  from_ends_on date,
  to_ends_on date,
  actor_admin_id uuid references admins(id),   -- null = النظام
  note text,
  created_at timestamptz not null default now()
);

create table certificates (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete set null,
  domain text not null,                        -- مثال: wifi.alnooah.pro
  sans text[] not null default '{}',
  source text not null default 'acme' check (source in ('acme','imported')),
  imported_by uuid references admins(id),       -- من رفع الشهادة (للمستوردة فقط)
  acme_managed boolean not null default true,   -- false = لا تجديد تلقائي (المستوردة)
  key_type text not null default 'rsa2048' check (key_type = 'rsa2048'),
  status text not null default 'pending'
    check (status in ('pending','issued','renewing','failed','revoked')),
  version int not null default 0,              -- يزيد مع كل إصدار جديد، يقرؤه الراوتر
  serial text,
  fingerprint_sha256 text,
  not_before timestamptz,
  not_after timestamptz,
  chain_pem text,                              -- fullchain (عام)
  key_ciphertext bytea,                        -- المفتاح الخاص مشفّر
  key_nonce bytea,
  key_wrapped_dek bytea,                       -- إن استُخدم envelope encryption
  last_error text,
  issued_at timestamptz,
  next_renew_at timestamptz,
  created_at timestamptz not null default now(),
  unique (domain)
);

-- نسخ سابقة من الشهادة (للتراجع بعد الاستبدال)
create table certificate_revisions (
  id uuid primary key default gen_random_uuid(),
  certificate_id uuid not null references certificates(id) on delete cascade,
  version int not null,
  source text not null check (source in ('acme','imported')),
  serial text,
  fingerprint_sha256 text,
  not_after timestamptz,
  chain_pem text,
  key_ciphertext bytea,
  key_nonce bytea,
  key_wrapped_dek bytea,
  created_by uuid references admins(id),
  created_at timestamptz not null default now(),
  retire_after timestamptz,                    -- يحذفها retention.cleanup بعد هذا التاريخ
  unique (certificate_id, version)
);

create table routers (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  certificate_id uuid references certificates(id),
  name text not null,
  ros_major int not null check (ros_major in (6,7)),
  ros_version text,
  hotspot_profile text not null default 'hsprof1',
  hotspot_local_ip inet not null,              -- عنوان الراوتر على واجهة الهوت سبوت
  hotspot_dns_name text not null,              -- يطابق دومين الشهادة
  https_redirect boolean not null default true,
  agent_user text not null,
  agent_secret_hash text not null,             -- argon2id، لا تخزّن النص الأصلي
  agent_url_token_hash text not null,          -- hash للرمز الموجود في المسار
  enabled boolean not null default true,
  status text not null default 'created'
    check (status in ('created','awaiting_bootstrap','connected','applied','stale','disabled')),
  last_ack_at timestamptz,
  agent_secret_enc bytea,                      -- نسخة مشفرة مؤقتة لعرض السر مرة واحدة
  agent_secret_reveal_until timestamptz,       -- بعدها يُصفَّر agent_secret_enc
  last_seen_at timestamptz,
  last_seen_ip inet,
  last_applied_version int,
  created_at timestamptz not null default now()
);

create table router_fetch_log (
  id bigserial primary key,
  router_id uuid references routers(id) on delete set null,
  endpoint text not null,                      -- version | fullchain | privkey
  status_code int not null,
  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create table provisioning_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('new_cert_acme','new_cert_import','bulk_item','offboard')),
  customer_id uuid references customers(id) on delete set null,
  router_id uuid references routers(id) on delete set null,
  certificate_id uuid references certificates(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued','running','waiting','succeeded','failed','cancelled')),
  current_step text,
  params jsonb not null default '{}',          -- بدون أي أسرار
  created_by uuid references admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create table provisioning_steps (
  id bigserial primary key,
  run_id uuid not null references provisioning_runs(id) on delete cascade,
  name text not null,
  status text not null default 'pending'
    check (status in ('pending','running','waiting','succeeded','failed','skipped')),
  attempts int not null default 0,
  idempotency_key text not null,
  started_at timestamptz,
  finished_at timestamptz,
  detail_redacted text,
  error text,
  unique (run_id, name)
);

create table router_acks (
  id bigserial primary key,
  router_id uuid not null references routers(id) on delete cascade,
  version int,
  ok boolean not null,
  step text,                                   -- download | import | bind
  ip inet,
  created_at timestamptz not null default now()
);

create table cloudflare_config (
  id int primary key default 1 check (id = 1), -- صف واحد
  zone_id text,
  zone_name text,
  token_ciphertext bytea,
  token_nonce bytea,
  token_last_verified_at timestamptz,
  token_last_error text
);

create table dns_records (
  id uuid primary key default gen_random_uuid(),
  cf_record_id text unique,
  type text not null,
  name text not null,
  content text not null,
  proxied boolean not null default false check (proxied = false),
  purpose text not null check (purpose in ('server-host','acme-challenge','other')),
  created_at timestamptz not null default now()
);

create table acme_jobs (
  id uuid primary key default gen_random_uuid(),
  certificate_id uuid not null references certificates(id) on delete cascade,
  kind text not null check (kind in ('issue','renew','revoke')),
  status text not null default 'queued'
    check (status in ('queued','running','succeeded','failed','cancelled')),
  attempts int not null default 0,
  run_after timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  log_redacted text,
  error text
);

create table audit_log (
  id bigserial primary key,
  admin_id uuid references admins(id),
  action text not null,
  entity_type text,
  entity_id text,
  details jsonb,
  ip inet,
  created_at timestamptz not null default now()
);

create table settings (
  key text primary key,
  value jsonb not null
);
```

**ملاحظات على النموذج:**
- لا تخزّن كلمات المرور أو الرموز (agent secrets) بنص واضح. تُعرض للمشغّل **مرة واحدة** عند الإنشاء داخل السكربت المُولَّد، ثم تُخزَّن مجزأة فقط. إن ضاعت يُنشأ سر جديد ويُعاد توليد السكربت.
- `version` هو الرقم الذي يقارنه الراوتر مع آخر نسخة طبّقها، فلا يحمّل المفتاح الخاص إلا عند وجود نسخة جديدة. هذا يقلل مرات تعريض المفتاح.
- `proxied` مقيّد بـ `false` عمداً.

---

## 7. آلة الحالات والمهام المجدولة

### 7.1 حالة الاشتراك (تُحسب من `ends_on` والتاريخ الحالي بتوقيت UTC)

```
active   --(اليوم > ends_on، و auto_renew=true)--> تمديد تلقائي --> active
active   --(اليوم > ends_on، و auto_renew=false)--> grace (مدة grace_days)
grace    --(انتهت المهلة)--> expired
grace/expired --(تجديد يدوي)--> active
أي حالة --(إيقاف يدوي)--> suspended --(إعادة تفعيل)--> حسب التواريخ
```

- الحساب يتم **في قاعدة البيانات/المجدول** وليس في الواجهة فقط.
- كل انتقال يُسجل في `subscription_events` ويُرسل إشعاراً إن كان مفعّلاً.
- **التمديد التلقائي:** `ends_on = ends_on + period_months` (يُحسب من تاريخ النهاية الأصلي لا من تاريخ اليوم، حتى لا تُفقد أيام). احذر من نهايات الأشهر (31 يناير + شهر).

### 7.2 المهام المجدولة

| المهمة | التكرار | ما تفعله |
|---|---|---|
| `subscriptions.tick` | كل ساعة | تنقل الاشتراكات بين الحالات، تمدد التلقائية، تسجل الأحداث |
| `certs.renew-scan` | يومياً | تبحث عن الشهادات `not_after - 30 يوماً` لعملاء `active/grace` وتضيف مهمة `renew` |
| `acme.worker` | مستمر | تنفذ `issue/renew/revoke` مع إعادة محاولة تصاعدية (backoff) |
| `notify.expiry` | يومياً | تنبّه قبل 7 و3 و1 يوم من انتهاء الاشتراك، وقبل 14 و7 و3 أيام من انتهاء الشهادة إن فشل التجديد |
| `routers.stale-scan` | يومياً | تنبّه إن لم يتصل راوتر فعّال منذ أكثر من 3 أيام |
| `cloudflare.healthcheck` | كل 6 ساعات | تتحقق من صلاحية التوكن والمنطقة |
| `retention.cleanup` | أسبوعياً | تحذف `router_fetch_log` الأقدم من المدة المحددة (افتراضياً 90 يوماً) |

### 7.3 عند انتهاء الاشتراك دون تجديد (سلوك الإيقاف)

1. تتوقف الخدمة عن **إصدار وتجديد** شهادات العميل.
2. نقاط السحب للعميل تردّ `403` برسالة قصيرة (لا تكشف تفاصيل).
3. **تحذير جوهري:** الشهادة التي حمّلها الراوتر من قبل **تبقى صالحة حتى انتهائها** (حتى 90 يوماً). لا يوجد إيقاف فوري حقيقي. الإلغاء (`revoke`) عبر ACME ممكن، لكن **المتصفحات لا تعتمد غالباً على فحص الإلغاء بشكل موثوق** **[غير موثّق]**. يجب أن تقول الواجهة ذلك بوضوح للمشغّل.
4. خيار في الإعدادات: `revoke_after_expired_days` (افتراضياً معطّل). عند تفعيله تُلغى الشهادة بعد N يوماً من الانتهاء.
5. تسجيل كل ذلك في `audit_log`.

---

## 8. واجهات API

### 8.1 واجهة الراوتر (HTTPS فقط، بدون جلسات)

```
GET /agent/v1/{url_token}/version.txt     -> نص: رقم النسخة فقط، بلا سطر جديد في النهاية
GET /agent/v1/{url_token}/fullchain.pem   -> الشهادة + الوسيطة
GET /agent/v1/{url_token}/privkey.pem     -> المفتاح الخاص (الأكثر حساسية)
GET /agent/v1/{url_token}/ack?v={version}&ok={0|1}&step={download|import|bind}   -> إبلاغ من الراوتر بنتيجة التطبيق (ردّ فارغ 204)
```

**القواعد:**
- مصادقة **HTTP Basic** (مستخدم وسر الراوتر) **بالإضافة** إلى رمز عشوائي طويل (256 بت) في المسار.
- أي خطأ (رمز غير معروف، سر خاطئ) يعيد `404` موحداً، لا `401` ولا `403`، حتى لا يُعرف أن الرمز موجود.
- عند اشتراك منتهٍ أو راوتر معطّل: `403`.
- لا تُرجع `privkey.pem` إلا إذا كانت الشهادة بحالة `issued` والاشتراك `active/grace`.
- تحديد معدل الطلبات لكل رمز ولكل IP. الراوترات خلف CGNAT قد تتشارك IP، فلا تحجب بالـ IP وحده.
- سجّل كل طلب في `router_fetch_log` (بدون الأسرار).
- ترويسات: `Cache-Control: no-store`، `Content-Type: text/plain`.
- حدّث `last_seen_at` و`last_seen_ip` عند أي طلب ناجح. **نجاح التطبيق يُعرف من نقطة `ack` فقط** (لا من قراءة الملفين): عند `ok=1` يُحدَّث `last_applied_version` و`last_ack_at` وتصير الحالة `applied`، وعند `ok=0` تُسجَّل الخطوة الفاشلة وتُرسل تنبيه. أول طلب `version.txt` من راوتر في حالة `awaiting_bootstrap` ينقله إلى `connected`. نقطة `ack` تقبل قيم `v/ok/step` محددة فقط وتتجاهل أي مدخلات أخرى.

### 8.2 واجهة اللوحة (تحتاج جلسة مشغّل)

| المسار | الوظيفة |
|---|---|
| `POST /auth/login` | تسجيل الدخول (مع TOTP إن كان مفعّلاً) |
| `GET/POST/PATCH /customers` | العملاء |
| `POST /customers/{id}/renew` | تجديد يدوي: `{months}` أو `{ends_on}` |
| `POST /customers/{id}/auto-renew` | تفعيل/تعطيل التجديد التلقائي لعميل |
| `POST /customers/auto-renew/bulk` | تفعيل/تعطيل لكل العملاء أو لمجموعة محددة |
| `GET/POST/PATCH /routers` | الراوترات |
| `GET /routers/{id}/scripts?ros=6|7` | توليد سكربتات التهيئة والتحديث (القسم 12) |
| `POST /routers/{id}/rotate-secret` | تدوير سر الراوتر وإعادة توليد السكربت |
| `POST /certificates/{id}/reissue` | إعادة إصدار يدوية |
| `POST /certificates/{id}/revoke` | إلغاء |
| `POST /certificates` | إضافة شهادة جديدة بإصدار ACME: `{domain, customer_id, router_ids[]}` |
| `POST /certificates/import/validate` | **فحص فقط** لشهادة ومفتاح مرفوعين، بدون حفظ، ويعيد تقرير الفحوص (القسم 11.1) |
| `POST /certificates/import` | استيراد شهادة خارجية بعد نجاح الفحص: `{fullchain_pem, private_key_pem, key_passphrase?, domain, router_ids[]}` |
| `POST /certificates/{id}/rollback` | العودة إلى نسخة سابقة من `certificate_revisions` |
| `POST /certificates/{id}/attach` | ربط شهادة موجودة براوتر آخر (بعد التحقق من تطابق الاسم) |
| `GET/PUT /cloudflare` | حالة وإعداد Cloudflare |
| `POST /cloudflare/verify` | فحص التوكن والمنطقة |
| `POST /cloudflare/records` | إنشاء سجل DNS (مثل سجل خادم الخدمة) |
| `GET /audit`, `GET /jobs`, `GET /health` | السجلات والصحة |

---

## 9. لوحة التحكم (واجهة عربية RTL)

### 9.1 صفحات

1. **تسجيل الدخول**: بريد وكلمة مرور + رمز TOTP. قفل مؤقت بعد محاولات فاشلة. لا رسائل تكشف هل البريد موجود.
2. **نظرة عامة**: عدد العملاء حسب الحالة، اشتراكات تنتهي خلال 7 أيام، شهادات تنتهي خلال 14 يوماً، مهام فاشلة، آخر اتصال للراوترات، حالة Cloudflare.
3. **العملاء** (جدول من قاعدة البيانات): الاسم، الحالة، تاريخ النهاية وعدّاد الأيام، التجديد التلقائي (مفتاح تبديل)، عدد الراوترات، حالة الشهادة، **الروابط** (رابط صفحة العميل في اللوحة، ورابط سكربت كل راوتر)، وإجراءات: تجديد (+1 شهر، +3، +12، تاريخ مخصص)، إيقاف/تفعيل، حذف.
   - بحث وفلترة بالحالة وبالتاريخ، وتصدير CSV.
   - إجراء **جماعي**: تحديد عدة عملاء ثم تجديد أو تفعيل/تعطيل التجديد التلقائي، مع نافذة تأكيد تعرض عدد المتأثرين.
4. **تفاصيل عميل**: بيانات، تاريخ الاشتراك (`subscription_events`)، الراوترات، الشهادات.
5. **الراوتر**: اسم، إصدار RouterOS (6/7)، `hotspot_profile`، `hotspot_local_ip`، `hotspot_dns_name`، آخر اتصال، آخر نسخة طُبّقت، **زر توليد السكربتات** (تهيئة + تحديث) بنسخ سريع وتنبيهات واضحة، وزر تدوير السر.
6. **الشهادات**: الدومين، المصدر (`ACME` أو `مستوردة`)، الحالة، `not_after` وعدّاد الأيام، الإصدار، عدد الراوترات التي لم تطبّق النسخة الحالية بعد، آخر خطأ، وأزرار: إعادة الإصدار، إلغاء، تراجع إلى نسخة سابقة.
   - زر **"إضافة شهادة جديدة"** يفتح معالجاً من ثلاث خطوات (القسم 11.1): (1) اختيار الطريقة: إصدار جديد، أو استيراد، (2) الإدخال والفحص، (3) اختيار الراوترات المرتبطة وتأكيد النشر.
7. **Cloudflare**: حالة التوكن، المنطقة، سجلات DNS التي أنشأها النظام، زر فحص، زر إنشاء سجل خادم الخدمة.
8. **المهام والسجلات**: `acme_jobs` مع سجلات منقّحة من الأسرار، و`audit_log`.
9. **الإعدادات**: المهلة الافتراضية، إشعارات، مدة الاحتفاظ، المنطقة الزمنية للعرض، سياسة الإلغاء، وحدود الإضافة الآلية (القسم 11.2).
10. **الإضافة الآلية (Provisioning)**: قائمة الدفعات والإضافات مع **شريط تقدّم حيّ** لكل خطوة، وأزرار: إعادة محاولة خطوة، إلغاء، استئناف، ونافذة **عرض سر الراوتر مرة واحدة** مع زر نسخ سكربت اللصق الواحد.

### 9.2 سلوك واجهة مهم

- **التواريخ تُخزَّن UTC** وتُعرض بالمنطقة الزمنية المضبوطة في الإعدادات.
- أي إجراء مدمّر (حذف عميل، إلغاء شهادة، تعطيل جماعي) يطلب تأكيداً مكتوباً.
- بجوار زر "تجديد تلقائي" نصّ ثابت: "تمديد تلقائي لتاريخ الاشتراك فقط، دون تحصيل مبلغ".
- كلمات السر والأسرار لا تظهر في الواجهة بعد الإنشاء الأول.
- لا تعرض المفتاح الخاص للشهادة في أي شاشة.

---

## 10. تكامل Cloudflare

### 10.1 ما يجب أن تفعله الخدمة

1. **فحص التوكن**: استدعاء نقطة التحقق من التوكن في Cloudflare ثم التأكد من الوصول إلى المنطقة المطلوبة (`alnooah.pro`). **[غير موثّق]** راجع توثيق Cloudflare API الحالي لأسماء النقاط.
2. **إنشاء سجل خادم الخدمة**: سجل `A` للاسم `hotspotmikrotik.alnooah.pro` يشير إلى IP الخادم، `proxied=false`.
3. **سجلات التحدي**: تتولاها مكتبة ACME (lego) تلقائياً بإنشاء `_acme-challenge` TXT ثم حذفه. **لا تُنشئ هذه السجلات يدوياً**.
4. **لا تُنشئ سجل A عام لأسماء الهوت سبوت** (مثل `wifi.alnooah.pro`) إلا إذا طلب المالك صراحةً. الحل المحلي هو سجل DNS ثابت في الراوتر.
5. إدارة الأخطاء: التوكن منتهٍ، الصلاحية ناقصة، المنطقة خاطئة، حد معدل Cloudflare.

### 10.2 أمان التوكن

- يُخزَّن **مشفراً** في قاعدة البيانات، وفك التشفير فقط لحظة الاستخدام.
- لا يُطبع في السجلات ولا في رسائل الأخطاء.
- تدوير التوكن من اللوحة بدون توقف الخدمة.
- **اختياري (تحصين، غير موثّق):** تفويض `_acme-challenge` عبر CNAME إلى منطقة مخصصة للتحديات لتقليل صلاحيات التوكن.

---

## 11. تكامل ACME (الإصدار والتجديد)

1. حساب ACME واحد (بريد المالك)، مفتاح الحساب يُخزَّن مشفراً.
2. نوع المفتاح: **RSA 2048** فقط (القسم 2.1 البند 4).
3. التحقق: DNS-01 عبر Cloudflare.
4. عند النجاح:
   - تخزين `chain_pem`، والمفتاح مشفراً، و`serial`، و`fingerprint_sha256`، و`not_before/not_after`.
   - `version = version + 1` **داخل معاملة واحدة** مع حفظ الشهادة.
   - جدولة `next_renew_at = not_after - 30 يوماً`.
5. عند الفشل: `status='failed'` (إن لم توجد شهادة صالحة)، وإعادة محاولة تصاعدية (مثلاً 15 دقيقة، ساعة، 6 ساعات، يوم)، وإشعار للمشغّل بعد 3 إخفاقات. **لا تحذف الشهادة الصالحة القديمة عند فشل التجديد.**
6. الوضع: متغير `ACME_ENV=staging|production`. الافتراضي `staging` حتى يضبطه المالك.
7. اختبار محلي بخادم Pebble أو staging، **ولا اختبار على الإنتاج**.
8. عدم إصدار شهادة لعميل اشتراكه `expired/suspended`.
9. **سياسة الأسماء:** الخدمة تدعم خيارين لكل عميل:
   - **شهادة لكل راوتر/عميل** (عزل المفتاح، الافتراضي المقترح).
   - **شهادة مشتركة** لعدة راوترات لنفس العميل (أبسط، لكن المفتاح يُنسخ إلى كل راوتر).
   - تأكد من أن `routers.hotspot_dns_name` يطابق دومين الشهادة دائماً (تحقق في الواجهة والـ API).

### 11.1 إضافة شهادة جديدة (إصدار أو استيراد)

الزر في صفحة الشهادات يدعم **طريقتين** تنتهيان بنفس النتيجة: صف في `certificates` بحالة `issued` ورقم `version` جديد تسحبه الراوترات.

#### الطريقة أ: إصدار جديد عبر ACME
1. المشغّل يختار العميل والدومين (مثل `wifi.alnooah.pro`) والراوترات التي ستستخدمه.
2. تتحقق الخدمة: الدومين تحت المنطقة المضبوطة في Cloudflare، لا يوجد صف آخر بنفس الدومين (أو يُعرض خيار "استبدال")، واشتراك العميل `active/grace`.
3. تُنشأ مهمة `issue` (القسم 11) وتُعرض حالتها مباشرة في الواجهة.

#### الطريقة ب: استيراد شهادة خارجية (مشتراة أو من جهة أخرى)
المدخلات: `fullchain.pem` (الشهادة + الوسيطات)، `privkey.pem`، وعبارة مرور المفتاح إن كان مشفراً. يُسمح بالرفع كملفات أو بلصق النص.

**فحوص إلزامية قبل الحفظ (كلها تظهر في تقرير واضح، والفشل في أي فحص "حاجز" يمنع الحفظ):**

| # | الفحص | النوع |
|---|---|---|
| 1 | الملفات PEM صالحة، والحجم الإجمالي أقل من 64 كيلوبايت | حاجز |
| 2 | **المفتاح يطابق الشهادة** (مقارنة المفتاح العام المشتق من المفتاح الخاص مع مفتاح الشهادة) | حاجز |
| 3 | **نوع المفتاح RSA** وحجمه 2048 بت أو أكثر. ECDSA/EC مرفوض (مشاكل موثّقة مع RouterOS) | حاجز |
| 4 | الاسم المطلوب موجود في SAN (والمطابقة تدعم wildcard بمستوى واحد فقط) | حاجز |
| 5 | الشهادة سارية: `not_before` ≤ الآن < `not_after` | حاجز |
| 6 | **السلسلة كاملة**: شهادة الدومين ثم الوسيطات بالترتيب الصحيح، وتنتهي بسلسلة تُبنى إلى جذر موثوق في مخزن النظام | حاجز (مع إمكانية قبول بتأكيد صريح وتحذير) |
| 7 | الشهادة ليست موقعة ذاتياً، وإلا تحذير كبير أن المتصفحات ستعرض تحذيراً (يُسمح بها بتأكيد صريح للاختبار فقط) | تحذير |
| 8 | `not_after` أبعد من 14 يوماً، وإلا تحذير | تحذير |
| 9 | المفتاح غير مشفّر أو أُدخلت عبارة المرور الصحيحة. تُفكّ العبارة في الذاكرة فقط، **ولا تُخزَّن**، والمفتاح يُخزَّن مشفراً بتشفير الخدمة (القسم 13.1) لا بعبارة المستورد | حاجز |
| 10 | بصمة SHA-256 للشهادة غير موجودة مسبقاً (منع تكرار نفس الشهادة) | تحذير |

**قواعد الأمان في الاستيراد:**
- لا يُسمح إلا لدور `owner`، وتُطلب **إعادة إدخال كلمة المرور/TOTP** (step-up) قبل الحفظ.
- الملفات المرفوعة بيانات **غير موثوقة**: تُحلَّل بمكتبة تشفير موثوقة (مثل `node:crypto` `X509Certificate`) ولا تُمرَّر إلى أي أمر في الصدفة (shell) إطلاقاً.
- **لا تجلب الخدمة وسيطات من الإنترنت تلقائياً** (مثل AIA fetching) تفادياً لـ SSRF. المطلوب سلسلة كاملة من المستخدم.
- لا تُسجَّل محتويات الملفات ولا عبارة المرور في أي سجل (ولا في `audit_log`، يُسجَّل فقط: من استورد، متى، الدومين، البصمة).
- الرفع عبر HTTPS فقط، مع `Cache-Control: no-store`، ويُحذف أي ملف مؤقت فور المعالجة (الأفضل ألا يُكتب على القرص).

#### بعد الإضافة (للطريقتين)
1. **شهادة جديدة لدومين غير موجود:** صف جديد في `certificates`، `version = 1`، وربط الراوترات المختارة (تتحقق الواجهة أن `routers.hotspot_dns_name` يطابق الدومين).
2. **شهادة جديدة لدومين له شهادة حالية (استبدال):**
   - تُنقل المادة الحالية إلى `certificate_revisions` وتحتفظ بها مدة `retire_after` (إعداد، افتراضياً 30 يوماً).
   - تُكتب المادة الجديدة في الصف الحالي، ويزيد `version` **داخل معاملة واحدة**.
   - **لا تُحذف الشهادة القديمة قبل نجاح الجديدة** (نفس مبدأ سكربت الراوتر).
3. تظهر في اللوحة عبارة "بانتظار النشر: N راوتر" حتى يطبّقها كل راوتر (`last_applied_version = version`). الراوترات تسحبها تلقائياً في دورتها اليومية، وإن أراد المشغّل التسريع يشغّل السكربت يدوياً على الراوتر (تعرض اللوحة الأمر).
4. **الشهادات المستوردة** (`source='imported'`, `acme_managed=false`):
   - **لا تُجدَّد تلقائياً.** تنبيهات انتهاء أشد: قبل 30 و14 و7 و3 و1 يوم.
   - خيار "تحويل إلى ACME": يُصدر شهادة ACME لنفس الدومين ويستبدلها (بعد تأكيد).
5. **التراجع:** من `POST /certificates/{id}/rollback` تعود النسخة السابقة بالرقم `version` **الأعلى** (لا يُعاد استخدام رقم قديم)، لأن الراوتر يقارن بالتساوي ولا يعرف الترتيب.

**قاعدة مهمة للتراجع:** الراوتر يطبّق أي نسخة يختلف رقمها عن آخر نسخة طبّقها. لذلك التراجع ينسخ مادة النسخة القديمة إلى `version` جديد أكبر، ولا يعيد رقماً سابقاً.

### 11.2 خط الإضافة الآلي (Auto-provisioning): "أضف شهادة جديدة" وكل ما يتبعها يعمل وحده

**الهدف:** ضغطة واحدة على "إضافة" (أو رفع ملف CSV لعدة راوترات) تُنفّذ كل ما يتبعها آلياً: Cloudflare، الإصدار أو الاستيراد، التحقق، النشر، توليد السكربتات، التنبيه، ثم متابعة وصول الشهادة إلى الراوتر وتطبيقها. وتبقى **خطوة يدوية واحدة فقط**: لصق سكربت على الراوتر (القسم "ما لا يمكن أتمتته" أدناه).

#### المبادئ الهندسية (إلزامية)
1. كل إضافة = صف في `provisioning_runs` وخطواته في `provisioning_steps`.
2. **كل خطوة idempotent**: تعيد التشغيل نفس الأثر دون تكرار (مفتاح `idempotency_key = run_id + step`). لا تنشئ سجل DNS أو راوتراً أو شهادة مرتين.
3. **الاستئناف بعد الانهيار:** عند إعادة تشغيل العامل يكمل كل run من أول خطوة غير مكتملة.
4. **قفل لكل دومين** (PostgreSQL advisory lock) لمنع تنفيذ إضافتين لنفس الدومين معاً.
5. خطوات تنتظر حدثاً خارجياً تُوضع في حالة `waiting` ولا تحجز عاملاً (مثل انتظار أول اتصال من الراوتر).
6. **التعويض بدل الحذف:** عند فشل خطوة لا تحذف ما نجح قبلها إلا إذا كان آمناً وغير مستخدم، وتبقى الحالة قابلة لإعادة المحاولة. لا حذف لشهادة صالحة أبداً.
7. لا تُخزّن أي أسرار في `params` أو `detail_redacted`.
8. وضع **dry-run**: يمرّ على الخطوات 1 إلى 5 ويعرض ما سيحدث دون تنفيذ أي أثر.

#### الخطوات بالترتيب

| # | الخطوة | ما تفعله | عند الفشل |
|---|---|---|---|
| 1 | `validate` | العميل موجود واشتراكه `active/grace`، الدومين تحت منطقة Cloudflare المضبوطة، لا تعارض مع صف موجود، `hotspot_dns_name` يطابق الدومين، `ros_major` ∈ {6,7} | تفشل فوراً برسالة واضحة، بلا أي أثر |
| 2 | `cloudflare_check` | فحص التوكن والمنطقة | تفشل مبكراً (قبل أي إنشاء) وتنبّه |
| 3 | `ensure_server_record` | يتأكد من وجود سجل A لـ `AGENT_HOST` (غير مُوكَّل `proxied`). إن وُجد بنفس القيمة يتخطاه، وإن وُجد بقيمة مختلفة **يفشل ولا يستبدله** | يطلب قراراً من المشغّل |
| 4 | `create_entities` | ينشئ صفوف العميل (إن لزم) والراوتر والشهادة (`pending`)، ويولّد رمز المسار وسر الراوتر (عشوائي قوي)، ويحفظ المجزّأ، ويحفظ نسخة **مشفرة مؤقتة** للعرض مرة واحدة حتى `agent_secret_reveal_until` (افتراضياً 24 ساعة ثم تُصفَّر) | قابلة للإعادة |
| 5 | `throttle_gate` | بوابة معدّل: لا تتجاوز `max_new_certs_per_hour` (الإعداد) لتفادي حدود Let's Encrypt. إن زاد الطلب تنتظر (`waiting`) | لا فشل، تأخير فقط |
| 6 | `issue_or_import` | الطريقة أ: مهمة ACME (القسم 11). الطريقة ب: استيراد بعد فحوص 11.1 | إعادة محاولة تصاعدية ثم تنبيه |
| 7 | `verify_material` | إعادة فحص نهائي (مطابقة المفتاح، RSA، SAN، السلسلة، الصلاحية) حتى للشهادة الصادرة من ACME | تفشل ولا تنشر |
| 8 | `publish_version` | معاملة واحدة: حفظ المادة، `version + 1`، `status='issued'`، `next_renew_at`، وربط الراوتر بالشهادة | معاملة ذرّية، إما كل شيء أو لا شيء |
| 9 | `generate_scripts` | يولّد سكربت اللصق الواحد (القسم 12.5) وسكربتات التحديث والتراجع للإصدار 6 أو 7 | قابلة للإعادة |
| 10 | `notify_ready` | إشعار للمشغّل: "الشهادة جاهزة، الصق السكربت على الراوتر" مع رابط الصفحة. الراوتر يصير `awaiting_bootstrap` | |
| 11 | `await_first_contact` | `waiting` حتى أول طلب `version.txt` من الراوتر (الحالة `connected`). تذكير بعد `bootstrap_reminder_hours` (افتراضياً 24) ثم كل يوم، وتنبيه أشد بعد `bootstrap_alert_days` (3) | لا ينتهي بفشل، يبقى معلقاً مع تنبيهات |
| 12 | `await_apply` | `waiting` حتى `ack ok=1` (الحالة `applied`). عند `ack ok=0` تُعرض الخطوة الفاشلة (`download/import/bind`) مع إرشاد للحل | تنبيه وزر إعادة |
| 13 | `finalize` | يُغلق الـ run بنجاح، ويدخل الراوتر في المتابعة الدورية | |

#### ما يحدث بعد الإضافة تلقائياً (دورة الحياة)
1. **التجديد:** `certs.renew-scan` يجدد قبل 30 يوماً، فيزيد `version`، وكل راوتر يسحب النسخة الجديدة في دورته اليومية ويرسل `ack`. لا تدخل مطلوب.
2. **المتابعة:** إن لم يرسل راوتر `ack` للنسخة الجديدة خلال `rollout_alert_hours` (افتراضياً 48) يصير `stale` ويُنبَّه المشغّل. وإن لم يتصل إطلاقاً خلال `stale_days` (3) كذلك.
3. **ارتباط الاشتراك:** عند انتهاء اشتراك العميل: تتوقف التجديدات وتردّ نقاط السحب بـ403 (القسم 7.3) ويصير الراوتر `disabled`. وعند التجديد (يدوياً أو تلقائياً): تُعاد تفعيل النقاط، ويُشغَّل `renew-scan` فوراً للشهادات القريبة من الانتهاء، ويُرسل إشعار.
4. **الشهادات المستوردة:** نفس المتابعة، لكن بلا تجديد تلقائي وبتنبيهات انتهاء مكثفة (11.1).

#### الإضافة الجماعية (CSV)
- أعمدة مقترحة: `customer_name, phone, email, router_name, ros_major, hotspot_profile, hotspot_local_ip, hotspot_dns_name, subscription_months`.
- **المرحلة الأولى: فحص جاف (dry-run)** يعرض أخطاء كل سطر (دومين مكرر، IP غير صالح، إصدار غير 6/7...) دون أي أثر.
- بعدها ينشأ `provisioning_run` لكل سطر (`kind='bulk_item'`) ويمرّ على `throttle_gate`، فلا تتجاوز الدفعة حدود الإصدار.
- إعادة رفع نفس الملف لا تكرر شيئاً (idempotent بمفتاح الدومين).
- فشل سطر لا يوقف بقية الأسطر.

#### إلغاء الإضافة وإنهاء العميل (Offboarding، `kind='offboard'`)
1. تعطيل رموز الراوترات (403 فوراً).
2. اختيارياً: `revoke` الشهادة (حسب إعداد `revoke_on_offboard`، افتراضياً معطّل، ومحدودية الإلغاء كما في 7.3).
3. جدولة حذف مادة المفتاح بعد `key_retention_days` (افتراضياً 30) بحذف آمن يشمل `certificate_revisions`.
4. حذف سجلات DNS التي أنشأتها الخدمة لهذا العميل (وليس سجل `AGENT_HOST` المشترك).
5. عرض **سكربت تنظيف للراوتر** يلصقه المشغّل (الخدمة لا تستطيع الوصول للراوتر):

```
/system scheduler remove [find where name=hs-cert-update]
/system script remove [find where name=hs-cert-update]
/certificate remove [find where name~"^hs-"]
/ip dns static remove [find where comment="hs-cert"]
```
(غير مجرّب، اختبره قبل اعتماده.)

#### إعدادات التحكم (جدول `settings`، قابلة للتعديل من اللوحة)

| المفتاح | الافتراضي |
|---|---|
| `max_new_certs_per_hour` | 5 (ويُراجع على ضوء حدود Let's Encrypt الحالية، **[غير موثّق]**) |
| `agent_secret_reveal_hours` | 24 |
| `bootstrap_reminder_hours` | 24 |
| `bootstrap_alert_days` | 3 |
| `rollout_alert_hours` | 48 |
| `stale_days` | 3 |
| `key_retention_days` | 30 |
| `revoke_on_offboard` | false |

#### ما لا يمكن أتمتته (يجب أن تصرّح به الواجهة بوضوح)

| الأمر | السبب | الحل المتاح |
|---|---|---|
| لصق سكربت اللصق الواحد على كل راوتر مرة واحدة | الراوترات بلا IP عام ولا اتصال من الخادم إليها | سكربت واحد جاهز مع نسخ بضغطة |
| خطوة الثقة بجذر CA على RouterOS 6 | لا مخزن CA مدمج غالباً (**[غير موثّق]**) | تعليمات في السكربت مع مطابقة بصمة يدوية |
| تنظيف الراوتر عند إنهاء العميل | لا وصول من الخادم | سكربت تنظيف يلصقه المشغّل |
| قرار الانتقال من staging إلى production | قرار أمني وتجاري | مفتاح تبديل في الإعدادات للمالك فقط |
| تحديث قالب السكربت على الراوترات القائمة | لا تنفيذ سكربتات بعيدة (13.4) | تنبيه `template_version` متأخر |

> **اختياري مستقبلاً (خارج النسخة الأولى):** إن وُجد نفق إدارة (مثل WireGuard) بين الراوتر والخادم يمكن أتمتة اللصق الأولي، لكنه يضيف سطح هجوم وتعقيداً، ولا يُبنى إلا بطلب صريح.

---

## 12. توليد سكربتات الراوتر (v6 وv7)

لكل راوتر تُولَّد **ثلاثة** نصوص من القالب ومن بيانات قاعدة البيانات، بلا أي تعديل يدوي:

1. **سكربت التهيئة الأولية** (يُلصق مرة واحدة).
2. **سكربت التحديث** (يُنشأ على الراوتر ويُجدول).
3. **تعليمات التراجع** (rollback).

### 12.1 سكربت التهيئة الأولية (قالب، **[غير موثّق]**: يجب اختباره على الإصدارين)

```
# ===== hs-cert bootstrap | router={{router_name}} | ROS {{ros_major}} | template v{{template_version}} =====
# 0) نسخة احتياطية
/export file=before-hs-cert
/system backup save name=before-hs-cert

# 1) فحوصات مسبقة
:put [/system clock print]
:put [/system ntp client print]
{{#if ros7}}:put [/system device-mode print]{{/if}}
# تحقق: الساعة صحيحة، و fetch/scheduler/hotspot غير معطلة

# 2) DNS محلي لاسم الهوت سبوت
/ip dns static add name={{hotspot_dns_name}} address={{hotspot_local_ip}} type=A comment="hs-cert"

# 3) إعداد بروفايل الهوت سبوت (الشهادة تُربط لاحقاً بسكربت التحديث)
/ip hotspot profile set [find where name={{hotspot_profile}}] dns-name={{hotspot_dns_name}} login-by=https,http-chap
{{#if https_redirect_no}}/ip hotspot profile set [find where name={{hotspot_profile}}] https-redirect=no{{/if}}

{{#if ros6}}
# 4) [RouterOS 6 فقط] الثقة بجهة الإصدار قبل تفعيل check-certificate=yes
# اتبع التعليمات المعروضة في اللوحة: تحميل جذر ISRG، مطابقة بصمته مع الموقع الرسمي، ثم:
# /certificate import file-name=isrg-root-x1.pem passphrase=""
# ثم اختبر: /tool fetch url="https://{{agent_host}}/" check-certificate=yes output=none
{{/if}}
```

**ملاحظة للوكيل:** بصمة جذر ISRG المعروضة في اللوحة يجب أن تُجلب وقت البناء من صفحة Let's Encrypt الرسمية وتُعرض للمشغّل ليطابقها بيده، **ولا تخترع بصمة** ولا تحفظها من ذاكرتك.

### 12.2 سكربت التحديث (قالب v7، نقطة انطلاق، **[غير موثّق]**: لم يُجرَّب على راوتر حقيقي)

> يعتمد على `version.txt` الصغير: لا يحمّل المفتاح الخاص إلا عند وجود نسخة جديدة. آخر نسخة مطبقة تُحفظ في حقل `comment` للسكربت نفسه.

```
# ===== hs-cert-update | router={{router_name}} | ROS {{ros_major}} | template v{{template_version}} =====
:local sname "hs-cert-update"
:local profile "{{hotspot_profile}}"
:local base "https://{{agent_host}}/agent/v1/{{url_token}}"
:local fuser "{{agent_user}}"
:local fpass "{{agent_secret}}"
:local ackb ($base . "/ack")

:local fc "hs-new-fullchain.pem"
:local pk "hs-new-privkey.pem"
:local newCert ($fc . "_0")
:local newCa ($fc . "_1")

# 1) هل توجد نسخة جديدة؟
/file remove [find where name="hs-ver.txt"]
:local ok true
:do {
    /tool fetch url=($base . "/version.txt") user=$fuser password=$fpass check-certificate=yes dst-path="hs-ver.txt"
} on-error={ :set ok false }
:if (!$ok) do={
    :log error "hs-cert: version fetch failed"
    :error "hs-cert: version fetch failed"
}
:delay 1s
:local ver [/file get [find where name="hs-ver.txt"] contents]
/file remove [find where name="hs-ver.txt"]
:if ($ver = [/system script get [find where name=$sname] comment]) do={
    :error "hs-cert: up to date"
}

# 2) تنزيل الملفين (فشل أي تنزيل يوقف السكربت)
/certificate remove [find where name~"^hs-new-"]
/file remove [find where name=$fc]
/file remove [find where name=$pk]
:set ok true
:do {
    /tool fetch url=($base . "/fullchain.pem") user=$fuser password=$fpass check-certificate=yes dst-path=$fc
    /tool fetch url=($base . "/privkey.pem") user=$fuser password=$fpass check-certificate=yes dst-path=$pk
} on-error={ :set ok false }
:if (!$ok) do={
    :log error "hs-cert: download failed"
    :do { /tool fetch url=($ackb . "?v=" . $ver . "&ok=0&step=download") user=$fuser password=$fpass check-certificate=yes output=none } on-error={ }
    :error "hs-cert: download failed"
}

# 3) الاستيراد
/certificate import file-name=$fc passphrase=""
/certificate import file-name=$pk passphrase=""
:delay 3s
:if ([:len [/certificate find where name=$newCert]] = 0) do={
    :log error "hs-cert: import failed"
    :do { /tool fetch url=($ackb . "?v=" . $ver . "&ok=0&step=import") user=$fuser password=$fpass check-certificate=yes output=none } on-error={ }
    /file remove [find where name=$fc]
    /file remove [find where name=$pk]
    :error "hs-cert: import failed"
}

# 4) التبديل: اربط الجديدة أولاً ثم احذف القديمة
/ip hotspot profile set [find where name=$profile] ssl-certificate=$newCert
/certificate remove [find where name~"^hs-live"]
/certificate set [find where name=$newCert] name="hs-live"
/certificate set [find where name=$newCa] name="hs-live-ca"
/ip hotspot profile set [find where name=$profile] ssl-certificate="hs-live"

# 5) تنظيف وتسجيل النسخة
/file remove [find where name=$fc]
/file remove [find where name=$pk]
/system script set [find where name=$sname] comment=$ver
:do { /tool fetch url=($ackb . "?v=" . $ver . "&ok=1&step=bind") user=$fuser password=$fpass check-certificate=yes output=none } on-error={ }
:log info ("hs-cert: updated to version " . $ver)
```

الجدولة (تُولَّد أيضاً):

```
/system script add name=hs-cert-update policy=read,write,test,policy,sensitive source="<محتوى السكربت أعلاه>"
/system scheduler add name=hs-cert-update interval=1d start-time=04:{{minute_offset}}:00 on-event="/system script run hs-cert-update"
```

- `minute_offset` يختلف من راوتر لآخر (توزيع الأحمال، حتى لا تصل كل الراوترات في نفس الدقيقة).
- أسطر `:error` في حالة "up to date" ستظهر في السجل كأخطاء سكربت. هذا سلوك متوقع، ويجب أن توضّحه الوثائق ولا يُعتبر عطلاً.

### 12.3 فروقات RouterOS 6 (على الوكيل أن يتحقق منها بنفسه)

الوكيل **ملزم** ببناء قالب v6 منفصل أو أقسام شرطية، وتجربته على RouterOS 6.49 (مثلاً CHR)، مع التحقق من:

1. هل يدعم v6 كتلة `:do { } on-error={ }` وصيغة `:local` و`[/file get ... contents]` بنفس الشكل؟
2. هل الخيار `check-certificate=yes` وخيار `url=` متاحان مع `user` و`password`؟
3. هل يتعرف v6 على سلسلة Let's Encrypt بعد استيراد الجذر؟ تذكّر الحادثة الموثّقة عن فشل استيراد جذر متقاطع على 6.49.13، وجهّز بديلاً (استيراد ملف جذر ISRG المباشر بدل المتقاطع، أو استيراد الوسيطة منفصلة).
4. هل تُسمّى الشهادات المستوردة `_0` و`_1` بنفس الترتيب؟
5. ماذا يحدث عند حذف شهادة مرتبطة ببروفايل الهوت سبوت؟ (لذلك السكربت يربط الجديدة قبل حذف القديمة).

إن فشل شيء مما سبق على v6 فليُعدَّل القالب ويُوثَّق السبب، وإن تعذّر الحل فليُسجَّل في `KNOWN_LIMITATIONS.md` ويُوصى برفع الراوتر إلى v7.

### 12.4 تعليمات التراجع (تُعرض مع السكربت)

```
# إيقاف التحديث التلقائي
/system scheduler disable [find where name=hs-cert-update]
# العودة لدخول بدون شهادة مؤقتاً
/ip hotspot profile set [find where name={{hotspot_profile}}] login-by=http-chap,cookie
# استعادة النسخة الاحتياطية
/system backup load name=before-hs-cert
```

### 12.5 سكربت اللصق الواحد (All-in-one) وحده يكفي لتهيئة الراوتر

الخطوة 9 من خط الإضافة (`generate_scripts`) تُنتج **ملفاً واحداً** يلصقه المشغّل مرة واحدة ويجمع:

1. نسخة احتياطية وفحوصات مسبقة (12.1).
2. سجل DNS المحلي وإعداد بروفايل الهوت سبوت.
3. خطوة الثقة بالـ CA (على v6 فقط، مع التعليمات).
4. **إنشاء سكربت `hs-cert-update` بمحتواه الكامل** (12.2).
5. إنشاء المجدول `hs-cert-update`.
6. **تشغيل السكربت فوراً مرة واحدة** ليسحب الشهادة ويرسل `ack`، فيتحول الراوتر آلياً من `awaiting_bootstrap` إلى `connected` ثم `applied` دون أي أمر إضافي.

**نقاط حرجة على الوكيل معالجتها:**
- **الهروب (escaping):** وضع سكربت داخل `source="..."` يتطلب هروب علامات الاقتباس و`$` و`\`. ولّد النص بمكتبة هروب مخصصة، واكتب اختباراً يتحقق بالدورة الكاملة (إنشاء السكربت على RouterOS ثم قراءة `source` ومقارنته بالأصل حرفاً بحرف). **لا تفترض أن الهروب صحيح دون اختبار.**
- **حجم السكربت:** تحقق من حدود الطول في v6 وv7 (**[غير موثّق]**)، وإن تجاوزها فقسّم إلى أجزاء.
- **السر ظاهر في النص:** سر الراوتر داخل السكربت، فلا يُعرض إلا ضمن نافذة `agent_secret_reveal_until`، ويُمنع تخزينه نصاً بعدها. بعد الانتهاء يُنشأ سر جديد عبر تدوير السر وإعادة التوليد.
- **سطر `:error` لحالة "up to date"** يظهر في السجل كخطأ سكربت (سلوك متوقع).
- **مدة تشغيل التشغيل الأول:** اعرض في الواجهة أن الاستيراد قد يستغرق بضع ثوانٍ وأن الحالة تتغير تلقائياً.

---

## 13. الأمان

### 13.1 تشفير الأسرار

- المفاتيح الخاصة للشهادات، وتوكن Cloudflare، ومفتاح حساب ACME، وأسرار TOTP: **تُشفَّر في قاعدة البيانات** بخوارزمية AEAD (مثل AES-256-GCM) بمفتاح رئيسي `MASTER_KEY` يأتي من متغير بيئة سرّي في Coolify، **لا يُخزَّن في قاعدة البيانات ولا في المستودع.**
- يُفضَّل envelope encryption (مفتاح بيانات لكل سر مغلَّف بالمفتاح الرئيسي) لتسهيل تدوير المفتاح الرئيسي.
- **تحذير حاسم:** ضياع `MASTER_KEY` = فقدان كل المفاتيح الخاصة (يلزم إعادة إصدار كل الشهادات). احتفظ بنسخة منه **في مكان منفصل عن نسخ قاعدة البيانات**.
- أضف أداة لتدوير `MASTER_KEY` مع اختبار.

### 13.2 دخول المشغّل

- كلمات المرور بـ argon2id، وTOTP إلزامي لدور `owner`.
- جلسات في كوكيز `HttpOnly; Secure; SameSite=Strict`، وحماية CSRF.
- قفل الحساب بعد محاولات فاشلة، وتحديد معدل على `/auth/login`.
- ترويسات أمان (HSTS، CSP، X-Frame-Options...).

### 13.3 واجهة الراوتر

- HTTPS فقط، ورفض HTTP.
- الرمز العشوائي في المسار + مستخدم وسر. كلاهما مجزأ في القاعدة.
- لا تُسجّل الأسرار أو محتوى الملفات في السجلات أبداً.
- فعّل مراقبة سلوك شاذ (عدد كبير من الطلبات الفاشلة على رموز مختلفة).
- إن سُرّب سر راوتر: تدوير السر من اللوحة يبطل القديم فوراً.
- إن سُرّب مفتاح خاص لشهادة: `revoke` ثم إصدار جديد وتغيير كل أسرار الراوترات المرتبطة.

### 13.4 ممنوع: تنفيذ سكربتات بعيدة على الراوتر

- **لا تُنشئ نقطة يحمّل منها الراوتر سكربت `.rsc` ثم يشغّله (`/import`) آلياً.** لو اخترقت الخدمة أو سُرّق رمز لتمكّن المهاجم من تنفيذ أوامر على كل راوترات العملاء. التوثيق الرسمي نفسه يقول إن `/import` ينفّذ كل أمر في الملف وأن تحميل السكربتات يجب أن يكون من خادم تتحكم فيه.
- الراوتر يحمّل **بيانات فقط** (نص النسخة، الشهادة، المفتاح)، والسكربت الذي يعالجها **مكتوب داخل الراوتر** ويلصقه المشغّل مرة واحدة.
- أي تحديث لقالب السكربت يتطلب أن يلصقه المشغّل يدوياً، مع تتبع رقم `template_version` في اللوحة وتنبيه حين يتأخر راوتر عن الإصدار.

### 13.5 الخصوصية

- بيانات العملاء (اسم، هاتف، بريد) بيانات شخصية. قلّل ما تجمعه، وحدّد مدة احتفاظ، وفعّل حذف عميل مع حذف شهاداته ومفاتيحه (بعد `revoke` إن لزم). الخادم في الاتحاد الأوروبي حسب موقع المالك، فراجع متطلبات GDPR **[غير موثّق، ليست نصيحة قانونية]**.

---

## 14. النشر على Coolify

> **[غير موثّق]** تفاصيل Coolify تتغير بين الإصدارات، فعلى الوكيل مراجعة توثيقه الحالي.

1. نشر عبر **Docker Compose** يتضمن: `app` (الويب والـ API)، `worker` (ACME والمهام)، `postgres`.
2. قاعدة البيانات: إما مورد Postgres من Coolify أو حاوية في Compose، **مع volume دائم**.
3. متغيرات البيئة في Coolify (كلها أسرار حيث يلزم):

| المتغير | الوصف |
|---|---|
| `DATABASE_URL` | اتصال Postgres |
| `MASTER_KEY` | مفتاح التشفير الرئيسي (32 بايت base64) |
| `SESSION_SECRET` | سر الجلسات |
| `APP_BASE_URL` | `https://...` لواجهة اللوحة |
| `AGENT_HOST` | `hotspotmikrotik.alnooah.pro` |
| `ACME_ENV` | `staging` أو `production` |
| `ACME_EMAIL` | بريد حساب ACME |
| `CLOUDFLARE_API_TOKEN` | **اختياري**، الأفضل إدخاله من اللوحة وتخزينه مشفراً |
| `TZ` | `UTC` |
| `LOG_LEVEL` | `info` |

4. النطاقات:
   - `AGENT_HOST` (للراوترات) و`APP_BASE_URL` (للوحة) ويفضّل **اسمان مختلفان**، أو مسار منفصل للـ agent مع قواعد جدار مختلفة.
   - شهادة الخادم نفسه (للاسمين) يتولاها Coolify/وكيله العكسي. **لا تخلطها** مع شهادات العملاء.
5. **فحص الصحة**: `GET /health` يتحقق من الاتصال بالقاعدة، وحالة العامل، وتوكن Cloudflare (بدون كشف تفاصيل).
6. **النسخ الاحتياطي:** نسخ يومي لقاعدة البيانات إلى مكان خارج الخادم، **مشفّر**، مع **اختبار استعادة** فعلي قبل الإنتاج. تذكّر أن النسخة بلا `MASTER_KEY` لا تنفع.
7. **التحديثات:** هجرات القاعدة تعمل عند الإقلاع أو في خطوة منفصلة، ولا تُنفَّذ من نسختين في آن واحد (قفل).
8. **تعدد النسخ:** إن شُغّلت أكثر من نسخة من `worker`، يجب أن يضمن الطابور عدم تنفيذ نفس المهمة مرتين (قفل/`SKIP LOCKED`).
9. جدار ناري للخادم: يفتح 443 (و80 إن لزم للوكيل العكسي) وSSH بقيود. لا تفتح منفذ قاعدة البيانات للإنترنت.

---

## 15. الاختبارات ومعايير القبول

### 15.1 اختبارات آلية

- **وحدات:** حساب حالات الاشتراك (نهاية الأشهر، السنة الكبيسة، المناطق الزمنية، المهلة)، التمديد التلقائي، التشفير وفكّه، تدوير `MASTER_KEY`.
- **تكامل:** الإصدار عبر Pebble/staging بوجود Cloudflare وهمي (mock) أو منطقة اختبار، مسار الفشل وإعادة المحاولة، عدم حذف الشهادة القديمة عند فشل التجديد.
- **API الراوتر:** رمز خاطئ = 404، اشتراك منتهٍ = 403، تحديد المعدل، عدم تسريب المفتاح في السجلات.
- **أمان:** فحوص XSS/CSRF/SQL injection على اللوحة.
- **خط الإضافة الآلي:** قتل العامل في منتصف كل خطوة ثم الاستئناف (لا تكرار)، تكرار نفس الطلب (idempotency)، سجل A موجود بقيمة مختلفة، CSV بأخطاء، `throttle_gate`، انتهاء الاشتراك أثناء التنفيذ، انتهاء نافذة عرض السر، وصول `ack` مكرر أو ببيانات غريبة.
- **استيراد الشهادات:** شهادة سليمة، مفتاح لا يطابق، ECDSA، سلسلة ناقصة، منتهية، موقعة ذاتياً، SAN خاطئ، مفتاح مشفّر بعبارة صحيحة وخاطئة، ملف ضخم/تالف، تكرار نفس البصمة، التأكد من عدم ظهور المفتاح أو العبارة في أي سجل، واستبدال شهادة وتراجع (version يزيد دائماً).

### 15.2 اختبارات يدوية على راوترات حقيقية (إلزامية قبل الإعلان عن الجاهزية)

| الاختبار | v7 | v6 |
|---|---|---|
| تشغيل التهيئة الأولية بلا أخطاء | | |
| `fetch` بـ `check-certificate=yes` ينجح | | |
| استيراد `fullchain` والمفتاح، وظهور `K` | | |
| ربط الهوت سبوت وفتح `https://wifi.alnooah.pro/login` بقفل أخضر | | |
| التحديث عند نسخة جديدة (تغيير `version`) | | |
| "up to date" حين لا جديد | | |
| فشل التنزيل لا يحذف الشهادة العاملة | | |
| الحالات: ساعة خاطئة، مخزن CA ناقص، اشتراك منتهٍ | | |
| التراجع (rollback) | | |
| شهادة مستوردة (RSA بسلسلة كاملة) تُسحب وتُربط وتعمل | | |
| سكربت اللصق الواحد ينجح من أول مرة (الهروب حرفاً بحرف) | | |
| الحالات تتحرك تلقائياً: awaiting_bootstrap ثم connected ثم applied | | |
| سكربت التنظيف | | |
| استبدال شهادة ثم تراجع (version أعلى) | | |

الوكيل **يملأ هذا الجدول فعلياً** في `TEST_REPORT.md` بالنتائج الحقيقية. أي خانة لم تُجرَّب تُكتب "لم تُختبر"، لا "تعمل".

### 15.3 معايير القبول للنسخة الأولى

1. إضافة عميل بتاريخ، وتجديده يدوياً، وتفعيل التمديد التلقائي لعميل ولكل العملاء، من اللوحة.
2. عميل منتهٍ بلا تجديد يتوقف إصدار شهاداته وترد نقاط السحب له بـ403.
3. إصدار شهادة staging لراوتر تجريبي وسحبها وتطبيقها على RouterOS 7 (وعلى 6 إن أمكن).
4. السكربتات المولَّدة للإصدارين تُنسخ من اللوحة وتعمل.
5. لا توجد أسرار في السجلات أو في المستودع.
6. استعادة نسخة احتياطية ناجحة.
7. من زر "إضافة شهادة جديدة": إصدار شهادة staging لدومين جديد، واستيراد شهادة خارجية صالحة (تُرفض الحالات الحاجزة في 11.1)، واستبدال شهادة قائمة ثم التراجع عنها، وظهور "بانتظار النشر" ثم زواله بعد أن يسحبها الراوتر.
8. **الإضافة الآلية:** من زر واحد (أو CSV) تُنشأ كل الكيانات والشهادة، وتظهر حالة كل خطوة حياً، ويُنتج سكربت لصق واحد. بعد لصقه على راوتر تجريبي (v7 ثم v6) ينتقل الراوتر تلقائياً إلى `applied` دون أي أمر إضافي، وتُجدَّد الشهادة لاحقاً (بتقديم `next_renew_at` للاختبار) وتصل وحدها وتُرسَل `ack`.

---

## 16. التحذيرات والمشاكل المتوقعة

| # | المشكلة | الأثر | التحوّط |
|---|---|---|---|
| 1 | حدود معدل Let's Encrypt على `alnooah.pro` | رفض الإصدار عند كثرة الأسماء | إصدار تدريجي، staging للاختبار، مراقبة العدّاد، **قراءة الحدود من التوثيق الحالي** |
| 2 | شهادة ECDSA بدل RSA | يُستورد لكن يفشل الاتصال في خدمات الراوتر | فرض RSA 2048 وفحص نوع المفتاح بعد الإصدار |
| 3 | ساعة الراوتر خاطئة | فشل TLS في `fetch` أو "شهادة غير صالحة بعد" | فحص NTP في سكربت التهيئة وتنبيه |
| 4 | مخزن CA ناقص (خصوصاً v6) | فشل `check-certificate=yes` | خطوة التهيئة الأولية، وعدم تعطيل التحقق أبداً |
| 5 | فشل استيراد الجذر على v6 | لا تحقق من الخادم | بدائل استيراد، وتوثيق القيد |
| 6 | تعطل `fetch`/`scheduler`/`hotspot` بسبب `device-mode` | السكربت لا يعمل | فحص مسبق وتحذير |
| 7 | اسم الشهادة لا يطابق `dns-name` | تحذير في المتصفح | تحقق في الواجهة والـ API |
| 8 | لا سجل DNS محلي للاسم | الصفحة لا تفتح عند العميل | سطر `dns static` في التهيئة، وتنبيه لـ iOS |
| 9 | العملاء لا يستخدمون DNS الراوتر | لا يحلّ الاسم | تنبيه بفحص `/ip dhcp-server network` |
| 10 | تحذير شهادة عند فتح مواقع HTTPS قبل الدخول | شكاوى مستخدمين | خيار `https-redirect=no` وتوضيح للمشغّل |
| 11 | CGNAT يجعل IP الراوترات مشتركة | تحديد معدل ظالم أو فشل تقييد الـ IP | حدّ بالرمز وبحساب الراوتر لا بالـ IP وحده |
| 12 | تسريب مفتاح خاص من الخادم | انتحال اسم الهوت سبوت | تشفير، عزل، `revoke`، وتحليل خطر (المفتاح الخاص مخزّن مركزياً) |
| 13 | ضياع `MASTER_KEY` | فقدان كل المفاتيح | نسخة منفصلة، واختبار استعادة |
| 14 | التوكن Cloudflare منتهٍ أو صلاحياته ناقصة | فشل الإصدار | فحص دوري وتنبيه |
| 15 | انتشار TXT بطيء | فشل التحقق | انتظار قابل للضبط (propagation wait) وإعادة محاولة |
| 16 | تجديد تلقائي للاشتراك بلا دفع | تمديد لمن لم يدفع | نص تحذيري، ومعطّل افتراضياً، وسجل واضح |
| 17 | حساب نهاية الأشهر (31 يناير + شهر) | تواريخ خاطئة | اختبارات وحدة، وقواعد موثقة للتمديد |
| 18 | المناطق الزمنية وبداية/نهاية اليوم | اشتراك ينتهي مبكراً أو متأخراً | UTC في التخزين، ومنطقة عرض قابلة للضبط، وتعريف واضح لـ"نهاية اليوم" |
| 19 | الشهادة تبقى صالحة بعد إيقاف العميل | لا إيقاف فوري حقيقي | إيضاح للمشغّل، و`revoke` اختياري (مع محدوديته) |
| 20 | نسخ من `worker` تنفذ نفس المهمة | إصدار مكرر يستهلك الحدود | قفل المهام (`SKIP LOCKED`) |
| 21 | سقوط الخادم عند اقتراب انتهاء الشهادة | عدم تجديد | بدء التجديد قبل 30 يوماً، وتنبيه، ومراقبة خارجية |
| 22 | راوتر لا يتصل لأيام | لن يتلقى الشهادة الجديدة | تنبيه `stale-scan`، وإدخال فترة سماح |
| 23 | سكربت المفتاح يُنسخ للاستخدام في راوتر آخر | تسريب سر الراوتر | سر لكل راوتر، وتدوير، ومراقبة طلبات غير معتادة |
| 24 | أخطاء `:error` في السجل | قلق غير مبرر | توثيق السلوك |
| 25 | قالب سكربت قديم على راوتر قديم | سلوك غير متوقع | تتبع `template_version` وتنبيه |
| 26 | الراوتر خلف جدار ناري يمنع HTTPS الخارجي | فشل السحب | فحص مسبق: `fetch` اختباري في التهيئة |
| 27 | شهادة خادم الخدمة نفسها تنتهي | الراوترات لا تتحقق منه | مراقبة انتهاء شهادة `AGENT_HOST` |
| 28 | هجرة قاعدة بيانات تفشل في منتصف التحديث | توقف الخدمة | هجرات صغيرة، نسخة قبل كل ترقية |
| 29 | تعارض أسماء الشهادات على الراوتر | تبديل خاطئ | أسماء ثابتة `hs-new-*` و`hs-live*` وتنظيف البقايا قبل البدء |
| 30 | حذف شهادة مرتبطة ببروفايل | انقطاع مؤقت | ربط الجديدة قبل حذف القديمة (كما في السكربت) |
| 31 | شهادة مستوردة بسلسلة ناقصة (بدون وسيطة) | بعض الأجهزة (خصوصاً أندرويد القديم) ترفضها | فحص السلسلة حاجز، ولا جلب تلقائي للوسيطات |
| 32 | مفتاح لا يطابق الشهادة | فشل الاستيراد على الراوتر أو تحذير | فحص المطابقة قبل الحفظ |
| 33 | شهادة مستوردة من نوع ECDSA | مشاكل مع RouterOS | رفضها وطلب RSA |
| 34 | شهادة مستوردة لا تُجدَّد تلقائياً | انتهاؤها دون انتباه | تنبيهات مكثفة وعدّاد واضح، وخيار التحويل إلى ACME |
| 35 | الاسم في SAN لا يطابق `dns-name` | تحذير في المتصفح | فحص إلزامي عند الرفع وعند ربط الراوتر |
| 36 | رفع المفتاح الخاص عبر المتصفح | تسريب إن سُجّل أو خُزّن مؤقتاً | HTTPS فقط، no-store، عدم الكتابة على القرص، عدم التسجيل، step-up auth |
| 37 | تراجع إلى نسخة بنفس الرقم القديم | الراوتر لا يتعرف على التغيير | التراجع ينشئ `version` أعلى دائماً |
| 38 | استبدال شهادة لعدة راوترات دفعة واحدة | فشل جزئي على بعضها | عرض "بانتظار النشر" لكل راوتر، ولا حذف للنسخة السابقة قبل اكتمال النشر (retention) |
| 39 | انهيار العامل في منتصف خط الإضافة | إضافة معلّقة أو مكررة | خطوات idempotent واستئناف من آخر خطوة، وقفل لكل دومين |
| 40 | دفعة CSV كبيرة | تجاوز حدود Let's Encrypt | `throttle_gate` ودفعات متدرجة، وفحص جاف قبل التنفيذ |
| 41 | السجل A لـ `AGENT_HOST` موجود بقيمة مختلفة | استبدال خاطئ يكسر الراوترات | الخطوة 3 تفشل ولا تستبدل، وتطلب قرار المشغّل |
| 42 | المشغّل لم يلصق السكربت | شهادة جاهزة بلا راوتر | حالة `awaiting_bootstrap` وتذكيرات وتنبيه بعد 3 أيام |
| 43 | انتهاء نافذة عرض السر قبل النسخ | لا يمكن إعادة عرض السر | تدوير السر وإعادة توليد السكربت |
| 44 | خطأ في هروب السكربت داخل `source` | سكربت معطوب على الراوتر | اختبار دورة كاملة حرفاً بحرف |
| 45 | `ack` لا يصل رغم نجاح التطبيق (شبكة) | حالة `connected` بدل `applied` | يُعاد إرسال `ack` في الدورة التالية، ويُعتبر `applied` عند أول `up to date` بنسخة مطابقة (يتطلب تسجيل النسخة) |
| 46 | فتح `ack` لهجمات ملء السجلات | تضخم الجدول | تحديد معدل، وقبول قيم محددة فقط، وتنظيف دوري |
| 47 | تعارض اشتراك منتهٍ مع run قيد التنفيذ | إصدار لعميل منتهٍ | إعادة فحص الاشتراك في `validate` وقبل الخطوة 6 |

---

## 17. أسئلة مفتوحة للمالك (والافتراضات إن لم تُجب)

| # | السؤال | الافتراض إن لم يُجب |
|---|---|---|
| 1 | كم عدد الراوترات المتوقع، وكم منها v6؟ | حتى 100، والنصف v6 |
| 2 | هل كل الراوترات لك أم لجهات مختلفة؟ | لعملاء مختلفين، فشهادة لكل راوتر |
| 3 | لغة الإشعارات وقناتها (بريد، Telegram، WhatsApp)؟ | بريد SMTP فقط |
| 4 | أدوار المشغّلين وعددهم؟ | `owner` واحد + إمكانية إضافة آخرين |
| 5 | المنطقة الزمنية للعرض؟ | `Europe/Paris` |
| 6 | مهلة السماح الافتراضية بعد الانتهاء؟ | 3 أيام |
| 7 | هل يُفعَّل `https-redirect=no` افتراضياً؟ | لا، خيار لكل راوتر |
| 8 | هل تريد سياسة `revoke` بعد الانتهاء؟ | معطّلة |
| 9 | هل تريد بوابة عميل لاحقاً؟ | لاحقاً، خارج النسخة الأولى |
| 10 | هل هناك مزوّد SMTP/Telegram جاهز؟ | لا، يُترك إعداده في اللوحة |
| 11 | هل الأسماء `wifi.alnooah.pro` أم `<ref>.alnooah.pro` لكل عميل؟ | `<public_ref>-<n>.alnooah.pro` |
| 12 | الاحتفاظ بسجلات السحب؟ | 90 يوماً |

---

## 18. طريقة العمل المطلوبة من الوكيل (مراحل)

**المرحلة 0:** اقرأ الملف كله، واطرح الأسئلة المفتوحة (القسم 17)، وأنشئ `ASSUMPTIONS.md` بما تعتمده.

**المرحلة 1: الأساس**
- هيكل المشروع، Dockerfile وDocker Compose صالح لـ Coolify، الهجرات (القسم 6)، نظام الأسرار والتشفير، تسجيل الدخول وTOTP والأدوار، `/health`.
- **توقف واعرض** ما أنجزت.

**المرحلة 2: العملاء والاشتراكات**
- CRUD للعملاء والاشتراكات، التجديد اليدوي، التجديد التلقائي لفرد وللمجموعة، آلة الحالات والمجدول، `subscription_events`، الإشعارات، واجهة العملاء.
- اختبارات الوحدة للتواريخ. **توقف.**

**المرحلة 3: Cloudflare وACME**
- تكامل Cloudflare، عامل ACME (staging فقط)، تخزين الشهادات مشفرة، `version`، إعادة المحاولة والتنبيهات.
- **محرك الإضافة الآلي** (11.2): الخطوات الثلاث عشرة، idempotency والاستئناف، `throttle_gate`، الإضافة الجماعية CSV، وواجهة التقدم الحيّ.
- **توقف.**

**المرحلة 4: الراوترات والسكربتات**
- نقاط `/agent/v1` بما فيها `ack`، توليد السكربتات (تهيئة + تحديث + تراجع) للإصدارين، **سكربت اللصق الواحد** (12.5)، تتبع `template_version`، ومتابعة `awaiting_bootstrap` ثم `connected` ثم `applied`.
- **اختبر على راوترات/CHR حقيقية وعبّئ جدول 15.2.** **توقف.**

**المرحلة 5: التحصين والتسليم**
- مراجعة أمنية ذاتية، النسخ الاحتياطي والاستعادة، وثائق التشغيل، `KNOWN_LIMITATIONS.md`، `TEST_REPORT.md`.
- الانتقال إلى `ACME_ENV=production` **بقرار المالك فقط**.

### مخرجات مطلوبة في المستودع

- `README.md` (تشغيل محلي، نشر Coolify، المتغيرات).
- `ASSUMPTIONS.md`, `KNOWN_LIMITATIONS.md`, `TEST_REPORT.md`, `SECURITY.md` (نموذج التهديد، التدوير، الاستجابة للتسريب).
- `docs/router-scripts/` (القوالب v6 وv7 مع شرح كل سطر).
- `docker-compose.yml`, `Dockerfile`, `.env.example` (بدون أسرار حقيقية).

---

## 19. ما يجب ألا يفعله الوكيل

1. لا تُصدر شهادات إنتاج أثناء التطوير.
2. لا تكتب أسراراً حقيقية في الكود أو المستودع أو السجلات.
3. لا تعطّل `check-certificate=yes` في أي سكربت لتجاوز مشكلة.
4. لا تجعل الراوتر يشغّل سكربتات يحمّلها من الخادم.
5. لا تضف اتصالاً بالراوتر من الخادم (SSH/API).
6. لا تعتمد ECDSA، ولا wildcard، ولا بروكسي Cloudflare، ولا Origin CA.
7. لا تقل إن شيئاً "تم اختباره" ما لم يُشغَّل فعلاً وتُسجَّل نتيجته.
8. لا تخترع أرقاماً أو بصمات أو أسماء خصائص RouterOS: إن لم تتأكد فاختبر على جهاز وسجّل ما حصل.
9. لا تبنِ بوابة دفع أو بوابة عملاء دون طلب.
10. لا تحذف شهادة عاملة قبل نجاح البديل.

---

## 20. المصادر التي استند إليها هذا البرومبت

- توثيق ميكروتيك الرسمي للهوت سبوت: https://help.mikrotik.com/docs/spaces/ROS/pages/56459266/HotSpot+-+Captive+portal
- توثيق `/tool fetch` (إصدار 7.25): https://manual.mikrotik.com/docs/7.25/system-information-and-utilities/fetch
- منتدى ميكروتيك: طلب دعم DNS-01 والتجديد: https://forum.mikrotik.com/t/please-help-with-automatic-lets-encrypt-updates/268244
- منتدى ميكروتيك: ECC وwww-ssl: https://forum.mikrotik.com/t/does-routeros-not-support-ecc-certificates/267202
- منتدى ميكروتيك: مفاتيح SSH (ed25519 غير مدعوم على 6.x): https://forum.mikrotik.com/t/ecdsa-keys-for-ssh/133657
- منتدى ميكروتيك: فشل استيراد جذر Let's Encrypt على 6.49.13: https://forum.mikrotik.com/t/failed-to-import-certificate/174838
- توثيق Cloudflare Origin CA: https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/troubleshooting/
- دليل هوت سبوت مع Let's Encrypt: https://techjunction.co/how-to-secure-your-mikrotik-hotspot-captive-portal-with-a-free-letsencrypt-ssl-certificate-and-prevent-browser-security-warnings-to-your-wifi-users/
- مزوّد هوت سبوت (iOS وWalled Garden): https://go.starthotspot.com/?p=3430
