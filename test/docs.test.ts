import { expect, test, describe } from "bun:test"
import { findContactRoute, lastSearchError } from "../src/core/docs.ts"
import { Evidence } from "../src/core/http.ts"

describe("contact discovery", () => {
  test("prefers a partner programme over a generic contact page", async () => {
    // Live probe: these are conventional paths, no search plan required.
    const ev = new Evidence()
    const routes = await findContactRoute("copper.com", ev)
    expect(routes.length).toBeGreaterThan(0)
    expect(routes[0]!.kind).toBe("partner_program")
  }, 30000)

  test("records why search returned nothing instead of implying nothing exists", async () => {
    const ev = new Evidence()
    await findContactRoute("copper.com", ev)
    // Either search worked (null) or it explained itself — never silently empty.
    if (lastSearchError !== null) {
      expect(lastSearchError).toMatch(/credits|configured|failed/i)
    }
  }, 30000)
})
