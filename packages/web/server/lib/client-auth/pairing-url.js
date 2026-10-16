// Pairing connection link codec (pairing v2).
//
// A link carries the one-time pairing secret plus the candidate transports:
// `alcode://connect?v=2&p=<base64url(JSON)>`. The pre-rename
// `openchamber://` scheme decodes to the same payload; new links are always
// minted with the `alcode://` scheme. The browser package mirrors this codec
// (`packages/ui/src/lib/connectionPayload.ts`); keep the wire form in sync.

const CONNECT_SCHEMES = new Set(['alcode', 'openchamber']);
const CONNECT_PATH = 'connect';

/** Mint a pairing connection link for `payload` (v2, base64url JSON). */
export const encodePairingConnectUrl = (payload) => {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `alcode://connect?v=2&p=${encoded}`;
};

/**
 * Parse a pairing connection link minted by `encodePairingConnectUrl`,
 * accepting both the `alcode://` and the legacy `openchamber://` scheme.
 * Returns the payload, or null when the link is not a well-formed v2 link.
 */
export const decodePairingConnectUrl = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const schemeEnd = trimmed.indexOf('://');
  if (schemeEnd <= 0) return null;
  if (!CONNECT_SCHEMES.has(trimmed.slice(0, schemeEnd).toLowerCase())) return null;
  const rest = trimmed.slice(schemeEnd + '://'.length);
  const queryStart = rest.indexOf('?');
  if (queryStart <= 0) return null;
  const pathPart = rest.slice(0, queryStart).replace(/\/+$/, '');
  if (pathPart.toLowerCase() !== CONNECT_PATH) return null;
  let params;
  try {
    params = new URLSearchParams(rest.slice(queryStart + 1));
  } catch {
    return null;
  }
  if (params.get('v') !== '2') return null;
  const encoded = params.get('p');
  if (!encoded) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (payload.v !== 2) return null;
  if (typeof payload.pairingId !== 'string' || payload.pairingId.trim().length === 0) return null;
  if (typeof payload.secret !== 'string' || payload.secret.length === 0) return null;
  return payload;
};
