import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { z } from "zod";

const SELF_TEST_FLAG = "--self-test";
const ENGINE_ROOT_FLAG = "--engine-root";

const fail = (message: string): never => {
  console.error(`[omo-invoker-worker] ${message}`);
  process.exit(2);
};

const jobSchema = z.object({
  message: z.string().trim().min(1),
  // Job kind: the bridge always sends this explicitly. "wrapper" makes
  // the worker spawn wrapperEntry with wrapperArgv and relay its stdio;
  // "native" imports the engine run barrel in-process. Hand-driven jobs
  // without a kind infer it: a wrapper entry present reads as wrapper.
  kind: z.enum(["wrapper", "native"]).optional(),
  wrapperEntry: z.string().trim().min(1).optional(),
  wrapperArgv: z.array(z.string()).optional(),
  agent: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  directory: z.string().trim().min(1).optional(),
  sessionId: z.string().trim().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  attach: z.string().trim().min(1).optional(),
});

type Job = z.infer<typeof jobSchema>;

interface RunOptions {
  message: string;
  agent?: string;
  model?: string;
  directory?: string;
  sessionId?: string;
  port?: number;
  attach?: string;
  json?: boolean;
}

interface RunFn {
  (options: RunOptions): Promise<number>;
}

const args = process.argv.slice(2);
const engineRootIndex = args.indexOf(ENGINE_ROOT_FLAG);
// --engine-root is required per mode below (self-test, loop-status, and
// native-kind jobs), not up front: wrapper-kind jobs never touch the
// engine tree, so a wrapper-only machine runs without one.
const engineRoot = engineRootIndex === -1 ? null : args[engineRootIndex + 1]?.trim() || null;
const selfTest = args.includes(SELF_TEST_FLAG);

// Optional direct barrel override for vendored trees that do not keep
// the engine packages/ layout (e.g. Alcode packages/omo-engine).
const barrelIndex = args.indexOf("--barrel-path");
const barrelOverride = barrelIndex === -1 ? null : args[barrelIndex + 1]?.trim() || null;
if (barrelIndex !== -1 && !barrelOverride) fail("missing --barrel-path <file>");
const resolveBarrelSpecifier = (root: string): string => {
  const specifier = barrelOverride ?? `${root}/packages/omo-opencode/src/cli/run/index.ts`;
  // Bare relative paths are package names to the loader and module-relative
  // paths anchor to this file, not the shell: resolve everything that is not
  // already absolute or URL-shaped against the working directory. The scheme
  // check requires :// so Windows drive letters (C:\...) are not mistaken
  // for URLs.
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(specifier) ? specifier : pathToFileURL(path.resolve(specifier)).href;
};
// The run barrel loads lazily: loop-status serves pure state reads and
// must never pay for (or fail on) the run entry.
const loadBarrel = async (specifier: string): Promise<Record<string, RunFn>> =>
  // SAFETY: dynamic import of a third-party barrel; shape verified by the run-function check (and by --self-test output).
  (await import(specifier).catch((error) => {
    fail(`cannot import engine run barrel: ${error instanceof Error ? error.message : error}`);
  })) as Record<string, RunFn>;

if (selfTest) {
  if (!engineRoot) fail(`missing ${ENGINE_ROOT_FLAG} <dir>`);
  // SAFETY: fail() above exits the process, so engineRoot is a string here.
  const barrel = await loadBarrel(resolveBarrelSpecifier(engineRoot as string));
  console.log(JSON.stringify({ ok: true, exports: Object.keys(barrel).sort() }));
  process.exit(0);
}

// Loop-status mode: pure state reads over a ulw-loop state tree, no
// execution, no session, no spend. T2 loop-status contract:
//   --loop-status [--session <id>] [--limit <n>] [--loop-src <dir>]
// (--loop-src selects the reader modules and defaults to the engine-layout
// component dir; the repo root handed to those readers is the working
// directory.) Prints one JSON line { ok:true, sessionId, plan, ledgerTail }.
// A bad session id, missing state, or unreadable readers degrade to
// plan:null + ledgerTail:[] with exit 0; only unknown flags or missing
// values fail closed with exit 2.
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const DEFAULT_LOOP_LIMIT = 50;
const MAX_LOOP_LIMIT = 500;
const clampLoopLimit = (limit: number): number => {
  if (!Number.isFinite(limit)) return DEFAULT_LOOP_LIMIT;
  return Math.max(1, Math.min(MAX_LOOP_LIMIT, Math.floor(limit)));
};

const loopStatusIndex = args.indexOf("--loop-status");
if (loopStatusIndex !== -1 && !engineRoot) fail(`missing ${ENGINE_ROOT_FLAG} <dir>`);
if (loopStatusIndex !== -1) {
  let sessionId: string | null = null;
  let sessionValid = true;
  let ledgerLimit = DEFAULT_LOOP_LIMIT;
  let loopSrc = `${engineRoot}/packages/omo-codex/plugin/components/ulw-loop/src`;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--loop-status") continue;
    if (arg === "--engine-root" || arg === "--barrel-path") {
      if (args[i + 1] === undefined) fail(`missing value for ${arg}`);
      i++;
      continue;
    }
    if (arg === "--session") {
      const raw = args[i + 1];
      if (raw === undefined) fail("missing value for --session");
      i++;
      // SAFETY: fail() above exits the process, so raw is a string here.
      const value = raw as string;
      if (!SESSION_ID_PATTERN.test(value)) {
        sessionValid = false;
        sessionId = null;
      } else {
        sessionId = value;
      }
      continue;
    }
    if (arg === "--limit") {
      const raw = args[i + 1];
      if (raw === undefined) fail("missing value for --limit");
      i++;
      // SAFETY: fail() above exits the process, so raw is a string here.
      const parsed = Number.parseInt(raw as string, 10);
      ledgerLimit = Number.isNaN(parsed) || parsed < 1 ? DEFAULT_LOOP_LIMIT : parsed;
      continue;
    }
    if (arg === "--loop-src") {
      const raw = args[i + 1];
      if (raw === undefined || raw.trim() === "") fail("missing value for --loop-src");
      i++;
      // SAFETY: fail() above exits the process, so raw is a non-empty string here.
      loopSrc = raw as string;
      continue;
    }
    fail(`unknown argument: ${arg}`);
  }
  ledgerLimit = clampLoopLimit(ledgerLimit);
  if (!sessionValid) {
    console.log(JSON.stringify({ ok: true, sessionId: null, plan: null, ledgerTail: [] }));
    process.exit(0);
  }
  const anchorLoop = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(loopSrc) ? loopSrc : pathToFileURL(path.resolve(loopSrc)).href;
  let planIo: unknown;
  let planCrud: unknown;
  let ledgerMod: unknown;
  try {
    [planIo, planCrud, ledgerMod] = await Promise.all([
      import(`${anchorLoop}/plan-io.ts`),
      import(`${anchorLoop}/plan-crud.ts`),
      import(`${anchorLoop}/ledger.ts`),
    ]);
  } catch {
    console.log(JSON.stringify({ ok: true, sessionId, plan: null, ledgerTail: [] }));
    process.exit(0);
  }
  interface LoopScope { sessionId?: string }
  type LoopJson = string | number | boolean | null | LoopJson[] | { [key: string]: LoopJson };
  interface LoopPlanIo { readUlwLoopPlanSync: (repoRoot: string, scope?: LoopScope) => LoopJson }
  interface LoopPlanCrud { summarizeUlwLoopPlan: (plan: LoopJson) => LoopJson }
  interface LoopLedger { readLedger: (repoRoot: string, scope?: LoopScope) => LoopJson[] }
  // SAFETY: vendored loop entry shapes; every call below is guarded and degrades to null/[] on mismatch.
  const planReader = planIo as LoopPlanIo;
  // SAFETY: same vendored module shape as above; guarded call below.
  const planSummarizer = planCrud as LoopPlanCrud;
  // SAFETY: same vendored module shape as above; guarded call below.
  const ledgerReader = ledgerMod as LoopLedger;
  const loopScope: LoopScope | undefined = sessionId ? { sessionId } : undefined;
  // The readers resolve state from a repo root; with no repoRoot flag the
  // working directory is the root (mirrors the T2 loop-src default of cwd).
  const loopRoot = process.cwd();
  let plan: LoopJson | null = null;
  try {
    plan = planSummarizer.summarizeUlwLoopPlan(planReader.readUlwLoopPlanSync(loopRoot, loopScope));
  } catch {
    plan = null;
  }
  let ledgerTail: LoopJson[] = [];
  try {
    ledgerTail = ledgerReader.readLedger(loopRoot, loopScope).slice(-ledgerLimit);
  } catch {
    ledgerTail = [];
  }
  console.log(JSON.stringify({ ok: true, sessionId, plan, ledgerTail }));
  process.exit(0);
}

const readJobLine = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    // SAFETY: stdin async iteration yields Buffer chunks; collected only into the locally-concatenated job line.
    chunks.push(chunk as Buffer);
  }
  const line = Buffer.concat(chunks)
    .toString("utf8")
    .split("\n")
    .find((candidate) => candidate.trim() !== "");
  if (!line) fail("empty job on stdin");
  // SAFETY: line is non-empty here per the fail() above, which exits the process.
  return line as string;
};

const readJob = async (): Promise<Job> => {
  const line = await readJobLine();
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    fail("job on stdin is not valid JSON");
  }
  const parsedJob = jobSchema.safeParse(raw);
  if (!parsedJob.success) fail("job needs a non-empty message with optional kind/agent/model/directory/sessionId/port/attach/wrapperEntry/wrapperArgv");
  return parsedJob.data;
};

// Wrapper-kind jobs: spawn the user-installed wrapper entry with the bridge
// argv and relay its stdio byte-verbatim to our own stdout/stderr. The
// bridge pumps our stdout through the same line protocol as a direct spawn
// (event lines to the snapshot writer and onEvent, the `--json` result line
// to wait()), so the relay adds no banners: stdout carries the wrapper's
// bytes only. The wrapper child's exit code becomes our exit; a signaled
// child re-raises the signal so our own exit carries it instead of masking
// it as exit 1. SIGTERM/SIGINT forward to the child, so a bridge cancel
// leaves no orphaned engine process behind.
const runWrapperJob = async (entry: string, argv: string[]): Promise<void> => {
  const spawnChild = (): ReturnType<typeof spawn> => {
    try {
      return spawn(entry, argv, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (error) {
      return fail(`cannot start wrapper entry "${entry}": ${error instanceof Error ? error.message : error}`);
    }
  };
  const started = spawnChild();
  const forwardSignal = (signal: NodeJS.Signals): void => {
    try {
      started.kill(signal);
    } catch {
      // Already exited; the close handler below still settles the exit.
    }
  };
  const forwardTerm = (): void => forwardSignal("SIGTERM");
  const forwardInt = (): void => forwardSignal("SIGINT");
  process.on("SIGTERM", forwardTerm);
  process.on("SIGINT", forwardInt);
  started.stdout?.on("data", (chunk) => {
    try {
      // SAFETY: stdio pipe chunks are byte buffers; relayed verbatim.
      process.stdout.write(chunk as Uint8Array);
    } catch {
      // A closed bridge pipe ends the run; the close handler settles it.
    }
  });
  started.stderr?.on("data", (chunk) => {
    try {
      // SAFETY: same pipe-chunk relay as stdout above.
      process.stderr.write(chunk as Uint8Array);
    } catch {
      // Same as stdout: never crash the relay on a broken pipe.
    }
  });
  const shutdown = (): void => {
    process.removeListener("SIGTERM", forwardTerm);
    process.removeListener("SIGINT", forwardInt);
  };
  await new Promise<void>((resolve) => {
    started.on("error", (error) => {
      shutdown();
      fail(`cannot start wrapper entry "${entry}": ${error instanceof Error ? error.message : error}`);
    });
    started.on("close", (code, signal) => {
      shutdown();
      if (code !== null && code !== undefined) {
        process.exit(code);
      }
      // The child died by signal: re-raise it so this worker exits with
      // the same signal instead of masking it as exit 1.
      try {
        process.kill(process.pid, signal ?? "SIGTERM");
      } catch {
        process.exit(1);
      }
      resolve();
    });
  });
};

const job: Job = await readJob();
// A wrapper-kind job carries the wrapper entry for the worker to spawn and
// relay; without an explicit kind the entry's presence decides (wrapper
// when present, native otherwise).
const kind = job.kind ?? (job.wrapperEntry !== undefined ? "wrapper" : "native");

if (kind === "wrapper") {
  if (!job.wrapperEntry || !Array.isArray(job.wrapperArgv)) {
    fail("wrapper jobs need a wrapper entry plus argv");
  }
  // SAFETY: non-empty entry and argv array verified above; fail() exits otherwise.
  await runWrapperJob(job.wrapperEntry as string, job.wrapperArgv as string[]);
  // The relay exits the process from the child close handler; landing here
  // means signal delivery failed, so fail closed instead of hanging the
  // bridge wait().
  fail("wrapper child ended without an exit code");
}

// Native-kind jobs import the engine run barrel in-process. --engine-root
// is required only here: wrapper-kind jobs never touch the engine tree.
if (!engineRoot) fail(`missing ${ENGINE_ROOT_FLAG} <dir>`);
// SAFETY: fail() above exits the process, so engineRoot is a string here.
const barrelSpecifier = resolveBarrelSpecifier(engineRoot as string);
// SAFETY: narrowed by the undefined/null check immediately below; self-test prints the real export names.
const barrel = await loadBarrel(barrelSpecifier);
// SAFETY: narrowed by the undefined/null check immediately below; self-test prints the real export names.
const run = barrel["run"] as RunFn | undefined;
if (run === undefined || run === null) fail("engine run barrel exports no run() function");

try {
  // Worker-routing keys (kind/wrapperEntry/wrapperArgv) never reach the
  // engine: only the run() options travel, with absent fields omitted as
  // before (no explicit undefineds cross into run()).
  const runOptions: RunOptions = { message: job.message, json: true };
  if (job.agent !== undefined) runOptions.agent = job.agent;
  if (job.model !== undefined) runOptions.model = job.model;
  if (job.directory !== undefined) runOptions.directory = job.directory;
  if (job.sessionId !== undefined) runOptions.sessionId = job.sessionId;
  if (job.port !== undefined) runOptions.port = job.port;
  if (job.attach !== undefined) runOptions.attach = job.attach;
  // SAFETY: same value null-checked above; the call cannot run without it.
  const code = await (run as RunFn)(runOptions);
  // SAFETY: Number.isInteger narrows unknown to integer; the cast only names that result.
  process.exit(Number.isInteger(code) ? (code as number) : 0);
} catch (error) {
  console.error(
    `[omo-invoker-worker] run() rejected: ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
}
