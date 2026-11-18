/**
 * Where a server address points: this machine, the user's own network, or the
 * internet. The instance switcher uses it to tell a user which of the three
 * self-hosted modes they are looking at, and to reject an address that cannot
 * be a server before it reaches the host list.
 *
 * Pure and dependency-free: no fetching, no window, no state.
 */

export type InstanceMode = 'local' | 'lan' | 'vps';

export type ServerUrlError = 'empty' | 'invalid' | 'protocol' | 'credentials' | 'fragment';

export type ClassifiedServerUrl =
  | { ok: true; mode: InstanceMode; url: string; host: string }
  | { ok: false; code: ServerUrlError };

const LOOPBACK_HOSTS = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost']);

const isLoopbackIpv4 = (host: string): boolean => {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  if (parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  if (parts.some((part) => Number(part) > 255)) return false;
  return parts[0] === '127';
};

const isPrivateIpv4 = (host: string): boolean => {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  if (parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const values = parts.map(Number);
  if (values.some((value) => value > 255)) return false;
  const [first, second] = values as [number, number, number, number];
  if (first === 10) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 169 && second === 254) return true;
  return false;
};

const stripBrackets = (host: string): string => (host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host);

/**
 * Reads the address a user typed and answers which mode it belongs to. A
 * trailing slash is normalized away so the stored host matches the probe.
 */
export const classifyServerUrl = (input: string): ClassifiedServerUrl => {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (raw === '') return { ok: false, code: 'empty' };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, code: 'invalid' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, code: 'protocol' };
  if (parsed.username !== '' || parsed.password !== '') return { ok: false, code: 'credentials' };
  if (parsed.hash !== '') return { ok: false, code: 'fragment' };

  const host = stripBrackets(parsed.hostname).toLowerCase();
  if (host === '') return { ok: false, code: 'invalid' };

  if (LOOPBACK_HOSTS.has(host) || isLoopbackIpv4(host) || host === '::1') {
    return { ok: true, mode: 'local', url: normalizeUrl(parsed), host };
  }
  if (host.endsWith('.local') || isPrivateIpv4(host) || !host.includes('.')) {
    return { ok: true, mode: 'lan', url: normalizeUrl(parsed), host };
  }
  return { ok: true, mode: 'vps', url: normalizeUrl(parsed), host };
};

const normalizeUrl = (parsed: URL): string => {
  const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
  return `${parsed.origin}${pathname}`;
};

export type InstanceModeLabelKey = 'instanceMode.local' | 'instanceMode.lan' | 'instanceMode.vps';

/**
 * Human-facing label key for a mode, so the UI keeps one vocabulary.
 */
export const instanceModeLabelKey = (mode: InstanceMode): InstanceModeLabelKey => {
  if (mode === 'local') return 'instanceMode.local';
  if (mode === 'lan') return 'instanceMode.lan';
  return 'instanceMode.vps';
};
