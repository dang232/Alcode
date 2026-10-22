import { describe, expect, test } from "bun:test"
import {
  ELLIPSIS,
  excerptRendererText,
  rendererVisibleWidth,
  truncateToWidthFallback,
} from "./renderer-text"

// Pure-fallback contract (warming-independent): the code-unit approximation the
// renderers use when no barrel is warmed. Warmed runs delegate to the real
// barrel instead; that path is covered by the CJK assertions in tool.test.ts.
describe("truncateToWidthFallback", () => {
  test("given a long ASCII string #when truncating #then it fits with an ellipsis", () => {
    const long = `task identity label that far exceeds the available width ${"x".repeat(200)}`
    const out = truncateToWidthFallback(long, 48, ELLIPSIS)
    expect(out.length).toBeLessThanOrEqual(48)
    expect(out.endsWith(ELLIPSIS)).toBe(true)
  })

  test("given fitting text #when truncating #then it returns the input", () => {
    expect(truncateToWidthFallback("quick task", 48, ELLIPSIS)).toBe("quick task")
  })
})

describe("excerpt helpers", () => {
  test("given padded text #when excerpting #then it returns normalized text", () => {
    expect(excerptRendererText("  quick  task  ", 48)).toBe("quick task")
  })

  test("given plain ASCII #when measuring width #then it is the code-unit length", () => {
    expect(rendererVisibleWidth("abcdef")).toBe(6)
  })
})
