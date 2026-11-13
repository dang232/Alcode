#!/usr/bin/env node
/**
 * Phase 2.6 F1 - plan compliance audit (read-only over the plan).
 *
 * Verifies the contract in `.omo/plans/p26-autonomous-acceptance-closure.md`
 * ("Final verification wave" F1):
 *
 *   - every hard constraint HC-A..HC-F is present and maps to at least one todo;
 *   - every risk R1..R5 is present and maps to at least one todo;
 *   - every owner gate OQ-A..OQ-C is declared before its dependent task, the
 *     dependent task names the gate, and its `Blocked by:` line names it too;
 *   - every implementation row matches `- [ ] N.` or a closed state
 *     `- [x] N.` / `- [~] N.`, with the todo numbers exactly 1..11;
 *   - every verifier row matches `- [ ] F<n>.`, with the ids exactly F1..F5;
 *   - every implementation row carries `Recommended task executor category:`;
 *   - no task proposes a second runtime, a DAG redesign, an unrelated bundle
 *     regeneration, or a git write command.
 *
 * Prohibitions are legal: a line that already says "must not", "do not",
 * "never", "forbids", or "without" is not a proposal. The task's own
 * `Commit: N - ... forbids commit/push/reset/clean/stash` line is exempt for
 * the same reason. A planted affirmative line is still caught (see the F1
 * evidence: the probe copy is rejected with exit 1 and then deleted).
 *
 * This script never edits the plan. It writes only its JSON evidence artifact.
 *
 * Usage:
 *   node scripts/qa/p26-plan-audit.mjs
 *   node scripts/qa/p26-plan-audit.mjs <plan.md> --out <artifact.json>
 *   node scripts/qa/p26-plan-audit.mjs --json
 *
 * Exit codes:
 *   0  the plan satisfies every F1 rule (0 violations)
 *   1  one or more violations
 *   2  the plan could not be read or parsed
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..")
const DEFAULT_PLAN = path.join(REPO_ROOT, ".omo", "plans", "p26-autonomous-acceptance-closure.md")
const DEFAULT_OUT = path.join(REPO_ROOT, ".omo", "ulw", "p26", "f1-plan-audit.json")

const TODO_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const VERIFIER_IDS = ["F1", "F2", "F3", "F4", "F5"]
const HARD_CONSTRAINTS = ["HC-A", "HC-B", "HC-C", "HC-D", "HC-E", "HC-F"]
const RISKS = ["R1", "R2", "R3", "R4", "R5"]
const GATE_IDS = ["OQ-A", "OQ-B", "OQ-C"]

const NEGATION = /\b(?:must\s+not|must\s+NOT|do\s+not|never|forbids?|without|no\s+second|no\s+DAG|no\s+regeneration|no\s+commit)\b/i

const FORBIDDEN_PROPOSALS = [
  {
    id: "second-runtime",
    pattern: /\b(?:add|create|introduce|build|start|spin\s+up)\b[^\n]*\bsecond\b[^\n]*\b(?:delegation\s+)?runtime\b/i,
  },
  {
    id: "dag-redesign",
    pattern: /\b(?:redesign|re-?architect|rewrite)\b[^\n]*\bDAG\b|\bDAG\s+redesign\b/i,
  },
  {
    id: "unrelated-bundle",
    pattern: /\b(?:regenerate|rebuild|re-?build)\b[^\n]*\b(?:panel\/main\.js|unrelated\s+bundle)\b/i,
  },
  {
    id: "git-write",
    pattern: /\bgit\s+(?:commit|push|reset|clean|stash)\b/i,
  },
]

function fail(message) {
  console.error(`FAIL ${message}`)
  process.exit(1)
}

function toolFail(message) {
  console.error(`ERROR ${message}`)
  process.exit(2)
}

function usage() {
  console.log(`Phase 2.6 F1 plan compliance audit.

Usage:
  node scripts/qa/p26-plan-audit.mjs [<plan.md>] [--out <artifact.json>] [--json]

Exit codes:
  0 plan satisfies every F1 rule
  1 one or more violations
  2 the plan could not be read or parsed`)
}

function parseArgs(argv) {
  const options = { planPath: DEFAULT_PLAN, outPath: DEFAULT_OUT, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--out") {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith("--")) toolFail("--out needs a path")
      options.outPath = path.resolve(value)
      index += 1
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
    if (arg.startsWith("--")) toolFail(`unknown argument: ${arg}`)
    options.planPath = path.resolve(arg)
  }
  return options
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8")
  } catch (error) {
    toolFail(`cannot read plan at ${filePath}: ${error.message}`)
  }
}

function splitCells(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim())
}

function parsePlan(text) {
  const lines = text.split(/\r?\n/)

  const implementationStrict = /^- \[( |x|X|~)\] (\d+)\. (.*)$/
  const implementationBroad = /^- (?:\[[^\]]*\]\s*)?\d+\.\s+/
  const verifierStrict = /^- \[[^\]]*\] (F\d+)\. (.*)$/
  const verifierBroad = /^- (?:\[[^\]]*\]\s*)?F\d+\.\s+/

  const todos = []
  const verifiers = []
  const broadImplementationLines = []
  const broadVerifierLines = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (verifierBroad.test(line)) {
      broadVerifierLines.push({ line: index + 1, text: line })
      const match = verifierStrict.exec(line)
      if (match !== null) {
        verifiers.push({ id: match[1], title: match[2], line: index + 1 })
      }
      continue
    }
    if (implementationBroad.test(line)) {
      broadImplementationLines.push({ line: index + 1, text: line })
      const match = implementationStrict.exec(line)
      if (match !== null) {
        todos.push({ marker: match[1], number: Number(match[2]), title: match[3], line: index + 1 })
      }
    }
  }

  // Task block: the heading line through the next top-level todo heading or
  // section heading. Sub-bullets stay in the block.
  const blocks = new Map()
  for (const todo of todos) {
    let end = lines.length
    for (let index = todo.line; index < lines.length; index += 1) {
      const line = lines[index]
      if (implementationBroad.test(line) || verifierBroad.test(line) || /^###?\s/.test(line)) {
        end = index
        break
      }
    }
    blocks.set(todo.number, lines.slice(todo.line - 1, end).join("\n"))
  }

  const gates = []
  for (let index = 0; index < lines.length; index += 1) {
    const cells = splitCells(lines[index])
    if (cells === null || cells.length < 3) continue
    const idMatch = /\*\*(OQ-[ABC])\*\*/.exec(cells[0])
    if (idMatch === null) continue
    const dependent = /\bTask\s+(\d+)\b/.exec(cells[2])
    gates.push({
      id: idMatch[1],
      dependent_task: dependent === null ? null : Number(dependent[1]),
      line: index + 1,
      gate_question: cells[1],
      before_cell: cells[2],
    })
  }

  const tableMapping = (id) => {
    for (const line of lines) {
      const cells = splitCells(line)
      if (cells === null || cells.length < 2) continue
      if (!cells[0].includes(`**${id}**`)) continue
      return cells[cells.length - 1]
    }
    return null
  }

  return {
    lines,
    todos,
    verifiers,
    blocks,
    gates,
    broadImplementationLines,
    broadVerifierLines,
    tableMapping,
  }
}

function validate(plan) {
  const violations = []
  const { lines, todos, verifiers, blocks, gates, broadImplementationLines, broadVerifierLines } = plan

  // 1. Hard constraints and risks.
  const hardConstraints = []
  for (const id of HARD_CONSTRAINTS) {
    const present = new RegExp(`\\b${id}\\b`).test(lines.join("\n"))
    const mapping = plan.tableMapping(id)
    const mapped = mapping !== null && /\d/.test(mapping)
    hardConstraints.push({ id, present, mapping, mapped })
    if (!present) violations.push(`${id} is missing from the plan`)
    else if (!mapped) violations.push(`${id} has no delivering todo in its mapping row`)
  }
  const risks = []
  for (const id of RISKS) {
    const present = new RegExp(`\\b${id}\\b`).test(lines.join("\n"))
    const mapping = plan.tableMapping(id)
    const mapped = mapping !== null && /\d/.test(mapping)
    risks.push({ id, present, mapping, mapped })
    if (!present) violations.push(`${id} is missing from the plan`)
    else if (!mapped) violations.push(`${id} has no mitigation todo in its mapping row`)
  }

  // 2. Owner gates before their dependent tasks.
  const todoByNumber = new Map(todos.map((todo) => [todo.number, todo]))
  const gateRows = []
  for (const id of GATE_IDS) {
    const gate = gates.find((entry) => entry.id === id)
    if (gate === undefined) {
      violations.push(`${id} gate row is missing`)
      continue
    }
    const dependent = gate.dependent_task === null ? undefined : todoByNumber.get(gate.dependent_task)
    if (dependent === undefined) {
      violations.push(`${id} does not name an existing dependent task (got ${gate.before_cell})`)
      gateRows.push({ id, dependent_task: gate.dependent_task, gated_before: false })
      continue
    }
    const block = blocks.get(dependent.number) ?? ""
    const gatedBefore = gate.line < dependent.line
    const taskNamesGate = block.includes(id)
    const blockedByLine = block.split(/\r?\n/).find((line) => /^\s*Parallelization:.*\|\s*Blocked by:/i.test(line)) ?? ""
    const blockedByNamesGate = blockedByLine.includes(id)
    gateRows.push({
      id,
      dependent_task: dependent.number,
      gate_line: gate.line,
      dependent_line: dependent.line,
      gated_before: gatedBefore,
      task_names_gate: taskNamesGate,
      blocked_by_names_gate: blockedByNamesGate,
      blocked_by: blockedByLine.trim(),
    })
    if (!gatedBefore) violations.push(`${id} is declared after its dependent task ${dependent.number}`)
    if (!taskNamesGate) violations.push(`task ${dependent.number} does not name ${id}`)
    if (!blockedByNamesGate) violations.push(`task ${dependent.number} Blocked by line does not name ${id}`)
  }
  const gateIds = new Set(gates.map((gate) => gate.id))
  for (const id of GATE_IDS) {
    if (!gateIds.has(id)) violations.push(`${id} is missing from the gate table`)
  }

  // 3. Implementation rows.
  const todoNumbers = todos.map((todo) => todo.number)
  const missingTodos = TODO_NUMBERS.filter((number) => !todoNumbers.includes(number))
  const extraTodos = todoNumbers.filter((number) => !TODO_NUMBERS.includes(number))
  if (missingTodos.length > 0) violations.push(`missing implementation rows: ${missingTodos.join(", ")}`)
  if (extraTodos.length > 0) violations.push(`unexpected implementation rows: ${extraTodos.join(", ")}`)
  const duplicateTodos = todoNumbers.filter((number, index) => todoNumbers.indexOf(number) !== index)
  if (duplicateTodos.length > 0) violations.push(`duplicate implementation rows: ${duplicateTodos.join(", ")}`)
  for (const broad of broadImplementationLines) {
    if (!/^- \[( |x|X|~)\] \d+\. /.test(broad.text)) {
      violations.push(`implementation row at line ${broad.line} does not match "- [ ] N." or a closed "- [x] N." / "- [~] N.": ${broad.text}`)
    }
  }
  const openTodos = todos.filter((todo) => todo.marker === " ")
  const closedTodos = todos.filter((todo) => todo.marker === "x" || todo.marker === "X")
  const partialTodos = todos.filter((todo) => todo.marker === "~")

  // 4. Verifier rows.
  const verifierIds = verifiers.map((verifier) => verifier.id)
  const missingVerifiers = VERIFIER_IDS.filter((id) => !verifierIds.includes(id))
  const extraVerifiers = verifierIds.filter((id) => !VERIFIER_IDS.includes(id))
  if (missingVerifiers.length > 0) violations.push(`missing verifier rows: ${missingVerifiers.join(", ")}`)
  if (extraVerifiers.length > 0) violations.push(`unexpected verifier rows: ${extraVerifiers.join(", ")}`)
  for (const broad of broadVerifierLines) {
    if (!/^- \[[^\]]*\] F\d+\. /.test(broad.text)) {
      violations.push(`verifier row at line ${broad.line} does not match "- [ ] F<n>.": ${broad.text}`)
    }
  }

  // 5. Executor category on every implementation row.
  const categoryRows = []
  for (const todo of todos) {
    const block = blocks.get(todo.number) ?? ""
    const hasCategory = /^\s{2}Recommended task executor category:\s+\S/m.test(block)
    categoryRows.push({ number: todo.number, has_category: hasCategory })
    if (!hasCategory) violations.push(`task ${todo.number} is missing "Recommended task executor category:"`)
  }

  // 6. Forbidden proposals inside task blocks only. Prohibitions are legal.
  const proposalScan = []
  let scannedLines = 0
  for (const todo of todos) {
    const block = blocks.get(todo.number) ?? ""
    for (const line of block.split(/\r?\n/)) {
      if (/^\s*Commit:/i.test(line)) continue
      if (NEGATION.test(line)) continue
      scannedLines += 1
      for (const rule of FORBIDDEN_PROPOSALS) {
        if (rule.pattern.test(line)) {
          proposalScan.push({ task: todo.number, rule: rule.id, text: line.trim() })
          violations.push(`task ${todo.number} proposes ${rule.id}: ${line.trim()}`)
        }
      }
    }
  }

  return {
    violations,
    checked: {
      implementation_rows: todos.length,
      implementation_open: openTodos.length,
      implementation_closed: closedTodos.length,
      implementation_partial: partialTodos.length,
      implementation_states: todos
        .slice()
        .sort((left, right) => left.number - right.number)
        .map((todo) => ({ number: todo.number, marker: todo.marker, title: todo.title })),
      verifier_rows: verifiers.length,
      verifier_ids: verifiers.map((verifier) => verifier.id),
      hard_constraints: hardConstraints,
      risks,
      gates: gateRows,
      executor_category_rows: categoryRows.filter((row) => row.has_category).length,
      executor_category_missing: categoryRows.filter((row) => !row.has_category).map((row) => row.number),
      proposal_scan: {
        scanned_tasks: todos.length,
        scanned_lines: scannedLines,
        forbidden: proposalScan,
      },
    },
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const text = readText(options.planPath)
  const plan = parsePlan(text)

  if (plan.todos.length === 0) toolFail(`no implementation rows found in ${options.planPath}`)
  if (plan.verifiers.length === 0) toolFail(`no verifier rows found in ${options.planPath}`)

  const result = validate(plan)
  const artifact = {
    plan: path.relative(REPO_ROOT, options.planPath).split(path.sep).join("/"),
    generated_at: new Date().toISOString(),
    violations: result.violations,
    checked: result.checked,
  }

  fs.mkdirSync(path.dirname(options.outPath), { recursive: true })
  fs.writeFileSync(options.outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8")

  if (options.json) {
    console.log(JSON.stringify(artifact, null, 2))
  } else {
    for (const violation of result.violations) console.error(`FAIL ${violation}`)
    const summary = result.checked
    const verdict = result.violations.length === 0 ? "PASS" : "FAIL"
    console.log(
      `${verdict} plan-audit: ${summary.implementation_rows} implementation rows `
      + `(${summary.implementation_closed} closed, ${summary.implementation_partial} partial), `
      + `${summary.verifier_rows} verifier rows, ${summary.gates.length} gates gated, `
      + `${summary.hard_constraints.length} hard constraints, ${summary.risks.length} risks, `
      + `${result.violations.length} violations`,
    )
    console.log(`artifact: ${path.relative(REPO_ROOT, options.outPath).split(path.sep).join("/")}`)
  }

  if (result.violations.length > 0) process.exit(1)
}

main()
