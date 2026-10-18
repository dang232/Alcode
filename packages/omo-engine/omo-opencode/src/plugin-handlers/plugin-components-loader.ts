import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OhMyOpenCodeConfig } from "../config/schema/oh-my-opencode-config";
import type { OmoPluginComponents } from "../plugin-types";

const DEFAULT_PLUGIN_LOAD_TIMEOUT_MS = 10000;

const EMPTY_INDEX: OmoPluginComponents = {
  commandNames: [],
  skillNames: [],
};

function listCommandNames(root: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      found.push(entry.name.slice(0, -".md".length));
    }
  }
  return found;
}

function listSkillNames(root: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (existsSync(join(root, entry.name, "SKILL.md"))) {
      found.push(entry.name);
    }
  }
  return found;
}

function commandRoots(directory: string): string[] {
  return [
    join(directory, ".claude", "commands"),
    join(directory, ".agents", "commands"),
    join(homedir(), ".claude", "commands"),
  ];
}

function skillRoots(directory: string): string[] {
  return [
    join(directory, ".claude", "skills"),
    join(directory, ".agents", "skills"),
    join(homedir(), ".claude", "skills"),
  ];
}

function discoverIndex(directory: string): OmoPluginComponents {
  const commandNames = new Set<string>();
  for (const root of commandRoots(directory)) {
    try {
      for (const name of listCommandNames(root)) commandNames.add(name);
    } catch {
      continue;
    }
  }
  const skillNames = new Set<string>();
  for (const root of skillRoots(directory)) {
    try {
      for (const name of listSkillNames(root)) skillNames.add(name);
    } catch {
      continue;
    }
  }
  return {
    commandNames: [...commandNames].sort(),
    skillNames: [...skillNames].sort(),
  };
}

function timeoutAfter(ms: number): { promise: Promise<never>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Plugin component discovery timed out after ${ms}ms`));
    }, ms);
  });
  return {
    promise,
    cancel: () => {
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

/**
 * Indexes installed component names for the config pipeline. Each discovery
 * root is read in isolation so one unreadable directory cannot fail the
 * whole index, and the full scan races the configured plugin load timeout
 * (default 10000ms). A timeout or unexpected failure yields an empty index
 * flagged as retryable so the caller can try again on the next pass.
 */
export async function loadPluginComponents(params: {
  directory: string;
  pluginConfig: OhMyOpenCodeConfig;
}): Promise<OmoPluginComponents> {
  if (params.pluginConfig.claude_code?.plugins === false) {
    return { ...EMPTY_INDEX };
  }
  const timeoutMs =
    params.pluginConfig.experimental?.plugin_load_timeout_ms ?? DEFAULT_PLUGIN_LOAD_TIMEOUT_MS;
  const gate = timeoutAfter(timeoutMs);
  try {
    const index = await Promise.race([Promise.resolve().then(() => discoverIndex(params.directory)), gate.promise]);
    return index;
  } catch {
    return { ...EMPTY_INDEX, retryableLoadFailure: true };
  } finally {
    gate.cancel();
  }
}
