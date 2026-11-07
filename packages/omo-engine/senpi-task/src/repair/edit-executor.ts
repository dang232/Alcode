// Real repair-edit executor: applies a host-validated repair through the same
// authorized file-write path ordinary Alcode workers use, then proves each
// edit by re-reading the file from disk.
//
// Authorized primitives reused (not reimplemented):
// - `createEditToolDefinition` from the @code-yeongyu/senpi barrel
//   (node_modules/@code-yeongyu/senpi/dist/core/tools/edit.js:81) for every
//   file mutation, and `createWriteToolDefinition`
//   (node_modules/@code-yeongyu/senpi/dist/core/tools/write.js:22) for
//   rollback restores. These are the exact definitions the in-process runner
//   installs as session builtins `edit` / `write`
//   (src/runners/in-process/host-tools.ts:17-18, sessionBuiltin: true), which
//   is what an ordinary worker's `edit` / `write` tool call executes.
//   Calling the definitions' `execute` transitively reuses their internal
//   guards: `resolveToCwd` (dist/core/tools/path-utils.js:47),
//   `canonicalizeFilesystemPath` (dist/core/tools/filesystem-policy.js:49),
//   `withFileMutationQueue` (dist/core/tools/file-mutation-queue.js:29), and
//   `applyEditsToNormalizedContent` (dist/core/tools/edit-diff.js:216).
//   The barrel is loaded with a dynamic `import()` so this file keeps no
//   static runtime edge to "@code-yeongyu/senpi"
//   (see src/lazy/senpi-barrel.ts and src/senpi-static-import-guard.test.ts).
// - `workspaceRevision` (src/verification/evidence-store.ts:69) for the
//   baseline-vs-current conflict check and the resulting revision, the same
//   revision src/repair/execute.ts stamps evidence with. It only reads git
//   state (rev-parse/status); this module never runs a git command to apply
//   or revert an edit.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import type * as SenpiBarrel from "@code-yeongyu/senpi";

import { workspaceRevision } from "../verification/evidence-store";
import type { RepairPlan } from "./plan";

// One exact-text replacement, mirroring the worker `edit` tool's
// `{ path, edits: [{ oldText, newText }] }` shape: oldText must match exactly
// (including whitespace) and newText is its replacement.
export type ProposedRepairEdit = {
  readonly path: string;
  readonly oldText: string;
  readonly newText: string;
};

export type ApplyRepairEditsInput = {
  // Host-approved plan: filesToChange is the closed set this call may touch.
  readonly plan: RepairPlan;
  readonly workspaceDir: string;
  // workspaceRevision(workspaceDir) observed before the repair was built.
  readonly baselineRevision: string;
  readonly edits: readonly ProposedRepairEdit[];
  // Test-only seam for the adversarial "lying writer" case: when set, the
  // executor calls it instead of the real edit-tool `execute` to prove the
  // re-read verification catches a claimed-without-change write. Production
  // callers omit it and always ride the real tool definitions above.
  readonly overrides?: {
    readonly executeEdit?: (absolutePath: string, edit: ProposedRepairEdit) => Promise<void>;
    readonly restoreFile?: (absolutePath: string, content: string) => Promise<void>;
  };
};

export type RepairEditFileReceipt = {
  readonly path: string;
  readonly beforeHash: string;
  readonly afterHash: string;
};

type ApplyRepairEditsFailureCode =
  | "outside_plan"
  | "protected_path"
  | "path_escape"
  | "revision_conflict"
  | "edit_failed"
  | "no_filesystem_change"
  | "rollback_failed";

export type ApplyRepairEditsFailure = {
  readonly code: ApplyRepairEditsFailureCode;
  readonly message: string;
  readonly path?: string;
};

export type ApplyRepairEditsReceipt = {
  readonly status: "applied" | "rejected";
  readonly files: readonly RepairEditFileReceipt[];
  // workspaceRevision(workspaceDir) observed when this receipt was produced.
  readonly revision: string;
  readonly failures: readonly ApplyRepairEditsFailure[];
};

type RepairEditToolUpdate = {
  readonly text?: string;
};

type RepairEditToolUpdateHandler = (update: RepairEditToolUpdate) => void;

type EditToolDefinitionLike = {
  readonly execute: (
    toolCallId: string,
    input: {
      readonly path: string;
      readonly edits?: readonly { readonly oldText: string; readonly newText: string }[];
      readonly content?: string;
    },
    signal?: AbortSignal,
    onUpdate?: RepairEditToolUpdateHandler,
    ctx?: { readonly cwd?: string },
  ) => Promise<void>;
};

function normalizeRepairPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function pathSegments(path: string): readonly string[] {
  return normalizeRepairPath(path).split("/").filter((segment) => segment.length > 0);
}

// Same cover semantics repair/plan.ts uses for scope checks: equality or
// prefix in either direction, so a scoped directory covers its files.
function scopeCovers(scopePath: string, file: string): boolean {
  const scope = normalizeRepairPath(scopePath);
  const target = normalizeRepairPath(file);
  if (scope.length === 0 || target.length === 0) return false;
  return target === scope || target.startsWith(scope + "/") || scope.startsWith(target + "/");
}

const ALCODE_SENSITIVE_NAME =
  /(verif|approval|authorit|catalog|policy|allow|key|secret|credential|token)/i;
const VERIFICATION_AUTHORITY_FILE = /(catalogue|catalog|approval|authority)/i;

// Mirrors the guard in repair/plan.ts (guardPaths) plus the workspace's own
// git directory: a repair may never rewrite verification evidence, approval
// authority, catalogue material, or .git internals.
function isProtectedRepairPath(rawPath: string): boolean {
  const segments = pathSegments(rawPath);
  if (segments.includes(".git")) return true;
  if (segments.includes(".alcode") && ALCODE_SENSITIVE_NAME.test(rawPath)) return true;
  if (segments.includes("verification")) {
    const fileName = segments[segments.length - 1] ?? "";
    if (VERIFICATION_AUTHORITY_FILE.test(fileName)) return true;
  }
  return false;
}

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export async function applyRepairEdits(input: ApplyRepairEditsInput): Promise<ApplyRepairEditsReceipt> {
  const workspaceDir = resolve(input.workspaceDir);

  // 1. Concurrent-modification fence: the tree moved since the host's
  // baseline, so overwriting it would bury someone else's change. Abort
  // before touching anything.
  const currentRevision = workspaceRevision(workspaceDir);
  if (currentRevision !== input.baselineRevision) {
    return {
      status: "rejected",
      files: [],
      revision: currentRevision,
      failures: [
        {
          code: "revision_conflict",
          message: `workspace revision changed between the repair baseline and the write (baseline ${input.baselineRevision}, current ${currentRevision}); refusing to overwrite a concurrently modified tree`,
        },
      ],
    };
  }

  // 2. Validate every edit before writing any file, so a rejection leaves no
  // partial write behind. Escape and protected-path checks run first so a
  // sensitive path is reported as protected even when it is also outside the
  // plan's allowed set.
  type ValidatedEdit = {
    readonly edit: ProposedRepairEdit;
    readonly absolutePath: string;
    readonly receiptPath: string;
  };
  const failures: ApplyRepairEditsFailure[] = [];
  const validated: ValidatedEdit[] = [];
  const allowed = input.plan.filesToChange.map(normalizeRepairPath);
  for (const edit of input.edits) {
    const absolutePath = resolve(workspaceDir, edit.path);
    const rel = relative(workspaceDir, absolutePath);
    if (rel.length === 0 || rel === ".." || rel.startsWith(`..${"/"}`)) {
      const failure: ApplyRepairEditsFailure = {
        code: "path_escape",
        message: `repair edit escapes the workspace: ${edit.path}`,
      };
      failures.push({ ...failure, path: edit.path });
      continue;
    }
    const receiptPath = normalizeRepairPath(rel);
    if (isProtectedRepairPath(receiptPath) || isProtectedRepairPath(edit.path)) {
      failures.push({
        code: "protected_path",
        message: `repair edit targets protected verification, approval, catalogue, or git material: ${edit.path}`,
        path: edit.path,
      });
      continue;
    }
    const insidePlan = allowed.some(
      (allowedPath) => scopeCovers(allowedPath, receiptPath) || scopeCovers(allowedPath, normalizeRepairPath(edit.path)),
    );
    if (!insidePlan) {
      failures.push({
        code: "outside_plan",
        message: `repair edit targets ${edit.path}, which sits outside the plan's filesToChange`,
        path: edit.path,
      });
      continue;
    }
    validated.push({ edit, absolutePath, receiptPath });
  }
  if (failures.length > 0) {
    return {
      status: "rejected",
      files: [],
      revision: workspaceRevision(workspaceDir),
      failures,
    };
  }

  // 3. Apply through the real worker tool definitions (dynamic barrel import
  // keeps the static-import guard green). Rollback restores use the real
  // write-tool definition for the same reason.
  // SAFETY: the pinned barrel always exports the two factories this module calls; Pick names only that surface.
  const barrel = (await import("@code-yeongyu/senpi")) as Pick<
    typeof SenpiBarrel,
    "createEditToolDefinition" | "createWriteToolDefinition"
  >;
  if (!(barrel.createEditToolDefinition instanceof Function) || !(barrel.createWriteToolDefinition instanceof Function)) {
    throw new Error("The pinned @code-yeongyu/senpi engine does not export createEditToolDefinition/createWriteToolDefinition.");
  }
  // SAFETY: the engine tool definitions share the execute shape above; Like names only the fields this module calls.
  const editTool = barrel.createEditToolDefinition(workspaceDir) as EditToolDefinitionLike;
  // SAFETY: the engine write definition shares the same execute shape; Like names only the fields the rollback calls.
  const writeTool = barrel.createWriteToolDefinition(workspaceDir) as EditToolDefinitionLike;

  const realExecuteEdit = async (absolutePath: string, edit: ProposedRepairEdit): Promise<void> => {
    await editTool.execute(
      "senpi-task-repair-edit",
      { path: absolutePath, edits: [{ oldText: edit.oldText, newText: edit.newText }] },
      undefined,
      undefined,
      { cwd: workspaceDir },
    );
  };
  const realRestoreFile = async (absolutePath: string, content: string): Promise<void> => {
    await writeTool.execute("senpi-task-repair-rollback", { path: absolutePath, content }, undefined, undefined, {
      cwd: workspaceDir,
    });
  };
  const executeEdit = input.overrides?.executeEdit ?? realExecuteEdit;
  const restoreFile = input.overrides?.restoreFile ?? realRestoreFile;

  const applied: { readonly absolutePath: string; readonly beforeContent: string }[] = [];
  const files: RepairEditFileReceipt[] = [];
  const fail = async (
    failure: ApplyRepairEditsFailure,
  ): Promise<ApplyRepairEditsReceipt> => {
    // Restore every file already changed in reverse order through the same
    // authorized write path (never a git checkout/restore), so a mid-batch
    // failure leaves no partial write behind.
    const rollbackFailures: ApplyRepairEditsFailure[] = [];
    for (let index = applied.length - 1; index >= 0; index -= 1) {
      const entry = applied[index];
      if (entry === undefined) continue;
      try {
        await restoreFile(entry.absolutePath, entry.beforeContent);
      } catch (error) {
        rollbackFailures.push({
          code: "rollback_failed",
          message: `failed to restore ${relative(workspaceDir, entry.absolutePath)} after a repair failure: ${error instanceof Error ? error.message : String(error)}`,
          path: relative(workspaceDir, entry.absolutePath),
        });
      }
    }
    return {
      status: "rejected",
      files: [],
      revision: workspaceRevision(workspaceDir),
      failures: rollbackFailures.length > 0 ? [failure, ...rollbackFailures] : [failure],
    };
  };

  for (const item of validated) {
    let beforeContent: string;
    try {
      beforeContent = await readFile(item.absolutePath, "utf8");
    } catch (error) {
      return fail({
        code: "edit_failed",
        message: `repair edit cannot read ${item.edit.path}: ${error instanceof Error ? error.message : String(error)}`,
        path: item.edit.path,
      });
    }
    const beforeHash = hashContent(beforeContent);
    try {
      await executeEdit(item.absolutePath, item.edit);
    } catch (error) {
      return fail({
        code: "edit_failed",
        message: `repair edit failed for ${item.edit.path}: ${error instanceof Error ? error.message : String(error)}`,
        path: item.edit.path,
      });
    }
    // 4. Prove the write: re-read from disk. A claimed edit with no real
    // filesystem change is a hard failure, not a success.
    const afterContent = await readFile(item.absolutePath, "utf8");
    const afterHash = hashContent(afterContent);
    if (afterHash === beforeHash) {
      return fail({
        code: "no_filesystem_change",
        message: `repair edit claimed success for ${item.edit.path} but the file is byte-identical after re-reading it from disk`,
        path: item.edit.path,
      });
    }
    applied.push({ absolutePath: item.absolutePath, beforeContent });
    files.push({ path: item.receiptPath, beforeHash, afterHash });
  }

  return {
    status: "applied",
    files,
    revision: workspaceRevision(workspaceDir),
    failures: [],
  };
}
