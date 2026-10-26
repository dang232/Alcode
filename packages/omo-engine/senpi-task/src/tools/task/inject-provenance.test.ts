import { describe, expect, test } from "bun:test"

import { buildStartSpec, type InjectedKnowledgeBlock, type InjectedKnowledgeRecord } from "./execute-spec"
import { CTX, createFakeManager, makeDeps } from "./__fixtures__/task-tool-fakes"

function knowledgeRecord(overrides: Partial<InjectedKnowledgeRecord> = {}): InjectedKnowledgeRecord {
  return {
    id: "pk-abc123def456",
    category: "source-verified",
    claim: "Evidence gates stay fail-closed.",
    sourceFile: "src/dag/verification.ts",
    sourceRevision: "c".repeat(40),
    fingerprint: "d".repeat(64),
    validatedAt: "2026-10-20T00:00:00.000Z",
    ...overrides,
  }
}

function promptFor(block: InjectedKnowledgeBlock): string {
  const deps = makeDeps(createFakeManager({}))
  return buildStartSpec({ prompt: "base" }, { category: "quick" }, CTX.sessionManager.getSessionId(), deps, CTX.cwd, undefined, block).prompt
}

describe("inject-provenance", () => {
  test("#given an injected block #when rendered #then the untrusted-data header travels with it", () => {
    // given one eligible record
    // when the spec prompt is built
    const prompt = promptFor({ records: [knowledgeRecord()] })
    // then H1 travels with the data
    expect(prompt).toContain("untrusted memory")
    expect(prompt).toContain("verify before acting")
  })

  test("#given a record #when rendered #then id, category, source, short hashes, and validation travel together", () => {
    // given a fully provenanced record
    // when the spec prompt is built
    const prompt = promptFor({ records: [knowledgeRecord()] })
    // then every provenance slot is present in short form
    expect(prompt).toContain("pk-abc123def456")
    expect(prompt).toContain("source-verified")
    expect(prompt).toContain("src/dag/verification.ts")
    expect(prompt).toContain("c".repeat(12))
    expect(prompt).toContain("d".repeat(12))
    expect(prompt).toContain("2026-10-20T00:00:00.000Z")
    // and the long hashes are not leaked in full
    expect(prompt.includes("c".repeat(40))).toBe(false)
    expect(prompt.includes("d".repeat(64))).toBe(false)
  })

  test("#given a record never validated #when rendered #then the slot reads never validated", () => {
    // given a record without validatedAt (entry state: never validated)
    const neverValidated: InjectedKnowledgeRecord = { ...knowledgeRecord(), validatedAt: undefined }
    // when the spec prompt is built
    const prompt = promptFor({ records: [neverValidated] })
    // then the provenance slot stays explicit instead of vanishing
    expect(prompt).toContain("never validated")
    expect(prompt).toContain("pk-abc123def456")
  })

  test("#given more records than the cap #when truncated #then provenance survives on every kept line", () => {
    // given 15 eligible records against the 12-record cap
    const records = Array.from({ length: 15 }, (_, index) =>
      knowledgeRecord({ id: `pk-record${String(index).padStart(2, "0")}` }))
    // when the spec prompt is built
    const prompt = promptFor({ records })
    // then the block stays bounded and every kept line keeps its provenance
    const provenanceLines = prompt.split("\n").filter((line) => line.includes("(source:"))
    expect(provenanceLines).toHaveLength(12)
    for (const line of provenanceLines) {
      expect(line).toContain("fingerprint")
      expect(line).toContain("source-verified")
    }
    expect(prompt).toContain("untrusted memory")
  })

  test("#given an oversized block #when truncated #then the block stays within 4KB with the header intact", () => {
    // given records whose claims would overflow the byte cap
    const records = Array.from({ length: 12 }, (_, index) =>
      knowledgeRecord({ id: `pk-big${String(index).padStart(2, "0")}`, claim: `word ${index} ` + "x".repeat(490) }))
    // when the spec prompt is built
    const prompt = promptFor({ records })
    const suffix = prompt.slice("base".length)
    // then the suffix (header included) fits the budget
    expect(new TextEncoder().encode(suffix).length).toBeLessThanOrEqual(4096)
    expect(suffix).toContain("untrusted memory")
    expect(suffix).toContain("(source:")
  })
})
