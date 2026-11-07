# Provenance

`plugin/runtime/dag/sdk.js` is vendored verbatim from the tracked DAG runtime in
oh-my-openAlcore at `8a4dd14ab7ea4e492f2d4c09fd082950cc441ba9` (2026-10-09), the
revision the rest of this checkout's `test-vendor` fixtures come from:

- source: `packages/omo-senpi/plugin/runtime/dag/sdk.js`
- sha256: `1d3109a2c6514d43a4748ca75f3687dddb3da97de361ff9767ba3a67e8d8b171`
- unchanged at upstream HEAD `dabd270037`

The adapter package is not vendored as a whole, and `sdk.js` is a tracked source
artifact, not a build output, so no package build produces it. It is import-free
by design (the eval kernel has no node_modules on its resolver path), which is
what lets the `e2e-happy` suite load the shipped SDK directly against the real
engine. `library.js` is not vendored: no test loads it.
