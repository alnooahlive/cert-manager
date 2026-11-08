// Mikrotik RouterOS script generator (auto-detect ROS 6/7)
export interface ScriptContext {
  router_name: string;
  ros_major: number;
  hotspot_profile: string;
  hotspot_dns_name: string;
  hotspot_local_ip: string;
  agent_host: string;
  url_token: string;
  agent_user: string;
  agent_secret: string;
  template_version?: string;
}

function esc(s: string): string {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function cleanScript(raw: string): string {
  const lines = raw.split('\n');
  const out: string[] = [];
  for (let ln of lines) {
    const s = ln.trim();
    if (s.startsWith('#')) continue;
    if (s === '') continue;
    if (ln.includes('source={')) {
      ln = ln.split('source={', 1)[0] + 'source={';
    } else if (ln.includes(' #') && !ln.includes('source={')) {
      ln = ln.split(' #', 1)[0].trimEnd();
      if (ln.trim() === '') continue;
    }
    const t = ln.trimEnd();
    if (t.endsWith('{') || t.endsWith('}') || t.endsWith(';') || t === '') {
      out.push(t);
    } else {
      out.push(t + ';');
    }
  }
  return out.join('\n');
}

export function updateScript(ctx: ScriptContext): string {
  const base = `https://${ctx.agent_host}/agent/v1/${ctx.url_token}`;
  return cleanScript(`# ===== hs-cert-update | router=${ctx.router_name} | ROS auto | template v${ctx.template_version || '1'} =====
:local sname "hs-cert-update"
:local profile "${esc(ctx.hotspot_profile)}"
:local base "${esc(base)}"
:local fuser "${esc(ctx.agent_user)}"
:local fpass "${esc(ctx.agent_secret)}"
:local ackb ($base . "/ack")
:local rosVer [/system resource get version]
:local rosMajor 6
:local cc "no"
:local fc "hs-new-fullchain.pem"
:local pk "hs-new-privkey.pem"
:local newCert ($fc . "_0")
:local newCa ($fc . "_1")
:local ok true
:local ver "0"
:local waited 0

:if ([:find $rosVer "7."] = 0) do={ :set rosMajor 7 }
:if ($rosMajor = 7) do={ :set cc "yes" }

:do { /file remove [find where name="hs-ver.txt"] } on-error={ }
:do {
    /tool fetch url=($base . "/version.txt") user=$fuser password=$fpass check-certificate=$cc dst-path="hs-ver.txt"
} on-error={ :set ok false }
:if (!$ok) do={
    :log error "hs-cert: version fetch failed"
    :error "hs-cert: version fetch failed"
}
:delay 1s
:set ver [/file get [find where name="hs-ver.txt"] contents]
:do { /file remove [find where name="hs-ver.txt"] } on-error={ }
:if ($ver = [/system script get [find where name=$sname] comment]) do={
    :log info "hs-cert: up to date"
    :return
}

:do { /certificate remove [find where name~"^hs-new-"] } on-error={ }
:do { /file remove [find where name=$fc] } on-error={ }
:do { /file remove [find where name=$pk] } on-error={ }
:set ok true
:do {
    /tool fetch url=($base . "/fullchain.pem") user=$fuser password=$fpass check-certificate=$cc dst-path=$fc
    /tool fetch url=($base . "/privkey.pem") user=$fuser password=$fpass check-certificate=$cc dst-path=$pk
} on-error={ :set ok false }
:if (!$ok) do={
    :log error "hs-cert: download failed"
    :do { /tool fetch url=($ackb . "?v=" . $ver . "&ok=0&step=download") user=$fuser password=$fpass check-certificate=$cc output=none } on-error={ }
    :error "hs-cert: download failed"
}
:set waited 0
:while ([:len [/file find where name=$fc]] = 0) do={
    :delay 1s
    :set waited ($waited + 1)
    :if ($waited > 10) do={ :error "hs-cert: fullchain not written" }
}
:set waited 0
:while ([:len [/file find where name=$pk]] = 0) do={
    :delay 1s
    :set waited ($waited + 1)
    :if ($waited > 10) do={ :error "hs-cert: privkey not written" }
}
:delay 2s
/certificate import file-name=$fc passphrase=""
:delay 2s
/certificate import file-name=$pk passphrase=""
:delay 2s
:delay 3s
:if ([:len [/certificate find where name=$newCert]] = 0) do={
    :log error "hs-cert: import failed"
    :do { /tool fetch url=($ackb . "?v=" . $ver . "&ok=0&step=import") user=$fuser password=$fpass check-certificate=$cc output=none } on-error={ }
    :do { /file remove [find where name=$fc] } on-error={ }
    :do { /file remove [find where name=$pk] } on-error={ }
    :error "hs-cert: import failed"
}
/ip hotspot profile set [find where name=$profile] dns-name=${ctx.hotspot_dns_name} login-by=https,http-chap
:if ($rosMajor = 6) do={ /ip hotspot profile set [find where name=$profile] https-redirect=no }
/ip hotspot profile set [find where name=$profile] ssl-certificate=$newCert
:delay 2s
:do { /certificate remove [find where name~"^hs-live"] } on-error={ }
:delay 1s
:do { /certificate set [find where name=$newCert] name="hs-live" } on-error={ }
:delay 1s
:do { /certificate set [find where name=$newCa] name="hs-live-ca" } on-error={ }
:delay 1s
/ip hotspot profile set [find where name=$profile] ssl-certificate="hs-live"
:delay 1s
:do { /file remove [find where name=$fc] } on-error={ }
:do { /file remove [find where name=$pk] } on-error={ }
/system script set [find where name=$sname] comment=$ver
:do { /tool fetch url=($ackb . "?v=" . $ver . "&ok=1&step=bind") user=$fuser password=$fpass check-certificate=$cc output=none } on-error={ :log warning "hs-cert: ack failed (non-fatal)" }
:log info ("hs-cert: updated to version " . $ver)
:put "hs-cert: DONE"
:return
`);
}

export function bootstrapScript(ctx: ScriptContext): string {
  const base = `https://${ctx.agent_host}/agent/v1/${ctx.url_token}`;
  const cc = 'no'; // bootstrap uses no for v6 safety; update script detects at runtime
  return cleanScript(`# ===== hs-cert bootstrap (AUTO) | router=${ctx.router_name} | template v${ctx.template_version || '1'} =====

# detect ROS major
:local rosVer [/system resource get version]
:local rosMajor 6
:if ([:find $rosVer "7."] = 0) do={ :set rosMajor 7 }
:put ("Detected ROS major: " . $rosMajor)

# 1) verify clock/ntp
:put [/system clock print]
:put [/system ntp client print]

# 2) DNS static (idempotent)
:do { /ip dns static add name=${ctx.hotspot_dns_name} address=${ctx.hotspot_local_ip} type=A comment="hs-cert" } on-error={ }

# 3) hotspot profile
/ip hotspot profile set [find where name=${ctx.hotspot_profile}] dns-name=${ctx.hotspot_dns_name} login-by=https,http-chap
:if ($rosMajor = 6) do={ /ip hotspot profile set [find where name=${ctx.hotspot_profile}] https-redirect=no }

# 4) fetch update script from server (no nested braces)
:local waited 0
:do { /file remove [find where name=hs-update.rsc] } on-error={ }
/tool fetch url=${base}/update.rsc user=${ctx.agent_user} password=${ctx.agent_secret} check-certificate=no dst-path=hs-update.rsc
:while ([:len [/file find where name=hs-update.rsc]] = 0) do={
    :delay 1s
    :set waited ($waited + 1)
    :if ($waited > 15) do={ :error "update script not downloaded" }
}
:delay 2s

# 5) create stored script from file
/system script remove [find where name=hs-cert-update]
/system script add name=hs-cert-update comment="0"
/system script set [find where name=hs-cert-update] source=[/file get hs-update.rsc contents]
:do { /file remove [find where name=hs-update.rsc] } on-error={ }

# 6) scheduler (daily 04:xx)
/system scheduler remove [find where name=hs-cert-update]
/system scheduler add name=hs-cert-update interval=1d start-time=04:00:00 on-event="/system script run hs-cert-update"

# 7) run once
/system script run hs-cert-update
`);
}

export function allInOne(ctx: ScriptContext): string {
  return bootstrapScript(ctx);
}