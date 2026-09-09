import { expect, test, describe, beforeEach, afterAll } from "bun:test"

const ORIG = process.env.DASHBOARD_PASSWORD
process.env.DASHBOARD_PASSWORD = "hunter2-hunter2"
const auth = await import("../src/auth.ts")
afterAll(() => {
  if (ORIG === undefined) delete process.env.DASHBOARD_PASSWORD
  else process.env.DASHBOARD_PASSWORD = ORIG
})

/** Minimal stand-in for the bits of Hono's Context that auth.ts touches. */
function ctx(cookie?: string, path = "/api/runs") {
  const headers: Record<string, string> = {}
  return {
    req: { path, header: (k: string) => (k === "cookie" ? cookie : undefined) },
    header: (k: string, v: string) => { headers[k] = v },
    json: (body: any, status = 200) => ({ body, status }),
    _headers: headers,
  } as any
}

describe("password comparison", () => {
  test("accepts the configured password and nothing else", () => {
    expect(auth.passwordMatches("hunter2-hunter2")).toBe(true)
    expect(auth.passwordMatches("hunter2-hunter1")).toBe(false)
    expect(auth.passwordMatches("")).toBe(false)
    expect(auth.passwordMatches("hunter2-hunter2 ")).toBe(false)
  })
  test("rejects non-strings rather than coercing them", () => {
    expect(auth.passwordMatches(undefined)).toBe(false)
    expect(auth.passwordMatches(null)).toBe(false)
    expect(auth.passwordMatches(123 as any)).toBe(false)
    expect(auth.passwordMatches({} as any)).toBe(false)
    expect(auth.passwordMatches(["hunter2-hunter2"] as any)).toBe(false)
  })
})

describe("session cookie", () => {
  test("a freshly issued cookie authenticates", () => {
    const c = ctx()
    auth.issueCookie(c)
    const setCookie: string = c._headers["Set-Cookie"]
    const value = setCookie.split(";")[0]!.split("=")[1]!
    expect(auth.authed(ctx(`aa_session=${value}`))).toBe(true)
  })

  test("a forged or tampered cookie does not", () => {
    const future = Date.now() + 60_000
    expect(auth.authed(ctx(`aa_session=${future}.deadbeef`))).toBe(false)
    expect(auth.authed(ctx(`aa_session=${future}.`))).toBe(false)
    expect(auth.authed(ctx("aa_session=garbage"))).toBe(false)
    expect(auth.authed(ctx("aa_session="))).toBe(false)
    expect(auth.authed(ctx(""))).toBe(false)
    expect(auth.authed(ctx(undefined))).toBe(false)
  })

  test("an expired but correctly signed cookie is refused", () => {
    // Sign a past expiry the way the server would, to prove the check is on the
    // timestamp and not merely on the signature.
    const { createHmac } = require("node:crypto")
    const secret = createHmac("sha256", "auth-agent/session/v1")
      .update("hunter2-hunter2").digest("hex")
    const past = String(Date.now() - 1000)
    const mac = createHmac("sha256", secret).update(past).digest("hex")
    expect(auth.authed(ctx(`aa_session=${past}.${mac}`))).toBe(false)
  })

  test("changing the password invalidates existing sessions", () => {
    const c = ctx()
    auth.issueCookie(c)
    const value = c._headers["Set-Cookie"].split(";")[0]!.split("=")[1]!
    process.env.DASHBOARD_PASSWORD = "a-different-password"
    expect(auth.authed(ctx(`aa_session=${value}`))).toBe(false)
    process.env.DASHBOARD_PASSWORD = "hunter2-hunter2"
  })

  test("survives other cookies sharing the header", () => {
    const c = ctx()
    auth.issueCookie(c)
    const value = c._headers["Set-Cookie"].split(";")[0]!.split("=")[1]!
    expect(auth.authed(ctx(`_ga=1; aa_session=${value}; other=2`))).toBe(true)
  })
})

describe("route guard", () => {
  const reached = () => { let hit = false; return { next: async () => { hit = true }, hit: () => hit } }

  test("blocks an unauthenticated API call", async () => {
    const r = reached()
    const res: any = await auth.guard(ctx(undefined, "/api/runs"), r.next as any)
    expect(r.hit()).toBe(false)
    expect(res.status).toBe(401)
  })

  test("lets login, logout and health through", async () => {
    for (const p of ["/api/login", "/api/logout", "/api/health"]) {
      const r = reached()
      await auth.guard(ctx(undefined, p), r.next as any)
      expect(r.hit()).toBe(true)
    }
  })

  test("guards the mutating routes, not just reads", async () => {
    for (const p of ["/api/runs", "/api/runs/abc", "/api/runs/abc/abort", "/api/session"]) {
      const r = reached()
      await auth.guard(ctx(undefined, p), r.next as any)
      expect(r.hit()).toBe(false)
    }
  })

  test("does not gate static asset paths", async () => {
    const r = reached()
    await auth.guard(ctx(undefined, "/assets/index.js"), r.next as any)
    expect(r.hit()).toBe(true)
  })
})

describe("login rate limiting", () => {
  beforeEach(() => auth.clearFailures("1.2.3.4"))

  test("locks out after repeated failures and clears on success", () => {
    expect(auth.rateLimited("1.2.3.4")).toBe(false)
    for (let i = 0; i < 8; i++) auth.recordFailure("1.2.3.4")
    expect(auth.rateLimited("1.2.3.4")).toBe(true)
    auth.clearFailures("1.2.3.4")
    expect(auth.rateLimited("1.2.3.4")).toBe(false)
  })

  test("one address being locked out does not affect another", () => {
    for (let i = 0; i < 8; i++) auth.recordFailure("1.2.3.4")
    expect(auth.rateLimited("5.6.7.8")).toBe(false)
  })
})

describe("rate limiter memory", () => {
  test("does not grow without bound under forged addresses", () => {
    // x-forwarded-for is attacker-controlled, so the key space is theirs.
    for (let i = 0; i < 12_000; i++) auth.recordFailure(`10.0.${(i >> 8) & 255}.${i & 255}`)
    expect(auth.trackedAddresses()).toBeLessThanOrEqual(10_000)
  })

  test("still limits a real repeat offender after a sweep", () => {
    auth.clearFailures("203.0.113.9")
    for (let i = 0; i < 8; i++) auth.recordFailure("203.0.113.9")
    expect(auth.rateLimited("203.0.113.9")).toBe(true)
  })
})

describe("artifact route", () => {
  const reached = () => { let hit = false; return { next: async () => { hit = true }, hit: () => hit } }

  test("run artefacts are behind the gate, not beside it", async () => {
    const r = reached()
    const res: any = await auth.guard(ctx(undefined, "/artifacts/run123_form.png"), r.next as any)
    expect(r.hit()).toBe(false)
    expect(res.status).toBe(401)
  })

  test("a valid session still reaches them", async () => {
    const c = ctx()
    auth.issueCookie(c)
    const value = c._headers["Set-Cookie"].split(";")[0]!.split("=")[1]!
    const r = reached()
    await auth.guard(ctx(`aa_session=${value}`, "/artifacts/run123_form.png"), r.next as any)
    expect(r.hit()).toBe(true)
  })
})

describe("lockout survives an eviction flood", () => {
  test("a locked-out address is not evicted to make room", () => {
    auth.clearFailures("victim.ip")
    for (let i = 0; i < 9; i++) auth.recordFailure("victim.ip")
    expect(auth.rateLimited("victim.ip")).toBe(true)

    // The flood that previously reset it: 10k+ distinct forged addresses.
    for (let i = 0; i < 10_500; i++) auth.recordFailure(`flood-${i}`)

    expect(auth.trackedAddresses()).toBeLessThanOrEqual(10_000)
    expect(auth.rateLimited("victim.ip")).toBe(true)
  })
})
