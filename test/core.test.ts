import { expect, test, describe } from "bun:test"
import { validatePacket, emptyPacket } from "../src/core/schema.ts"
import { lookup as nangoLookup, toComposioScheme } from "../src/core/nango.ts"
import { mcpCandidates } from "../src/core/discover.ts"
import { extract } from "../src/core/mail.ts"
import { toOrigin } from "../src/core/http.ts"

const ok = (p: any) => {
  const base = emptyPacket("r1", "test")
  return validatePacket({ ...base, ...p, evidence: p.evidence ?? ["https://x.test/doc"], confidence: 0.8 })
}

describe("packet validation", () => {
  test("rejects a secret on a user-credential scheme", () => {
    const errs = ok({
      auth: { ...emptyPacket("r", "t").auth, scheme: "API_KEY" },
      acquisition: { ...emptyPacket("r", "t").acquisition, path: "none_needed", status: "no_app_required", blocked_reason: null },
      composio_auth_config: { toolkit: "t", auth_scheme: "API_KEY", credentials: { client_secret: "nope" } },
    })
    expect(errs.some((e) => e.field.includes("client_secret"))).toBe(true)
  })

  test("credentials_obtained requires verification", () => {
    const errs = ok({
      auth: { ...emptyPacket("r", "t").auth, scheme: "DCR_OAUTH" },
      acquisition: { ...emptyPacket("r", "t").acquisition, path: "dcr", status: "credentials_obtained", blocked_reason: null },
      composio_auth_config: { toolkit: "t", auth_scheme: "OAUTH2", credentials: { client_id: "abc" } },
      verification: { method: "x", result: "y", invalid_client: null, checked_at: null },
    })
    expect(errs.some((e) => e.field === "verification.invalid_client")).toBe(true)
  })

  test("blocked requires a reason and a concrete action", () => {
    const errs = ok({
      acquisition: { ...emptyPacket("r", "t").acquisition, path: "form", status: "blocked", blocked_reason: null, human_action_required: null },
    })
    expect(errs.some((e) => e.field === "acquisition.blocked_reason")).toBe(true)
    expect(errs.some((e) => e.field === "acquisition.human_action_required")).toBe(true)
  })

  test("rejects an invented vocabulary word", () => {
    const errs = ok({ acquisition: { ...emptyPacket("r", "t").acquisition, path: "email_the_vendor" } })
    expect(errs.some((e) => e.field === "acquisition.path")).toBe(true)
  })

  test("accepts a clean no-app-required packet", () => {
    const errs = ok({
      auth: { ...emptyPacket("r", "t").auth, scheme: "API_KEY" },
      acquisition: { ...emptyPacket("r", "t").acquisition, path: "none_needed", status: "no_app_required", blocked_reason: null },
    })
    expect(errs).toEqual([])
  })
})

describe("nango registry", () => {
  test("matches a domain to its provider", () => {
    expect(nangoLookup("linear.app")?.slug).toBe("linear")
    expect(nangoLookup("https://notion.so")?.slug).toBe("notion")
  })
  test("maps MCP oauth to the DCR scheme", () => {
    expect(toComposioScheme("MCP_OAUTH2")).toBe("DCR_OAUTH")
    expect(toComposioScheme("OAUTH2_CC")).toBe("S2S_OAUTH2")
  })
})

describe("discovery candidates", () => {
  test("tries the MCP host across TLDs so notion.so finds mcp.notion.com", () => {
    expect(mcpCandidates("notion.so")).toContain("https://mcp.notion.com")
  })
  test("normalises loose input", () => {
    expect(toOrigin("Linear.app")).toBe("https://linear.app")
    expect(toOrigin("https://x.com/path")).toBe("https://x.com")
  })
})

describe("otp extraction", () => {
  test("prefers a code next to a verification word", () => {
    const e = extract({ from: "no-reply@x.test", subject: "Verify", text: "Built in 2024. Your code is 448213.", at: "" })
    expect(e.otp).toBe("448213")
  })
  test("collects links", () => {
    const e = extract({ from: "a@b.c", subject: "s", text: "click https://x.test/verify?t=1 now", at: "" })
    expect(e.links[0]).toContain("https://x.test/verify")
  })
})

describe("composio slug guessing", () => {
  test("reduces a domain to the toolkit label", async () => {
    const { guessSlug } = await import("../src/core/composio.ts")
    expect(guessSlug("openai.com")).toBe("openai")
    expect(guessSlug("OpenAI")).toBe("openai")
    expect(guessSlug("https://linear.app/x")).toBe("linear")
    expect(guessSlug("developer.xero.com")).toBe("xero")
  })
  test("keeps multi-word names joined by underscores", async () => {
    const { guessSlug } = await import("../src/core/composio.ts")
    expect(guessSlug("Zoho CRM")).toBe("zoho_crm")
    expect(guessSlug("Amazon Selling Partner")).toBe("amazon_selling_partner")
  })
})

describe("secret smuggling", () => {
  test("blocks a secret on a user-credential scheme under any key spelling", async () => {
    const { validatePacket, emptyPacket } = await import("../src/core/schema.ts")
    for (const key of ["client_secret", "clientSecret", "app_secret", "appSecret", "consumer_secret", "secret"]) {
      const p: any = emptyPacket("r", "x.test")
      p.evidence = ["https://x.test/a"]; p.confidence = 0.9
      p.auth.scheme = "API_KEY"
      p.acquisition = { ...p.acquisition, path: "none_needed", status: "no_app_required", blocked_reason: null }
      p.composio_auth_config = { toolkit: "x", auth_scheme: "API_KEY", credentials: { [key]: "sneaky" } }
      const errs = validatePacket(p)
      expect(errs.length, `${key} should be rejected`).toBeGreaterThan(0)
    }
  })

  test("still allows the api key itself through", async () => {
    const { validatePacket, emptyPacket } = await import("../src/core/schema.ts")
    const p: any = emptyPacket("r", "x.test")
    p.evidence = ["https://x.test/a"]; p.confidence = 0.9
    p.auth.scheme = "API_KEY"
    p.acquisition = { ...p.acquisition, path: "none_needed", status: "no_app_required", blocked_reason: null }
    p.composio_auth_config = { toolkit: "x", auth_scheme: "API_KEY", credentials: { generic_api_key: "" } }
    expect(validatePacket(p)).toEqual([])
  })
})
