/**
 * Secret values in the CLI config (today: `ai.api_key`).
 *
 * The config commands print to the terminal, and that output ends up in
 * scrollback, CI logs, screen recordings and support tickets. A secret is
 * therefore never printed: `config list`, `config get` and `config set` show a
 * placeholder instead. The value itself stays readable in the 0600 config file
 * (`~/.achilles/config.json`) for whoever owns it.
 */

export const HIDDEN = '(set, hidden)';

/** A config key holds a secret when its last segment looks like one. */
export function isSecretKey(key: string): boolean {
  const last = key.split('.').pop() ?? '';
  return /(^|_)(api_?key|token|secret|password|passphrase)$/i.test(last);
}

/** A copy of `value` with every non-empty secret replaced by a placeholder. */
export function redactSecrets(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, key));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [name, child] of Object.entries(value)) {
      out[name] = redactSecrets(child, key ? `${key}.${name}` : name);
    }
    return out;
  }
  if (isSecretKey(key) && value !== undefined && value !== null && value !== '') return HIDDEN;
  return value;
}
