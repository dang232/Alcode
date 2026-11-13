#!/usr/bin/env node
// Read-only conformance check for .omo/ulw/p26-report.md. Writes nothing.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const reportPath = resolve(repoRoot, ".omo/ulw/p26-report.md");
const failures = [];
const pass = (msg) => console.log("PASS " + msg);
const fail = (msg) => { failures.push(msg); console.log("FAIL " + msg); };

if (!existsSync(reportPath) || !statSync(reportPath).isFile()) {
  fail(".omo/ulw/p26-report.md exists");
  console.log("\nRESULT: FAIL (" + failures.length + " failure(s))");
  process.exit(1);
}
pass(".omo/ulw/p26-report.md exists");
const text = readFileSync(reportPath, "utf8");
const lines = text.split(/\r?\n/);

const headings = lines.filter((line) => line.startsWith("## "));
if (headings.length === 20) pass("exactly 20 top-level '## ' headings (" + headings.length + ")");
else fail("exactly 20 top-level '## ' headings (found " + headings.length + ")");

if (/^### Appendix A\b/m.test(text)) pass("Appendix A present at heading level '###'");
else fail("Appendix A present at heading level '###'");

const ledger = new Map();
for (const line of lines) {
  const m = line.match(/^\|\s*C([1-7])\b/);
  if (m && /\b(PASS|PARTIAL)\b/.test(line)) ledger.set(m[1], line);
}
for (let i = 1; i <= 7; i += 1) {
  if (ledger.has(String(i))) pass("per-criterion ledger names C" + i + " with PASS/PARTIAL");
  else fail("per-criterion ledger names C" + i + " with PASS/PARTIAL");
}

const cited = new Set();
for (const m of text.matchAll(/\.omo\/[A-Za-z0-9._/-]+/g)) {
  let p = m[0].replace(/[.,;:]+$/, "");
  if (p.includes("*") || p.includes("<") || p.includes(">")) continue;
  cited.add(p);
}
let okPaths = 0;
for (const p of [...cited].sort()) {
  if (existsSync(resolve(repoRoot, p))) okPaths += 1;
  else fail("cited .omo path exists: " + p);
}
pass("every cited .omo path exists (" + okPaths + "/" + cited.size + ")");

console.log("\nRESULT: " + (failures.length === 0 ? "PASS" : "FAIL") + " (" + failures.length + " failure(s))");
process.exit(failures.length === 0 ? 0 : 1);
