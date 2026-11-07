# شهادة SSL لهوت سبوت ميكروتيك بدون IP عام

مرجع مرتب: الطرق، المقارنة، المخاطر، والسكربتات. آخر تحقق من المصادر: 6 نوفمبر 2026.

## 0. تنبيهات قبل البدء

1. **السكربتات في هذا المستند من تأليفي أنا (Claude)، وليست منسوخة من مشاريع أخرى.** لم أستطع تجربتها على راوتر حقيقي. اختبرها على نسخة تجريبية وراجع أسماء الخصائص بـ `/certificate print detail` قبل الاعتماد عليها.
2. **تصحيح لما قلته سابقاً عن الـ Walled Garden:** كتبت أن HTTPS يتطلب قاعدة IP، وكان ذلك من نقاش قديم في المنتدى (إصدارات 6.x). التوثيق الرسمي الحالي (محدّث أبريل 2026) يقول إن قائمة `/ip hotspot walled-garden` تدير HTTP وHTTPS، وإن `walled-garden ip` للبروتوكولات الأخرى ولعناوين IP. اختبر على إصدارك.
3. **تصحيح عن التجديد التلقائي:** أمر `enable-ssl-certificate` في RouterOS يعتمد على HTTP-01 فقط (المنفذ 80 من الإنترنت)، ولا يدعم DNS-01 أصلياً، وهو مصمم لخدمة www-ssl وليس لبروفايل الهوت سبوت.
4. **الهوت سبوت قد يكون معطّلاً بسبب device-mode.** التوثيق الرسمي ينبه إلى التأكد من تفعيله في `/system device-mode` قبل الإعداد.
5. **ما لا يمكن إلغاؤه:** تحذير الشهادة عند فتح موقع HTTPS قبل تسجيل الدخول. الخيار الرسمي `https-redirect=no` يرفض تلك الطلبات بدل تحويلها، فيضطر المستخدم لفتح صفحة http.

## 1. جدول المقارنة (مرتب من الأوثق للأضعف في حالتك: بدون IP عام)

| # | الطريقة | المصدر/التوثيق | الإيجابيات | المخاطر والسلبيات | التجديد |
| --- | --- | --- | --- | --- | --- |
| 1 | certbot يدوي بتحدي DNS-01 ثم استيراد يدوي | دليل techjunction لهوت سبوت + وثائق ميكروتيك للشهادات | الأبسط، لا يحتاج جهازاً دائماً ولا بيانات اعتماد مخزنة، يعمل بدون أي منفذ مفتوح | يدوي كل \~60 يوماً، نسيانه ينهي الشهادة، يحتاج دومين | يدوي |
| 2 | acme.sh + DNS API + hook رسمي `routeros` | مستودع acme.sh (deploy/routeros.sh) + منتدى ميكروتيك | تلقائي بالكامل، جزء من مشروع معروف | افتراضياً يحدّث www-ssl فقط، يعتمد على تسمية `cer_0` غير مضمونة مستقبلاً، يحتاج مفتاح SSH ومستخدماً على الراوتر، توكن DNS مخزن على الجهاز | تلقائي |
| 3 | mikrotik-certbot (hook لـ certbot) | صفحة PyPI | يدعم بروفايلات الهوت سبوت صراحةً، يسمي الشهادة باسم فريد لكل تجديد | مشروع فردي حديث (أكتوبر 2025)، يخزن كلمة مرور الراوتر في ملف، يحتاج www-ssl مفعّلاً وRouterOS 7.17+ للـ REST (أو SFTP للأقدم)، راجع الكود أولاً | تلقائي |
| 4 | certbot/acme.sh + رفع SCP + سكربت جدولة على الراوتر (من تأليفي) | الفكرة من دليل administrator.de، التنفيذ مني | الجزء الحساس (الاستيراد والربط) على الراوتر، لا يعطي الجهاز صلاحيات تعديل البروفايل | سكربت غير مجرّب، يتطلب أن يصل جهاز الشهادة إلى الراوتر (نفس الشبكة أو VPN) | تلقائي |
| 5 | VPS + WireGuard لتمرير المنفذ 80 ثم `enable-ssl-certificate` | منتدى ميكروتيك (فتح المنفذ 80 مؤقتاً) + مقالات حلول CGNAT | يستخدم أداة الراوتر الأصلية | الأعقد، كلفة VPS، فتح المنفذ 80 على الراوتر، لا يربط الشهادة بالهوت سبوت تلقائياً، لم أجد توثيقاً لسلسلة كاملة بهذا الشكل | شبه تلقائي |
| 6 | بدون شهادة: `login-by=http-chap` | التوثيق الرسمي لميكروتيك | لا صيانة ولا دومين | صفحة الدخول على HTTP (المتصفح يعرض غير آمن)، حماية الكلمة بتحدي MD5 فقط، ولا يعمل خيار DHCP الخاص بكشف الكابتف بورتال (يتطلب شهادة صالحة) | لا يوجد |
| 7 | شهادة موقعة ذاتياً | معرفتي العامة (لم أبحث فيها) | بدون دومين ولا خدمات خارجية | تحذير دائم، والعميل لا يستطيع تثبيت جهة الإصدار قبل تسجيل الدخول؛ غير مناسب لجمهور عام | يدوي |

**توصيتي:** ابدأ بالطريقة 1 للتأكد أن كل شيء يعمل (الدومين، DNS المحلي، الربط). ثم انتقل إلى 2 أو 4 للأتمتة بعد اختبارها.

## 2. المتطلبات المشتركة

1. **دومين تملكه** وتعدّل سجلاته. لا شهادة موثوقة لعنوان IP محلي.
2. **اسم فرعي مخصص**، مثل `hotspot.yourdomain.com`.
3. **جهاز لإصدار الشهادة** (كمبيوتر أو Raspberry Pi أو VPS). التحقق يتم بسجل TXT، فلا يحتاج الراوتر أي IP عام ولا منفذاً مفتوحاً.
4. **ضبط الوقت على الراوتر** (NTP). الوقت الخاطئ يجعل الشهادة تبدو غير صالحة (معلومة عامة لم أتحقق منها هنا).
5. **DNS محلي:** يجب أن يحل العميل الدومين إلى IP الراوتر على واجهة الهوت سبوت. التوثيق الرسمي يقول إن `dns-name` في البروفايل يُضاف تلقائياً كسجل ثابت في DNS الراوتر. ويوصي مزود هوت سبوت بإضافته يدوياً أيضاً لتفادي مشاكل iOS:

```
/ip dns static add name=hotspot.yourdomain.com address=192.168.88.1 type=A
```

6. تأكد أن خادم DHCP يعطي العملاء عنوان الراوتر كخادم DNS (`/ip dhcp-server network print`).

## 3. الطريقة 1: certbot يدوي + استيراد (الأضمن)

### 3.1 على جهاز الشهادة

```
certbot certonly --manual --preferred-challenges dns -d hotspot.yourdomain.com
```

سيطلب منك إضافة سجل TXT باسم `_acme-challenge.hotspot` بقيمة يعرضها. أضفه ثم اضغط Enter. الملفان الناتجان عادة في:

```
/etc/letsencrypt/live/hotspot.yourdomain.com/fullchain.pem
/etc/letsencrypt/live/hotspot.yourdomain.com/privkey.pem
```

### 3.2 رفع الملفين إلى الراوتر

عبر WinBox: Files ثم اسحب الملفين. أو من الطرفية (إن كان الراوتر يقبل SCP):

```
scp fullchain.pem privkey.pem admin@192.168.88.1:/
```

إن ظهر خطأ صلاحيات على `privkey.pem` فانسخ الملفين إلى مجلد آخر قبل الرفع (مفتاح certbot الخاص مقيّد لـ root).

### 3.3 الاستيراد على الراوتر

```
/certificate import file-name=fullchain.pem
/certificate import file-name=privkey.pem
/certificate print
```

النتيجة المتوقعة: `fullchain.pem_0` (شهادة الدومين) و`fullchain.pem_1` (الوسيطة)، والأولى بعلامة `K`.

### 3.4 الربط بالهوت سبوت

```
/ip hotspot profile print
/ip hotspot profile set [find name=hsprof1] dns-name=hotspot.yourdomain.com ssl-certificate=fullchain.pem_0 login-by=https,http-pap
```

معاني القيم من التوثيق الرسمي: `https` يعني تشفير تبادل اسم المستخدم وكلمة المرور بنفق SSL، و`http-pap` يرسل كلمة المرور نصاً واضحاً عبر HTTP (وهو هنا احتياطي فقط، وإن أردت منعه احذفه من القائمة)، و`http-chap` يستخدم تحدياً مشفراً بـ MD5.

### 3.5 اختيارياً: ضبط تحويل HTTPS

```
/ip hotspot profile set [find name=hsprof1] https-redirect=no
```

## 4. الطريقة 2: acme.sh مع hook رسمي

على جهاز لينكس (داخل شبكتك أو متصل بها عبر VPN).

### 4.1 إصدار الشهادة (مثال Cloudflare، من معرفتي ولم أتحقق منه في هذه الجلسة)

```
export CF_Token="ضع-التوكن-هنا"
acme.sh --issue --dns dns_cf -d hotspot.yourdomain.com
```

### 4.2 تجهيز الراوتر

```
/user group add name=certgrp policy=read,write,ftp,ssh,test,policy,sensitive
/user add name=certuser group=certgrp password=كلمة-قوية
```

استورد المفتاح العام لهذا المستخدم (الصيغة من معرفتي ولم أتحقق منها، راجع `/user ssh-keys` على إصدارك):

```
/user ssh-keys import public-key-file=acme_key.pub user=certuser
```

### 4.3 النشر

```
export ROUTER_OS_USERNAME=certuser
export ROUTER_OS_HOST=192.168.88.1
export ROUTER_OS_ADDITIONAL_SERVICES="/ip hotspot profile set [find name=hsprof1] ssl-certificate=hotspot.yourdomain.com.cer_0"
acme.sh --deploy -d hotspot.yourdomain.com --deploy-hook routeros
```

**انتبه:** التوثيق نفسه يحذر أن اسم الشهادة المستوردة (`cer_0`) افتراض قد لا يبقى. بعد أول تشغيل افحص `/certificate print` وتأكد من الاسم الفعلي، ثم عدّله في المتغير.

## 5. الطريقة 3: mikrotik-certbot

من وصف المشروع على PyPI: يرفع الشهادة المجددة عبر REST ويطبقها على www-ssl وapi-ssl وبروفايلات الهوت سبوت الاختيارية. الخطوات العامة:

1. ضع ملف الـ hook في `/etc/letsencrypt/renewal-hooks/deploy/`.
2. عدّل المتغيرات: `MIKROTIK_DOMAIN` و`ROUTER_HOST` و`ROUTER_USER` و`ROUTER_PASS`، وراجع README لمتغير بروفايل الهوت سبوت (لم أطّلع عليه).
3. جرّب: `certbot renew --dry-run`.

نفّذ على الراوتر مستخدماً بأقل صلاحيات، وراجع كود المشروع قبل منحه كلمة المرور.

مع إصدار الشهادة بتحدي DNS تلقائي (لتعمل `certbot renew` بدون تدخل) استخدم إضافة DNS لمزودك. مثال Cloudflare (من معرفتي):

```
certbot certonly --dns-cloudflare --dns-cloudflare-credentials /root/cf.ini -d hotspot.yourdomain.com
```

## 6. الطريقة 4: رفع SCP + سكربت على الراوتر (من تأليفي)

الفكرة: جهاز الشهادة يرفع الملفين فقط، والراوتر يستوردهما ويربطهما بنفسه عبر سكربت مجدول.

### 6.1 على جهاز الشهادة: ملف hook

المسار: `/etc/letsencrypt/renewal-hooks/deploy/upload-to-mikrotik.sh` (وأعطه صلاحية تنفيذ):

```
#!/bin/sh
set -eu

ROUTER="192.168.88.1"
RUSER="certuser"
KEY="/root/.ssh/id_ed25519_mikrotik"
LIVE="/etc/letsencrypt/live/hotspot.yourdomain.com"

scp -i "$KEY" "$LIVE/fullchain.pem" "$RUSER@$ROUTER:fullchain.pem"
scp -i "$KEY" "$LIVE/privkey.pem" "$RUSER@$ROUTER:privkey.pem"
```

ملاحظة: الجهاز يجب أن يصل إلى الراوتر (نفس الشبكة أو VPN). الراوتر بلا IP عام فلا يمكن لـ VPS خارجي الوصول إليه مباشرة.

### 6.2 على الراوتر: السكربت

من WinBox: System ثم Scripts ثم Add، الاسم `hs-cert-update`، الصلاحيات: read, write, test, policy, sensitive. الصق:

```
:local profile "hsprof1"
:local fc "fullchain.pem"
:local pk "privkey.pem"

:if (([:len [/file find where name=$fc]] = 0) || ([:len [/file find where name=$pk]] = 0)) do={
    :log info "hs-cert: no new files"
    :error "hs-cert: no new files"
}

/certificate remove [find where name~"^fullchain"]
/certificate import file-name=$fc passphrase=""
/certificate import file-name=$pk passphrase=""
:delay 3s

:local newCert ($fc . "_0")
:if ([:len [/certificate find where name=$newCert]] = 0) do={
    :log error "hs-cert: import failed"
    :error "hs-cert: import failed"
}

/ip hotspot profile set [find where name=$profile] ssl-certificate=$newCert
/file remove [find where name=$fc]
/file remove [find where name=$pk]
:log info "hs-cert: hotspot certificate updated"
```

### 6.3 الجدولة

```
/system scheduler add name=hs-cert-update interval=1d start-time=04:00:00 on-event="/system script run hs-cert-update"
```

**مخاطر هذا السكربت:** (1) يحذف الشهادة القديمة قبل التأكد من نجاح الجديدة، ولو فشل الاستيراد يبقى الهوت سبوت بلا شهادة حتى تتدخل. (2) لم أتحقق من سلوك الراوتر عند حذف شهادة مربوطة ببروفايل. (3) خذ نسخة احتياطية قبل أول تشغيل: `/export file=before-cert`.

## 7. الطريقة 5: VPS + WireGuard لتمرير المنفذ 80

هذه فكرة مركّبة من مصادر منفصلة ولم أجد توثيقاً لسلسلة كاملة بهذا الشكل. الخلاصة العامة:

1. على VPS ذي IP عام وWireGuard يصله الراوتر. المصادر تذكر أن النفق الخارج من الراوتر يعمل خلف CGNAT.
2. على VPS: تمرير المنفذ 80 إلى عنوان الراوتر في النفق (DNAT).
3. على الراوتر: السماح بالمنفذ 80 على سلسلة input من واجهة WireGuard فقط، وتفعيل `/ip service set www disabled=no`.
4. تشغيل `/certificate enable-ssl-certificate dns-name=hotspot.yourdomain.com`، مع سجل A للدومين يشير لـ IP الـ VPS مؤقتاً.
5. ربط الشهادة الناتجة ببروفايل الهوت سبوت يدوياً (الاسم يتغير مع كل تجديد).

عيوبها أن فتح المنفذ 80 على الراوتر قد يعرّض WebFig لـ HTTP، وكلفة VPS، والتعقيد. وعملياً الطرق 1 إلى 4 أبسط في حالتك.

## 8. الطريقة 6: بدون شهادة (http-chap)

```
/ip hotspot profile set [find name=hsprof1] login-by=http-chap,cookie
```

من التوثيق الرسمي: `http-chap` يحمي كلمة المرور بتحدي MD5، و`http-pap` يرسلها نصاً واضحاً. لا تضف `http-pap` هنا. عيوبها أن المتصفح يعلّم الصفحة غير آمنة، وأن بعض أجهزة الهاتف لا تفتح نافذة الدخول تلقائياً. وبحسب التوثيق، رسالة DHCP الخاصة بكشف الكابتف بورتال (RFC 7710) تُفعَّل تلقائياً فقط عند وجود dns-name وشهادة صالحة، وهذه ميزة تخسرها بدون شهادة.

## 9. الـ Walled Garden: متى يفيد

| الهدف | هل يفيد؟ |
| --- | --- |
| الحصول على الشهادة | لا، الإصدار يتم خارج الهوت سبوت |
| إتاحة مواقع محددة قبل الدخول دون تحذير | نعم |
| إزالة التحذير عن كل المواقع | لا، استخدم `https-redirect=no` |
| صفحة دخول خارجية | يجب إضافة دومينها |

قاعدة بالاسم (الصيغة الرسمية، تغطي HTTP وHTTPS بحسب التوثيق الحالي):

```
/ip hotspot walled-garden add dst-host=www.example.com
```

قاعدة لبروتوكول آخر أو منفذ محدد:

```
/ip hotspot walled-garden ip add action=accept dst-host=www.example.com dst-port=443 protocol=tcp
```

تحذير: إتاحة موقع لغير المسجلين تعني أن أي أحد يصل إليه بلا دخول، والمواقع على CDN قد تشارك عناوين مع مواقع أخرى.

## 10. قائمة التحقق

**على الراوتر:**

```
/certificate print detail
/ip hotspot print
/ip hotspot profile print detail
/system clock print
/system ntp client print
```

- الشهادة عليها `K`، وتاريخ انتهائها بعيد، والوسيطة موجودة.
- في `/ip hotspot print` العلامة `S` تعني أن HTTPS يعمل.
- `dns-name` يطابق اسم الدومين في الشهادة تماماً.

**من جهاز عميل:**

1. `nslookup hotspot.yourdomain.com` يعيد IP الراوتر.
2. افتح `https://hotspot.yourdomain.com/login` وتحقق من القفل.
3. من لينكس أو Mac: `openssl s_client -connect 192.168.88.1:443 -servername hotspot.yourdomain.com` وابحث عن `Verify return code: 0 (ok)`.
4. افتح `http://neverssl.com` وتأكد أنك تُحوَّل لصفحة الدخول المؤمّنة.

## 11. الأعطال الشائعة

| العرَض | السبب المرجح |
| --- | --- |
| تحذير على صفحة الدخول | اخترت `_1` بدل `_0`، أو `dns-name` لا يطابق الشهادة، أو غابت الوسيطة |
| الصفحة لا تفتح | العميل لا يحل الدومين إلى IP الراوتر |
| مشاكل في iOS | أضف سجل DNS ثابتاً يدوياً |
| لا تظهر علامة K | استوردت المفتاح قبل الشهادة أو لم تستورده |
| فشل استيراد المفتاح | ملف المفتاح مشفر بعبارة مرور أو صلاحيات ملف |
| تحذير عند فتح موقع HTTPS قبل الدخول | سلوك طبيعي، ضبط `https-redirect=no` |
| انتهت الشهادة | لم يتم التجديد، تحقق من الجدولة وسجلات الراوتر `/log print where message~"hs-cert"` |

## 12. ما لم أتحقق منه

- صيغة استيراد مفتاح SSH على راوتر بإصدارك (`/user ssh-keys`).
- أوامر مزود DNS لديك (Cloudflare مثال فقط).
- أن الراوتر يسمح بحذف شهادة مربوطة ببروفايل، وسلوكه عند الاستيراد المتكرر بنفس الاسم.
- متغير بروفايل الهوت سبوت في mikrotik-certbot.
- نجاح الطريقة 5 كسلسلة كاملة.

## 13. المصادر

- توثيق ميكروتيك الرسمي للهوت سبوت (مجمّد، والجديد على manual.mikrotik.com): https://help.mikrotik.com/docs/spaces/ROS/pages/56459266/HotSpot+-+Captive+portal
- دليل هوت سبوت مع Let's Encrypt (techjunction): https://techjunction.co/how-to-secure-your-mikrotik-hotspot-captive-portal-with-a-free-letsencrypt-ssl-certificate-and-prevent-browser-security-warnings-to-your-wifi-users/
- منتدى ميكروتيك: طلب دعم DNS-01 والتجديد: https://forum.mikrotik.com/t/please-help-with-automatic-lets-encrypt-updates/268244
- منتدى ميكروتيك: تجديد وربط الهوت سبوت: https://forum.mikrotik.com/t/renewing-lets-encrypt-ssl-certificate/160888
- hook الخاص بـ acme.sh لـ RouterOS: https://gitea.plantroon.com/plantroon/acme.sh/raw/commit/c2dd7e0f6ed2a3e099bd6409b37cfd9a84f5f752/deploy/routeros.sh
- mikrotik-certbot: https://pypi.org/project/mikrotik-certbot/
- دليل administrator.de: https://www.administrator.de/content/detail.php?id=355746
- مزود هوت سبوت (iOS وWalled Garden): https://go.starthotspot.com/?p=3430
- حلول CGNAT: https://oneuptime.com/blog/post/2026-03-20-cgnat-workaround-port-forwarding/view
