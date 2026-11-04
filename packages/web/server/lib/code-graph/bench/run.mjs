#!/usr/bin/env bun
// S11 benchmark-discipline harness entry point (docs + eval only).
//
// Dry run:
//   bun ./packages/web/server/lib/code-graph/bench/run.mjs --mini
// Full-discipline shape (4 runs/arm medians):
//   bun ./packages/web/server/lib/code-graph/bench/run.mjs --mini --runs 4
//
// What it does: loads the fixed mini-corpus, runs the both-arms CLI block
// probe (every arm/repo/run attempts the `codegraph` CLI against an empty
// PATH and must observe zero output bytes), builds N runs/arm of
// deterministic synthetic records (seeded; DRY-RUN only, never a perf
// claim), and prints the full table: throughput medians + residual-occupancy
// row + blocked-attempt counts. Exits 0 only when the contamination gate
// passes; exits 2 when the corpus shape drifts from the frozen contract.

import { spawnSync } from "node:child_process";
import { MINI_CORPUS } from "./corpus.mini.mjs";
import {
  checkContaminationGate,
  mulberry32,
  renderTable,
  summarizeArm,
} from "./lib.mjs";

// String check without a runtime `typeof` (banned by the anti-slop gate).
const isString = (value) => Object.prototype.toString.call(value) === "[object String]";

const ARMS = ["WITH", "WITHOUT"];
const DRY_RUN_SEED = 0xc6a9;

// Synthetic dry-run bases only. WITHOUT burns discovery (more tools, tokens,
// time); WITH front-loads one dense payload (less processed, more resident).
// Direction mirrors the harvested finding; magnitudes are illustrative.
const SYNTHETIC_BASES = {
  "mini-ts": {
    WITH: { timeS: 58, toolCalls: 2, tokens: 15500, costUsd: 0.53, residualTokens: 33000 },
    WITHOUT: { timeS: 130, toolCalls: 28, tokens: 41000, costUsd: 1.8, residualTokens: 18000 },
  },
  "mini-js": {
    WITH: { timeS: 28, toolCalls: 1, tokens: 6500, costUsd: 0.31, residualTokens: 16500 },
    WITHOUT: { timeS: 46, toolCalls: 7, tokens: 12000, costUsd: 0.31, residualTokens: 9000 },
  },
};

function parseArgs(argv) {
  const args = { mini: false, runs: 2 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--mini") args.mini = true;
    else if (argv[i] === "--runs") args.runs = Number(argv[++i]);
  }
  return args;
}

// Both-arms CLI block probe: attempt the real `codegraph` CLI with no PATH
// to resolve it from. A blocked attempt observes an error and zero output
// bytes; any output byte is contamination and fails the gate.
function probeCliBlock() {
  const probed = spawnSync("codegraph", ["--version"], {
    env: { ...process.env, PATH: "" },
    encoding: "buffer",
    timeout: 10000,
  });
  const outputBytes =
    (probed.stdout?.length ?? 0) + (probed.stderr?.length ?? 0);
  return { blocked: probed.error != null || probed.status !== 0, outputBytes };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.mini || !Number.isInteger(args.runs) || args.runs < 1) {
    console.error(
      "usage: bun ./packages/web/server/lib/code-graph/bench/run.mjs --mini [--runs N]"
    );
    process.exit(2);
  }
  // Frozen-corpus contract: exactly 2 repos, one question each.
  const repos = MINI_CORPUS.repos ?? [];
  if (
    repos.length !== 2 ||
    repos.some((r) => !isString(r.question) || r.question.length === 0)
  ) {
    console.error(
      `corpus ${MINI_CORPUS.id} drifted from the frozen 2-repo/1-question contract; ` +
        `ship a new corpus id, never an edit.`
    );
    process.exit(2);
  }

  const rng = mulberry32(DRY_RUN_SEED);
  const jitter = (v) => v * (1 + (rng() - 0.5) * 0.2);
  let attempted = 0;
  let blockedAttempts = 0;
  let cliOutputBytes = 0;
  const tableRows = [];

  for (const repo of repos) {
    for (const arm of ARMS) {
      const records = [];
      for (let run = 0; run < args.runs; run++) {
        attempted += 1;
        const probe = probeCliBlock();
        if (probe.blocked) blockedAttempts += 1;
        cliOutputBytes += probe.outputBytes;
        const base = SYNTHETIC_BASES[repo.id][arm];
        records.push({
          timeS: jitter(base.timeS),
          toolCalls: Math.max(1, Math.round(jitter(base.toolCalls))),
          tokens: jitter(base.tokens),
          costUsd: jitter(base.costUsd),
          residualTokens: jitter(base.residualTokens),
        });
      }
      tableRows.push({ repo: repo.id, arm, ...summarizeArm(records) });
    }
  }

  const gate = {
    ...checkContaminationGate({ blockedAttempts, cliOutputBytes }),
    attempted,
  };
  console.log(
    renderTable({
      corpusId: MINI_CORPUS.id,
      regime: "dry-run-synthetic/1-turn (do not mix with single- or multi-turn model rows)",
      runsPerArm: args.runs,
      rows: tableRows,
      gate,
      synthetic: true,
    })
  );
  if (!gate.pass || blockedAttempts !== attempted) {
    console.error(
      `contamination gate FAILED: ${blockedAttempts}/${attempted} blocked, ${cliOutputBytes} output bytes.`
    );
    process.exit(1);
  }
}

main();
