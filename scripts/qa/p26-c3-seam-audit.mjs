#!/usr/bin/env node
/**
 * Phase 2.6 task 1 - C3 production seam audit (read-only).
 *
 * Runs the four seam commands named by
 * `.omo/plans/p26-autonomous-acceptance-closure.md` (todo 1), classifies every
 * match, and asserts that no in-repo production host supplies
 * `TaskManagerOptions.admission` or `TaskToolDeps.readTerminalRecord`.
 *
 * The audit is evidence classification, not a C3 driver: it never composes
 * `createTaskManager` + `createDagManager` + `runEngineeringDelegation`, and it
 * never treats the p24 QA drivers (`scripts/qa/delegation-*.mjs`) as production
 * evidence.
 *
 * Usage:
 *   bun scripts/qa/p26-c3-seam-audit.mjs
 *     Audit the repo, write `.omo/ulw/p26/task-1-c3-seam-audit.json`.
 *
 *   bun scripts/qa/p26-c3-seam-audit.mjs --scan-root <dir> --no-write
 *     Audit an alternate tree (used by the failure probe).
 *
 *   bun scripts/qa/p26-c3-seam-audit.mjs --failure-probe
 *     Plant a temporary non-test fixture under `.omo/ulw/p26/` that calls
 *     `createTaskManager({ admission: fakePort })`, run the audit over it, and
 *     require the audit to report a non-empty `production_host_matches` with
 *     `default_verdict: "NEEDS_HOST_CONFIRMATION"`. Exits 0 only when the
 *     detector rejects the planted host, then removes the fixture.
 *
 * Exit codes:
 *   0  audit passes (or the failure probe correctly rejected the planted host)
 *   1  an assertion failed, a match is unclassified, or a production host exists
 *   2  the audit could not run (rg unavailable / unreadable tree)
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..")
const ARTIFACT_PATH = path.join(REPO_ROOT, ".omo", "ulw", "p26", "task-1-c3-seam-audit.json")
const PROBE_DIR = path.join(REPO_ROOT, ".omo", "ulw", "p26", ".tmp-p26-seam-probe")

const SEAM = {
  admission: {
    symbol: "TaskManagerOptions.admission",
    file: "packages/omo-engine/senpi-task/src/manager/types.ts",
    line: 477,
  },
  readTerminalRecord: {
    symbol: "TaskToolDeps.readTerminalRecord",
    file: "packages/omo-engine/senpi-task/src/tools/task/types.ts",
    line: 89,
    consumer: "packages/omo-engine/senpi-task/src/tools/task/delegated-start.ts:72-77",
  },
  runEngineeringDelegation: {
    symbol: "runEngineeringDelegation",
    file: "packages/omo-engine/senpi-task/src/delegation/run.ts",
    line: 152,
  },
}

const QA_DRIVERS_NOT_EVIDENCE = [
  "scripts/qa/delegation-agreement.mjs",
  "scripts/qa/delegation-c3.mjs",
  "scripts/qa/delegation-live.mjs",
  "scripts/qa/delegation-negatives.mjs",
]

const COMMANDS = [
  {
    id: "createTaskManager-sites",
    targets: ["packages/omo-engine/senpi-task/src"],
    argv: [
      "-n",
      "createTaskManager\\(",
      "packages/omo-engine/senpi-task/src",
      "--glob",
      "!**/*.test.ts",
      "--glob",
      "!**/__fixtures__/**",
    ],
    command:
      'rg -n "createTaskManager\\(" packages/omo-engine/senpi-task/src --glob "!**/*.test.ts" --glob "!**/__fixtures__/**"',
  },
  {
    id: "manager-admission-sites",
    targets: ["packages/omo-engine/senpi-task/src"],
    argv: [
      "-n",
      "admission\\??:",
      "packages/omo-engine/senpi-task/src",
      "--glob",
      "!**/*.test.ts",
      "--glob",
      "!**/__fixtures__/**",
    ],
    command:
      'rg -n "admission\\??:" packages/omo-engine/senpi-task/src --glob "!**/*.test.ts" --glob "!**/__fixtures__/**"',
  },
  {
    id: "runEngineeringDelegation-sites",
    targets: ["packages"],
    argv: ["-n", "runEngineeringDelegation\\(", "packages", "--glob", "!**/*.test.ts"],
    command:
      'rg -n "runEngineeringDelegation\\(" packages --glob "!**/*.test.ts"',
  },
  {
    id: "readTerminalRecord-sites",
    targets: ["packages"],
    argv: [
      "-n",
      "readTerminalRecord",
      "packages",
      "--glob",
      "!**/*.test.ts",
      "--glob",
      "!**/__fixtures__/**",
    ],
    command:
      'rg -n "readTerminalRecord" packages --glob "!**/*.test.ts" --glob "!**/__fixtures__/**"',
  },
  {
    id: "createTaskManager-export",
    targets: ["packages/omo-engine/senpi-task/src/manager/index.ts"],
    argv: [
      "-n",
      "createTaskManager",
      "packages/omo-engine/senpi-task/src/manager/index.ts",
      "--with-filename",
    ],
    command:
      'rg -n "createTaskManager" packages/omo-engine/senpi-task/src/manager/index.ts --with-filename',
    supplementary: true,
  },
]

class AuditFailure extends Error {}

function fail(message) {
  throw new AuditFailure(message)
}

function runRg(root, spec) {
  const presentTargets = (spec.targets ?? []).filter((target) => fs.existsSync(path.join(root, target)))
  if ((spec.targets ?? []).length > 0 && presentTargets.length === 0) {
    return {
      id: spec.id,
      command: spec.command,
      exit_code: null,
      output: "",
      supplementary: spec.supplementary === true,
      skipped: `target path absent under scan root: ${(spec.targets ?? []).join(", ")}`,
    }
  }
  const result = spawnSync("rg", spec.argv, { cwd: root, encoding: "utf8" })
  if (result.error) {
    throw new Error(`cannot run rg for ${spec.id}: ${result.error.message}`)
  }
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`rg exited ${result.status} for ${spec.id}\n${result.stderr ?? ""}`)
  }
  return {
    id: spec.id,
    command: spec.command,
    exit_code: result.status,
    output: (result.stdout ?? "").replace(/\r\n/g, "\n"),
    supplementary: spec.supplementary === true,
  }
}

/** Parse `rg -n` output into {file, line, text} records. */
function parseRgOutput(output) {
  const matches = []
  for (const raw of output.split("\n")) {
    if (raw.trim() === "") continue
    const parsed = /^(.*?):(\d+):(.*)$/s.exec(raw)
    if (parsed === null) {
      throw new Error(`unparseable rg line: ${JSON.stringify(raw)}`)
    }
    matches.push({
      file: parsed[1].split(path.sep).join("/"),
      line: Number(parsed[2]),
      text: parsed[3].trim(),
    })
  }
  return matches
}

function readCallArguments(root, file, line, marker) {
  let source
  try {
    source = fs.readFileSync(path.join(root, file), "utf8")
  } catch {
    return ""
  }
  const lines = source.split("\n")
  const start = Math.max(0, line - 1)
  const window = lines.slice(start).join("\n")
  const markerIndex = window.indexOf(marker)
  if (markerIndex === -1) return window.slice(0, 2000)
  const open = window.indexOf("(", markerIndex)
  if (open === -1) return window.slice(0, 2000)
  let depth = 0
  for (let index = open; index < window.length && index - open < 8000; index += 1) {
    const char = window[index]
    if (char === "(") depth += 1
    else if (char === ")") {
      depth -= 1
      if (depth === 0) return window.slice(open, index + 1)
    }
  }
  return window.slice(open, open + 8000)
}

function isTestOnlyPath(file) {
  return (
    file.includes("/__fixtures__/") ||
    file.includes("/__adversarial__/") ||
    /\.test\.[cm]?[jt]sx?$/.test(file) ||
    /\.test-harness\.[cm]?[jt]sx?$/.test(file)
  )
}

function isComment(text) {
  return text.startsWith("//") || text.startsWith("*") || text.startsWith("/*")
}

/**
 * Classify one match. Returns a record with `classification` plus the reason.
 * Order matters: test-only and documentation never become production hosts.
 */
function classify(root, match) {
  const { file, line, text } = match
  if (file.endsWith(".md")) {
    return { ...match, classification: "documentation", reason: "markdown documentation, not executable code" }
  }
  if (isTestOnlyPath(file)) {
    return { ...match, classification: "test_only", reason: "test-only path (fixture, adversarial or test harness)" }
  }
  if (file.endsWith("/src/manager/manager.ts") && /export function createTaskManager\(/.test(text)) {
    return { ...match, classification: "definition", symbol: "createTaskManager", reason: "createTaskManager definition + export" }
  }
  if (file.endsWith("/src/manager/types.ts") && /readonly admission\?: ManagerAdmissionPort/.test(text)) {
    return {
      ...match,
      classification: "definition",
      symbol: "TaskManagerOptions.admission",
      reason: "TaskManagerOptions.admission declaration (the seam, not a host)",
    }
  }
  if (file.endsWith("/src/tools/task/types.ts") && /readonly readTerminalRecord\?:/.test(text)) {
    return {
      ...match,
      classification: "definition",
      symbol: "TaskToolDeps.readTerminalRecord",
      reason: "TaskToolDeps.readTerminalRecord declaration (the seam, not a host)",
    }
  }
  if (file.endsWith("/src/delegation/run.ts") && /export async function runEngineeringDelegation\(/.test(text)) {
    return { ...match, classification: "definition", symbol: "runEngineeringDelegation", reason: "runEngineeringDelegation definition" }
  }
  if (file.endsWith("/src/manager/index.ts") && /createTaskManager/.test(text)) {
    return { ...match, classification: "export", symbol: "createTaskManager", reason: "manager index re-export" }
  }
  if (file.includes("/src/workpool/")) {
    return {
      ...match,
      classification: "unrelated_workpool",
      reason: "workpool admission port (WorkpoolAdmission); unrelated to TaskManagerOptions.admission",
    }
  }
  if (file.endsWith("/src/tools/task/delegated-start.ts") && /readTerminalRecord/.test(text)) {
    return {
      ...match,
      classification: "consumer",
      reason: "repo-internal consumer reads the injected dep; the host that supplies it is absent from the repo",
    }
  }
  if (isComment(text)) {
    return { ...match, classification: "documentation", reason: "source comment, not executable code" }
  }
  if (/createTaskManager\(/.test(text)) {
    const args = readCallArguments(root, file, line, "createTaskManager")
    if (/\badmission\s*\??\s*:/.test(args)) {
      return {
        ...match,
        classification: "production_host",
        reason: "non-test createTaskManager call site supplies TaskManagerOptions.admission",
      }
    }
    return {
      ...match,
      classification: "production_call_site",
      reason: "non-test createTaskManager call site without the admission seam",
    }
  }
  return { ...match, classification: "unclassified", reason: "no classification rule matched" }
}

function audit(root, { write }) {
  const scans = COMMANDS.map((spec) => runRg(root, spec))
  const matches = []
  for (const scan of scans) {
    for (const match of parseRgOutput(scan.output)) {
      matches.push({ ...classify(root, match), command: scan.id })
    }
  }

  const byClassification = (name) => matches.filter((match) => match.classification === name)
  const createTaskManagerDefinition = byClassification("definition").filter(
    (match) => match.symbol === "createTaskManager",
  )
  const exportMatches = byClassification("export")
  const productionHostMatches = [
    ...byClassification("production_host"),
    ...byClassification("production_call_site"),
  ]
  const unclassified = byClassification("unclassified")

  const definitionMatches = [...createTaskManagerDefinition, ...exportMatches].map((match) => ({
    file: match.file,
    line: match.line,
    kind: match.classification,
    symbol: match.symbol,
    text: match.text,
  }))

  const seamMatch = (symbol) =>
    byClassification("definition").find((match) => match.symbol === symbol) ?? null

  const admission = seamMatch("TaskManagerOptions.admission")
  const readTerminalRecord = seamMatch("TaskToolDeps.readTerminalRecord")
  const runDelegation = seamMatch("runEngineeringDelegation")
  const consumer = matches.find(
    (match) => match.classification === "consumer" && /deps\.readTerminalRecord/.test(match.text),
  )

  const spacing = {
    admission_definition_present: admission !== null &&
      admission.file === SEAM.admission.file && admission.line === SEAM.admission.line,
    read_terminal_record_definition_present: readTerminalRecord !== null &&
      readTerminalRecord.file === SEAM.readTerminalRecord.file &&
      readTerminalRecord.line === SEAM.readTerminalRecord.line,
    read_terminal_record_consumer_present: consumer !== undefined &&
      consumer.file === "packages/omo-engine/senpi-task/src/tools/task/delegated-start.ts" &&
      consumer.line >= 72 && consumer.line <= 77,
    run_engineering_delegation_definition_present: runDelegation !== null &&
      runDelegation.file === SEAM.runEngineeringDelegation.file &&
      runDelegation.line === SEAM.runEngineeringDelegation.line,
    create_task_manager_definition_present: createTaskManagerDefinition.some(
      (match) =>
        match.file === "packages/omo-engine/senpi-task/src/manager/manager.ts" && match.line === 2770,
    ),
    no_unclassified_matches: unclassified.length === 0,
    no_production_host_matches: productionHostMatches.length === 0,
  }

  const seamChecksPassed = Object.values(spacing).every(Boolean)
  const defaultVerdict = seamChecksPassed ? "PARTIAL" : "NEEDS_HOST_CONFIRMATION"

  const artifact = {
    task: "p26-task-1-c3-seam-audit",
    audit_scope: "C3 production seam only; evidence classification, no C3 driver",
    generated_at: new Date().toISOString(),
    scan_root: root.split(path.sep).join("/"),
    commands: scans.map((scan) => {
      const entry = {
        id: scan.id,
        command: scan.command,
        cwd: root.split(path.sep).join("/"),
        exit_code: scan.exit_code,
        output: scan.output,
        supplementary: scan.supplementary,
      }
      if (scan.skipped !== undefined) entry.skipped = scan.skipped
      return entry
    }),
    definition_matches: definitionMatches,
    definition_matches_scope:
      "createTaskManager definition (manager.ts:2770) plus its manager/index.ts re-export; seam declarations are recorded under seam",
    test_only_matches: byClassification("test_only").map((match) => ({
      file: match.file,
      line: match.line,
      text: match.text,
      reason: match.reason,
    })),
    production_host_matches: productionHostMatches.map((match) => ({
      file: match.file,
      line: match.line,
      text: match.text,
      classification: match.classification,
      reason: match.reason,
    })),
    unclassified_matches: unclassified.map((match) => ({
      file: match.file,
      line: match.line,
      text: match.text,
      reason: match.reason,
    })),
    seam: {
      admission: {
        symbol: SEAM.admission.symbol,
        definition: `${SEAM.admission.file}:${SEAM.admission.line}`,
        supplied_by: "none in this repository",
        consumer:
          "packages/omo-engine/senpi-task/src/manager/manager.ts:459-465 (reads this.#options.admission; returns admission_unavailable when absent)",
      },
      read_terminal_record: {
        symbol: SEAM.readTerminalRecord.symbol,
        definition: `${SEAM.readTerminalRecord.file}:${SEAM.readTerminalRecord.line}`,
        consumer: SEAM.readTerminalRecord.consumer,
        supplied_by: "none in this repository",
      },
      run_engineering_delegation: {
        symbol: SEAM.runEngineeringDelegation.symbol,
        definition: `${SEAM.runEngineeringDelegation.file}:${SEAM.runEngineeringDelegation.line}`,
        note: "definition only; no non-test caller in packages",
      },
      qa_drivers_not_evidence: QA_DRIVERS_NOT_EVIDENCE.map((file) => ({
        file,
        present: fs.existsSync(path.join(root, file)),
        evidence: false,
        reason: "test composition driver; HC-A forbids treating it as a production host",
      })),
      p25_fake_admission_port_not_evidence: {
        file: "packages/omo-engine/senpi-task/src/manager/admission-port.test.ts",
        lines: "31-33,86-91",
        evidence: false,
        reason: "test-only literal run id and st_${nodeId} identities; HC-B forbids reusing them",
      },
    },
    classification_summary: Object.fromEntries(
      [...new Set(matches.map((match) => match.classification))].map((name) => [
        name,
        matches.filter((match) => match.classification === name).length,
      ]),
    ),
    match_inventory: matches.map((match) => ({
      command: match.command,
      file: match.file,
      line: match.line,
      text: match.text,
      classification: match.classification,
      symbol: match.symbol,
      reason: match.reason,
    })),
    consistency_checks: spacing,
    default_verdict: defaultVerdict,
  }

  if (write) {
    fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true })
    fs.writeFileSync(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, "utf8")
  }

  return { artifact, matches, unclassified, productionHostMatches, spacing, seamChecksPassed }
}

function assertAuditPassed(result) {
  const { artifact, unclassified, productionHostMatches, spacing } = result
  if (unclassified.length > 0) {
    return `unclassified matches: ${JSON.stringify(unclassified)}`
  }
  if (productionHostMatches.length > 0) {
    return `production host matches found: ${JSON.stringify(productionHostMatches)}`
  }
  const failedChecks = Object.entries(spacing)
    .filter(([, passed]) => !passed)
    .map(([name]) => name)
  if (failedChecks.length > 0) return `failed checks: ${failedChecks.join(", ")}`
  if (artifact.default_verdict !== "PARTIAL") {
    return `default_verdict must be PARTIAL, got ${artifact.default_verdict}`
  }
  const definitionFiles = artifact.definition_matches.map((match) => `${match.file}:${match.line}`)
  const allowed = new Set([
    "packages/omo-engine/senpi-task/src/manager/manager.ts:2770",
    "packages/omo-engine/senpi-task/src/manager/index.ts:1",
  ])
  for (const entry of definitionFiles) {
    if (!allowed.has(entry)) return `unexpected definition match ${entry}`
  }
  return null
}

function runFailureProbe() {
  const probeRoot = PROBE_DIR
  const hostFile = path.join(
    probeRoot,
    "packages",
    "omo-engine",
    "senpi-task",
    "src",
    "manager",
    "production-host.ts",
  )
  try {
    fs.rmSync(probeRoot, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(hostFile), { recursive: true })
    fs.writeFileSync(
      hostFile,
      [
        'import { createTaskManager } from "./manager"',
        "",
        "declare const fakePort: never",
        "declare const store: never",
        "declare const runners: never",
        "declare const planner: never",
        "declare const config: never",
        "",
        "export const planted = createTaskManager({",
        "  admission: fakePort,",
        "  store,",
        "  runners,",
        "  planner,",
        "  config,",
        '  cwd: "fixture",',
        "})",
        "",
      ].join("\n"),
      "utf8",
    )
    const result = audit(probeRoot, { write: false })
    if (result.productionHostMatches.length === 0) {
      fail("failure probe: the audit failed to flag a planted non-test createTaskManager({ admission }) host")
    }
    if (result.artifact.default_verdict !== "NEEDS_HOST_CONFIRMATION") {
      fail(
        `failure probe: default_verdict must be NEEDS_HOST_CONFIRMATION, got ${result.artifact.default_verdict}`,
      )
    }
    if (result.artifact.production_host_matches.length === 0) {
      fail("failure probe: artifact production_host_matches is empty despite the planted host")
    }
    console.log(
      `PASS failure-probe detected ${result.productionHostMatches.length} production host match(es); verdict ${result.artifact.default_verdict}`,
    )
    console.log(`PASS failure-probe fixture: ${result.productionHostMatches.map((match) => `${match.file}:${match.line}`).join(", ")}`)
  } finally {
    fs.rmSync(probeRoot, { recursive: true, force: true })
  }
}

function main() {
  const args = process.argv.slice(2)
  const failureProbe = args.includes("--failure-probe")
  const noWrite = args.includes("--no-write")
  const scanRootIndex = args.indexOf("--scan-root")
  const scanRoot = scanRootIndex === -1 ? REPO_ROOT : path.resolve(args[scanRootIndex + 1] ?? "")
  if (scanRootIndex !== -1 && (args[scanRootIndex + 1] === undefined || args[scanRootIndex + 1].startsWith("--"))) {
    console.error("ERROR --scan-root requires a directory")
    process.exit(2)
  }

  if (failureProbe) {
    runFailureProbe()
    if (fs.existsSync(PROBE_DIR)) fail("failure probe fixture was not cleaned up")
    return
  }

  const result = audit(scanRoot, { write: !noWrite && scanRoot === REPO_ROOT })
  const failure = assertAuditPassed(result)
  if (failure !== null) {
    console.error(`FAIL ${failure}`)
    console.error(JSON.stringify(result.artifact, null, 2))
    process.exit(1)
  }
  console.log(
    `PASS seam audit: ${result.matches.length} matches classified, production_host_matches=${result.productionHostMatches.length}, default_verdict=${result.artifact.default_verdict}`,
  )
  if (!noWrite && scanRoot === REPO_ROOT) {
    console.log(`PASS artifact: ${ARTIFACT_PATH.split(path.sep).join("/")}`)
  }
}

try {
  main()
} catch (error) {
  if (error instanceof AuditFailure) {
    console.error(`FAIL ${error.message}`)
    process.exit(1)
  }
  console.error(`ERROR ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}
