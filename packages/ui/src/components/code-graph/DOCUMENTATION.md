# code-graph panel

## Ownership

`packages/ui/src/components/code-graph` owns the panel the user sees:
toolbar, canvas, inspector, module map, legend, and the view models in
`codeGraphModes.ts`. It renders server payloads and never invents a node,
an edge, or a count. Payload shapes live in `packages/ui/src/lib/codeGraphApi.ts`.
Indexing, freshness, and route contracts live with the server
(`packages/web/server/lib/code-graph/DOCUMENTATION.md`). Query semantics
live with the engine
(`packages/omo-engine/code-graph/src/DOCUMENTATION.md`).

## Invariants

- Every served `indexState.state` gets exactly one labelled, non-spinner
  render. The full state-to-render map is the server parity table; this
  panel implements the render column. A new server state needs a row here
  in spirit and a render there in code, and an unmapped state must never
  collapse to a bare spinner.
- Totals stay honest: `displayed` of `known`, with the hidden remainder
  derived, never sliced prose. A `null` known renders the not-available
  text instead of a number.
- Truncation surfacing is answer-first. `deriveTruncationView(answer, index)`
  prefers the active answer's fields and falls back to the index, and it
  returns null on a fully indexed scope so the toolbar stays quiet instead
  of stating a zero-exclusion fact. The toolbar lines render under the
  `code-graph-index-truncation` and `code-graph-truncation-modules` testids
  with the `truncationExcluded` (`Index excludes {count} files`) and
  `truncationModules` (`Excluded by module: {modules}`) copy keys. Sample
  paths ride the `title` attribute, capped at ten.
- The Explore view (`CodeGraphInspector` explore section) groups verbatim
  bodies by file with line numbers, lists static call paths with refs, and
  shows blast-radius counts with impact actions. Dynamics are disclosed,
  never drawn as edges. Labels are literal English, so no locale catalogue
  change is needed for this view.
- Freshness is the server's decision. The panel polls while a build runs,
  stops when the scope settles truncated, and offers Retry on failed or
  cancelled states. Manual Refresh always rebuilds; it's the escape hatch
  whether the native watcher is on or off. Focus revalidate stays the
  fallback when the watcher is off.
- Row limits and depth budgets are answer properties, never index
  properties. The panel offers no row-count or limit choice; depth choices
  (1, 2, 3) forward into `maxDepth` and key the memo.
