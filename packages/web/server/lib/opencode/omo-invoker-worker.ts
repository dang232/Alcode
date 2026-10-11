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
  agent: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  directory: z.string().trim().min(1).optional(),
  sessionId: z.string().trim().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  attach: z.string().trim().min(1).optional(),
});

type Job = z.infer<typeof jobSchema>;

interface RunFn {
  (options: {
    message: string;
    agent?: string;
    model?: string;
    directory?: string;
    sessionId?: string;
    port?: number;
    attach?: string;
    json?: boolean;
  }): Promise<number>;
}

const args = process.argv.slice(2);
const engineRootIndex = args.indexOf(ENGINE_ROOT_FLAG);
const engineRoot = engineRootIndex === -1 ? null : args[engineRootIndex + 1]?.trim();
if (!engineRoot) fail(`missing ${ENGINE_ROOT_FLAG} <dir>`);
const selfTest = args.includes(SELF_TEST_FLAG);

// Optional direct barrel override for vendored trees that do not keep
// the engine packages/ layout (e.g. Alwork packages/omo-engine).
const barrelIndex = args.indexOf("--barrel-path");
const barrelSpecifier = barrelIndex === -1
  ? `${engineRoot}/packages/omo-opencode/src/cli/run/index.ts`
  : args[barrelIndex + 1]?.trim();
if (!barrelSpecifier) fail("missing --barrel-path <file>");
// Bare relative paths are package names to the loader and module-relative
// paths anchor to this file, not the shell: resolve everything that is not
// already absolute or URL-shaped against the working directory.
const anchoredBarrel = /^[a-zA-Z]+:/.test(barrelSpecifier)
  ? barrelSpecifier
  : pathToFileURL(path.resolve(barrelSpecifier)).href;
// The run barrel loads lazily: loop-status serves pure state reads and
// must never pay for (or fail on) the run entry.
const loadBarrel = async (): Promise<Record<string, RunFn>> =>
  // SAFETY: dynamic import of a third-party barrel; shape verified by the run-function check (and by --self-test output).
  (await import(anchoredBarrel).catch((error) => {
    fail(`cannot import engine run barrel: ${error instanceof Error ? error.message : error}`);
  })) as Record<string, RunFn>;

if (selfTest) {
  const barrel = await loadBarrel();
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
  const anchorLoop = /^[a-zA-Z]+:/.test(loopSrc) ? loopSrc : pathToFileURL(path.resolve(loopSrc)).href;
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
  if (!parsedJob.success) fail("job needs a non-empty message with optional agent/model/directory/sessionId/port/attach");
  return parsedJob.data;
};

const job: Job = await readJob();

// SAFETY: narrowed by the undefined/null check immediately below; self-test prints the real export names.
const barrel = await loadBarrel();
// SAFETY: narrowed by the undefined/null check immediately below; self-test prints the real export names.
const run = barrel["run"] as RunFn | undefined;
if (run === undefined || run === null) fail("engine run barrel exports no run() function");

try {
  // SAFETY: same value null-checked above; the call cannot run without it.
  const code = await (run as RunFn)({ ...job, json: true });
  // SAFETY: Number.isInteger narrows unknown to integer; the cast only names that result.
  process.exit(Number.isInteger(code) ? (code as number) : 0);
} catch (error) {
  console.error(
    `[omo-invoker-worker] run() rejected: ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
}
