# code-graph - Repository Code-Graph Index

## Ownership

`@oh-my-opencode/code-graph` owns the repository code graph: symbol
definitions, symbol references, and reachability queries over source files.
The public API is the barrel at `src/index.ts`.

- Symbol extraction, reference resolution, and graph queries belong here.
- Harness adapters consume the graph through this barrel; they never import
  graph internals or reimplement symbol resolution.
- Neighbouring owners: `memory-core` owns agent memory and transcript state,
  `model-core` owns model resolution, `utils` owns shared pure helpers.
  None of them owns code structure; that boundary is this package's.

## Invariants

- Stay harness-neutral. Production code and package dependencies must not
  import Senpi, Pi, OpenCode adapters, or other harness-specific packages.
- The barrel is the only public surface. Consumers import
  `@oh-my-opencode/code-graph`, never deep paths into `src/`.
- `sideEffects` stays `false` so bundlers can tree-shake the graph builders
  a consumer does not use.
- `package.json` carries no runtime dependencies beyond what the lockfile
  already vendors; adding one requires a lockfile update and the
  workspace-wide validation in the change-discipline skill.

### Why `typescript` is pinned exact (`7.0.2`) and not `^7.0.2` like the root

The root manifest ranges `^7.0.2`, so a fresh resolve can drift the compiler
under a frozen lockfile's nose. The exact pin keeps every workspace on the
already-vendored `7.0.2` in `bun.lock`, so no lockfile change is needed and
the skeleton type-checks with the same compiler everywhere.

### Why `exports` and `types` point at TypeScript source, not `dist`

Sibling engine packages (`model-core`, `delegate-core`, `utils`) resolve
`./src/index.ts` directly, so type-checks and Bun consumers never depend on
a stale build output. A `dist` entrypoint would add a build step and a drift
risk for a package whose consumers all resolve source; it is rejected until
a published runtime boundary needs it.

### Why `lib` is `ESNext` without `DOM`

The graph runs under Bun/Node over repository files; it touches no DOM APIs.
`team-core` adds `DOM` because it drives tmux UI layout, but for this
package `DOM` would only widen the ambient surface for autocompletion and
accidental use. It follows the `utils`/`model-core` precedent instead.

### Why there is no Dockerfile `deps`-stage line for this package

The `deps` stage copies only top-level `packages/*/package.json` manifests
by name. Nested `packages/omo-engine/*` packages ship inside the single
`packages/omo-engine` unit, and no sibling engine package has its own `COPY`
line. Adding one would break the established pattern, not follow it.
