// Test-only: warm the pi-tui barrel when it is installed so renderer tests
// exercise the real width algorithm; without the package this no-ops and the
// width-approximate fallback covers. Never throws: a test process must boot
// with or without the optional barrel present.
try {
  await (await import("../src/lazy/pi-tui")).loadPiTui()
} catch {
  // optional barrel absent - renderers degrade gracefully (covered by unit tests)
}
