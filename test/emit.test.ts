import { expect, test, describe, beforeEach } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Point the store at a scratch dir before it is imported.
process.env.LOCAL_RUNS_DIR = mkdtempSync(join(tmpdir(), "runs-"))
delete process.env.RUNS_TABLE

const store = await import("../src/core/store.ts")
const { emit } = await import("../src/core/packet.ts")

/**
 * `verified` seeds the oauth_verify verdict a credential claim now requires.
 * The verdict must name the same client_id the packet claims, so the id is a
 * parameter rather than a constant.
 */
async function seed(id: string, platform = "linear.app", verified: false | string = false) {
  const log = [{ at: new Date().toISOString(), kind: "evidence", text: "https://mcp.linear.app/register" }]
  if (verified) {
    const clientId = typeof verified === "string" ? verified : "abc123"
    log.push({ at: new Date().toISOString(), kind: "verification", text: `accepted client_id ${clientId} at https://mcp.linear.app/authorize (HTTP 200)` })
  }
  await store.put({
    run_id: id, platform, status: "running", session_id: "ses_" + id,
    packet: null, error: null, log,
    live_view_url: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  })
}

describe("emit_packet", () => {
  test("lifts credentials reported in the natural OAuth shape", async () => {
    await seed("r-lift", "linear.app", true)
    const r = await emit("r-lift", {
      auth: {
        scheme: "DCR_OAUTH",
        client_id: "abc123",
        client_secret: "shh",
        scopes: "read write",
      },
      acquisition: { path: "dcr", status: "credentials_obtained" },
      verification: { method: "authorize_endpoint_probe", result: "accepted", invalid_client: false },
      confidence: 0.9,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.packet.composio_auth_config?.credentials.client_id).toBe("abc123")
    expect(r.packet.composio_auth_config?.credentials.client_secret).toBe("shh")
    // DCR is how the credential was obtained; agent #3 configures plain OAuth2.
    expect(r.packet.composio_auth_config?.auth_scheme).toBe("OAUTH2")
  })

  test("does not leave the seeded blocked_reason on a successful run", async () => {
    await seed("r-clean")
    const r = await emit("r-clean", {
      auth: { scheme: "API_KEY" },
      acquisition: { path: "none_needed", status: "no_app_required" },
      confidence: 0.8,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.packet.acquisition.blocked_reason).toBeNull()
  })

  test("still rejects an unverified credential claim", async () => {
    await seed("r-unverified")
    const r = await emit("r-unverified", {
      auth: { scheme: "DCR_OAUTH", client_id: "abc" },
      acquisition: { path: "dcr", status: "credentials_obtained" },
      confidence: 0.9,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.some((e) => e.field === "verification.invalid_client")).toBe(true)
  })

  test("collects evidence from the run rather than trusting the model", async () => {
    await seed("r-ev")
    const r = await emit("r-ev", {
      auth: { scheme: "API_KEY" },
      acquisition: { path: "none_needed", status: "no_app_required" },
      confidence: 0.5,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.packet.evidence).toContain("https://mcp.linear.app/register")
  })
})

describe("blocked packets", () => {
  test("a blocked run must name its own reason, not inherit a default", async () => {
    await seed("r-blocked")
    const r = await emit("r-blocked", {
      auth: { scheme: "OAUTH2" },
      acquisition: {
        path: "self_serve",
        status: "blocked",
        human_action_required: "A human must create a developer account and register an app.",
      },
      confidence: 0.9,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.some((e) => e.field === "acquisition.blocked_reason")).toBe(true)
  })

  test("accepts a blocked run that names a real reason", async () => {
    await seed("r-blocked-ok")
    const r = await emit("r-blocked-ok", {
      auth: { scheme: "OAUTH2" },
      acquisition: {
        path: "self_serve",
        status: "blocked",
        blocked_reason: "needs_operator_account",
        human_action_required: "A human must create a Xero developer account and register an app.",
      },
      confidence: 0.9,
    })
    expect(r.ok).toBe(true)
  })
})

describe("run bookkeeping", () => {
  test("collects screenshots from the run even when the agent forgets them", async () => {
    await store.put({
      run_id: "r-shots", platform: "portal.test", status: "running", session_id: "ses_r-shots",
      packet: null, error: null,
      log: [
        { at: new Date().toISOString(), kind: "evidence", text: "https://portal.test/apps/new" },
        { at: new Date().toISOString(), kind: "screenshot", text: "/artifacts/r-shots_form.png" },
        { at: new Date().toISOString(), kind: "screenshot", text: "failed" },
      ],
      live_view_url: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    const r = await emit("r-shots", {
      auth: { scheme: "OAUTH2" },
      acquisition: {
        path: "self_serve", status: "blocked",
        blocked_reason: "needs_operator_account",
        human_action_required: "Create an account at https://portal.test/signup and register the app.",
      },
      confidence: 0.7,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.packet.acquisition.screenshots).toEqual(["/artifacts/r-shots_form.png"])
  })
})

describe("concurrent run writes", () => {
  test("parallel appends do not lose entries", async () => {
    await store.put({
      run_id: "r-race", platform: "race.test", status: "running", session_id: "ses_r-race",
      packet: null, error: null, log: [], live_view_url: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    const ctx = { sessionID: "ses_r-race" }
    const { log: appendLog } = await import("../src/core/runctx.ts")
    // The scout is told to call independent tools in the same turn, so this is
    // the shape that actually happens.
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => appendLog(ctx, "evidence", `https://x.test/${i}`)),
    )
    const run = await store.get("r-race")
    expect(run?.log.length).toBe(25)
    expect(new Set(run!.log.map((l) => l.text)).size).toBe(25)
  })
})


describe("packet provenance", () => {
  test("refuses a verification verdict with no oauth_verify on record", async () => {
    await seed("r-fabricated")   // no verification entry in the log
    const r = await emit("r-fabricated", {
      auth: { scheme: "OAUTH2" },
      acquisition: { path: "dcr", status: "credentials_obtained" },
      composio_auth_config: { toolkit: "x", auth_scheme: "OAUTH2", credentials: { client_id: "abc" } },
      verification: { invalid_client: false },
      evidence: ["https://x.example"],
      confidence: 0.9,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors[0]!.field).toBe("verification.invalid_client")
  })

  test("accepts the same claim once oauth_verify has actually run", async () => {
    await seed("r-corroborated", "linear.app", true)
    const r = await emit("r-corroborated", {
      auth: { scheme: "OAUTH2" },
      acquisition: { path: "dcr", status: "credentials_obtained" },
      composio_auth_config: { toolkit: "x", auth_scheme: "OAUTH2", credentials: { client_id: "abc" } },
      verification: { invalid_client: false },
      confidence: 0.9,
    })
    expect(r.ok).toBe(true)
  })

  test("drops evidence the run never fetched", async () => {
    await seed("r-injected")
    const r = await emit("r-injected", {
      auth: { scheme: "API_KEY" },
      acquisition: { path: "none_needed", status: "no_app_required" },
      evidence: ["https://totally-never-fetched.example/x"],
      confidence: 0.5,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.packet.evidence).not.toContain("https://totally-never-fetched.example/x")
    expect(r.packet.evidence).toContain("https://mcp.linear.app/register")
  })
})

describe("blocker ladder", () => {
  test("derives the class and the unblocking step from the reason", async () => {
    const cases: [string, string][] = [
      // capability, not config: a solver clears v2/Turnstile but not Enterprise.
      ["captcha_blocked", "capability"],
      ["email_verification_required", "config"],
      ["sms_verification_required", "capability"],
      ["paid_tier_required", "commercial"],
      ["partner_program_required", "human"],
      ["per_tenant_only", "structural"],
    ]
    for (const [reason, klass] of cases) {
      await seed(`r-${reason}`)
      const r = await emit(`r-${reason}`, {
        auth: { scheme: "OAUTH2" },
        acquisition: {
          path: "form", status: "blocked", blocked_reason: reason,
          human_action_required: "A person must do the thing that unblocks this.",
        },
        confidence: 0.8,
      })
      expect(r.ok, `${reason} should validate`).toBe(true)
      if (!r.ok) continue
      expect(r.packet.acquisition.blocker_class, reason).toBe(klass as any)
      expect(r.packet.acquisition.unblocked_by, reason).toBeTruthy()
    }
  })

  test("a run that is not blocked carries no class", async () => {
    await seed("r-unblocked")
    const r = await emit("r-unblocked", {
      auth: { scheme: "API_KEY" },
      acquisition: { path: "none_needed", status: "no_app_required" },
      confidence: 0.9,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.packet.acquisition.blocker_class).toBeNull()
  })
})

describe("credentials the toolkit cannot use", () => {
  test("a public client is not a completed acquisition when a secret is required", async () => {
    await seed("r-public", "airtable.com", "70a93eb7-dbf1-477f-b41d-97cf5a9caa35")
    const r = await emit("r-public", {
      resolved: { composio_slug: "airtable" },
      auth: { scheme: "DCR_OAUTH" },
      acquisition: { path: "dcr", status: "credentials_obtained" },
      composio_auth_config: {
        toolkit: "airtable",
        auth_scheme: "OAUTH2",
        // Airtable's registration endpoint issues public clients only.
        credentials: { client_id: "70a93eb7-dbf1-477f-b41d-97cf5a9caa35" },
      },
      verification: { invalid_client: false },
      confidence: 0.99,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.packet.acquisition.status).toBe("blocked")
    expect(r.packet.acquisition.blocked_reason).toBe("public_client_only")
    expect(r.packet.acquisition.human_action_required).toContain("70a93eb7")
  }, 30000)
})
