/**
 * spawn-role-guard.ts — identity guard for the final quality gate.
 *
 * The final gate only accepts its three registered native reviewer roles.
 * Bare or legacy-sounding names never pass by accident: legacy
 * `omo-senpi-*` aliases canonicalize to their native counterparts, and
 * anything else — generic labels like "reviewer" as well as unknown names —
 * throws so a misconfigured dispatch fails loudly instead of spawning the
 * wrong reviewer.
 */

/** The only reviewer identities the final gate accepts. */
export const REGISTERED_GATE_ROLES = [
  "omo-native-code-reviewer",
  "omo-native-qa-executor",
  "omo-native-gate-reviewer",
] as const;

/** One of the registered native gate roles. */
export type GateRoleName = (typeof REGISTERED_GATE_ROLES)[number];

/** Legacy aliases from the previous generation, canonicalized on resolve. */
const LEGACY_GATE_ROLE_ALIASES: Record<string, GateRoleName> = {
  "omo-senpi-code-reviewer": "omo-native-code-reviewer",
  "omo-senpi-qa-executor": "omo-native-qa-executor",
  "omo-senpi-gate-reviewer": "omo-native-gate-reviewer",
};

function gateRoleError(role: string): Error {
  const received = role.trim() === "" ? "(empty)" : `"${role.trim()}"`;
  return new Error(
    `Unknown gate role ${received}. Registered gate roles: ` +
      `${REGISTERED_GATE_ROLES.join(", ")}.`,
  );
}

/**
 * Canonicalize one role to its native gate identity.
 *
 * Native names pass through, legacy `omo-senpi-*` aliases resolve to their
 * native counterparts, and anything else throws.
 */
export function resolveGateRoleName(role: string): GateRoleName {
  const name = typeof role === "string" ? role.trim() : "";
  const aliased = LEGACY_GATE_ROLE_ALIASES[name];
  if (aliased !== undefined) return aliased;
  const match = (REGISTERED_GATE_ROLES as readonly string[]).includes(name);
  if (match) return name as GateRoleName;
  throw gateRoleError(role);
}

/**
 * Assert that a role is an accepted gate identity (native or legacy alias).
 * Throws on generic or unknown roles.
 */
export function assertGateRole(role: string): void {
  resolveGateRoleName(role);
}
