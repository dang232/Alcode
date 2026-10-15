const CORE_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
/** `1.22.0` or `>=1.22.0`. Ranges beyond a floor are not accepted. */
export const ALCODE_ENGINE_PATTERN = /^(>=)?\d+\.\d+\.\d+$/;

type AlcodeVersionParts = {
  major: number;
  minor: number;
  patch: number;
};

export const parseAlcodeVersion = (value: string): AlcodeVersionParts | null => {
  const core = String(value || '').trim().replace(/^v/i, '').split(/[-+]/)[0] ?? '';
  const match = CORE_VERSION.exec(core);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
};

export const compareAlcodeVersions = (left: string, right: string): number => {
  const a = parseAlcodeVersion(left);
  const b = parseAlcodeVersion(right);
  if (!a || !b) {
    return 0;
  }
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
};

/** Normalize `>=1.22.0` / `1.22.0` to the floor version string. */
export const alcodeEngineMinimum = (engine: string): string | null => {
  const trimmed = engine.trim();
  if (!ALCODE_ENGINE_PATTERN.test(trimmed)) {
    return null;
  }
  const floor = trimmed.startsWith('>=') ? trimmed.slice(2) : trimmed;
  return parseAlcodeVersion(floor) ? floor : null;
};

/**
 * True when this Alcode build is new enough for the guest's `engines.alcode`.
 * Unknown host versions fail closed when an engine is declared.
 */
export const hostMeetsAlcodeEngine = (
  hostVersion: string,
  engine: string,
): boolean => {
  const minimum = alcodeEngineMinimum(engine);
  if (!minimum) {
    return false;
  }
  if (!parseAlcodeVersion(hostVersion)) {
    return false;
  }
  return compareAlcodeVersions(hostVersion, minimum) >= 0;
};
