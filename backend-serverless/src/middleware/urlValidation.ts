import { isIP } from 'net';
import { lookup } from 'dns/promises';

/**
 * Checks whether an IP address belongs to a private, loopback, or link-local range.
 * Blocks SSRF to internal infrastructure (RFC 1918, cloud metadata, etc.)
 */
function isPrivateIP(ip: string): boolean {
  const parts = ip.split('.').map(Number);

  // IPv4 private/reserved ranges
  if (parts.length === 4) {
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 127.0.0.0/8 (loopback)
    if (parts[0] === 127) return true;
    // 169.254.0.0/16 (link-local / cloud metadata)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 0.0.0.0
    if (parts.every(p => p === 0)) return true;
  }

  // IPv6 loopback and private
  if (ip === '::1' || ip === '::' || ip.startsWith('fe80:') || ip.startsWith('fc00:') || ip.startsWith('fd')) {
    return true;
  }

  return false;
}

/**
 * Validates a URL for SSRF safety. Resolves the hostname and checks that
 * it does not point to a private/loopback/link-local IP address.
 *
 * @param url The URL to validate
 * @param allowedPatterns Optional regex patterns for allowed URL formats (e.g., Slack webhook)
 * @throws Error if the URL targets a private IP range
 */
export async function validateUrlForSSRF(url: string, allowedPatterns?: RegExp[]): Promise<void> {
  // If allowedPatterns provided, check that the URL matches at least one
  if (allowedPatterns && allowedPatterns.length > 0) {
    const matches = allowedPatterns.some(p => p.test(url));
    if (!matches) {
      throw new Error(`URL does not match allowed patterns`);
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL format');
  }

  // Only allow http/https schemes
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`URL scheme '${parsed.protocol}' is not allowed. Use http: or https:`);
  }

  const hostname = parsed.hostname;

  // If hostname is already an IP, check directly
  if (isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new Error('URL targets a private or reserved IP address');
    }
    return;
  }

  // Resolve hostname to IP and check
  try {
    const { address } = await lookup(hostname);
    if (isPrivateIP(address)) {
      throw new Error('URL hostname resolves to a private or reserved IP address');
    }
  } catch (err) {
    // DNS resolution failed — could be a non-existent host
    if (err instanceof Error && err.message.includes('private')) {
      throw err; // Re-throw our own error
    }
    throw new Error(`Cannot resolve hostname '${hostname}'`);
  }
}

/**
 * Validates a hostname:port for SSRF safety (for SMTP servers etc.)
 */
export async function validateHostForSSRF(host: string): Promise<void> {
  // Wrap as URL for uniform validation
  await validateUrlForSSRF(`https://${host}`);
}
