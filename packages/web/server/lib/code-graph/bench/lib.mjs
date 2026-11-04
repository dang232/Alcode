// Shared helpers for the S11 benchmark-discipline harness.
// Dependency-free (node built-ins only); imported by run.mjs.

// Canonical metric definitions. Every perf claim ships with these exact
// meanings; a table row that redefines one is a new regime, not a revision.
export const METRIC_DEFINITIONS = {
  cost: "run total_cost_usd",
  tokens:
    "total tokens processed, summed per assistant turn " +
    "(input incl. cache reads + creation + output)",
  time: "wall-clock per run",
  toolCalls: "every invocation, incl. sub-agent-spawned calls",
  residual:
    "tokens resident in context after N turns (occupancy), " +
    "not tokens processed (throughput)",
};

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Deterministic PRNG (mulberry32) so dry-run records are reproducible.
// `seed` is fixed in run.mjs; variation across run indexes is deliberate
// (medians need spread) and identical on every invocation.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function summarizeArm(records) {
  const pick = (k) => median(records.map((r) => r[k]));
  return {
    timeS: pick("timeS"),
    toolCalls: pick("toolCalls"),
    tokens: pick("tokens"),
    costUsd: pick("costUsd"),
    residualTokens: pick("residualTokens"),
    runs: records.length,
  };
}

// Contamination gate: the CLI block holds only when zero CLI output entered
// any run window. Blocked attempts are reported; output bytes decide PASS.
export function checkContaminationGate({ blockedAttempts, cliOutputBytes }) {
  return {
    pass: cliOutputBytes === 0,
    blockedAttempts,
    cliOutputBytes,
  };
}

const pad = (s, w) => String(s).padEnd(w);
const pct = (withV, withoutV) =>
  withoutV === 0 ? "n/a" : `${((1 - withV / withoutV) * 100).toFixed(1)}%`;

export function renderTable({
  corpusId,
  regime,
  runsPerArm,
  rows,
  gate,
  synthetic,
}) {
  const line = (c = "-") => c.repeat(78);
  const out = [];
  out.push(line("="));
  out.push(
    `code-graph benchmark discipline table  corpus: ${corpusId}  ` +
      `regime: ${regime}  runs/arm: ${runsPerArm} (median of ${runsPerArm})`
  );
  if (synthetic) {
    out.push(
      "DRY-RUN: synthetic records exercise the harness mechanics only; " +
        "not a perf claim."
    );
  }
  out.push(line("="));
  out.push(
    `${pad("repo", 10)}${pad("arm", 10)}${pad("time", 10)}` +
      `${pad("tools", 8)}${pad("tokens", 10)}${pad("cost", 10)}` +
      `${pad("residual", 12)}`
  );
  out.push(line());
  for (const r of rows) {
    out.push(
      `${pad(r.repo, 10)}${pad(r.arm, 10)}${pad(r.timeS.toFixed(1) + "s", 10)}` +
        `${pad(r.toolCalls.toFixed(0), 8)}${pad(r.tokens.toFixed(0), 10)}` +
        `${pad("$" + r.costUsd.toFixed(2), 10)}` +
        `${pad(r.residualTokens.toFixed(0) + " tok", 12)}`
    );
  }
  out.push(line());
  const withRows = rows.filter((r) => r.arm === "WITH");
  const withoutRows = rows.filter((r) => r.arm === "WITHOUT");
  const avg = (rs, k) => rs.reduce((n, r) => n + r[k], 0) / rs.length;
  out.push(
    `savings WITH vs WITHOUT (medians): time ${pct(avg(withRows, "timeS"), avg(withoutRows, "timeS"))}  ` +
      `tools ${pct(avg(withRows, "toolCalls"), avg(withoutRows, "toolCalls"))}  ` +
      `tokens ${pct(avg(withRows, "tokens"), avg(withoutRows, "tokens"))}  ` +
      `cost ${pct(avg(withRows, "costUsd"), avg(withoutRows, "costUsd"))}`
  );
  const resW = avg(withRows, "residualTokens");
  const resWo = avg(withoutRows, "residualTokens");
  out.push(
    `residual occupancy WITH vs WITHOUT: ${resW.toFixed(0)} vs ${resWo.toFixed(0)} tok ` +
      `(${resWo === 0 ? "n/a" : `WITH leaves ${((resW / resWo - 1) * 100).toFixed(0)}% more resident`}; ` +
      `throughput win does not imply resident win)`
  );
  out.push(
    `contamination gate: blocked attempts ${gate.blockedAttempts}/${gate.attempted}  ` +
      `CLI output bytes ${gate.cliOutputBytes} — ${gate.pass ? "PASS" : "FAIL"}`
  );
  out.push(
    `definitions: cost=${METRIC_DEFINITIONS.cost}; tokens=${METRIC_DEFINITIONS.tokens}; ` +
      `time=${METRIC_DEFINITIONS.time}; tool-calls=${METRIC_DEFINITIONS.toolCalls}; ` +
      `residual=${METRIC_DEFINITIONS.residual}`
  );
  out.push(line("="));
  return out.join("\n");
}
