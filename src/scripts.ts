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
    if (s.startsWith(':put')) continue;
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
  const base = 'https://' + ctx.agent_host + '/agent/v1/' + ctx.url_token;
  const lines: string[] = [];
  lines.push('{ # ===== hs-cert-update | router=' + ctx.router_name + ' | ROS auto | template v' + (ctx.template_version || '1') + ' =====');
  lines.push('');
  lines.push(':local sname "hs-cert-update"');
  lines.push(':local profile "' + esc(ctx.hotspot_profile) + '"');
  lines.push(':local base "' + esc(base) + '"');
  lines.push(':local fuser "' + esc(ctx.agent_user) + '"');
  lines.push(':local fpass "' + esc(ctx.agent_secret) + '"');
  lines.push(':local ackb ($base . "/ack")');
  lines.push(':local rosVer [/system resource get version]');
  lines.push(':local rosMajor 6');
  lines.push(':local cc "no"');
  lines.push(':local fc "hs-new-fullchain.pem"');
  lines.push(':local pk "hs-new-privkey.pem"');
  lines.push(':local newCert ($fc . "_0")');
  lines.push(':local newCa ($fc . "_1")');
  lines.push(':local ok true');
  lines.push(':local ver "0"');
  lines.push(':local waited 0');
  lines.push(':local serial "unknown"');
  lines.push('');
  lines.push(':if ([:find $rosVer "7."] = 0) do={ :set rosMajor 7 }');
  lines.push(':if ($rosMajor = 7) do={ :set cc "yes" }');
  lines.push('');
  lines.push(':do { :set serial [/system routerboard get serial-number] } on-error={');
  lines.push('    :do { :set serial [/system license get software-id] } on-error={ :set serial "unknown" }');
  lines.push('}');
  lines.push('');
  lines.push(':do { /tool fetch url=($base . "/serial") user=$fuser password=$fpass check-certificate=$cc http-method=post http-header-field=("X-Router-Serial: " . $serial) output=none } on-error={ }');
  lines.push('');
  lines.push(':do { /file remove [find where name="hs-ver.txt"] } on-error={ }');
  lines.push(':do {');
  lines.push('    /tool fetch url=($base . "/version.txt") user=$fuser password=$fpass check-certificate=$cc http-header-field=("X-Router-Serial: " . $serial) dst-path="hs-ver.txt"');
  lines.push('} on-error={ :set ok false }');
  lines.push(':if (!$ok) do={');
  lines.push('    :log error "hs-cert: version fetch failed"');
  lines.push('    :error "hs-cert: version fetch failed"');
  lines.push('}');
  lines.push(':delay 1s');
  lines.push(':set ver [/file get [find where name="hs-ver.txt"] contents]');
  lines.push(':do { /file remove [find where name="hs-ver.txt"] } on-error={ }');
  lines.push('');
  lines.push(':local isUpToDate false');
  lines.push(':if ($ver = [/system script get [find where name=$sname] comment]) do={ :set isUpToDate true }');
  lines.push('');
  lines.push(':if ($isUpToDate = false) do={');
  lines.push('    :do { /certificate remove [find where name~"^hs-new-"] } on-error={ }');
  lines.push('    :do { /file remove [find where name=$fc] } on-error={ }');
  lines.push('    :do { /file remove [find where name=$pk] } on-error={ }');
  lines.push('    :set ok true');
  lines.push('    :do {');
  lines.push('        /tool fetch url=($base . "/fullchain.pem") user=$fuser password=$fpass check-certificate=$cc http-header-field=("X-Router-Serial: " . $serial) dst-path=$fc');
  lines.push('        /tool fetch url=($base . "/privkey.pem") user=$fuser password=$fpass check-certificate=$cc http-header-field=("X-Router-Serial: " . $serial) dst-path=$pk');
  lines.push('    } on-error={ :set ok false }');
  lines.push('    :if (!$ok) do={');
  lines.push('        :log error "hs-cert: download failed"');
  lines.push('        :do { /tool fetch url=($ackb . "?v=" . $ver . "&ok=0&step=download") user=$fuser password=$fpass check-certificate=$cc output=none } on-error={ }');
  lines.push('        :error "hs-cert: download failed"');
  lines.push('    }');
  lines.push('    :set waited 0');
  lines.push('    :while ([:len [/file find where name=$fc]] = 0) do={');
  lines.push('        :delay 1s');
  lines.push('        :set waited ($waited + 1)');
  lines.push('        :if ($waited > 10) do={ :error "hs-cert: fullchain not written" }');
  lines.push('    }');
  lines.push('    :set waited 0');
  lines.push('    :while ([:len [/file find where name=$pk]] = 0) do={');
  lines.push('        :delay 1s');
  lines.push('        :set waited ($waited + 1)');
  lines.push('        :if ($waited > 10) do={ :error "hs-cert: privkey not written" }');
  lines.push('    }');
  lines.push('    :delay 2s');
  lines.push('    /certificate import file-name=$fc passphrase=""');
  lines.push('    :delay 2s');
  lines.push('    /certificate import file-name=$pk passphrase=""');
  lines.push('    :delay 2s');
  lines.push('    :delay 3s');
  lines.push('    :if ([:len [/certificate find where name=$newCert]] = 0) do={');
  lines.push('        :log error "hs-cert: import failed"');
  lines.push('        :do { /tool fetch url=($ackb . "?v=" . $ver . "&ok=0&step=import") user=$fuser password=$fpass check-certificate=$cc output=none } on-error={ }');
  lines.push('        :do { /file remove [find where name=$fc] } on-error={ }');
  lines.push('        :do { /file remove [find where name=$pk] } on-error={ }');
  lines.push('        :error "hs-cert: import failed"');
  lines.push('    }');
  lines.push('    /ip hotspot profile set [find where name=$profile] dns-name=' + ctx.hotspot_dns_name + ' login-by=https,http-chap');
  lines.push('    :if ($rosMajor = 6) do={ /ip hotspot profile set [find where name=$profile] https-redirect=no }');
  lines.push('    /ip hotspot profile set [find where name=$profile] ssl-certificate=$newCert');
  lines.push('    :delay 2s');
  lines.push('    :do { /certificate remove [find where name~"^hs-live"] } on-error={ }');
  lines.push('    :delay 1s');
  lines.push('    :do { /certificate set [find where name=$newCert] name="hs-live" } on-error={ }');
  lines.push('    :delay 1s');
  lines.push('    :do { /certificate set [find where name=$newCa] name="hs-live-ca" } on-error={ }');
  lines.push('    :delay 1s');
  lines.push('    /ip hotspot profile set [find where name=$profile] ssl-certificate="hs-live"');
  lines.push('    :delay 1s');
  lines.push('    :do { /file remove [find where name=$fc] } on-error={ }');
  lines.push('    :do { /file remove [find where name=$pk] } on-error={ }');
  lines.push('    /system script set [find where name=$sname] comment=$ver');
  lines.push('    :do { /tool fetch url=($ackb . "?v=" . $ver . "&ok=1&step=bind") user=$fuser password=$fpass check-certificate=$cc http-header-field=("X-Router-Serial: " . $serial) output=none } on-error={ :log warning "hs-cert: ack failed (non-fatal)" }');
  lines.push('}');
  lines.push('');
  lines.push(':if ($isUpToDate = true) do={ :log info "hs-cert: up to date" }');
  lines.push(':return 0');
  lines.push('}');
  const raw = lines.join('\n');
  return cleanScript(raw);
}

export function bootstrapScript(ctx: ScriptContext): string {
  const base = `https://${ctx.agent_host}/agent/v1/${ctx.url_token}`;
  const lines: string[] = [];
  lines.push('{ # ===== hs-cert bootstrap (AUTO) | router=' + ctx.router_name + ' | template v' + (ctx.template_version || '1') + ' =====');
  lines.push('');
  lines.push('# detect ROS major');
  lines.push(':local rosVer [/system resource get version]');
  lines.push(':local rosMajor 6');
  lines.push(':if ([:find $rosVer "7."] = 0) do={ :set rosMajor 7 }');
  lines.push('');
  lines.push('# 1) DNS static (idempotent)');
  lines.push(':do { /ip dns static add name=' + ctx.hotspot_dns_name + ' address=' + ctx.hotspot_local_ip + ' type=A comment="hs-cert" } on-error={ }');
  lines.push('');
  lines.push('# 2) hotspot profile');
  lines.push('/ip hotspot profile set [find where name=' + ctx.hotspot_profile + '] dns-name=' + ctx.hotspot_dns_name + ' login-by=https,http-chap');
  lines.push(':if ($rosMajor = 6) do={ /ip hotspot profile set [find where name=' + ctx.hotspot_profile + '] https-redirect=no }');
  lines.push('');
  lines.push('# 3) fetch update script from server (no nested braces)');
  lines.push(':local waited 0');
  lines.push(':do { /file remove [find where name=hs-update.rsc] } on-error={ }');
  lines.push('/tool fetch url=' + base + '/update.rsc user=' + ctx.agent_user + ' password=' + ctx.agent_secret + ' check-certificate=no dst-path=hs-update.rsc');
  lines.push(':while ([:len [/file find where name=hs-update.rsc]] = 0) do={');
  lines.push('    :delay 1s');
  lines.push('    :set waited ($waited + 1)');
  lines.push('    :if ($waited > 15) do={ :error "update script not downloaded" }');
  lines.push('}');
  lines.push(':delay 2s');
  lines.push('');
  lines.push('# 4) run update script directly (no stored script needed)');
  lines.push('/import file-name=hs-update.rsc');
  lines.push(':do { /file remove [find where name=hs-update.rsc] } on-error={ }');
  lines.push('');
  lines.push('# 5) scheduler (daily 04:xx) - fetch + import');
  lines.push('/system scheduler remove [find where name=hs-cert-update]');
  lines.push('/system scheduler add name=hs-cert-update interval=1d start-time=04:00:00 on-event="/tool fetch url=' + base + '/update.rsc user=' + ctx.agent_user + ' password=' + ctx.agent_secret + ' check-certificate=no dst-path=hs-update.rsc; :delay 5s; /import file-name=hs-update.rsc"');
  lines.push('');
  lines.push('# 6) done');
  lines.push('}');
  const raw = lines.join('\n');
  return cleanScript(raw);
}

export function allInOne(ctx: ScriptContext): string {
  return bootstrapScript(ctx);
}