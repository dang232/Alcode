#!/usr/bin/env node
/**
 * Phase 2.6 task 10 - scope ledger check (read-only).
 *
 * Parses `.omo/ulw/p26/scope-ledger.md` and asserts the contract from
 * `.omo/plans/p26-autonomous-acceptance-closure.md` (todo 10):
 *
 *   - exactly 12 rows;
 *   - the in-scope set is exactly #1 and #3;
 *   - every in-scope row names at least one real plan todo, and never todo 10
 *     (the ledger todo cannot deliver itself);
 *   - every follow-up row has a non-empty reason and no delivering todo, so no
 *     follow-up carries a code change in this phase;
 *   - the Alcode run-graph gap, the 14 stale `tsgo` scripts, the C3 host seam,
 *     and the p25 limitations are folded into the follow-up rows.
 *
 * This script never writes to the repository. It reads the ledger, the plan,
 * and nothing else.
 *
 * Usage:
 *   node scripts/qa/p26-scope-check.mjs
 *   node scripts/qa/p26-scope-check.mjs --ledger <path> --plan <path>
 *   node scripts/qa/p26-scope-check.mjs --failure-probe
 *   node scripts/qa/p26-scope-check.mjs --json
 *
 * `--failure-probe` also moves one follow-up row into `in-scope` in memory,
 * without a delivering todo, and requires the validator to reject it. It
 * proves the parser is not vacuous and writes no temp file.
 *
 * Exit codes:
 *   0  the ledger satisfies the contract (and the failure probe is rejected)
 *   1  a contract violation, a ledger parse failure, or a probe that did not fail
 *   2  the ledger or the plan could not be read
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..")
const DEFAULT_LEDGER = path.join(REPO_ROOT, ".omo", "ulw", "p26", "scope-ledger.md")
const DEFAULT_PLAN = path.join(REPO_ROOT, ".omo", "plans", "p26-autonomous-acceptance-closure.md")

const HEADER = ["id", "finding", "disposition", "delivering_todo", "reason"]
const ROW_COUNT = 12
const IN_SCOPE_IDS = ["#1", "#3"]
const LEDGER_TODO = 10
const FOLLOW_UP_COUNT = ROW_COUNT - IN_SCOPE_IDS.length

class LedgerParseError extends Error {}

function fail(message) {
  console.error(`FAIL ${message}`)
  process.exit(1)
}

function toolFail(message) {
  console.error(`ERROR ${message}`)
  process.exit(2)
}

function usage() {
  console.log(`Phase 2.6 task 10 scope ledger check.

Usage:
  node scripts/qa/p26-scope-check.mjs [--ledger <path>] [--plan <path>] [--failure-probe] [--json]

Exit codes:
  0 ledger satisfies the contract (and the failure probe is rejected when requested)
  1 a contract violation, a ledger parse failure, or a probe that did not fail
  2 the ledger or the plan could not be read`)
}

function parseArgs(argv) {
  const options = {
    ledgerPath: DEFAULT_LEDGER,
    planPath: DEFAULT_PLAN,
    failureProbe: false,
    json: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--ledger" || arg === "--plan") {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith("--")) {
        toolFail(`${arg} needs a path`)
      }
      if (arg === "--ledger") options.ledgerPath = path.resolve(value)
      else options.planPath = path.resolve(value)
      index += 1
      continue
    }
    if (arg === "--failure-probe") {
      options.failureProbe = true
      continue
    }
    if (arg === "--json") {
      options.json = true
      continue
    }
    if (arg === "--help" || arg === "-h") {
      usage()
      process.exit(0)
    }
    toolFail(`unknown argument: ${arg}`)
  }
  return options
}

function readText(filePath, label) {
  try {
    return fs.readFileSync(filePath, "utf8")
  } catch (error) {
    toolFail(`cannot read ${label} at ${filePath}: ${error.message}`)
  }
}

function splitRow(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim())
}

function parseLedger(text) {
  const lines = text.split(/\r?\n/)
  const headingIndex = lines.findIndex((line) => line.trim() === "## Ledger")
  if (headingIndex === -1) throw new LedgerParseError('missing "## Ledger" heading')

  const tableLines = []
  let tableStarted = false
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim()
    if (trimmed.startsWith("|")) {
      tableStarted = true
      tableLines.push(trimmed)
      continue
    }
    if (tableStarted) break
  }
  if (tableLines.length < 3) throw new LedgerParseError("the ledger table needs a header, a separator, and data rows")

  const header = splitRow(tableLines[0])
  if (header === null || header.length !== HEADER.length) {
    throw new LedgerParseError(`table header must have ${HEADER.length} columns`)
  }
  for (let index = 0; index < HEADER.length; index += 1) {
    if (header[index] !== HEADER[index]) {
      throw new LedgerParseError(`column ${index + 1} is "${header[index]}", expected "${HEADER[index]}"`)
    }
  }

  const separator = splitRow(tableLines[1])
  if (separator === null || separator.length !== HEADER.length) {
    throw new LedgerParseError(`table separator must have ${HEADER.length} columns`)
  }
  if (!separator.every((cell) => /^:?-{3,}:?$/.test(cell))) {
    throw new LedgerParseError("table separator cells must be three or more dashes")
  }

  const rows = []
  for (const line of tableLines.slice(2)) {
    const cells = splitRow(line)
    if (cells === null || cells.length !== HEADER.length) {
      throw new LedgerParseError(`data row must have ${HEADER.length} columns: ${line}`)
    }
    const [id, finding, disposition, deliveringTodo, reason] = cells
    rows.push({ id, finding, disposition, delivering_todo: deliveringTodo, reason })
  }
  return rows
}

function parsePlanTodos(text) {
  const todos = new Set()
  for (const match of text.matchAll(/^- \[[ xX~]\] (\d+)\. /gm)) {
    todos.add(Number(match[1]))
  }
  return todos
}

function validateRows(rows, planTodos) {
  const violations = []
  const inScope = rows.filter((row) => row.disposition === "in-scope")
  const followUps = rows.filter((row) => row.disposition === "follow-up")

  if (rows.length !== ROW_COUNT) {
    violations.push(`row count is ${rows.length}, expected ${ROW_COUNT}`)
  }
  if (followUps.length !== FOLLOW_UP_COUNT) {
    violations.push(`follow-up count is ${followUps.length}, expected ${FOLLOW_UP_COUNT}`)
  }

  const ids = rows.map((row) => row.id)
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
  if (duplicates.length > 0) {
    violations.push(`duplicate ids: ${duplicates.join(", ")}`)
  }

  for (const row of rows) {
    const where = row.id.length > 0 ? row.id : "(row without id)"
    if (!/^#\d+$/.test(row.id)) {
      violations.push(`${where}: id must look like #<number>`)
    }
    if (row.finding.length === 0) {
      violations.push(`${where}: finding is empty`)
    }
    if (row.disposition !== "in-scope" && row.disposition !== "follow-up") {
      violations.push(`${where}: disposition is "${row.disposition}", expected in-scope or follow-up`)
    }
  }

  const inScopeIds = inScope.map((row) => row.id).sort()
  const expectedIds = [...IN_SCOPE_IDS].sort()
  if (JSON.stringify(inScopeIds) !== JSON.stringify(expectedIds)) {
    violations.push(
      `in-scope set is ${inScopeIds.length > 0 ? inScopeIds.join(", ") : "(empty)"}, expected ${expectedIds.join(", ")}`,
    )
  }

  for (const row of inScope) {
    const raw = row.delivering_todo.trim()
    if (raw.length === 0 || raw === "-") {
      violations.push(`${row.id}: in-scope row needs a delivering_todo`)
      continue
    }
    const parts = raw.split(",").map((part) => part.trim())
    for (const part of parts) {
      if (!/^\d+$/.test(part)) {
        violations.push(`${row.id}: delivering_todo entry "${part}" is not a todo number`)
        continue
      }
      const todo = Number(part)
      if (!planTodos.has(todo)) {
        violations.push(`${row.id}: delivering_todo ${todo} is not a todo in the plan`)
      }
      if (todo === LEDGER_TODO) {
        violations.push(`${row.id}: delivering_todo ${todo} is the ledger todo and cannot deliver an in-scope row`)
      }
    }
  }

  for (const row of followUps) {
    if (row.reason.trim().length === 0) {
      violations.push(`${row.id}: follow-up row needs a non-empty reason`)
    }
    const raw = row.delivering_todo.trim()
    if (raw.length > 0 && raw !== "-") {
      violations.push(
        `${row.id}: follow-up row names delivering_todo "${raw}"; no follow-up may carry a code change in this phase`,
      )
    }
  }

  const followUpText = followUps.map((row) => `${row.id} ${row.finding} ${row.reason}`).join("\n")
  const requiredThemes = [
    { label: "the Alcode run-graph surface gap", pattern: /run-graph|dag-runs/i },
    { label: "the 14 stale tsgo scripts", pattern: /tsgo/i },
    { label: "the C3 host seam", pattern: /host seam|TaskManagerOptions\.admission|ManagerAdmissionPort/i },
    { label: "the p25 limitations", pattern: /p25/i },
  ]
  for (const theme of requiredThemes) {
    if (!theme.pattern.test(followUpText)) {
      violations.push(`follow-up rows do not fold in ${theme.label}`)
    }
  }

  return { violations, inScope, followUps }
}

function runFailureProbe(rows, planTodos) {
  const mutated = rows.map((row) => ({ ...row }))
  const victim = mutated.find((row) => row.disposition === "follow-up")
  if (victim === undefined) {
    return { rejected: false, victim: null, violations: ["no follow-up row to move into in-scope"] }
  }
  victim.disposition = "in-scope"
  victim.delivering_todo = "-"
  const result = validateRows(mutated, planTodos)
  const rejected =
    result.violations.some((violation) => violation.includes(`${victim.id}: in-scope row needs a delivering_todo`)) &&
    result.violations.some((violation) => violation.includes("in-scope set is"))
  return { rejected, victim: victim.id, violations: result.violations }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const ledgerText = readText(options.ledgerPath, "scope ledger")
  const planText = readText(options.planPath, "plan")

  const planTodos = parsePlanTodos(planText)
  if (planTodos.size === 0) {
    toolFail(`no numbered todos found in ${options.planPath}`)
  }

  let rows
  try {
    rows = parseLedger(ledgerText)
  } catch (error) {
    if (error instanceof LedgerParseError) fail(`ledger parse error: ${error.message}`)
    throw error
  }

  const result = validateRows(rows, planTodos)
  if (result.violations.length > 0) {
    for (const violation of result.violations) {
      console.error(`FAIL ${violation}`)
    }
    fail(`scope-ledger: ${result.violations.length} violation(s)`)
  }

  let probe = null
  if (options.failureProbe) {
    probe = runFailureProbe(rows, planTodos)
    if (!probe.rejected) {
      fail(`failure probe: moving ${probe.victim ?? "a follow-up"} into in-scope without a delivering todo was not rejected`)
    }
  }

  const summary = {
    ledger: options.ledgerPath,
    plan: options.planPath,
    rows: rows.length,
    in_scope: result.inScope.map((row) => row.id),
    follow_ups: result.followUps.map((row) => row.id),
    delivering_todos: Object.fromEntries(result.inScope.map((row) => [row.id, row.delivering_todo])),
    violations: [],
    failure_probe: probe === null ? "not-run" : `rejected ${probe.victim}`,
  }

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2))
    return
  }

  console.log(
    `PASS scope-ledger: ${summary.rows} rows, in-scope ${summary.in_scope.join(", ")}, follow-ups ${summary.follow_ups.length}`,
  )
  if (probe !== null) {
    console.log(`PASS failure probe: moving ${probe.victim} into in-scope without a delivering todo is rejected`)
  }
}

main()
