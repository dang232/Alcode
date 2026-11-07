// Test-only: warm the pi-tui barrel when it is installed so renderer tests
// exercise the real width algorithm; without the package this no-ops and the
// width-approximate fallback covers. Never throws: a test process must boot
// with or without the optional barrel present.
//
// Bun sets NODE_ENV=test for `bun test` only when the caller has not exported
// one; an ambient development value would otherwise leak into the test process.
// The knowledge-lifecycle store boundary keys off the test runtime.
process.env.NODE_ENV = "test"
try {
  await (await import("../src/lazy/pi-tui")).loadPiTui()
} catch {
  // optional barrel absent - renderers degrade gracefully (covered by unit tests)
}
