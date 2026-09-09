/**
 * Browser sessions for the portal work.
 *
 * The browser deliberately does not live in this container. `agent-browser -p
 * agentcore` runs it on AWS Bedrock AgentCore, which keeps the image small,
 * persists logins between runs via a profile id, and — the part that matters
 * for the demo — prints a Live View URL that a human can open and watch.
 *
 * The agent itself drives the browser through agent-browser's MCP tools. This
 * module only owns session lifecycle and the artefacts, because those need to
 * reach the run store.
 */

import { spawn } from "node:child_process"
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { putArtifact } from "./store.ts"

export type Provider = "agentcore" | "local"

export const provider = (): Provider =>
  (process.env.BROWSER_PROVIDER as Provider) === "local" ? "local" : "agentcore"

export type Session = {
  name: string
  provider: Provider
  live_view_url: string | null
  /** False when the browser did not actually launch. */
  ok: boolean
  note: string
}

export type ExecResult = { code: number; stdout: string; stderr: string }

/** Where the stealth init script lives. Applied at launch, via `open`. */
const STEALTH_SCRIPT = join(import.meta.dir ?? ".", "stealth.js")

export const stealthy = () => process.env.BROWSER_STEALTH !== "false"

/**
 * Session env carries the session name and nothing else.
 *
 * It used to inject the stealth launch config here too. That was actively
 * destructive: agent-browser keys a running browser on a hash of its launch
 * configuration, and the agent drives the browser through the MCP server, which
 * spawns with the plain environment. Two callers with different configs meant
 * every command issued from this file relaunched Chrome and threw away the page
 * the model had just navigated to — the model would snapshot a real signup form,
 * this code would look at the same session and see Chrome's error page, and
 * portal_signup would report "no email field found" on a page that had one.
 *
 * The launch config now lives only in .env, so every process inherits exactly
 * the same one and the hash matches.
 */
export function sessionEnv(session: string): Record<string, string> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    AGENT_BROWSER_SESSION: session,
  }
  if (provider() === "agentcore") {
    env.AGENT_BROWSER_PROVIDER = "agentcore"
    env.AGENTCORE_REGION = process.env.AGENTCORE_REGION ?? process.env.AWS_REGION ?? "us-east-1"
    if (process.env.AGENTCORE_PROFILE_ID) env.AGENTCORE_PROFILE_ID = process.env.AGENTCORE_PROFILE_ID
  }
  return env
}

/**
 * `allowed-domains` is documented as rejecting profiles, CDP and startup args,
 * and the agent passes it on most browser calls. Left in, it changes the launch
 * configuration relative to the MCP server's, which is enough on its own to
 * force a relaunch and lose the page.
 */
function stripConflicts(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--allowed-domains") { i++; continue }
    if (args[i]?.startsWith("--allowed-domains=")) continue
    out.push(args[i]!)
  }
  return out
}

/** The init script only applies at launch, so it rides along with `open`. */
function withStealth(args: string[]): string[] {
  if (!stealthy() || provider() !== "local") return args
  const cmd = args[0]
  if (cmd !== "open" && cmd !== "goto" && cmd !== "navigate") return args
  return [...args, "--init-script", STEALTH_SCRIPT]
}

export function exec(args: string[], session: string, timeoutMs = 90000): Promise<ExecResult> {
  return new Promise((resolve) => {
    const p = spawn("agent-browser", withStealth(stripConflicts(args)), { env: sessionEnv(session) })
    let stdout = "", stderr = ""
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs)
    p.stdout.on("data", (d) => (stdout += d))
    p.stderr.on("data", (d) => (stderr += d))
    p.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
    p.on("error", (e) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: String(e) })
    })
  })
}

const LIVE_VIEW_RE = /Live View:\s*(\S+)/i

/**
 * Opening a blank page is what actually provisions the cloud session, so the
 * Live View URL only exists after a real navigation.
 */
/**
 * A profile directory keeps a SingletonLock so two Chromes cannot share it. A
 * killed Chrome leaves it behind, and every later launch dies with "File
 * exists (17)" or "exited early without writing DevToolsActivePort" — a state
 * the previous code reported as a healthy session.
 */
function clearStaleProfileLock(): string | null {
  const dir = process.env.AGENT_BROWSER_PROFILE
  if (!dir) return null
  const locks = ["SingletonLock", "SingletonCookie", "SingletonSocket"]
  const cleared: string[] = []
  for (const l of locks) {
    const p = join(dir, l)
    try {
      if (existsSync(p)) { rmSync(p, { force: true }); cleared.push(l) }
    } catch {}
  }
  return cleared.length ? cleared.join(", ") : null
}

export async function start(runId: string): Promise<Session> {
  const name = `auth-agent-${runId}`

  let r = await exec(["open", "about:blank"], name, 60000)
  let cleared: string | null = null

  // Retry once against a stale lock rather than handing back a session that
  // will fail on every subsequent navigation.
  if (r.code !== 0 && /SingletonLock|DevToolsActivePort|exited early/i.test(r.stderr)) {
    cleared = clearStaleProfileLock()
    if (cleared) r = await exec(["open", "about:blank"], name, 60000)
  }

  const live = LIVE_VIEW_RE.exec(r.stderr + r.stdout)?.[1] ?? null

  // Claiming a session that does not exist cost two runs: the agent was told
  // "browser session started" and then hit four consecutive open failures.
  if (r.code !== 0) {
    return {
      name,
      provider: provider(),
      live_view_url: null,
      ok: false,
      note:
        provider() === "agentcore"
          ? `AgentCore session failed (${r.stderr.trim().slice(0, 200)}). Set BROWSER_PROVIDER=local to fall back to a local browser.`
          : `Browser did not launch (${r.stderr.trim().slice(0, 200)}).${cleared ? ` Cleared a stale ${cleared} and it still failed.` : ""}`,
    }
  }

  return {
    name,
    provider: provider(),
    live_view_url: live,
    ok: true,
    note: live
      ? "cloud browser session live"
      : cleared
      ? `browser session started after clearing a stale ${cleared}`
      : "browser session started",
  }
}

export async function stop(session: string): Promise<void> {
  await exec(["close"], session, 20000)
}

/**
 * Screenshot straight into the artefact store so the frontend can show it.
 *
 * Waits for the network to settle first. Capturing immediately after a
 * navigation reliably produced blank images on JS-rendered developer portals,
 * which is exactly the kind of page this runs against.
 */
export async function screenshot(runId: string, session: string, label: string): Promise<string | null> {
  await exec(["wait", "--load", "networkidle"], session, 30000).catch(() => undefined)

  // A screenshot of chrome-error://chromewebdata is worse than none: it is
  // filed as evidence of a filled form and shows "This site can't be reached".
  // Seen shipped, so the page is checked before the image is kept.
  const url = (await exec(["get", "url"], session, 20000)).stdout.trim()
  if (/^chrome-error:|^about:blank/.test(url) || !url) {
    return null
  }

  const dir = mkdtempSync(join(tmpdir(), "ab-"))
  const file = join(dir, `${label}.png`)
  const r = await exec(["screenshot", file], session, 60000)
  if (r.code !== 0 || !existsSync(file)) return null
  return putArtifact(`${runId}/${label}.png`, readFileSync(file), "image/png")
}

// ── form driving ──────────────────────────────────────────────────────────────

export type Field = { ref: string; role: string; type: string; label: string }

/**
 * Interactive elements as structured data rather than the prose snapshot the
 * model reads. Tools that fill secrets need to locate fields themselves, so the
 * password never has to pass through the model's context to be typed.
 */
export async function fields(session: string): Promise<Field[]> {
  const r = await exec(["snapshot", "-i", "--json"], session, 45000)
  if (r.code !== 0) return []

  let doc: any
  try {
    doc = JSON.parse(r.stdout.trim())
  } catch {
    return []
  }
  const data = doc?.data ?? doc
  const refs = data?.refs
  if (!refs || typeof refs !== "object") return []

  // agent-browser's accessibility snapshot does not carry an input's `type` —
  // measured across four signup pages, `type="` appears zero times. Every
  // `type === "password"` check in this file was therefore dead, including the
  // confirm-password loop in portal_signup, which could never match.
  //
  // So the type is inferred from the accessible name, which is what the
  // snapshot does give: `- textbox "Password" [ref=e9]`. Any `type="..."` that
  // a future version emits still wins.
  const types = new Map<string, string>()
  const prose = typeof data.snapshot === "string" ? data.snapshot : ""
  for (const line of prose.split("\n")) {
    const ref = /\bref=(e\d+)\b/.exec(line)?.[1]
    if (!ref) continue
    const declared = /\btype="([^"]+)"/.exec(line)?.[1]
    if (declared) { types.set(ref, declared); continue }
    const name = (/"([^"]*)"/.exec(line)?.[1] ?? "").toLowerCase()
    const isBox = /\b(textbox|searchbox|combobox)\b/.test(line)
    if (isBox && /pass(word|code)|^pin$/.test(name)) types.set(ref, "password")
    else if (isBox && /e-?mail/.test(name)) types.set(ref, "email")
    else if (/\bbutton\b/.test(line) && /sign ?up|create account|register|log ?in|sign ?in|continue|submit|next|get started/.test(name)) {
      types.set(ref, "submit")
    }
  }

  return Object.entries(refs).map(([id, v]: [string, any]) => ({
    ref: id.startsWith("@") ? id : `@${id}`,
    role: String(v?.role ?? ""),
    type: types.get(id) ?? "",
    label: String(v?.name ?? v?.label ?? ""),
  }))
}

const looksLike = (f: Field, needles: string[]) => {
  const hay = `${f.type} ${f.label}`.toLowerCase()
  return needles.some((n) => hay.includes(n))
}

/**
 * Label matching alone is not enough to find an input. "Forgot your password?"
 * is a link that sits next to the password box on most login screens, and it
 * matched before this guard existed.
 */
const isEntry = (f: Field) => {
  const r = f.role.toLowerCase()
  return r.includes("textbox") || r.includes("input") || r.includes("searchbox") || r === "combobox"
}

const isControl = (f: Field) => {
  const r = f.role.toLowerCase()
  return r.includes("button") || f.type === "submit"
}

export function findEmailField(fs: Field[]): Field | undefined {
  const entries = fs.filter(isEntry)
  return (
    entries.find((f) => f.type === "email") ??
    entries.find((f) => looksLike(f, ["email", "e-mail"])) ??
    entries.find((f) => looksLike(f, ["username", "user name", "login"])) ??
    // Last resort on a one-field form: the only text box present.
    (entries.filter((f) => f.type !== "password").length === 1
      ? entries.find((f) => f.type !== "password")
      : undefined)
  )
}

export function findPasswordField(fs: Field[]): Field | undefined {
  const byType = fs.find((f) => f.type === "password")
  if (byType) return byType
  // Only ever an entry field: the "Forgot password?" link is not one.
  return fs.filter(isEntry).find((f) => looksLike(f, ["password", "passcode"]))
}

/** Verbs that submit a form, most specific first. */
const SUBMIT_VERBS = [
  "sign up", "signup", "create account", "create your account", "register",
  "get started", "log in", "login", "sign in", "signin", "submit", "continue", "next",
]

/**
 * Controls that are not the form's submit: page furniture, and — the one that
 * actually bit — federated-identity buttons. "Sign up with Google" contains
 * "sign up" and sits above the real "Sign Up", so a naive verb match hands the
 * account to Google's consent screen instead of filling the form.
 */
const NOT_SUBMIT =
  /slide|carousel|cookie|preference|previous|back|skip|close|dismiss|menu|language|\bwith (google|github|apple|microsoft|facebook|linkedin|slack|sso|saml|okta|twitter|x)\b|single sign|continue with/i

export function findSubmit(fs: Field[]): Field | undefined {
  const controls = fs.filter(isControl).filter((f) => !NOT_SUBMIT.test(f.label))
  // Ordered, so "sign up" beats "continue" on a signup page rather than
  // whichever happened to appear first in the tree.
  for (const verb of SUBMIT_VERBS) {
    const hit = controls.find((f) => f.label.toLowerCase().includes(verb))
    if (hit) return hit
  }
  return controls.find((f) => f.type === "submit") ?? controls[0]
}

/**
 * Some signup pages show only "Sign up with email" until it is clicked, and the
 * real form appears after. Aborting there reports "no email field found" about
 * a form that is one click away — typeform does exactly this.
 */
const REVEAL = /sign ?up with e-?mail|continue with e-?mail|use e-?mail|with e-?mail|other options|more options/i

export function findRevealControl(fs: Field[]): Field | undefined {
  return fs.filter(isControl).find((f) => REVEAL.test(f.label))
}

/**
 * Types a value without it ever appearing in the model's context or in a log
 * line. Callers pass the secret straight from the vault.
 *
 * Known limitation: agent-browser's `fill` takes its value as an argument, so
 * for the life of that child process the secret is visible in `ps` to any other
 * user on the host. That is acceptable in a single-tenant container and is not
 * acceptable on a shared box; closing it properly means driving CDP directly
 * rather than shelling out. Documented in the README rather than papered over.
 */
export async function fillSecret(session: string, ref: string, value: string): Promise<boolean> {
  const r = await exec(["fill", ref, value], session, 30000)
  return r.code === 0
}
