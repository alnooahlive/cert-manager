// Mikrotik RouterOS script generator
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

export function updateScript(ctx: ScriptContext): string {
  const cc = ctx.ros_major === 6 ? 'no' : 'yes';
  const base = `https://${ctx.agent_host}/agent/v1/${ctx.url_token}`;
  return `# ===== hs-cert-update | router=${ctx.router_name} | ROS ${ctx.ros_major} | template v${ctx.template_version || '1'} =====
:local sname "hs-cert-update"
:local profile "${esc(ctx.hotspot_profile)}"
:local base "${esc(base)}"
:local fuser "${esc(ctx.agent_user)}"
:local fpass "${esc(ctx.agent_secret)}"
:local ackb ($base . "/ack")

:local fc "hs-new-fullchain.pem"
:local pk "hs-new-privkey.pem"
:local newCert ($fc . "_0")
:local newCa ($fc . "_1")

# 1) fetch version
/file remove [find where name="hs-ver.txt"]
:local ok true
:do {
    /tool fetch url=($base . "/version.txt") user=$fuser password=$fpass check-certificate=${cc} dst-path="hs-ver.txt"
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

# 2) download material
/certificate remove [find where name~"^hs-new-"]
/file remove [find where name=$fc]
/file remove [find where name=$pk]
:set ok true
:do {
    /tool fetch url=($base . "/fullchain.pem") user=$fuser password=$fpass check-certificate=${cc} dst-path=$fc
    /tool fetch url=($base . "/privkey.pem") user=$fuser password=$fpass check-certificate=${cc} dst-path=$pk
} on-error={ :set ok false }
:if (!$ok) do={
    :log error "hs-cert: download failed"
    :do { /tool fetch url=($ackb . "?v=" . $ver . "&ok=0&step=download") user=$fuser password=$fpass check-certificate=${cc} output=none } on-error={ }
    :error "hs-cert: download failed"
}

# 3) import
/certificate import file-name=$fc passphrase=""
/certificate import file-name=$pk passphrase=""
:delay 3s
:if ([:len [/certificate find where name=$newCert]] = 0) do={
    :log error "hs-cert: import failed"
    :do { /tool fetch url=($ackb . "?v=" . $ver . "&ok=0&step=import") user=$fuser password=$fpass check-certificate=${cc} output=none } on-error={ }
    /file remove [find where name=$fc]
    /file remove [find where name=$pk]
    :error "hs-cert: import failed"
}

# 4) bind
/ip hotspot profile set [find where name=$profile] ssl-certificate=$newCert
/certificate remove [find where name~"^hs-live"]
/certificate set [find where name=$newCert] name="hs-live"
/certificate set [find where name=$newCa] name="hs-live-ca"
/ip hotspot profile set [find where name=$profile] ssl-certificate="hs-live"

# 5) finalize
/file remove [find where name=$fc]
/file remove [find where name=$pk]
/system script set [find where name=$sname] comment=$ver
:do { /tool fetch url=($ackb . "?v=" . $ver . "&ok=1&step=bind") user=$fuser password=$fpass check-certificate=${cc} output=none } on-error={ }
:log info ("hs-cert: updated to version " . $ver)
`;
}

export function bootstrapScript(ctx: ScriptContext): string {
  const cc = ctx.ros_major === 6 ? 'no' : 'yes';
  const v6note = ctx.ros_major === 6 ? `# RouterOS 6: ensure ISRG root CA imported if check-certificate=yes fails
# /certificate import file-name=isrg-root-x1.pem passphrase=""
# test: /tool fetch url="https://${ctx.agent_host}/" check-certificate=yes output=none
` : '';
  return `# ===== hs-cert bootstrap | router=${ctx.router_name} | ROS ${ctx.ros_major} | template v${ctx.template_version || '1'} =====
# 0) backup
/export file=before-hs-cert
/system backup save name=before-hs-cert

# 1) verify clock/ntp
:put [/system clock print]
:put [/system ntp client print]
${ctx.ros_major === 7 ? ':put [/system device-mode print]' : ''}

# 2) DNS static (idempotent)
:do { /ip dns static add name=${ctx.hotspot_dns_name} address=${ctx.hotspot_local_ip} type=A comment="hs-cert" } on-error={ }

# 3) hotspot profile
/ip hotspot profile set [find where name=${ctx.hotspot_profile}] dns-name=${ctx.hotspot_dns_name} login-by=https,http-chap
${ctx.ros_major === 7 ? '' : '/ip hotspot profile set [find where name=' + ctx.hotspot_profile + '] https-redirect=no'}

${v6note}
# 4) create update script
/system script remove [find where name=hs-cert-update]
/system script add name=hs-cert-update policy=read,write,test,policy,sensitive comment="0" source={${updateScript(ctx).replace(/^/gm, '    ')}}

# 5) scheduler (daily 04:xx)
/system scheduler remove [find where name=hs-cert-update]
/system scheduler add name=hs-cert-update interval=1d start-time=04:00:00 on-event="/system script run hs-cert-update"

# 6) run once
/system script run hs-cert-update
`;
}

export function allInOne(ctx: ScriptContext): string {
  return bootstrapScript(ctx);
}