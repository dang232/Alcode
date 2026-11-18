// Read-only checker for the Phase 2.6 owner-decision gate ledger.
// A gate may be answered only with a verbatim owner_quote and an answered_at date.
// Usage: node scripts/qa/p26-gate-check.mjs [path-to-gates.md]

import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_LEDGER = path.join('.omo', 'ulw', 'p26', 'gates.md')
const BEGIN = '<!-- BEGIN p26-gates-json -->'
const END = '<!-- END p26-gates-json -->'
const EXPECTED_GATES = [
  { id: 'OQ-A', blockedTask: '3' },
  { id: 'OQ-B', blockedTask: '4' },
  { id: 'OQ-C', blockedTask: '9' },
]

function readLedger(file) {
  const content = fs.readFileSync(file, 'utf8')
  const beginCount = content.split(BEGIN).length - 1
  const endCount = content.split(END).length - 1
  if (beginCount !== 1 || endCount !== 1) {
    throw new Error(`expected exactly one ${BEGIN} ... ${END} block, found begin=${beginCount} end=${endCount}`)
  }
  const start = content.indexOf(BEGIN) + BEGIN.length
  const end = content.indexOf(END, start)
  const block = content
    .slice(start, end)
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
  return JSON.parse(block)
}

function main() {
  const file = process.argv[2] ?? DEFAULT_LEDGER
  const failures = []
  const check = (condition, message) => {
    if (!condition) failures.push(message)
  }

  let payload
  try {
    payload = readLedger(file)
  } catch (error) {
    console.error(`Gate ledger FAILED: ${file}`)
    console.error(`- ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
    return
  }

  const gates = Array.isArray(payload.gates) ? payload.gates : []
  check(Array.isArray(payload.gates), 'gates must be an array')
  check(gates.length === 3, `expected exactly 3 gates, found ${gates.length}`)

  const ids = gates.map((gate) => (gate && typeof gate === 'object' ? gate.id : null))
  check(new Set(ids).size === ids.length, `gate ids must be unique, found ${ids.join(',')}`)
  check(
    [...ids].sort().join(',') === EXPECTED_GATES.map((gate) => gate.id).sort().join(','),
    `gate ids must be exactly OQ-A, OQ-B, OQ-C, found ${ids.join(',')}`,
  )

  for (const expected of EXPECTED_GATES) {
    const gate = gates.find((entry) => entry && entry.id === expected.id)
    if (!gate) {
      check(false, `missing gate ${expected.id}`)
      continue
    }

    const blocked = Array.isArray(gate.blocked_tasks) ? gate.blocked_tasks : []
    check(blocked.length > 0, `${expected.id} must declare at least one blocked todo`)
    check(
      blocked.length > 0 && blocked.every((id) => typeof id === 'string' && /^\d+$/.test(id)),
      `${expected.id} blocked_tasks must be todo id strings`,
    )
    check(blocked.includes(expected.blockedTask), `${expected.id} must block todo ${expected.blockedTask}`)
    check(gate.default_adopted === false, `${expected.id} must not adopt a default`)

    const statusKnown = gate.status === 'awaiting-user-input' || gate.status === 'answered-by-evidence' || gate.status === 'answered'
    check(statusKnown, `${expected.id} has unknown status ${JSON.stringify(gate.status)}`)
    if (!statusKnown) continue

    const quote = typeof gate.owner_quote === 'string' ? gate.owner_quote.trim() : ''
    const answeredAt = typeof gate.answered_at === 'string' ? gate.answered_at.trim() : ''

    if (gate.status === 'answered') {
      check(quote.length > 0, `${expected.id} is answered without a verbatim owner_quote`)
      check(
        answeredAt.length > 0 && !Number.isNaN(Date.parse(answeredAt)),
        `${expected.id} is answered without a valid answered_at date`,
      )
    } else {
      check(quote.length === 0, `${expected.id} is awaiting-user-input but carries an owner_quote`)
      check(answeredAt.length === 0, `${expected.id} is awaiting-user-input but carries answered_at`)
    }
  }

  if (failures.length > 0) {
    console.error(`Gate ledger FAILED (${failures.length}): ${file}`)
    for (const failure of failures) console.error(`- ${failure}`)
    process.exitCode = 1
    return
  }

  const answered = gates.filter((gate) => gate.status === 'answered').length
  console.log(`Gate ledger OK: gates=${gates.length} ids=${ids.join(',')} answered=${answered} awaiting=${gates.length - answered}`)
}

main()
