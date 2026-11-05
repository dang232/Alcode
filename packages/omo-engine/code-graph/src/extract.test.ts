/**
 * Contract tests for `extract.ts` (schema-draft sections 1-3) on a small
 * real fixture: static calls resolve to definitions with callers,
 * unresolved dynamics stay uncertain and are never proven, and a rename or
 * delete invalidates the affected edges.
 */

import { describe, expect, it } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { indexFiles, invalidateEdges, preferUnpacked } from "./extract";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "graph-basic");
const TEST_TIMEOUT_MS = 60000;

function fixture(...names: string[]): string[] {
  return names.map((name) => join(FIXTURE_DIR, name));
}

function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "code-graph-fixture-"));
  cpSync(FIXTURE_DIR, dir, { recursive: true });
  return dir;
}

/** A temp repo with a nested index root (`apps/a`) and a cross-package target (`packages/b`). */
function writeRepoTree() {
  const repo = mkdtempSync(join(tmpdir(), "code-graph-rootdir-"));
  const files = {
    "apps/a/main.ts":
      `import { helper } from "../../packages/b/util";\n` +
      `import { same as sameA } from "./same";\n` +
      `import { same as sameB } from "../../packages/b/same";\n` +
      `import { spaced } from "./my module-ünïcode";\n` +
      `\n` +
      `export function run(): number {\n` +
      `  return helper() + sameA() + sameB() + spaced();\n` +
      `}\n`,
    "apps/a/same.ts": `export function same(): number {\n  return 1;\n}\n`,
    "apps/a/my module-ünïcode.ts": `export function spaced(): number {\n  return 3;\n}\n`,
    "packages/b/util.ts": `export function helper(): number {\n  return 42;\n}\n`,
    "packages/b/same.ts": `export function same(): number {\n  return 2;\n}\n`,
  };
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(repo, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return { repo };
}

function toPosixRoot(repo: string): string {
  const slashed = repo.replace(/\\/g, "/");
  return /^[A-Z]:\//.test(slashed) ? slashed[0].toLowerCase() + slashed.slice(1) : slashed;
}

describe("code-graph extract", () => {
  it(
    "#given a known function #when the fixture is indexed #then it resolves to its definition with callers",
    () => {
      // given
      const entries = fixture("main.ts", "reexport.ts", "main.test.ts");

      // when
      const graph = indexFiles(entries);

      // then: definition with a DEFINES edge at confidence 1.00
      const addId = "fn:add@math.ts";
      expect(graph.nodes.some((node) => node.id === addId && node.kind === "symbol")).toBe(true);
      expect(
        graph.edges.some(
          (edge) =>
            edge.kind === "DEFINES" && edge.from === "file:math.ts" && edge.to === addId && edge.confidence === 1,
        ),
      ).toBe(true);

      // then: static call edge from the caller with a file:line source ref
      const runId = "fn:run@main.ts";
      const call = graph.edges.find(
        (edge) => edge.kind === "CALLS_STATIC" && edge.from === runId && edge.to === addId,
      );
      expect(call).toBeDefined();
      expect(call?.confidence).toBe(1);
      expect(call?.ref).toBe("main.ts:4");
      expect(call?.callSite).toMatch(/^call:main\.ts:4:\d+$/);

      // then: callers of add resolve back to run
      const callers = graph.edges.filter((edge) => edge.kind === "CALLS_STATIC" && edge.to === addId);
      expect(callers.map((edge) => edge.from)).toContain(runId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given static module structure #when the fixture is indexed #then imports, exports, and test links resolve at confidence 1",
    () => {
      // given
      const entries = fixture("main.ts", "reexport.ts", "main.test.ts");

      // when
      const graph = indexFiles(entries);

      // then: static import resolved by the compiler's module resolution
      expect(
        graph.edges.some(
          (edge) =>
            edge.kind === "IMPORTS" &&
            edge.from === "file:main.ts" &&
            edge.to === "file:math.ts" &&
            edge.confidence === 1 &&
            edge.ref === "main.ts:1",
        ),
      ).toBe(true);

      // then: re-export traced to the origin declaration
      const contract = graph.nodes.find((node) => node.id === "export:add@reexport.ts");
      expect(contract?.target).toBe("fn:add@math.ts");
      expect(
        graph.edges.some(
          (edge) => edge.kind === "EXPORTS" && edge.from === "file:reexport.ts" && edge.confidence === 1,
        ),
      ).toBe(true);

      // then: test file statically imports its subject, never guessed
      expect(
        graph.edges.some(
          (edge) =>
            edge.kind === "TESTS" &&
            edge.from === "file:main.test.ts" &&
            edge.to === "file:main.ts" &&
            edge.confidence === 1,
        ),
      ).toBe(true);
      const testFile = graph.nodes.find((node) => node.id === "file:main.test.ts");
      expect(testFile?.isTest).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given dynamic call sites #when the fixture is indexed #then they are recorded uncertain and never proven",
    () => {
      // given
      const entries = fixture("main.ts");

      // when
      const graph = indexFiles(entries);

      // then: computed dispatch and eval stay uncertain, capped at most 0.50
      const dynamicId = "fn:runDynamic@main.ts";
      const evalId = "fn:runEval@main.ts";
      const unresolved = graph.edges.filter((edge) => edge.kind === "CALLS_UNRESOLVED");
      expect(unresolved.length).toBeGreaterThanOrEqual(2);
      for (const edge of unresolved) {
        expect(edge.to).toBe("unknown");
        expect(edge.confidence).toBeLessThanOrEqual(0.5);
        expect(edge.uncertain).toBe(true);
      }
      expect(unresolved.some((edge) => edge.from === dynamicId)).toBe(true);
      expect(unresolved.some((edge) => edge.from === evalId)).toBe(true);

      // then: no dynamic caller is ever recorded as a proven static call
      const provenFromDynamic = graph.edges.filter(
        (edge) => edge.kind === "CALLS_STATIC" && (edge.from === dynamicId || edge.from === evalId),
      );
      expect(provenFromDynamic).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a renamed symbol #when the graph is re-extracted #then the affected edges are invalidated",
    () => {
      // given: a baseline plus a variant with add renamed to total
      const dir = copyFixture();
      try {
        const baseline = indexFiles([join(dir, "main.ts"), join(dir, "reexport.ts"), join(dir, "main.test.ts")]);
        const mathPath = join(dir, "math.ts");
        writeFileSync(mathPath, readFileSync(mathPath, "utf8").replace("function add(", "function total("));
        const renamed = indexFiles([join(dir, "main.ts"), join(dir, "reexport.ts"), join(dir, "main.test.ts")]);

        // when
        const invalidated = invalidateEdges(baseline, renamed);

        // then: the stale definition and its callers carry SYM-RENAME
        const byFrom = new Map(invalidated.map((edge) => [edge.from, edge]));
        expect(byFrom.get("fn:add@math.ts")?.cause).toBe("SYM-RENAME");
        const staleCall = baseline.edges.find(
          (edge) => edge.kind === "CALLS_STATIC" && edge.to === "fn:add@math.ts",
        );
        expect(staleCall).toBeDefined();
        expect(byFrom.get(staleCall?.id ?? "")?.cause).toBe("SYM-RENAME");
        for (const edge of invalidated) {
          expect(edge.kind).toBe("INVALIDATED_BY");
          expect(edge.confidence).toBe(1);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a deleted file #when the graph is re-extracted #then the affected edges are invalidated",
    () => {
      // given: a baseline plus a variant with reexport.ts deleted
      const dir = copyFixture();
      try {
        const baseline = indexFiles([join(dir, "main.ts"), join(dir, "reexport.ts"), join(dir, "main.test.ts")]);
        rmSync(join(dir, "reexport.ts"));
        const afterDelete = indexFiles([join(dir, "main.ts"), join(dir, "math.ts"), join(dir, "main.test.ts")]);

        // when
        const invalidated = invalidateEdges(baseline, afterDelete);

        // then: the file and its edges carry SRC-DELETE at confidence 1.00
        const byFrom = new Map(invalidated.map((edge) => [edge.from, edge]));
        expect(byFrom.get("file:reexport.ts")?.cause).toBe("SRC-DELETE");
        expect(byFrom.get("file:reexport.ts")?.confidence).toBe(1);
        expect(
          invalidated.some(
            (edge) => edge.kind === "INVALIDATED_BY" && edge.cause === "SRC-DELETE" && edge.from !== "file:reexport.ts",
          ),
        ).toBe(true);

        // then: unaffected edges are not invalidated
        const affected = new Set(invalidated.map((edge) => edge.from));
        expect(affected.has("file:math.ts")).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});

describe("code-graph extract with rootDir", () => {
  it(
    "#given a nested index root #when rootDir is the repo root #then file ids stay repo-relative POSIX",
    () => {
      // given: only apps/a/main.ts indexed, with the repo root as the id base
      const { repo } = writeRepoTree();
      try {
        // when
        const graph = indexFiles([join(repo, "apps", "a", "main.ts")], { rootDir: repo });

        // then: every id is rooted at the repo, never at the nested index root
        const ids = graph.nodes.map((node) => node.id);
        expect(ids).toContain("file:apps/a/main.ts");
        expect(ids).toContain("file:packages/b/util.ts");
        expect(ids.some((id) => id === "file:main.ts")).toBe(false);
        expect(graph.root).toBe(toPosixRoot(repo));
        expect(graph.dropped).toEqual([]);

        // then: every stored file path is clean POSIX relative (no leading
        // ./, no drive prefix, no .. segment, forward slashes only)
        for (const node of graph.nodes) {
          expect(node.file).not.toContain("\\");
          expect(node.file).not.toMatch(/^[a-zA-Z]:\//);
          expect(node.file.startsWith("./")).toBe(false);
          expect(node.file.split("/")).not.toContain("..");
        }
        for (const edge of graph.edges) {
          expect(edge.ref).not.toContain("\\");
          expect(edge.ref).not.toMatch(/^[a-zA-Z]:\//);
        }

        // then: the content index uses the same id space
        expect(Object.keys(graph.content?.files ?? {})).toContain("apps/a/main.ts");
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a cross-package import #when rootDir is the repo root #then the import and call resolve inside one id space",
    () => {
      // given: apps/a/main.ts importing ../../packages/b/util
      const { repo } = writeRepoTree();
      try {
        // when
        const graph = indexFiles([join(repo, "apps", "a", "main.ts")], { rootDir: repo });

        // then: the compiler's own module resolution crosses packages with
        // no extra resolver — IMPORTS and CALLS_STATIC share the repo ids
        expect(
          graph.edges.some(
            (edge) =>
              edge.kind === "IMPORTS" &&
              edge.from === "file:apps/a/main.ts" &&
              edge.to === "file:packages/b/util.ts" &&
              edge.confidence === 1,
          ),
        ).toBe(true);
        const call = graph.edges.find(
          (edge) =>
            edge.kind === "CALLS_STATIC" &&
            edge.from === "fn:run@apps/a/main.ts" &&
            edge.to === "fn:helper@packages/b/util.ts",
        );
        expect(call).toBeDefined();
        expect(call?.ref).toBe("apps/a/main.ts:7");

        // then: same basenames in different folders stay distinct, no collision
        const ids = graph.nodes.map((node) => node.id);
        expect(ids).toContain("file:apps/a/same.ts");
        expect(ids).toContain("file:packages/b/same.ts");
        expect(ids).toContain("fn:same@apps/a/same.ts");
        expect(ids).toContain("fn:same@packages/b/same.ts");

        // then: spaces and non-ASCII survive normalization byte-identical
        expect(ids).toContain("file:apps/a/my module-ünïcode.ts");
        expect(
          graph.edges.some(
            (edge) =>
              edge.kind === "DEFINES" &&
              edge.from === "file:apps/a/my module-ünïcode.ts" &&
              edge.to === "fn:spaced@apps/a/my module-ünïcode.ts",
          ),
        ).toBe(true);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given two tsconfig projects #when the scope builds #then call sites are emitted once, not once per project",
    () => {
      // given: two packages with their own tsconfig, one call per line,
      // one call crossing the project boundary
      const repo = mkdtempSync(join(tmpdir(), "code-graph-shardded-"));
      try {
        for (const pkg of ["pkg-a", "pkg-b"]) {
          mkdirSync(join(repo, pkg), { recursive: true });
          writeFileSync(
            join(repo, pkg, "tsconfig.json"),
            JSON.stringify({ compilerOptions: { strict: true }, include: ["*.ts"] }),
          );
        }
        writeFileSync(join(repo, "pkg-a", "a.ts"), "export function inner(): number {\n  return 1;\n}\n");
        writeFileSync(
          join(repo, "pkg-b", "b.ts"),
          "import { inner } from \"../pkg-a/a.js\";\nexport function outer(): number {\n  return inner() + 1;\n}\n",
        );

        // when
        const graph = indexFiles([join(repo, "pkg-a", "a.ts"), join(repo, "pkg-b", "b.ts")], {
          rootDir: repo,
        });

        // then: the cross-project call resolves inside one id space
        expect(
          graph.edges.some(
            (edge) =>
              edge.kind === "CALLS_STATIC" &&
              edge.from === "fn:outer@pkg-b/b.ts" &&
              edge.to === "fn:inner@pkg-a/a.ts",
          ),
        ).toBe(true);

        // then: no node or edge id repeats. Re-emission used to mint a
        // fresh ordinal call-site id on every project pass, duplicating
        // the whole call graph once per project.
        const nodeIds = graph.nodes.map((node) => node.id);
        expect(new Set(nodeIds).size).toBe(nodeIds.length);
        const edgeIds = graph.edges.map((edge) => edge.id);
        expect(new Set(edgeIds).size).toBe(edgeIds.length);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a file outside rootDir #when indexed #then it is refused with a recorded reason",
    () => {
      // given: the id base narrowed to apps/a, excluding packages/b
      const { repo } = writeRepoTree();
      try {
        // when
        const graph = indexFiles(
          [join(repo, "apps", "a", "main.ts"), join(repo, "packages", "b", "util.ts")],
          { rootDir: join(repo, "apps", "a") },
        );

        // then: outside files are dropped once each with reasons, never re-rooted
        const outsideUtil = `${toPosixRoot(repo)}/packages/b/util.ts`;
        const outsideSame = `${toPosixRoot(repo)}/packages/b/same.ts`;
        expect(graph.dropped).toEqual([
          { file: outsideSame, reason: "outside-root" },
          { file: outsideUtil, reason: "outside-root" },
        ]);
        expect(graph.nodes.some((node) => node.id.includes("packages/b"))).toBe(false);
        expect(graph.edges.some((edge) => edge.ref.includes("packages/b"))).toBe(false);

        // then: the inside file still indexes in the narrowed id space
        expect(graph.nodes.some((node) => node.id === "file:main.ts")).toBe(true);

        // when: every entry sits outside the root
        const empty = indexFiles([join(repo, "packages", "b", "util.ts")], {
          rootDir: join(repo, "apps", "a"),
        });

        // then: an empty graph with the root recorded and the refusal recorded
        expect(empty.nodes).toEqual([]);
        expect(empty.edges).toEqual([]);
        expect(empty.root).toBe(`${toPosixRoot(repo)}/apps/a`);
        expect(empty.dropped).toEqual([{ file: outsideUtil, reason: "outside-root" }]);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given no rootDir #when a nested entry is indexed #then today's commonDir behaviour is unchanged",
    () => {
      // given: a nested entry with no rootDir
      const { repo } = writeRepoTree();
      try {
        // when
        const graph = indexFiles([join(repo, "apps", "a", "main.ts")]);

        // then: legacy identity — root is the entry dir, ids are bare names
        expect(graph.root).toBe(toPosixRoot(join(repo, "apps", "a")));
        expect(graph.nodes.some((node) => node.id === "file:main.ts")).toBe(true);
        expect(graph.dropped).toBeUndefined();
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});

describe("preferUnpacked", () => {
  it(
    "#given an archive path with an unpacked twin #when resolved #then the real twin wins for spawning",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "code-graph-unpack-"));
      try {
        const archived = join(dir, "app.asar", "node_modules", "tsc.exe");
        const twin = join(dir, "app.asar.unpacked", "node_modules", "tsc.exe");
        mkdirSync(join(dir, "app.asar.unpacked", "node_modules"), { recursive: true });
        writeFileSync(twin, "binary");
        expect(preferUnpacked(archived)).toBe(twin);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a checkout path or a missing twin #when resolved #then the candidate is unchanged",
    () => {
      expect(preferUnpacked(join("repo", "node_modules", "tsc.exe"))).toBe(
        join("repo", "node_modules", "tsc.exe"),
      );
      const dir = mkdtempSync(join(tmpdir(), "code-graph-unpack-"));
      try {
        const archived = join(dir, "app.asar", "node_modules", "tsc.exe");
        expect(preferUnpacked(archived)).toBe(archived);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});

describe("code-graph routes S8", () => {
  function writeFiles(repo: string, files: Record<string, string>): void {
    for (const [rel, text] of Object.entries(files)) {
      const abs = join(repo, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, text);
    }
  }

  it(
    "#given express routes #when indexed #then route to handler hops carry framework tags at confidence 1",
    () => {
      const repo = mkdtempSync(join(tmpdir(), "code-graph-s8-express-"));
      try {
        writeFiles(repo, {
          "server.ts":
            `import express from "express";\n` +
            `export function listUsers(): number {\n` +
            `  return 1;\n` +
            `}\n` +
            `export function getUser(): number {\n` +
            `  return 2;\n` +
            `}\n` +
            `const app = express();\n` +
            `app.get('/users', listUsers);\n` +
            `app.get('/users/:id', getUser);\n`,
        });
        const graph = indexFiles([join(repo, "server.ts")]);
        const routes = graph.edges.filter((edge) => edge.kind === "ROUTE");
        expect(routes.length).toBe(2);
        for (const edge of routes) {
          expect(edge.confidence).toBe(1);
          expect(edge.uncertain).toBeUndefined();
          expect(edge.resolvedBy).toBe("framework");
          expect(edge.framework).toBe("express");
          expect(edge.resolver).toBe("express-route-detector");
        }
        const refs = graph.edges.filter((edge) => edge.kind === "REFERENCES");
        expect(refs.length).toBe(2);
        expect(refs.some((edge) => edge.to === "fn:listUsers@server.ts" && edge.confidence === 1)).toBe(true);
        expect(refs.some((edge) => edge.to === "fn:getUser@server.ts" && edge.confidence === 1)).toBe(true);
        for (const edge of refs) {
          expect(edge.resolvedBy).toBe("framework");
          expect(edge.framework).toBe("express");
          expect(edge.resolver).toBe("express-route-detector");
        }
        const routeNode = graph.nodes.find((node) => node.kind === "route" && node.name === "/users");
        expect(routeNode).toBeDefined();
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given next app and pages routes #when indexed with rootDir #then file routes bind handlers per framework",
    () => {
      const repo = mkdtempSync(join(tmpdir(), "code-graph-s8-next-"));
      try {
        writeFiles(repo, {
          "app/users/page.tsx":
            `export default function UsersPage(): number {\n` + `  return 1;\n` + `}\n`,
          "pages/about.tsx":
            `export default function AboutPage(): number {\n` + `  return 2;\n` + `}\n`,
        });
        const graph = indexFiles(
          [join(repo, "app", "users", "page.tsx"), join(repo, "pages", "about.tsx")],
          { rootDir: repo },
        );
        const appRoute = graph.edges.find(
          (edge) => edge.kind === "ROUTE" && edge.framework === "next-app" && edge.to.includes("/users"),
        );
        expect(appRoute).toBeDefined();
        expect(appRoute?.confidence).toBe(1);
        expect(appRoute?.resolver).toBe("next-app-detector");
        const pagesRoute = graph.edges.find(
          (edge) => edge.kind === "ROUTE" && edge.framework === "next-pages" && edge.to.includes("/about"),
        );
        expect(pagesRoute).toBeDefined();
        expect(pagesRoute?.resolver).toBe("next-pages-detector");
        const refs = graph.edges.filter((edge) => edge.kind === "REFERENCES");
        expect(refs.some((edge) => edge.to === "fn:UsersPage@app/users/page.tsx")).toBe(true);
        expect(refs.some((edge) => edge.to === "fn:AboutPage@pages/about.tsx")).toBe(true);
        for (const edge of [...graph.edges.filter((e) => e.kind === "ROUTE" || e.kind === "REFERENCES")]) {
          expect(edge.resolvedBy).toBe("framework");
        }
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given react router routes #when indexed #then literal paths bind components",
    () => {
      const repo = mkdtempSync(join(tmpdir(), "code-graph-s8-rr-"));
      try {
        writeFiles(repo, {
          "routes.tsx":
            `import { Route } from "react-router-dom";\n` +
            `export function Home(): number {\n` +
            `  return 1;\n` +
            `}\n` +
            `export function App(): unknown {\n` +
            `  return <Route path="/home" element={<Home />} />;\n` +
            `}\n`,
        });
        const graph = indexFiles([join(repo, "routes.tsx")]);
        const route = graph.edges.find((edge) => edge.kind === "ROUTE" && edge.framework === "react-router");
        expect(route).toBeDefined();
        expect(route?.confidence).toBe(1);
        expect(route?.resolver).toBe("react-router-detector");
        expect(
          graph.edges.some(
            (edge) => edge.kind === "REFERENCES" && edge.to === "fn:Home@routes.tsx" && edge.confidence === 1,
          ),
        ).toBe(true);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given code senders #when indexed #then literal fetches hop to screens while computed and unserved stay unresolved",
    () => {
      const repo = mkdtempSync(join(tmpdir(), "code-graph-s8-send-"));
      try {
        writeFiles(repo, {
          "server.ts":
            `import express from "express";\n` +
            `export function listUsers(): number {\n` +
            `  return 1;\n` +
            `}\n` +
            `const app = express();\n` +
            `app.get('/users', listUsers);\n`,
          "client.ts":
            `export function loadUsers(): unknown {\n` +
            `  return fetch('/users');\n` +
            `}\n` +
            `export function goDynamic(dest: string): unknown {\n` +
            `  return fetch(dest);\n` +
            `}\n` +
            `export function goMissing(): unknown {\n` +
            `  return fetch('/nope');\n` +
            `}\n`,
        });
        const graph = indexFiles([join(repo, "server.ts"), join(repo, "client.ts")]);
        const hops = graph.edges.filter((edge) => edge.kind === "NAVIGATES");
        expect(hops.length).toBe(1);
        const hop = hops[0];
        expect(hop?.from).toBe("fn:loadUsers@client.ts");
        expect(hop?.to.includes("/users")).toBe(true);
        expect(hop?.confidence).toBe(1);
        expect(hop?.resolvedBy).toBe("framework");
        expect(hop?.resolver).toBe("navigation-detector");
        expect(hop?.inferred).toBeUndefined();
        expect(graph.edges.some((edge) => edge.kind === "NAVIGATES" && edge.from === "fn:goDynamic@client.ts")).toBe(false);
        expect(graph.edges.some((edge) => edge.kind === "NAVIGATES" && edge.from === "fn:goMissing@client.ts")).toBe(false);
        const unresolved = graph.edges.filter((edge) => edge.kind === "CALLS_UNRESOLVED");
        expect(unresolved.some((edge) => edge.from === "fn:goDynamic@client.ts")).toBe(true);
        expect(unresolved.some((edge) => edge.from === "fn:goMissing@client.ts")).toBe(true);
        for (const edge of unresolved) {
          expect(edge.to).toBe("unknown");
          expect(edge.confidence).toBeLessThanOrEqual(0.5);
          expect(edge.uncertain).toBe(true);
        }
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given markup links #when indexed #then internal links hop inferred while computed and unserved stay unresolved",
    () => {
      const repo = mkdtempSync(join(tmpdir(), "code-graph-s8-markup-"));
      try {
        writeFiles(repo, {
          "app/users/page.tsx":
            `export default function UsersPage(): number {\n` + `  return 1;\n` + `}\n`,
          "app/nav.tsx":
            `import { Link } from "next/link";\n` +
            `export function Nav(): unknown {\n` +
            `  return <Link href="/users">users</Link>;\n` +
            `}\n` +
            `export function NavDynamic(dest: string): unknown {\n` +
            `  return <Link href={dest}>x</Link>;\n` +
            `}\n` +
            `export function NavMissing(): unknown {\n` +
            `  return <Link href="/nope">x</Link>;\n` +
            `}\n`,
        });
        const graph = indexFiles([join(repo, "app", "users", "page.tsx"), join(repo, "app", "nav.tsx")], {
          rootDir: repo,
        });
        const hops = graph.edges.filter((edge) => edge.kind === "NAVIGATES" && edge.from === "fn:Nav@app/nav.tsx");
        expect(hops.length).toBe(1);
        expect(hops[0]?.inferred).toBe(true);
        expect(hops[0]?.confidence).toBe(1);
        expect(hops[0]?.resolver).toBe("markup-navigation-detector");
        expect(graph.edges.some((edge) => edge.kind === "NAVIGATES" && edge.from === "fn:NavDynamic@app/nav.tsx")).toBe(
          false,
        );
        expect(graph.edges.some((edge) => edge.kind === "NAVIGATES" && edge.from === "fn:NavMissing@app/nav.tsx")).toBe(
          false,
        );
        const unresolved = graph.edges.filter((edge) => edge.kind === "CALLS_UNRESOLVED");
        expect(unresolved.some((edge) => edge.from === "fn:NavDynamic@app/nav.tsx")).toBe(true);
        expect(unresolved.some((edge) => edge.from === "fn:NavMissing@app/nav.tsx")).toBe(true);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given two apps sharing a path #when indexed with rootDir #then navigation stays inside its own app",
    () => {
      const repo = mkdtempSync(join(tmpdir(), "code-graph-s8-multi-"));
      try {
        writeFiles(repo, {
          "apps/a/server.ts":
            `import express from "express";\n` +
            `export function handlerA(): number {\n` +
            `  return 1;\n` +
            `}\n` +
            `const app = express();\n` +
            `app.get('/shared', handlerA);\n`,
          "apps/a/client.ts":
            `export function goA(): unknown {\n` + `  return fetch('/shared');\n` + `}\n`,
          "apps/b/client.ts":
            `export function goB(): unknown {\n` + `  return fetch('/shared');\n` + `}\n`,
        });
        const graph = indexFiles(
          [join(repo, "apps", "a", "server.ts"), join(repo, "apps", "a", "client.ts"), join(repo, "apps", "b", "client.ts")],
          { rootDir: repo },
        );
        expect(
          graph.edges.some(
            (edge) =>
              edge.kind === "NAVIGATES" &&
              edge.from === "fn:goA@apps/a/client.ts" &&
              edge.to === "route:express:GET /shared@apps/a/server.ts",
          ),
        ).toBe(true);
        expect(graph.edges.some((edge) => edge.kind === "NAVIGATES" && edge.from === "fn:goB@apps/b/client.ts")).toBe(
          false,
        );
        expect(
          graph.edges.some(
            (edge) => edge.kind === "CALLS_UNRESOLVED" && edge.from === "fn:goB@apps/b/client.ts",
          ),
        ).toBe(true);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a computed express path #when indexed #then no route is guessed and the site stays unresolved",
    () => {
      const repo = mkdtempSync(join(tmpdir(), "code-graph-s8-computed-"));
      try {
        writeFiles(repo, {
          "server.ts":
            `import express from "express";\n` +
            `export function handler(): number {\n` +
            `  return 1;\n` +
            `}\n` +
            `const app = express();\n` +
            `const base = "/api";\n` +
            `app.get(base + '/users', handler);\n`,
        });
        const graph = indexFiles([join(repo, "server.ts")]);
        expect(graph.edges.some((edge) => edge.kind === "ROUTE")).toBe(false);
        expect(graph.edges.some((edge) => edge.kind === "REFERENCES")).toBe(false);
        const unresolved = graph.edges.filter((edge) => edge.kind === "CALLS_UNRESOLVED");
        expect(unresolved.length).toBeGreaterThanOrEqual(1);
        for (const edge of unresolved) {
          expect(edge.confidence).toBeLessThanOrEqual(0.5);
          expect(edge.uncertain).toBe(true);
        }
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});

describe("code-graph routes S9", () => {
  function writeS9Files(repo: string, files: Record<string, string>): void {
    for (const [rel, text] of Object.entries(files)) {
      const abs = join(repo, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, text);
    }
  }

  function tagAsserts(edges: { kind: string; confidence: number; uncertain?: true; resolvedBy?: string; framework?: string; resolver?: string }[], framework: string, resolver: string): void {
    expect(edges.length).toBeGreaterThan(0);
    for (const edge of edges) {
      expect(edge.confidence).toBe(1);
      expect(edge.uncertain).toBeUndefined();
      expect(edge.resolvedBy).toBe("framework");
      expect(edge.framework).toBe(framework);
      expect(edge.resolver).toBe(resolver);
    }
  }

  it(
    "#given react router useRoutes with nested children #when indexed #then literal paths bind and computed fail closed",
    () => {
      const repo = mkdtempSync(join(tmpdir(), "code-graph-s9-rr-"));
      try {
        writeS9Files(repo, {
          "routes.tsx":
            `import { useRoutes } from "react-router-dom";\n` +
            `export function Home(): number {\n` +
            `  return 1;\n` +
            `}\n` +
            `export function Profile(): number {\n` +
            `  return 2;\n` +
            `}\n` +
            `export function App(): unknown {\n` +
            `  return useRoutes([\n` +
            `    { path: "/dashboard", element: <Home />, children: [{ path: "profile", element: <Profile /> }] },\n` +
            `    { path: computedPath, element: <Home /> },\n` +
            `  ]);\n` +
            `}\n`,
        });
        const graph = indexFiles([join(repo, "routes.tsx")]);
        const routes = graph.edges.filter((edge) => edge.kind === "ROUTE" && edge.framework === "react-router");
        expect(routes.map((edge) => edge.to).some((id) => id.includes("/dashboard"))).toBe(true);
        expect(routes.map((edge) => edge.to).some((id) => id.includes("/profile"))).toBe(true);
        tagAsserts(routes, "react-router", "react-router-detector");
        const refs = graph.edges.filter((edge) => edge.kind === "REFERENCES" && edge.framework === "react-router");
        expect(refs.some((edge) => edge.to === "fn:Home@routes.tsx")).toBe(true);
        expect(refs.some((edge) => edge.to === "fn:Profile@routes.tsx")).toBe(true);
        tagAsserts(refs, "react-router", "react-router-detector");
        const unresolved = graph.edges.filter((edge) => edge.kind === "CALLS_UNRESOLVED");
        expect(unresolved.length).toBeGreaterThanOrEqual(1);
        for (const edge of unresolved) {
          expect(edge.to).toBe("unknown");
          expect(edge.confidence).toBeLessThanOrEqual(0.5);
          expect(edge.uncertain).toBe(true);
        }
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given tanstack routes #when indexed #then file and config paths bind with literal-only tagging",
    () => {
      const repo = mkdtempSync(join(tmpdir(), "code-graph-s9-tanstack-"));
      try {
        writeS9Files(repo, {
          "routes.tsx":
            `import { createFileRoute, createRoute, useNavigate } from "@tanstack/react-router";\n` +
            `export function UsersPage(): number {\n` +
            `  return 1;\n` +
            `}\n` +
            `export const usersRoute = createFileRoute("/users")({ component: UsersPage });\n` +
            `export const profileRoute = createRoute({ path: "profile", component: UsersPage });\n` +
            `export function Go(): unknown {\n` +
            `  const navigate = useNavigate();\n` +
            `  return navigate({ to: "/users" });\n` +
            `}\n` +
            `export function GoDynamic(dest: string): unknown {\n` +
            `  const navigate = useNavigate();\n` +
            `  return navigate({ to: dest });\n` +
            `}\n`,
        });
        const graph = indexFiles([join(repo, "routes.tsx")]);
        const routes = graph.edges.filter((edge) => edge.kind === "ROUTE" && edge.framework === "tanstack-router");
        expect(routes.length).toBe(2);
        tagAsserts(routes, "tanstack-router", "tanstack-router-detector");
        const refs = graph.edges.filter((edge) => edge.kind === "REFERENCES" && edge.framework === "tanstack-router");
        expect(refs.some((edge) => edge.to === "fn:UsersPage@routes.tsx" && edge.confidence === 1)).toBe(true);
        const hops = graph.edges.filter((edge) => edge.kind === "NAVIGATES" && edge.from === "fn:Go@routes.tsx");
        expect(hops.length).toBe(1);
        expect(hops[0]?.to.includes("/users")).toBe(true);
        expect(hops[0]?.resolvedBy).toBe("framework");
        expect(hops[0]?.framework).toBe("tanstack-router");
        expect(hops[0]?.resolver).toBe("navigation-detector");
        expect(graph.edges.some((edge) => edge.kind === "NAVIGATES" && edge.from === "fn:GoDynamic@routes.tsx")).toBe(false);
        expect(graph.edges.some((edge) => edge.kind === "CALLS_UNRESOLVED" && edge.from === "fn:GoDynamic@routes.tsx")).toBe(true);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given vue router records #when indexed #then literal paths bind and router push hops to params",
    () => {
      const repo = mkdtempSync(join(tmpdir(), "code-graph-s9-vue-"));
      try {
        writeS9Files(repo, {
          "router.ts":
            `import { createRouter, createWebHistory } from "vue-router";\n` +
            `export function HomeView(): number {\n` +
            `  return 1;\n` +
            `}\n` +
            `export function UserView(): number {\n` +
            `  return 2;\n` +
            `}\n` +
            `const routes = [\n` +
            `  { path: "/", component: HomeView },\n` +
            `  { path: "/users/:id", component: UserView, children: [{ path: "profile", component: HomeView }] },\n` +
            `];\n` +
            `export const router = createRouter({ history: createWebHistory(), routes });\n` +
            `export function go(): unknown {\n` +
            `  return router.push("/users/7");\n` +
            `}\n` +
            `export function goMissing(): unknown {\n` +
            `  return router.push("/nope");\n` +
            `}\n`,
        });
        const graph = indexFiles([join(repo, "router.ts")]);
        const routes = graph.edges.filter((edge) => edge.kind === "ROUTE" && edge.framework === "vue-router");
        expect(routes.length).toBe(3);
        tagAsserts(routes, "vue-router", "vue-router-detector");
        const refs = graph.edges.filter((edge) => edge.kind === "REFERENCES" && edge.framework === "vue-router");
        expect(refs.some((edge) => edge.to === "fn:UserView@router.ts")).toBe(true);
        tagAsserts(refs, "vue-router", "vue-router-detector");
        const hops = graph.edges.filter((edge) => edge.kind === "NAVIGATES" && edge.from === "fn:go@router.ts");
        expect(hops.length).toBe(1);
        expect(hops[0]?.to.includes("/users")).toBe(true);
        expect(graph.edges.some((edge) => edge.kind === "NAVIGATES" && edge.from === "fn:goMissing@router.ts")).toBe(false);
        expect(graph.edges.some((edge) => edge.kind === "CALLS_UNRESOLVED" && edge.from === "fn:goMissing@router.ts")).toBe(true);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given nuxt server routes #when indexed with rootDir #then file paths bind and navigateTo hops",
    () => {
      const repo = mkdtempSync(join(tmpdir(), "code-graph-s9-nuxt-"));
      try {
        writeS9Files(repo, {
          "server/api/hello.ts": `export default function handler(): number {\n  return 1;\n}\n`,
          "server/utils/caller.ts":
            `import { navigateTo } from "#app";\n` +
            `export function go(): unknown {\n` +
            `  return navigateTo("/api/hello");\n` +
            `}\n` +
            `export function goDynamic(dest: string): unknown {\n` +
            `  return navigateTo(dest);\n` +
            `}\n`,
        });
        const graph = indexFiles([join(repo, "server", "api", "hello.ts"), join(repo, "server", "utils", "caller.ts")], { rootDir: repo });
        const routes = graph.edges.filter((edge) => edge.kind === "ROUTE" && edge.framework === "nuxt");
        expect(routes.length).toBe(1);
        expect(routes[0]?.to.includes("/api/hello")).toBe(true);
        tagAsserts(routes, "nuxt", "nuxt-detector");
        const hops = graph.edges.filter((edge) => edge.kind === "NAVIGATES" && edge.from === "fn:go@server/utils/caller.ts");
        expect(hops.length).toBe(1);
        expect(hops[0]?.framework).toBe("nuxt");
        expect(hops[0]?.resolver).toBe("navigation-detector");
        expect(hops[0]?.confidence).toBe(1);
        expect(graph.edges.some((edge) => edge.kind === "NAVIGATES" && edge.from === "fn:goDynamic@server/utils/caller.ts")).toBe(false);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given sveltekit page companions #when indexed with rootDir #then file paths bind and goto hops",
    () => {
      const repo = mkdtempSync(join(tmpdir(), "code-graph-s9-svelte-"));
      try {
        writeS9Files(repo, {
          "routes/about/+page.ts": `export function load(): number {\n  return 1;\n}\n`,
          "routes/home/+page.ts":
            `import { goto } from "$app/navigation";\n` +
            `export function go(): unknown {\n` +
            `  return goto("/about");\n` +
            `}\n` +
            `export function goMissing(): unknown {\n` +
            `  return goto("/nope");\n` +
            `}\n`,
        });
        const graph = indexFiles([join(repo, "routes", "about", "+page.ts"), join(repo, "routes", "home", "+page.ts")], { rootDir: repo });
        const routes = graph.edges.filter((edge) => edge.kind === "ROUTE" && edge.framework === "sveltekit");
        expect(routes.length).toBe(2);
        expect(routes.some((edge) => edge.to.includes("/about"))).toBe(true);
        tagAsserts(routes, "sveltekit", "sveltekit-detector");
        const hops = graph.edges.filter((edge) => edge.kind === "NAVIGATES" && edge.from === "fn:go@routes/home/+page.ts");
        expect(hops.length).toBe(1);
        expect(hops[0]?.framework).toBe("sveltekit");
        expect(hops[0]?.confidence).toBe(1);
        expect(graph.edges.some((edge) => edge.kind === "NAVIGATES" && edge.from === "fn:goMissing@routes/home/+page.ts")).toBe(false);
        expect(graph.edges.some((edge) => edge.kind === "CALLS_UNRESOLVED" && edge.from === "fn:goMissing@routes/home/+page.ts")).toBe(true);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given angular route arrays #when indexed #then literal paths bind and navigate arrays hop",
    () => {
      const repo = mkdtempSync(join(tmpdir(), "code-graph-s9-angular-"));
      try {
        writeS9Files(repo, {
          "app.routes.ts":
            `import { RouterModule } from "@angular/router";\n` +
            `export function HomeComponent(): number {\n` +
            `  return 1;\n` +
            `}\n` +
            `export function AdminComponent(): number {\n` +
            `  return 2;\n` +
            `}\n` +
            `const routes = [\n` +
            `  { path: "home", component: HomeComponent },\n` +
            `  { path: "admin", component: AdminComponent, children: [{ path: "users", component: HomeComponent }] },\n` +
            `];\n` +
            `export const routing = RouterModule.forRoot(routes);\n` +
            `export function go(router: { navigate: (parts: string[]) => unknown }): unknown {\n` +
            `  return router.navigate(["home"]);\n` +
            `}\n` +
            `export function goDynamic(router: { navigate: (parts: string[]) => unknown }, dest: string[]): unknown {\n` +
            `  return router.navigate(dest);\n` +
            `}\n`,
        });
        const graph = indexFiles([join(repo, "app.routes.ts")]);
        const routes = graph.edges.filter((edge) => edge.kind === "ROUTE" && edge.framework === "angular");
        expect(routes.length).toBe(3);
        tagAsserts(routes, "angular", "angular-detector");
        const refs = graph.edges.filter((edge) => edge.kind === "REFERENCES" && edge.framework === "angular");
        expect(refs.some((edge) => edge.to === "fn:HomeComponent@app.routes.ts")).toBe(true);
        tagAsserts(refs, "angular", "angular-detector");
        const hops = graph.edges.filter((edge) => edge.kind === "NAVIGATES" && edge.from === "fn:go@app.routes.ts");
        expect(hops.length).toBe(1);
        expect(hops[0]?.to.includes("/home")).toBe(true);
        expect(hops[0]?.framework).toBe("angular");
        expect(graph.edges.some((edge) => edge.kind === "NAVIGATES" && edge.from === "fn:goDynamic@app.routes.ts")).toBe(false);
        expect(graph.edges.some((edge) => edge.kind === "CALLS_UNRESOLVED" && edge.from === "fn:goDynamic@app.routes.ts")).toBe(true);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given two s9 apps sharing a path #when indexed with rootDir #then navigation stays inside its own app",
    () => {
      const repo = mkdtempSync(join(tmpdir(), "code-graph-s9-multi-"));
      try {
        writeS9Files(repo, {
          "apps/a/router.ts":
            `import { createRouter, createWebHistory } from "vue-router";\n` +
            `export function handlerA(): number {\n` +
            `  return 1;\n` +
            `}\n` +
            `export const router = createRouter({ history: createWebHistory(), routes: [{ path: "/shared", component: handlerA }] });\n`,
          "apps/a/client.ts":
            `export function goA(): unknown {\n` + `  return fetch("/shared");\n` + `}\n`,
          "apps/b/client.ts":
            `export function goB(): unknown {\n` + `  return fetch("/shared");\n` + `}\n`,
        });
        const graph = indexFiles(
          [join(repo, "apps", "a", "router.ts"), join(repo, "apps", "a", "client.ts"), join(repo, "apps", "b", "client.ts")],
          { rootDir: repo },
        );
        expect(
          graph.edges.some(
            (edge) =>
              edge.kind === "NAVIGATES" &&
              edge.from === "fn:goA@apps/a/client.ts" &&
              edge.to === "route:vue-router:/shared@apps/a/router.ts",
          ),
        ).toBe(true);
        expect(graph.edges.some((edge) => edge.kind === "NAVIGATES" && edge.from === "fn:goB@apps/b/client.ts")).toBe(
          false,
        );
        expect(
          graph.edges.some(
            (edge) => edge.kind === "CALLS_UNRESOLVED" && edge.from === "fn:goB@apps/b/client.ts",
          ),
        ).toBe(true);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
