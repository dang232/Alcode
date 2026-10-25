import type { TaskUnderstanding } from "./types"
import {
  selectVerificationChecks,
  type DagChangeScope,
  type DagSelectedChecks,
  type DagVerifyCheck,
} from "../verification"

function basenameOf(path: string): string {
  const slash = path.lastIndexOf("/")
  const backslash = path.lastIndexOf("\\")
  const cut = slash > backslash ? slash : backslash
  return cut < 0 ? path : path.slice(cut + 1)
}

function isTestFilePath(file: string): boolean {
  const base = basenameOf(file)
  return /\.test\.(ts|js|tsx|jsx|mjs|cjs)$/.test(base) || /\.spec\.(ts|js|tsx|jsx|mjs|cjs)$/.test(base)
}

export function affectedTestPaths(understanding: TaskUnderstanding): readonly string[] {
  if (understanding.usableForCaution !== true) return []
  const found = new Set<string>()
  for (const item of understanding.tests) {
    if (item.file.length > 0) found.add(item.file)
  }
  for (const change of understanding.changes) {
    if (change.file.length > 0 && isTestFilePath(change.file)) found.add(change.file)
  }
  return [...found].sort()
}

export function selectImpactAwareChecks(input: {
  readonly scope: DagChangeScope
  readonly available: readonly DagVerifyCheck[]
  readonly understanding: TaskUnderstanding
}): DagSelectedChecks {
  const base = selectVerificationChecks(input.scope, input.available)
  if (input.understanding.usableForCaution !== true) return base
  const affected = affectedTestPaths(input.understanding)
  if (affected.length === 0) return base
  const requiredIds = new Set<string>(base.required.map((check) => check.checkId))
  const extras: DagVerifyCheck[] = []
  for (const check of input.available) {
    if (requiredIds.has(check.checkId)) continue
    const joined = check.command.join(" ")
    let matched = false
    for (const path of affected) {
      if (joined.includes(path) || joined.includes(basenameOf(path))) {
        matched = true
        break
      }
    }
    if (matched) {
      extras.push(check)
      requiredIds.add(check.checkId)
    }
  }
  if (extras.length === 0) return base
  const extraIds = new Set<string>(extras.map((check) => check.checkId))
  return {
    required: [...base.required, ...extras],
    omitted: base.omitted.filter((entry) => !extraIds.has(entry.check.checkId)),
  }
}
