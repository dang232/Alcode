// Fixed 2-repo mini-corpus for the S11 benchmark-discipline dry run.
//
// Frozen contract: exactly 2 repos, exactly one question per repo. The
// harness refuses to run when this shape changes (see run.mjs); a new
// corpus ships as a new id, never an edit, so regime rows stay comparable.
// Full-discipline corpora (e.g. the 7-repo upstream set) are out of scope:
// this file exists so the dry run exercises the discipline mechanics
// (both-arms block, N-run medians, contamination gate, residual row) on a
// fixed shape, not to publish perf claims.

export const MINI_CORPUS = {
  id: "mini-v1",
  regimeNote:
    "dry-run-synthetic/1-turn. Never quote beside Opus-4.8/single-question " +
    "or Sonnet/3-turn rows; regimes are quoted separately, never mixed.",
  repos: [
    {
      id: "mini-ts",
      language: "ts",
      files: 3,
      // One architecture question per repo (fixed).
      question:
        "Which files can reach the `serveBuilt` export, and through what call path?",
    },
    {
      id: "mini-js",
      language: "js",
      files: 3,
      question:
        "Which files can reach the `restoreFromStore` export, and through what call path?",
    },
  ],
};
