// Mikrotik RouterOS script generator (auto-detect ROS 6/7)
// kora-style: serial-locked, hidden multi-layer fetch chain, central update.
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
  expected_serial?: string | null;
}

function esc(s: string): string {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// RouterOS string escape: \XX per ASCII byte.
function rosHex(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    out += '\\' + s.charCodeAt(i).toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

// Hidden paths. `*` cannot be downloaded to Windows; leading `.` hides in RouterOS.
export const HIDDEN_DIR = '.fi/hs*c*r.-';
export const CARRIER_PATH = HIDDEN_DIR + '/c*rrier.1*';
export const LOADER_PATH = HIDDEN_DIR + '/lo*der.2*';
export const UPDATE_PATH = HIDDEN_DIR + '/upd*te.3*';

function hexPath(p: string): string {
  return rosHex(p);
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

// Serial detection shared by every layer: RouterBOARD -> Software-ID -> System-ID.
function serialDetect(): string[] {
  return [
    ':local serial "unknown"',
    ':do { :set serial [/system routerboard get serial-number] } on-error={ :set serial "" }',
    ':if ([:len $serial] = 0) do={ :do { :set serial [/system license get software-id] } on-error={ :set serial "" } }',
    ':if ([:len $serial] = 0) do={ :do { :set serial [/system license get system-id] } on-error={ :set serial "" } }',
    ':if ([:len $serial] = 0) do={ :set serial "unknown" }',
  ];
}

function serialGuard(ctx: ScriptContext): string[] {
  if (!ctx.expected_serial) return [];
  return [
    ':if ($serial = "unknown") do={ :log error "hs-cert: serial unavailable - abort"; :error "serial unavailable" }',
    ':if ($serial != "' + esc(ctx.expected_serial) + '") do={ :log error "hs-cert: serial mismatch - abort"; :error "serial mismatch" }',
  ];
}

function headerLines(ctx: ScriptContext, tag: string): string[] {
  const base = `https://${ctx.agent_host}/agent/v1/${ctx.url_token}`;
  return [
    '{ # ===== hs-cert ' + tag + ' | router=' + esc(ctx.router_name) + ' | v' + (ctx.template_version || '1') + ' =====',
    ':local base "' + esc(base) + '"',
    ':local fuser "' + esc(ctx.agent_user) + '"',
    ':local fpass "' + esc(ctx.agent_secret) + '"',
    ':local rosVer [/system resource get version]',
    ':local rosMajor 6',
    ':local cc "no"',
    ':if ([:find $rosVer "7."] = 0) do={ :set rosMajor 7 }',
    ':if ($rosMajor = 7) do={ :set cc "yes" }',
    ...serialDetect(),
    ...serialGuard(ctx),
  ];
}

// ---------------------------------------------------------------------------
// Layer 3 - the real update script. ALWAYS fetched from the server, never run
// directly from the router. Keeps the safe rollback and www-ssl auto-create.
// ---------------------------------------------------------------------------
export function updateScript(ctx: ScriptContext): string {
  // Self-contained: /import runs in a fresh context, so redefine everything.
  const lines: string[] = headerLines(ctx, 'update (layer 3)');
  lines.push(':local profile "' + esc(ctx.hotspot_profile) + '"');
  lines.push(':local ackb ($base . "/ack")');
  lines.push(':local ok true');
  lines.push('');
  lines.push('# rollback: ALWAYS leave the hotspot usable (HTTP login)');
  lines.push(':local rollback do={');
  lines.push('    :log warning "hs-cert: rollback -> http,pap,chap (HTTPS disabled)"');
  lines.push('    /ip hotspot profile set [find where name="' + esc(ctx.hotspot_profile) + '"] login-by=http,pap,chap');
  lines.push('    /ip hotspot profile set [find where name="' + esc(ctx.hotspot_profile) + '"] https-redirect=no');
  lines.push('    /ip hotspot profile set [find where name="' + esc(ctx.hotspot_profile) + '"] ssl-certificate=""');
  lines.push('    :do { /ip service set www-ssl disabled=yes } on-error={ }');
  lines.push('}');
  lines.push('');
  lines.push('# report serial to server');
  lines.push(':do { /tool fetch url=($base . "/serial") user=$fuser password=$fpass check-certificate=$cc http-method=post http-header-field=("X-Router-Serial: " . $serial) output=none } on-error={ }');
  lines.push('');
  lines.push('# cleanup old');
  lines.push(':do { /certificate remove [find where name~"^hs-new-"] } on-error={ }');
  lines.push(':do { /file remove [find where name="hs-new-fullchain.pem"] } on-error={ }');
  lines.push(':do { /file remove [find where name="hs-new-privkey.pem"] } on-error={ }');
  lines.push(':set ok true');
  lines.push(':do {');
  lines.push('    /tool fetch url=($base . "/fullchain.pem") user=$fuser password=$fpass check-certificate=$cc http-header-field=("X-Router-Serial: " . $serial) dst-path="hs-new-fullchain.pem"');
  lines.push('    /tool fetch url=($base . "/privkey.pem") user=$fuser password=$fpass check-certificate=$cc http-header-field=("X-Router-Serial: " . $serial) dst-path="hs-new-privkey.pem"');
  lines.push('} on-error={ :set ok false }');
  lines.push(':if (!$ok) do={');
  lines.push('    :log warning "hs-cert: verified fetch failed, retry without certificate check"');
  lines.push('    :do { /file remove [find where name="hs-new-fullchain.pem"] } on-error={ }');
  lines.push('    :do { /file remove [find where name="hs-new-privkey.pem"] } on-error={ }');
  lines.push('    :set ok true');
  lines.push('    :do {');
  lines.push('        /tool fetch url=($base . "/fullchain.pem") user=$fuser password=$fpass check-certificate=no http-header-field=("X-Router-Serial: " . $serial) dst-path="hs-new-fullchain.pem"');
  lines.push('        /tool fetch url=($base . "/privkey.pem") user=$fuser password=$fpass check-certificate=no http-header-field=("X-Router-Serial: " . $serial) dst-path="hs-new-privkey.pem"');
  lines.push('    } on-error={ :set ok false }');
  lines.push('}');
  lines.push(':local fcs 0');
  lines.push(':local pks 0');
  lines.push(':delay 2s');
  lines.push(':do { :set fcs [:len [/file find where name="hs-new-fullchain.pem"]] } on-error={ :set fcs 0 }');
  lines.push(':do { :set pks [:len [/file find where name="hs-new-privkey.pem"]] } on-error={ :set pks 0 }');
  lines.push(':if ($fcs = 0) do={ :set ok false }');
  lines.push(':if ($pks = 0) do={ :set ok false }');
  lines.push(':if (!$ok) do={');
  lines.push('    $rollback');
  lines.push('    :do { /tool fetch url=($ackb . "?v=0&ok=0&step=download&sn=" . $serial) user=$fuser password=$fpass check-certificate=$cc output=none } on-error={ }');
  lines.push('    :error "hs-cert: download failed (rolled back to HTTP)"');
  lines.push('}');
  lines.push(':delay 15s');
  lines.push(':do { /certificate import file-name="hs-new-fullchain.pem" passphrase="" } on-error={ :set ok false }');
  lines.push(':delay 15s');
  lines.push(':do { /certificate import file-name="hs-new-privkey.pem" passphrase="" } on-error={ :set ok false }');
  lines.push(':delay 15s');
  lines.push(':if ([:len [/certificate find where name="hs-new-fullchain.pem_0"]] = 0) do={ :set ok false }');
  lines.push(':if ([:len [/certificate find where name="hs-new-fullchain.pem_1"]] = 0) do={ :set ok false }');
  lines.push(':if ([:len [/certificate find where name="hs-new-fullchain.pem_2"]] = 0) do={ :set ok false }');
  lines.push(':if (!$ok) do={');
  lines.push('    $rollback');
  lines.push('    :do { /tool fetch url=($ackb . "?v=0&ok=0&step=import&sn=" . $serial) user=$fuser password=$fpass check-certificate=$cc output=none } on-error={ }');
  lines.push('    :do { /file remove [find where name="hs-new-fullchain.pem"] } on-error={ }');
  lines.push('    :do { /file remove [find where name="hs-new-privkey.pem"] } on-error={ }');
  lines.push('    :error "hs-cert: import failed (rolled back to HTTP)"');
  lines.push('}');
  lines.push(':do { /certificate remove [find where name~"^hs-live"] } on-error={ }');
  lines.push(':delay 2s');
  lines.push(':do { /certificate set [find where name="hs-new-fullchain.pem_0"] name="hs-live" } on-error={ :set ok false }');
  lines.push(':delay 2s');
  lines.push(':do { /certificate set [find where name="hs-new-fullchain.pem_1"] name="hs-live-int" } on-error={ :set ok false }');
  lines.push(':delay 2s');
  lines.push(':do { /certificate set [find where name="hs-new-fullchain.pem_2"] name="hs-live-ca" } on-error={ :set ok false }');
  lines.push(':delay 2s');
  lines.push(':if ([:len [/certificate find where name="hs-live"]] = 0) do={ :set ok false }');
  lines.push(':if (!$ok) do={');
  lines.push('    $rollback');
  lines.push('    :do { /tool fetch url=($ackb . "?v=0&ok=0&step=bind&sn=" . $serial) user=$fuser password=$fpass check-certificate=$cc output=none } on-error={ }');
  lines.push('    :error "hs-cert: bind failed (rolled back to HTTP)"');
  lines.push('}');
  lines.push('/ip hotspot profile set [find where name="' + esc(ctx.hotspot_profile) + '"] dns-name=' + esc(ctx.hotspot_dns_name) + ' login-by=https,http-chap');
  lines.push('/ip hotspot profile set [find where name="' + esc(ctx.hotspot_profile) + '"] https-redirect=yes');
  lines.push('/ip hotspot profile set [find where name="' + esc(ctx.hotspot_profile) + '"] ssl-certificate="hs-live"');
  lines.push(':delay 2s');
  lines.push('# create www-ssl on port 443 if missing, then bind the certificate');
  lines.push(':if ([:len [/ip service find where name=www-ssl]] = 0) do={');
  lines.push('    /ip service add name=www-ssl port=443 certificate=hs-live disabled=no');
  lines.push('} else={');
  lines.push('    /ip service set www-ssl port=443 certificate=hs-live disabled=no');
  lines.push('}');
  lines.push(':delay 2s');
  lines.push(':do { /file remove [find where name="hs-new-fullchain.pem"] } on-error={ }');
  lines.push(':do { /file remove [find where name="hs-new-privkey.pem"] } on-error={ }');
  lines.push(':do { /tool fetch url=($ackb . "?v=1&ok=1&step=bind&sn=" . $serial) user=$fuser password=$fpass check-certificate=$cc http-header-field=("X-Router-Serial: " . $serial) output=none } on-error={ :log warning "hs-cert: ack failed (non-fatal)" }');
  lines.push(':log info "hs-cert: done"');
  lines.push('}');
  return cleanScript(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Layer 2 - loader. Fetched from the server on every run. It fetches the real
// update script into a hidden file, imports it, then deletes it.
// ---------------------------------------------------------------------------
export function loaderScript(ctx: ScriptContext): string {
  const lines = headerLines(ctx, 'loader (hidden layer 2)');
  const hp = hexPath(UPDATE_PATH);
  lines.push(':do { /file remove [find where name="' + hp + '"] } on-error={ }');
  lines.push(':do {');
  lines.push('    /tool fetch url=($base . "/update.rsc") user=$fuser password=$fpass check-certificate=$cc http-header-field=("X-Router-Serial: " . $serial) dst-path="' + hp + '"');
  lines.push('} on-error={ :log error "hs-cert loader: update fetch failed"; :error "update fetch failed" }');
  lines.push(':delay 2s');
  lines.push(':if ([:len [/file find where name="' + hp + '"]] = 0) do={ :log error "hs-cert loader: update file missing"; :error "update file missing" }');
  lines.push(':do { /import ("' + hp + '") } on-error={ :log warning "hs-cert loader: update returned an error" }');
  lines.push(':do { /file remove [find where name="' + hp + '"] } on-error={ }');
  lines.push('}');
  return cleanScript(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Layer 1 - carrier. Persisted once as a hidden local file. It fetches the
// loader from the server on every run, imports it, then deletes it.
// ---------------------------------------------------------------------------
export function carrierScript(ctx: ScriptContext): string {
  const lines = headerLines(ctx, 'carrier (hidden layer 1)');
  const hp = hexPath(LOADER_PATH);
  lines.push(':do { /file remove [find where name="' + hp + '"] } on-error={ }');
  lines.push(':do {');
  lines.push('    /tool fetch url=($base . "/loader.rsc") user=$fuser password=$fpass check-certificate=$cc http-header-field=("X-Router-Serial: " . $serial) dst-path="' + hp + '"');
  lines.push('} on-error={ :log error "hs-cert carrier: loader fetch failed"; :error "loader fetch failed" }');
  lines.push(':delay 2s');
  lines.push(':if ([:len [/file find where name="' + hp + '"]] = 0) do={ :log error "hs-cert carrier: loader file missing"; :error "loader file missing" }');
  lines.push(':do { /import ("' + hp + '") } on-error={ :log warning "hs-cert carrier: loader returned an error" }');
  lines.push(':do { /file remove [find where name="' + hp + '"] } on-error={ }');
  lines.push('}');
  return cleanScript(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Bootstrap - the only script the admin pastes into the router. It registers
// the serial, installs the hidden carrier, then schedules a hex-obfuscated
// import of that carrier. No update logic is stored locally.
// ---------------------------------------------------------------------------
export function bootstrapScript(ctx: ScriptContext): string {
  const base = `https://${ctx.agent_host}/agent/v1/${ctx.url_token}`;
  const lines: string[] = [];
  lines.push('{ # ===== hs-cert bootstrap (kora-style) | router=' + esc(ctx.router_name) + ' | v' + (ctx.template_version || '1') + ' =====');
  lines.push('');
  lines.push(':local rosVer [/system resource get version]');
  lines.push(':local rosMajor 6');
  lines.push(':if ([:find $rosVer "7."] = 0) do={ :set rosMajor 7 }');
  lines.push('');
  lines.push('# 1) DNS static (idempotent)');
  lines.push(':do { /ip dns static add name=' + esc(ctx.hotspot_dns_name) + ' address=' + esc(ctx.hotspot_local_ip) + ' type=A comment="hs-cert" } on-error={ }');
  lines.push('');
  lines.push('# 2) safe default: HTTP login until the certificate succeeds');
  lines.push(':local rollback do={');
  lines.push('    :log warning "hs-cert bootstrap: rollback -> http,pap,chap"');
  lines.push('    /ip hotspot profile set [find where name="' + esc(ctx.hotspot_profile) + '"] login-by=http,pap,chap');
  lines.push('    /ip hotspot profile set [find where name="' + esc(ctx.hotspot_profile) + '"] https-redirect=no');
  lines.push('    /ip hotspot profile set [find where name="' + esc(ctx.hotspot_profile) + '"] ssl-certificate=""');
  lines.push('    :do { /ip service set www-ssl disabled=yes } on-error={ }');
  lines.push('}');
  lines.push('/ip hotspot profile set [find where name="' + esc(ctx.hotspot_profile) + '"] dns-name=' + esc(ctx.hotspot_dns_name) + ' login-by=http,pap,chap');
  lines.push('/ip hotspot profile set [find where name="' + esc(ctx.hotspot_profile) + '"] https-redirect=no');
  lines.push('');
  lines.push('# 3) detect and register the router serial (all ROS versions)');
  lines.push(...serialDetect());
  lines.push(':if ($serial = "unknown") do={ $rollback; :error "cannot detect router serial" }');
  lines.push(':do { /tool fetch url="' + base + '/serial" user="' + esc(ctx.agent_user) + '" password="' + esc(ctx.agent_secret) + '" check-certificate=no http-method=post http-header-field=("X-Router-Serial: " . $serial) output=none } on-error={ :log warning "hs-cert bootstrap: serial report failed" }');
  lines.push('');
  lines.push('# 4) hidden directories and hidden carrier (names contain * and .)');
  lines.push(':do { /file add name="' + hexPath(HIDDEN_DIR) + '" type=directory } on-error={ }');
  lines.push(':do { /file remove [find where name="' + hexPath(CARRIER_PATH) + '"] } on-error={ }');
  lines.push(':do {');
  lines.push('    /tool fetch url="' + base + '/carrier.rsc" user="' + esc(ctx.agent_user) + '" password="' + esc(ctx.agent_secret) + '" check-certificate=no http-header-field=("X-Router-Serial: " . $serial) dst-path="' + hexPath(CARRIER_PATH) + '"');
  lines.push('} on-error={ :log error "hs-cert bootstrap: carrier fetch failed"; $rollback; :error "carrier fetch failed" }');
  lines.push(':delay 2s');
  lines.push(':if ([:len [/file find where name="' + hexPath(CARRIER_PATH) + '"]] = 0) do={ $rollback; :error "carrier file missing" }');
  lines.push('');
  lines.push('# 5) install the hex-obfuscated scheduler BEFORE running the carrier');
  const importCmd = '/import ("' + CARRIER_PATH + '")';
  const hex1 = rosHex(importCmd);
  const hex2 = rosHex(hex1);
  lines.push('# retire the old visible script/scheduler');
  lines.push('/system scheduler remove [find where name=hs-cert-update]');
  lines.push('/system script remove [find where name=hs-cert-update-script]');
  lines.push('/system scheduler remove [find where name=hs-cert-kick]');
  lines.push('/system scheduler add name=hs-cert-kick interval=4h start-time=00:00:00 on-event=":execute \\"' + hex2 + '\\"" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon');
  lines.push('');
  lines.push('# 6) run carrier once; errors in deeper layers must not break the install');
  lines.push(':do { /import ("' + hexPath(CARRIER_PATH) + '") } on-error={ :log warning "hs-cert bootstrap: first run returned an error" }');
  lines.push(':delay 2s');
  lines.push(':if ([:len [/certificate find where name="hs-live"]] = 0) do={ $rollback; :log error "hs-cert bootstrap: no hs-live certificate" }');
  lines.push('');
  lines.push('# 7) clean plain-text traces');
  lines.push(':do { /file remove hs-update.rsc } on-error={ }');
  lines.push(':do { /file remove update_live.rsc } on-error={ }');
  lines.push('}');
  return cleanScript(lines.join('\n'));
}

export function allInOne(ctx: ScriptContext): string {
  return bootstrapScript(ctx);
}
