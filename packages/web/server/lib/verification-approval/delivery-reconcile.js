import { statSync } from "node:fs"
import { reconcileRunSnapshots } from "../../../../omo-engine/omo-opencode/src/cli/run/run-delivery-reconcile.ts"

const messageOf = (error, fallback) => {
  const text = error instanceof Error ? String(error.message) : null
  return text !== null && text.length > 0 ? text : fallback
}

export function createSnapshotReconciler(options = {}) {
  const reconcile = options.reconcile ?? reconcileRunSnapshots
  return (input = {}) => {
    const directory = String(input.directory ?? "").trim()
    if (directory.length === 0) {
      return { error: "reconcile: a project directory is required" }
    }
    try {
      if (!statSync(directory).isDirectory()) return { error: `reconcile: not a directory: ${directory}` }
    } catch {
      return { error: `reconcile: directory not found: ${directory}` }
    }
    try {
      const report = reconcile({ directory, updatedAt: new Date().toISOString() })
      if (report.error !== undefined) return { error: `reconcile failed: ${report.error}` }
      return { report }
    } catch (error) {
      return { error: `reconcile failed: ${messageOf(error, "unknown failure")}` }
    }
  }
}
