/**
 * Grades the agent against the gold set and against two independent registries.
 *
 * Runs against a deployed URL by default so the thing being graded is the thing
 * the reviewer will click, not a local variant of it.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const API = process.env.EVAL_API ?? "http://127.0.0.1:8080"
const PASSWORD = process.env.EVAL_PASSWORD ?? process.env.DASHBOARD_PASSWORD

/** The gate applies to the eval too; log in once and reuse the cookie. */
let COOKIE = ""
async function login(): Promise<void> {
  if (!PASSWORD) return
  const r = await fetch(`${API}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  })
  if (!r.ok) throw new Error(`eval could not log in: ${r.status}`)
  COOKIE = (r.headers.get("set-cookie") ?? "").split(";")[0] ?? ""
}
const authHeaders = () => (COOKIE ? { cookie: COOKIE } : {})
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? 3)
const TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS ?? 8 * 60 * 1000)

type Row = { platform: string; expected_scheme: string; expected_path: string; coarse: string; source: string; note: string }

const GOLD = process.env.EVAL_GOLD ?? "golden.csv"

function readGold(): Row[] {
  const raw = readFileSync(join(import.meta.dir, GOLD), "utf8").trim().split("\n")
  const head = raw[0]!.split(",")
  return raw.slice(1).map((line) => {
    // note is last and may contain commas
    const parts = line.split(",")
    const o: any = {}
    head.forEach((h, i) => (o[h] = i === head.length - 1 ? parts.slice(i).join(",") : parts[i]))
    return o as Row
  })
}

const COARSE: Record<string, string> = {
  dcr: "machine", none_needed: "none",
  self_serve: "human", form: "human", relationship: "human",
  not_buildable: "none",
}

/**
 * Partial results are checkpointed after every platform.
 *
 * A full pass is 20 platforms of several turns each, which is more than one
 * ChatGPT Codex quota window holds. Resuming means the eval can be chipped at
 * across windows instead of being restarted from zero each time the model
 * disappears.
 */
const CACHE = join(import.meta.dir, `results.partial.${GOLD.replace(/\.csv$/, "")}.json`)

function loadPartial(): Record<string, any> {
  if (process.env.EVAL_FRESH === "1" || !existsSync(CACHE)) return {}
  try {
    return JSON.parse(readFileSync(CACHE, "utf8"))
  } catch {
    return {}
  }
}

function savePartial(done: Record<string, any>) {
  writeFileSync(CACHE, JSON.stringify(done, null, 2))
}

async function runOne(row: Row): Promise<any> {
  const started = Date.now()
  const post = await fetch(`${API}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ platform: row.platform }),
  }).then((r) => r.json())

  if (!post.run_id) return { row, error: post.error ?? "no run_id" }

  while (Date.now() - started < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 4000))
    const run = await fetch(`${API}/api/runs/${post.run_id}`, { headers: authHeaders() }).then((r) => r.json())
    if (run.status === "done" && run.packet) return { row, packet: run.packet, seconds: Math.round((Date.now() - started) / 1000) }
    if (run.status === "error") return { row, error: run.error, seconds: Math.round((Date.now() - started) / 1000) }
  }
  return { row, error: "timeout" }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++
        out[idx] = await fn(items[idx]!)
      }
    }),
  )
  return out
}

await login()

const gold = readGold()
const done = loadPartial()
const already = gold.filter((g) => done[g.platform]?.packet).length
const todo = gold.filter((g) => !done[g.platform]?.packet)

console.log(`grading ${gold.length} platforms from ${GOLD} against ${API}`)
if (already) console.log(`resuming: ${already} already scored, ${todo.length} to go (EVAL_FRESH=1 to start over)`)
console.log()

await pool(todo, CONCURRENCY, async (row) => {
  const r = await runOne(row)
  done[row.platform] = r
  savePartial(done)
  if (r.error) console.log(`  ${row.platform}: ${r.error}`)
  return r
})

// Score against the gold as it is NOW, not the copy cached beside the packet.
// Resuming re-used the stale row, so correcting a label had no effect on the
// numbers until the next full re-run — which is exactly when nobody looks.
const results = gold.map((g) => {
  const cached = done[g.platform]
  return cached ? { ...cached, row: g } : { row: g, error: "not run" }
})

let schemeHit = 0, pathHit = 0, coarseHit = 0, errored = 0, verified = 0
let agree = 0, disagree = 0, noOracle = 0
const rows: string[] = []

for (const r of results) {
  if (r.error || !r.packet) {
    errored++
    rows.push(`${r.row.platform.padEnd(18)} ERROR  ${r.error}`)
    continue
  }
  const p = r.packet
  const scheme = p.auth.scheme
  const path = p.acquisition.path
  const alts: string[] = p.auth.alternatives ?? []

  // A scheme counts as correct if it is the label or the label appears in the
  // alternatives the agent listed; multi-scheme platforms are real.
  const sOk = scheme === r.row.expected_scheme || alts.includes(r.row.expected_scheme)
  const pOk = path === r.row.expected_path
  const cOk = COARSE[path] === r.row.coarse

  if (sOk) schemeHit++
  if (pOk) pathHit++
  if (cOk) coarseHit++
  // A run that never obtained a client cannot have verified one. Counting
  // `invalid_client === false` alone credited blocked and no-app-required runs
  // whose own verification text said no client was ever created.
  if (
    p.acquisition?.status === "credentials_obtained" &&
    p.composio_auth_config?.credentials?.client_id &&
    p.verification?.invalid_client === false
  ) {
    verified++
  }
  if (p.oracles?.agreement === "agree") agree++
  else if (p.oracles?.agreement === "disagree") disagree++
  else noOracle++

  rows.push(
    `${r.row.platform.padEnd(18)} ${sOk ? "✓" : "✗"} ${scheme.padEnd(12)} ` +
    `${pOk ? "✓" : "✗"} ${path.padEnd(13)} ${cOk ? "✓" : "✗"} ${String(COARSE[path]).padEnd(8)} ` +
    `${String(p.acquisition.status).padEnd(21)} ${r.seconds}s`,
  )
}

const n = gold.length
const scored = n - errored
const pct = (x: number) => `${((x / Math.max(scored, 1)) * 100).toFixed(0)}%`

console.log("platform           scheme                path                       coarse            status                time")
console.log("-".repeat(112))
rows.sort().forEach((l) => console.log(l))
console.log("-".repeat(112))
console.log(`
  scored                 ${scored}/${n}   (${errored} errored)
  auth scheme            ${schemeHit}/${scored}  ${pct(schemeHit)}
  acquisition path       ${pathHit}/${scored}  ${pct(pathHit)}   exact
  path (machine/human)   ${coarseHit}/${scored}  ${pct(coarseHit)}   the decidable split
  credentials verified   ${verified}          runs that minted a client_id the platform then accepted

  oracle agreement       agree ${agree} · disagree ${disagree} · no oracle ${noOracle}
    (Composio's catalog, reported as agreement — it is not a hand label)
`)

writeFileSync(
  join(import.meta.dir, `results.${GOLD.replace(/\.csv$/, "")}.json`),
  JSON.stringify({ api: API, at: new Date().toISOString(), scored, schemeHit, pathHit, coarseHit, verified, agree, disagree, results }, null, 2),
)
console.log(`wrote eval/results.${GOLD.replace(/\.csv$/, "")}.json`)
