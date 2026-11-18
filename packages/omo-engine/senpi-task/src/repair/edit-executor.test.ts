// Adversarial proof for the real repair-edit executor: every test drives the
// real applyRepairEdits against a real git workspace under os.tmpdir (never
// inside the repo) with plain bun:test - no sleeps, no engine mocks. The only
// injected seam is the test-only overrides.executeEdit in the
// claimed-without-change case, which simulates a lying writer to prove the
// re-read verification catches it; every other test rides the real senpi
// edit/write tool definitions.
import { describe, expect, test, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { workspaceRevision } from "../verification/evidence-store";
import type { RepairPlan } from "./plan";
import { applyRepairEdits } from "./edit-executor";

const roots: string[] = [];
function tempRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(dir: string, ...args: string[]): void {
  execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
}

function gitWorkspace(name: string): string {
  const workspace = join(tempRoot(name), "workspace");
  mkdirSync(join(workspace, "src"), { recursive: true });
  mkdirSync(join(workspace, "verification"), { recursive: true });
  writeFileSync(join(workspace, "src", "fix.ts"), "export const counter = 0;\n");
  writeFileSync(join(workspace, "src", "other.ts"), "export const other = 1;\n");
  writeFileSync(join(workspace, "verification", "catalogue.json"), '{"checks":[]}\n');
  git(workspace, "init", "-q");
  git(workspace, "add", "-A");
  git(workspace, "-c", "user.email=t@x", "-c", "user.name=t", "commit", "-qm", "init");
  return workspace;
}

function planFor(filesToChange: readonly string[]): RepairPlan {
  return {
    addressedCheckIds: ["unit-a"],
    suspectedRootCause: "off-by-one in the retry counter",
    supportingEvidence: ["unit-a exit code 4"],
    filesToChange: [...filesToChange],
    expectedBehaviourChange: "retry counter increments once per round",
    risks: ["none observed"],
    checksToRerun: ["unit-a"],
    checksToRemainUnchanged: [],
    rollbackPlan: "revert the edited file",
  };
}

function sha(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

describe("repair edit-executor", () => {
  test("given an approved plan when the edit applies then content is verified and the receipt carries before/after hashes", async () => {
    const workspace = gitWorkspace("repair-exec-ok-");
    const baseline = workspaceRevision(workspace);
    const before = readFileSync(join(workspace, "src", "fix.ts"), "utf8");

    const receipt = await applyRepairEdits({
      plan: planFor(["src/fix.ts"]),
      workspaceDir: workspace,
      baselineRevision: baseline,
      edits: [{ path: "src/fix.ts", oldText: "counter = 0", newText: "counter = 1" }],
    });

    expect(receipt.status).toBe("applied");
    expect(receipt.failures).toEqual([]);
    expect(receipt.files).toHaveLength(1);
    expect(receipt.files[0]?.path).toBe("src/fix.ts");
    expect(receipt.files[0]?.beforeHash).toBe(sha(before));
    const after = readFileSync(join(workspace, "src/fix.ts"), "utf8");
    expect(after).toContain("counter = 1");
    expect(receipt.files[0]?.afterHash).toBe(sha(after));
    expect(receipt.files[0]?.beforeHash).not.toBe(receipt.files[0]?.afterHash);
    expect(receipt.revision).toBe(workspaceRevision(workspace));
    expect(receipt.revision).not.toBe(baseline);
  });

  test("given an edit outside the plan when applied then it is rejected and the file is untouched", async () => {
    const workspace = gitWorkspace("repair-exec-outside-");
    const baseline = workspaceRevision(workspace);
    const before = readFileSync(join(workspace, "src", "other.ts"), "utf8");

    const receipt = await applyRepairEdits({
      plan: planFor(["src/fix.ts"]),
      workspaceDir: workspace,
      baselineRevision: baseline,
      edits: [{ path: "src/other.ts", oldText: "other = 1", newText: "other = 2" }],
    });

    expect(receipt.status).toBe("rejected");
    expect(receipt.files).toEqual([]);
    expect(receipt.failures).toHaveLength(1);
    expect(receipt.failures[0]?.code).toBe("outside_plan");
    expect(readFileSync(join(workspace, "src", "other.ts"), "utf8")).toBe(before);
    expect(workspaceRevision(workspace)).toBe(baseline);
  });

  test("given an edit to verification evidence or authority material when applied then it is rejected even when the plan names it", async () => {
    const workspace = gitWorkspace("repair-exec-protected-");
    const baseline = workspaceRevision(workspace);
    const beforeCatalogue = readFileSync(join(workspace, "verification", "catalogue.json"), "utf8");

    const receipt = await applyRepairEdits({
      plan: planFor(["verification/catalogue.json"]),
      workspaceDir: workspace,
      baselineRevision: baseline,
      edits: [{ path: "verification/catalogue.json", oldText: '"checks":[]', newText: '"checks":["x"]' }],
    });

    expect(receipt.status).toBe("rejected");
    expect(receipt.files).toEqual([]);
    expect(receipt.failures).toHaveLength(1);
    expect(receipt.failures[0]?.code).toBe("protected_path");
    expect(readFileSync(join(workspace, "verification", "catalogue.json"), "utf8")).toBe(beforeCatalogue);

    const gitReceipt = await applyRepairEdits({
      plan: planFor([".git/config"]),
      workspaceDir: workspace,
      baselineRevision: baseline,
      edits: [{ path: ".git/config", oldText: "x", newText: "y" }],
    });
    expect(gitReceipt.status).toBe("rejected");
    expect(gitReceipt.failures[0]?.code).toBe("protected_path");
    expect(gitReceipt.files).toEqual([]);
  });

  test("given a writer that claims success without changing the file when applied then the re-read rejects it as a hard failure", async () => {
    const workspace = gitWorkspace("repair-exec-nochange-");
    const baseline = workspaceRevision(workspace);
    const before = readFileSync(join(workspace, "src", "fix.ts"), "utf8");

    const receipt = await applyRepairEdits({
      plan: planFor(["src/fix.ts"]),
      workspaceDir: workspace,
      baselineRevision: baseline,
      edits: [{ path: "src/fix.ts", oldText: "counter = 0", newText: "counter = 1" }],
      overrides: {
        // Lying writer: resolves without touching the filesystem.
        executeEdit: async () => undefined,
      },
    });

    expect(receipt.status).toBe("rejected");
    expect(receipt.files).toEqual([]);
    expect(receipt.failures).toHaveLength(1);
    expect(receipt.failures[0]?.code).toBe("no_filesystem_change");
    expect(readFileSync(join(workspace, "src", "fix.ts"), "utf8")).toBe(before);
  });

  test("given an identical old/new text when applied through the real tool then it is rejected and leaves no change", async () => {
    const workspace = gitWorkspace("repair-exec-noop-");
    const baseline = workspaceRevision(workspace);
    const before = readFileSync(join(workspace, "src", "fix.ts"), "utf8");

    const receipt = await applyRepairEdits({
      plan: planFor(["src/fix.ts"]),
      workspaceDir: workspace,
      baselineRevision: baseline,
      edits: [{ path: "src/fix.ts", oldText: "counter = 0", newText: "counter = 0" }],
    });

    expect(receipt.status).toBe("rejected");
    expect(receipt.files).toEqual([]);
    expect(receipt.failures).toHaveLength(1);
    expect(["edit_failed", "no_filesystem_change"]).toContain(receipt.failures[0]?.code);
    expect(readFileSync(join(workspace, "src", "fix.ts"), "utf8")).toBe(before);
  });

  test("given a concurrent external modification when applied then it aborts with a conflict instead of overwriting", async () => {
    const workspace = gitWorkspace("repair-exec-conflict-");
    const baseline = workspaceRevision(workspace);
    // External move after the baseline: an uncommitted change from someone else.
    writeFileSync(join(workspace, "src", "other.ts"), "export const other = 99;\n");
    const beforeFix = readFileSync(join(workspace, "src", "fix.ts"), "utf8");

    const receipt = await applyRepairEdits({
      plan: planFor(["src/fix.ts"]),
      workspaceDir: workspace,
      baselineRevision: baseline,
      edits: [{ path: "src/fix.ts", oldText: "counter = 0", newText: "counter = 1" }],
    });

    expect(receipt.status).toBe("rejected");
    expect(receipt.files).toEqual([]);
    expect(receipt.failures).toHaveLength(1);
    expect(receipt.failures[0]?.code).toBe("revision_conflict");
    // The repair never overwrote the tree: its own target is untouched.
    expect(readFileSync(join(workspace, "src", "fix.ts"), "utf8")).toBe(beforeFix);
  });

  test("given a batch with one valid and one rejected edit when applied then no partial write is left behind", async () => {
    const workspace = gitWorkspace("repair-exec-atomic-");
    const baseline = workspaceRevision(workspace);
    const beforeFix = readFileSync(join(workspace, "src", "fix.ts"), "utf8");
    const beforeOther = readFileSync(join(workspace, "src", "other.ts"), "utf8");

    const receipt = await applyRepairEdits({
      plan: planFor(["src/fix.ts"]),
      workspaceDir: workspace,
      baselineRevision: baseline,
      edits: [
        { path: "src/fix.ts", oldText: "counter = 0", newText: "counter = 1" },
        { path: "src/other.ts", oldText: "other = 1", newText: "other = 2" },
      ],
    });

    expect(receipt.status).toBe("rejected");
    expect(receipt.files).toEqual([]);
    expect(receipt.failures.some((failure) => failure.code === "outside_plan")).toBe(true);
    // Pre-write validation rejected the batch, so the valid edit never landed.
    expect(readFileSync(join(workspace, "src", "fix.ts"), "utf8")).toBe(beforeFix);
    expect(readFileSync(join(workspace, "src", "other.ts"), "utf8")).toBe(beforeOther);
    expect(workspaceRevision(workspace)).toBe(baseline);
  });
});
