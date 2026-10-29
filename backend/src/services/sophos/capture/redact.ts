// Consistent redaction for Sophos PoC captures.
//
// The capture kit's output becomes verbatim test fixtures, so two things must
// hold at once: nothing that identifies the customer's tenant survives
// (hostnames, users, domains, emails, IPs, MACs, tenant/endpoint ids), and
// everything Achilles correlates on does (event types, origins, remedy result
// codes, ATT&CK ids, timestamps, severities, hashes, and any file name under
// C:\F0 or /opt/f0).
//
// Every distinct value gets one stable pseudonym, shared across all fields and
// across calls that reuse the same map. The walk is two-pass: pass 1 learns
// the sensitive values from well-known keys, pass 2 rewrites keyed fields and
// scrubs every other string (free text) by substituting what pass 1 learned
// plus pattern-based detection (email, IP, MAC, UUID, Users dirs).

type Kind = 'host' | 'user' | 'domain' | 'email' | 'ipv4' | 'ipv6' | 'mac' | 'uuid' | 'tenant' | 'hostid' | 'label' | 'dir' | 'sid';

const HOST_KEYS = new Set(['hostname', 'host_name', 'computer_name', 'computername', 'dhost', 'shost']);
const FQDN_KEYS = new Set(['hostname_fqdn', 'fqdn']);
const USER_KEYS = new Set(['username', 'user_name', 'original_user_name', 'vialogin', 'logon_user', 'login_name', 'source', 'duser', 'suser']);
const DOMAIN_KEYS = new Set(['domain_name', 'auth_domain', 'dnsdomain', 'dns_domain']);
const TENANT_KEYS = new Set(['tenant_id', 'parent_tenant_id', 'tenantid', 'customer_id']);
const HOSTID_KEYS = new Set(['host_id', 'sensor_id', 'hostid']);
/** `name`-like keys are default-deny: pseudonymised unless the parent says it is harmless. */
const NAME_KEYS = new Set(['name', 'full_name', 'fullname']);
const PERSON_PARENTS = new Set(['associatedperson', 'person', 'createdby', 'modifiedby', 'updatedby', 'owner', 'user', 'assignee', 'author']);
const HOST_PARENTS = /^(?:endpoints?|hosts?|devices?|computers?|agents?|managedagent)$/;
/** Parents under which a `name` is a product/OS/event label, not customer data. */
const SAFE_NAME_PARENTS = /^(?:os|osinfo|products?|packages?|services?|technique|tactic|category|checks?|settings?|sensors?|engine|creator)$|event|alert|detection|threat|mitre/;
/** Any ancestor key that marks a vendor product/feature/OS list: `name` below it is a product name. */
const SAFE_NAME_TRAIL = /\/(?:assignedproducts?|products?|features?|packages?|modules?|services?|servicedetails|os|platform)(?:\/|$)/;
/** Sophos product / enum tokens: never customer data, never learned for free-text replacement. */
const KNOWN_TOKENS = new Set([
  'xdr', 'mtr', 'edr', 'interceptx', 'coreagent', 'endpointprotection', 'deviceencryption', 'ztna', 'windows', 'linux', 'macos',
  'computer', 'server', 'good', 'bad', 'suspicious', 'unknown', 'running', 'stopped', 'installed', 'assigned', 'protection',
  'sophos', 'high', 'medium', 'low', 'critical', 'info', 'true', 'false', 'null', 'none',
]);
const MIN_LEARN_LENGTH = 4;
/** Short values are only too ambiguous for free text when they came from a generic `name` key (label); a 3-letter user or host is still learned. */
const learnable = (orig: string, pseudo: string) =>
  orig.length >= (/^name-\d+$/.test(pseudo) ? MIN_LEARN_LENGTH : 3) && !KNOWN_TOKENS.has(orig.toLowerCase());
const PATH_KEYS = new Set(['path', 'value', 'location']);
const STANDARD_DIRS = new Set([
  'windows', 'system32', 'syswow64', 'winsxs', 'program files', 'program files (x86)', 'programdata', 'users', 'temp', 'tmp',
  'appdata', 'local', 'roaming', 'locallow', 'microsoft', 'windows defender', 'windowsapps', 'documents and settings', 'desktop',
  'documents', 'downloads', 'public', 'default', 'all users', '$recycle.bin', 'system volume information',
  'usr', 'bin', 'sbin', 'lib', 'lib64', 'etc', 'var', 'opt', 'home', 'system', 'library', 'applications', 'private', 'dev', 'proc',
  'mnt', 'volumes', 'application support', 'share', 'run', 'srv',
]);

const WELL_KNOWN_USERS = new Set(['system', 'local service', 'network service', 'administrator', 'root', 'public', 'default', 'default user', 'all users']);
const WELL_KNOWN_DOMAINS = new Set(['nt authority', 'builtin', 'nt service', 'window manager', 'font driver host']);
const VERSIONISH_KEYS = /version|build/i;
const SEP_RE = /[\\/]/;

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const IPV4_RE = /(?<![\d.])(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}(?![\d.]*\d)/g;
const IPV6_RE = /(?<![\w:])(?:(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6})?|::(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6}))(?![\w:])/g;
const MAC_RE = /(?<![0-9a-fA-F:-])[0-9a-fA-F]{2}(?:[:-][0-9a-fA-F]{2}){5}(?![0-9a-fA-F:-])/g;
const SID_RE = /(?<![\w-])S-1-\d+(?:-\d+)+(?![\w-])/gi;
/** Well-known SIDs (SYSTEM, LOCAL SERVICE, Administrators, mandatory labels...) carry no tenant data. */
const WELL_KNOWN_SID_RE = /^S-1-(?:[0-4]-\d+|5-\d{1,2}|5-32-\d+|16-\d+)$/i;
const USERS_DIR_RE = /(?<=[\\/](?:Users|home)[\\/])[^\\/\s"'<>|*?:]+/g;
const ALERT_TENANT_RE = /(?<=:\/\/priv:[^:\s"']+:)\d+(?=:)/g;
/** Achilles' own artefacts: kept verbatim so tests can be correlated. Stops at separators that can start other data. */
const PROTECTED_RE = /(?:[A-Za-z]:\\F0(?![A-Za-z0-9])|\/opt\/f0(?![A-Za-z0-9]))[^\s"'<>|*?;,)\]@]*/gi;

const isPseudonym = (v: string) =>
  /^(?:192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)\d+$/.test(v) || /^2001:db8::/i.test(v) ||
  /^00000000-0000-4000-8000-[0-9a-f]{12}$/.test(v) || /@example\.test$/.test(v) || /^02:00:00:00:/.test(v);

const isIdKey = (key: string) =>
  !/^(?:process|thread|session|rule|event)_?id$|^pid$/i.test(key) && (key === 'id' || /_id$/i.test(key) || /[a-z]Id$/.test(key));

const looksFileOrPath = (v: string) => SEP_RE.test(v) || /\.(?:exe|dll|sys|bat|ps1|msi|com|scr|js|vbs|lnk|bin|sh|dat|tmp)$/i.test(v);

class Redactor {
  private counters = new Map<Kind, number>();
  /** Every pseudonym handed out (or carried in on a reused map): never re-redacted. */
  private outputs = new Set<string>();
  constructor(readonly map: Map<string, string>) {
    // A reused map keeps its numbering: continue after the highest pseudonym per kind.
    for (const p of map.values()) {
      this.outputs.add(p);
      const kind = Redactor.kindOf(p);
      if (!kind) continue;
      const n = Redactor.numberOf(kind, p);
      this.counters.set(kind, Math.max(this.counters.get(kind) ?? 0, n));
    }
  }

  private static kindOf(p: string): Kind | null {
    if (/^host-\d+(\.example\.test)?$/.test(p)) return 'host';
    if (/^user-\d+$/.test(p)) return 'user';
    if (/^domain-\d+$/.test(p)) return 'domain';
    if (/^user-\d+@example\.test$/.test(p)) return 'email';
    if (/^(?:192\.0\.2|198\.51\.100|203\.0\.113)\.\d+$/.test(p)) return 'ipv4';
    if (/^2001:db8::/.test(p)) return 'ipv6';
    if (/^02:00:00:00:/.test(p)) return 'mac';
    if (/^00000000-0000-4000-8000-/.test(p)) return 'uuid';
    if (/^9\d{5}$/.test(p)) return 'tenant';
    if (/^hostid-\d+$/.test(p)) return 'hostid';
    if (/^name-\d+$/.test(p)) return 'label';
    if (/^dir-\d+$/.test(p)) return 'dir';
    if (/^S-1-5-21-111111111-222222222-333333333-\d+$/.test(p)) return 'sid';
    return null;
  }

  private static numberOf(kind: Kind, p: string): number {
    switch (kind) {
      case 'ipv4': {
        const [, base, n] = /^(.*)\.(\d+)$/.exec(p) ?? [];
        return (['192.0.2', '198.51.100', '203.0.113'].indexOf(base ?? '') * 254) + Number(n);
      }
      case 'ipv6': return parseInt(p.slice('2001:db8::'.length), 16) || 0;
      case 'mac': return parseInt(p.slice(-2), 16) || 0;
      case 'uuid': return parseInt(p.slice(-12), 16) || 0;
      case 'tenant': return Number(p) - 900000;
      case 'sid': return Number(p.slice(p.lastIndexOf('-') + 1)) - 1000;
      case 'email': return Number(/user-(\d+)@/.exec(p)?.[1] ?? 0);
      default: return Number(/(\d+)/.exec(p)?.[1] ?? 0);
    }
  }

  private make(kind: Kind, n: number): string {
    const pad = String(n).padStart(3, '0');
    switch (kind) {
      case 'host': return `host-${pad}`;
      case 'user': return `user-${pad}`;
      case 'domain': return `domain-${pad}`;
      case 'email': return `user-${pad}@example.test`;
      case 'ipv4': {
        const blocks = ['192.0.2', '198.51.100', '203.0.113'];
        const i = n - 1;
        return `${blocks[Math.floor(i / 254) % 3]}.${(i % 254) + 1}`;
      }
      case 'ipv6': return `2001:db8::${n.toString(16)}`;
      case 'mac': return `02:00:00:00:${Math.floor(n / 256).toString(16).padStart(2, '0')}:${(n % 256).toString(16).padStart(2, '0')}`;
      case 'uuid': return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
      case 'tenant': return String(900000 + n);
      case 'hostid': return `hostid-${pad}`;
      case 'label': return `name-${pad}`;
      case 'dir': return `dir-${pad}`;
      case 'sid': return `S-1-5-21-111111111-222222222-333333333-${1000 + n}`;
    }
  }

  /** Stable pseudonym for `value`. Case-insensitive kinds are keyed lower-case. */
  pseudonym(kind: Kind, value: string): string {
    const ci = kind !== 'tenant' && kind !== 'hostid';
    const key = ci ? value.toLowerCase() : value;
    const existing = this.map.get(key);
    if (existing !== undefined) return existing;
    const n = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, n);
    const p = this.make(kind, n);
    this.map.set(key, p);
    this.outputs.add(p);
    return p;
  }

  // ---- keyed rewrites ---------------------------------------------------
  /** Pseudonym for a value under a sensitive key, or undefined when the key is not sensitive. */
  private keyed(key: string, parent: string, value: string, trail = ''): string | undefined {
    const k = key.toLowerCase();
    const p = parent.toLowerCase();
    if (HOST_KEYS.has(k)) return this.pseudonym('host', value);
    if (k === 'location' && !SEP_RE.test(value)) return this.pseudonym('host', value);
    if ((k === 'display_name' || k === 'displayname') && !looksFileOrPath(value)) return this.host(value);
    if (FQDN_KEYS.has(k)) return this.host(value);
    if (DOMAIN_KEYS.has(k)) return WELL_KNOWN_DOMAINS.has(value.toLowerCase()) ? value : this.pseudonym('domain', value);
    if (USER_KEYS.has(k)) return this.user(value);
    if (NAME_KEYS.has(k)) {
      if (SAFE_NAME_PARENTS.test(p) || SAFE_NAME_TRAIL.test(`${trail}/`) || KNOWN_TOKENS.has(value.toLowerCase())) return undefined;
      if (HOST_PARENTS.test(p)) return this.host(value);
      if (PERSON_PARENTS.has(p)) return this.user(value);
      return this.pseudonym('label', value);
    }
    if (TENANT_KEYS.has(k)) return /^\d+$/.test(value) ? this.pseudonym('tenant', value) : this.pseudonym('uuid', value);
    if (HOSTID_KEYS.has(k)) return this.pseudonym('hostid', value);
    return undefined;
  }

  /** Short name or FQDN. For an FQDN the domain suffix is learned as a domain too. */
  private host(value: string): string {
    const dot = value.indexOf('.');
    if (dot < 0) return this.pseudonym('host', value);
    const base = this.pseudonym('host', value.slice(0, dot));
    const rest = value.slice(dot + 1);
    if (rest) this.pseudonym('domain', rest);
    const full = `${base}.example.test`;
    this.map.set(value.toLowerCase(), full);
    this.outputs.add(full);
    return full;
  }

  private user(value: string): string {
    if (value.includes('@')) return this.pseudonym('email', value);
    const m = /^([^\\]+)\\(.+)$/.exec(value);
    if (!m) return WELL_KNOWN_USERS.has(value.toLowerCase()) ? value : this.pseudonym('user', value);
    const [, domain, name] = m as unknown as [string, string, string];
    const d = WELL_KNOWN_DOMAINS.has(domain.toLowerCase()) ? domain : this.pseudonym('domain', domain);
    const u = WELL_KNOWN_USERS.has(name.toLowerCase()) ? name : this.pseudonym('user', name);
    return `${d}\\${u}`;
  }

  // ---- walk ----------------------------------------------------------------
  /**
   * One walk that both learns and rewrites. redactCapture() runs it twice: the
   * first run registers every sensitive value (so a hostname that is only
   * learnable from a later field still gets replaced in earlier free text), the
   * second run produces the output with the complete map.
   */
  transform(value: unknown, key = '', parent = '', trail = ''): unknown {
    if (Array.isArray(value)) return value.map((v) => this.transform(v, key, parent, trail));
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      const nextTrail = `${trail}/${key.toLowerCase()}`;
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[this.scrub(k, true)] = this.transform(v, k, key, nextTrail);
      }
      return out;
    }
    if (typeof value === 'number') {
      return isIdKey(key) && Number.isInteger(value) && Math.abs(value) >= 1000 ? Number(this.pseudonym('tenant', String(value))) : value;
    }
    if (typeof value !== 'string' || value === '') return value;

    const keyed = this.keyed(key, parent, value, trail);
    if (keyed !== undefined) return keyed;
    const k = key.toLowerCase();
    if (k === 'comment') return 'redacted-comment';
    if (PATH_KEYS.has(k) && (SEP_RE.test(value) || /exclusion|allowed/.test(trail))) return this.scrub(this.scrubPath(value), false);
    return this.scrub(value, VERSIONISH_KEYS.test(key));
  }

  /** Keep standard OS directories, Achilles' own C:\F0, drives and wildcards; pseudonymise every other path segment. */
  private scrubPath(input: string): string {
    const kept: string[] = [];
    const s = input.replace(PROTECTED_RE, (m) => { kept.push(m); return `\u0000${kept.length - 1}\u0000`; });
    let prev = '';
    const out = s.split(/([\\/]|\u0000\d+\u0000)/).map((t) => {
      if (t === '' || /^[\\/]$/.test(t)) return t;
      if (/^\u0000\d+\u0000$/.test(t)) { prev = ''; return t; }
      const lower = t.toLowerCase();
      const before = prev;
      prev = lower;
      if (/^[A-Za-z]:$/.test(t) || /^%[^%]+%$/.test(t) || t === '~' || t === '.' || t === '..') return t;
      if (/^[*?.]+$/.test(t) || /^\*\.[A-Za-z0-9]+$/.test(t)) return t;
      if (this.outputs.has(t)) return t;
      if (before === 'users' || before === 'home') return WELL_KNOWN_USERS.has(lower) ? t : this.pseudonym('user', t);
      if (STANDARD_DIRS.has(lower)) return t;
      return this.pseudonym('dir', t);
    }).join('');
    // eslint-disable-next-line no-control-regex
    return out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => kept[Number(i)] ?? '');
  }

  /** Free-text scrub: known values first (longest first), then pattern detection. */
  scrub(input: string, skipIps: boolean): string {
    const kept: string[] = [];
    let s = input.replace(PROTECTED_RE, (m) => { kept.push(m); return `\u0000${kept.length - 1}\u0000`; });

    const known = [...this.map.entries()]
      .filter(([orig, pseudo]) => learnable(orig, pseudo) && !isPseudonym(orig))
      .sort((a, b) => b[0].length - a[0].length);
    for (const [orig, pseudo] of known) {
      const esc = orig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (/^host-\d+$/.test(pseudo)) {
        // A learned short host followed by more labels is an FQDN: consume the suffix too.
        const re = new RegExp(`(?<![A-Za-z0-9])${esc}((?:\\.[A-Za-z0-9-]+)+)?(?![A-Za-z0-9])`, 'gi');
        s = s.replace(re, (_m, suffix: string | undefined) => (suffix ? `${pseudo}.example.test` : pseudo));
      } else {
        s = s.replace(new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`, 'gi'), () => pseudo);
      }
    }

    s = s.replace(EMAIL_RE, (m) => (isPseudonym(m) ? m : this.pseudonym('email', m)));
    s = s.replace(SID_RE, (m) => (WELL_KNOWN_SID_RE.test(m) || this.outputs.has(m) ? m : this.pseudonym('sid', m)));
    s = s.replace(UUID_RE, (m) => (isPseudonym(m) ? m : this.pseudonym('uuid', m)));
    s = s.replace(MAC_RE, (m) => (isPseudonym(m) ? m : this.pseudonym('mac', m)));
    s = s.replace(ALERT_TENANT_RE, (m) => (this.outputs.has(m) ? m : this.pseudonym('tenant', m)));
    s = s.replace(USERS_DIR_RE, (m) => (WELL_KNOWN_USERS.has(m.toLowerCase()) || this.outputs.has(m) ? m : this.pseudonym('user', m)));
    if (!skipIps) {
      s = s.replace(IPV6_RE, (m) => (isPseudonym(m) || m === '::1' || m === '::' ? m : this.pseudonym('ipv6', m)));
      s = s.replace(IPV4_RE, (m) => (isPseudonym(m) || m === '0.0.0.0' || m.startsWith('127.') ? m : this.pseudonym('ipv4', m)));
    }
    // eslint-disable-next-line no-control-regex
    return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => kept[Number(i)] ?? '');
  }
}

/**
 * Redact a captured API payload. Pass the same `map` to several calls (or call
 * once on a combined object) to keep pseudonyms consistent across files.
 * The map holds original value (lower-cased for case-insensitive kinds) ->
 * pseudonym, so it must never be written to disk or sent back.
 */
export function redactCapture(value: unknown, map: Map<string, string> = new Map()): unknown {
  const r = new Redactor(map);
  r.transform(value); // pass 1: learn
  return r.transform(value); // pass 2: rewrite with the complete map
}

/**
 * Redact the raw capture and its manifest together (consistent pseudonyms) while
 * leaving the endpoint names that key both objects untouched: they become the
 * output file names and are Achilles' own constants, not customer data.
 */
export function redactCaptureSet<M>(raw: Record<string, unknown>, manifest: Record<string, M>): { raw: Record<string, unknown>; manifest: Record<string, M> } {
  const rawKeys = Object.keys(raw);
  const manKeys = Object.keys(manifest);
  const out = redactCapture({ raw: rawKeys.map((k) => raw[k]), manifest: manKeys.map((k) => manifest[k]) }) as { raw: unknown[]; manifest: M[] };
  return {
    raw: Object.fromEntries(rawKeys.map((k, i) => [k, out.raw[i]])),
    manifest: Object.fromEntries(manKeys.map((k, i) => [k, out.manifest[i] as M])),
  };
}
