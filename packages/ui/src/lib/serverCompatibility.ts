import { z } from 'zod';
import { runtimeFetch } from './runtime-fetch';

const versionResponse = z.object({
  /**
   * The OpenCode version the server actually manages. This is the number the 2.x route guard is
   * about: `describeOpenCodeCompatibility` reports it with `minimumVersion` (2.0.20).
   */
  compatibility: z.object({ version: z.string().nullable() }).optional(),
  /** The product's own version. Kept only as the fallback for servers that predate `compatibility`. */
  openchamberVersion: z.string().optional(),
});

/**
 * The OpenCode version the connected server manages, over whatever transport the app uses
 * (direct, tunnel, relay). Servers that do not report `compatibility` fall back to their product
 * version, which is what the guard compared before the server started reporting OpenCode.
 * `null` when the server says nothing, which is not evidence of an old server.
 */
export const fetchConnectedServerVersion = async (
  signal: AbortSignal,
  request: typeof runtimeFetch = runtimeFetch,
): Promise<string | null> => {
  const response = await request('/api/version', {
    signal,
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) return null;
  const parsed = versionResponse.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return null;
  // OpenCode first: the product's own version says nothing about which routes the server serves.
  if (parsed.data.compatibility !== undefined) {
    return parsed.data.compatibility.version?.trim() || null;
  }
  const product = parsed.data.openchamberVersion?.trim();
  return product ? product : null;
};

/**
 * A server before 2.0 runs OpenCode 1.x and answers the 2.x routes this app
 * calls with its web page. A version that does not parse says nothing.
 */
export const isServerBeforeOpenCode2 = (version: string): boolean => {
  const major = /^(\d+)\./.exec(version)?.[1];
  return major !== undefined && Number(major) < 2;
};
