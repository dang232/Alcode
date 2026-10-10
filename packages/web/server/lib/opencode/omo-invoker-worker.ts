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
// SAFETY: dynamic import of a third-party barrel; shape verified below by the run-function check (and by --self-test output).
const barrel = (await import(anchoredBarrel).catch((error) => {
  fail(`cannot import engine run barrel: ${error instanceof Error ? error.message : error}`);
})) as Record<string, RunFn>;

if (selfTest) {
  console.log(JSON.stringify({ ok: true, exports: Object.keys(barrel).sort() }));
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

const parsed = jobSchema.safeParse(JSON.parse(await readJobLine()));
if (!parsed.success) fail("job needs a non-empty message with optional agent/model/directory/sessionId/port/attach");
const job: Job = parsed.data;

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
