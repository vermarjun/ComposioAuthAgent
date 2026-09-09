/**
 * Control plane.
 *
 * Thin on purpose: it owns run lifecycle and nothing else. All judgement lives
 * in the agent, all acquisition logic lives in src/core, and this file just
 * makes both reachable over HTTP.
 */

import { Hono } from "hono"
import { serveStatic } from "hono/bun"
import { randomBytes } from "node:crypto"
import { join } from "node:path"
import { existsSync } from "node:fs"
import * as oc from "./opencode.ts"
import * as store from "./store-shim.ts"
import { brief, type RunInput } from "./prompt.ts"
import * as auth from "./auth.ts"

const ROOT = process.cwd()
const app = new Hono()

const newId = () => randomBytes(6).toString("hex")

/**
 * The socket peer unless a proxy is explicitly trusted.
 *
 * `x-forwarded-for` is set by the client. Trusting it meant a fresh forged
 * value per request gave unlimited password guesses against the one shared
 * password — the lockout worked perfectly and protected nothing. Set
 * TRUST_PROXY=true only when something in front actually rewrites the header.
 */
const clientIp = (c: any) => {
  if (process.env.TRUST_PROXY === "true") {
    const fwd = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    if (fwd) return fwd
    const real = c.req.header("x-real-ip")
    if (real) return real
  }
  const conn = c.env?.requestIP?.(c.req.raw) ?? c.env?.remoteAddress
  return conn?.address ?? conn ?? c.req.header("cf-connecting-ip") ?? "peer"
}

app.post("/api/login", async (c) => {
  const ip = clientIp(c)
  if (auth.rateLimited(ip)) {
    return c.json({ error: "too many attempts; try again later" }, 429)
  }
  const body = await c.req.json().catch(() => ({}))
  if (!auth.passwordMatches(body?.password)) {
    auth.recordFailure(ip)
    return c.json({ error: "incorrect password" }, 401)
  }
  auth.clearFailures(ip)
  auth.issueCookie(c)
  return c.json({ ok: true })
})

app.post("/api/logout", (c) => {
  auth.clearCookie(c)
  return c.json({ ok: true })
})

app.get("/api/session", (c) => c.json({ authed: auth.authed(c), required: auth.enabled() }))

// Every /api route below this point is gated. Artefacts are gated too: they are
// screenshots of a run, and a bare static mount put them outside the only
// access control this system has.
app.use("/api/*", auth.guard)
app.use("/artifacts/*", auth.guard)

app.get("/api/health", async (c) =>
  c.json({
    auth_required: auth.enabled(),
    ok: true,
    opencode: oc.BASE,
    model: oc.model(),
    storage: store.usingAws() ? "dynamodb+s3" : "local disk",
    browser_provider: process.env.BROWSER_PROVIDER ?? "agentcore",
    acquisition_mode: (await import("./core/policy.ts")).mode(),
    vault_configured: (await import("./core/vault.ts")).configured(),
    integrations: {
      composio: Boolean(process.env.COMPOSIO_API_KEY),
      firecrawl: Boolean(process.env.FIRECRAWL_API_KEY),
      agentmail: Boolean(process.env.AGENTMAIL_API_KEY),
      capsolver: Boolean(process.env.CAPSOLVER_API_KEY),
    },
  }),
)

app.post("/api/runs", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as RunInput
  const platform = typeof body?.platform === "string" ? body.platform.trim() : ""
  if (!platform) {
    // Whitespace passed the old truthiness check and started a run against a
    // blank platform, which burns a model turn to conclude nothing.
    return c.json({ error: "platform is required" }, 400)
  }
  if (platform.length > 200) {
    return c.json({ error: "platform name is implausibly long" }, 400)
  }

  const run_id = newId()
  const now = new Date().toISOString()
  const run: store.RunState = {
    run_id,
    platform,
    status: "queued",
    session_id: null,
    packet: null,
    error: null,
    log: [{ at: now, kind: "system", text: `run queued for ${body.platform}` }],
    live_view_url: null,
    created_at: now,
    updated_at: now,
  }
  await store.put(run)

  // Session first, persisted before the prompt fires: tools resolve their run
  // through the session id, so the mapping must exist before the agent moves.
  try {
    const sessionId = await oc.createSession(`auth: ${run.platform}`)
    run.session_id = sessionId
    run.status = "running"
    run.log.push({ at: new Date().toISOString(), kind: "system", text: `session ${sessionId}` })
    await store.put(run)
    await oc.promptAsync(sessionId, "auth-scout", brief(body))
  } catch (e: any) {
    run.status = "error"
    run.error = String(e?.message ?? e)
    await store.put(run)
    return c.json({ run_id, status: "error", error: run.error }, 502)
  }

  return c.json({ run_id, status: run.status })
})

app.get("/api/runs", async (c) => {
  // 25 was fine when the only history was the current session's. The deployed
  // box now carries the full local run history merged in, and a cap that hides
  // 90% of it makes the dashboard look like the agent had barely been run.
  const runs = await store.recent(Number(process.env.HISTORY_LIMIT ?? 250))
  return c.json(
    runs.map((r) => ({
      run_id: r.run_id,
      platform: r.platform,
      status: r.status,
      path: r.packet?.acquisition?.path ?? null,
      packet_status: r.packet?.acquisition?.status ?? null,
      created_at: r.created_at,
    })),
  )
})

app.get("/api/runs/:id", async (c) => {
  const run = await store.get(c.req.param("id"))
  if (!run) return c.json({ error: "not found" }, 404)

  // A run that produced no packet is not finished, however quiet the agent went.
  if (run.status === "running" && run.session_id && !run.packet) {
    const err = await oc.sessionError(run.session_id)
    if (err) {
      run.status = "error"
      run.error = err
      // A model outage mid-demo should not look like the system is broken. If
      // this platform has completed before, surface that packet — labelled, so
      // nobody mistakes it for a fresh acquisition.
      if (/model unavailable/i.test(err)) {
        const prior = (await store.recent(200)).find(
          (r) => r.platform === run!.platform && r.packet && r.run_id !== run!.run_id,
        )
        if (prior?.packet) {
          run.packet = { ...prior.packet, notes: [prior.packet.notes, `Served from a previous run (${prior.completed_at ?? prior.updated_at}). The model was unavailable for this attempt, so nothing was re-acquired.`].filter(Boolean).join(" ") }
          ;(run as any).from_cache = { run_id: prior.run_id, at: prior.updated_at }
        }
      }
      await store.put(run)
    } else if (Date.now() - new Date(run.updated_at).getTime() > 1000 * 60 * 12) {
      run.status = "error"
      run.error = "agent stopped without emitting a packet"
      await store.put(run)
    }
  }
  return c.json(run)
})

app.post("/api/runs/:id/abort", async (c) => {
  const run = await store.get(c.req.param("id"))
  if (!run) return c.json({ error: "not found" }, 404)
  if (run.session_id) await oc.abort(run.session_id)
  run.status = "error"
  run.error = "aborted by operator"
  await store.put(run)
  return c.json({ ok: true })
})

app.use("/artifacts/*", serveStatic({ root: "./runs" }))

// The React dashboard is the product surface; public/ is the fallback that
// keeps the API usable from a browser when the frontend has not been built.
const DASHBOARD = existsSync(join(ROOT, "web", "dist", "index.html"))
const uiRoot = DASHBOARD ? "./web/dist" : "./public"
const uiIndex = `${uiRoot}/index.html`

app.use("/*", serveStatic({ root: uiRoot }))
// Any non-API path falls through to index.html so client-side routing works.
app.get("*", serveStatic({ path: uiIndex }))

/**
 * Abandon a run that has stopped making progress.
 *
 * Observed four times: opencode opens an assistant turn with no parts, no
 * error and no completion, and then sits there. The tools are not implicated —
 * the previous turn finished in five seconds and both its calls returned. The
 * only existing exit was the staleness check on GET, which needs someone to
 * poll and never aborts the session, so a stalled run held a browser and a
 * model slot indefinitely.
 *
 * Progress is measured by the run's own log, which every tool appends to, so a
 * long-but-working browser step is not mistaken for a hang.
 */
const STALL_MS = Number(process.env.RUN_STALL_MS ?? 6 * 60 * 1000)

async function reapStalledRuns(): Promise<void> {
  const runs = await store.recent(50).catch(() => [])
  const now = Date.now()
  for (const run of runs) {
    if (run.status !== "running" || run.packet) continue
    if (now - new Date(run.updated_at).getTime() < STALL_MS) continue

    const minutes = Math.round((now - new Date(run.updated_at).getTime()) / 60000)
    console.warn(`[watchdog] run ${run.run_id} (${run.platform}) idle ${minutes}m; aborting`)
    if (run.session_id) await oc.abort(run.session_id)
    run.status = "error"
    run.error = `no progress for ${minutes} minutes; the agent turn stalled and the run was abandoned`
    await store.put(run).catch(() => {})
  }
}

setInterval(() => void reapStalledRuns().catch(() => {}), 30_000).unref?.()

const port = Number(process.env.PORT ?? 8080)

await oc.start(ROOT).catch((e) => {
  console.error("[fatal] opencode did not start:", e.message)
  console.error("[fatal] is xypro running?  xypro serve   (expected at " + (process.env.XYPRO_BASE_URL ?? "http://127.0.0.1:1455/v1") + ")")
})

console.log(`[server] listening on http://0.0.0.0:${port}`)
console.log(`[server] serving ${DASHBOARD ? "web/dist (dashboard)" : "public/ (fallback — run: cd web && npm run build)"}`)
console.log(`[server] password gate ${auth.enabled() ? "ON" : "OFF (set DASHBOARD_PASSWORD)"}`)
export default { port, fetch: app.fetch, idleTimeout: 120 }
