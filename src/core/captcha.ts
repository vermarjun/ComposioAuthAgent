/**
 * CAPTCHA relay, used so a legitimate registration does not stall on a
 * checkbox. Scope is deliberately narrow: Composio registering its own
 * developer app, under its own name, on a portal it is entitled to use.
 * No key configured means the agent blocks with `captcha_blocked` rather than
 * pretending the page was solved.
 */

import { Evidence, req } from "./http.ts"

const BASE = "https://api.capsolver.com"
const key = () => process.env.CAPSOLVER_API_KEY
export const configured = () => Boolean(key())

export type CaptchaKind = "turnstile" | "recaptcha_v2" | "recaptcha_v3"

export type SolveResult = { ok: boolean; token: string | null; error: string | null; ms: number }

function taskFor(kind: CaptchaKind, siteKey: string, pageUrl: string, action?: string) {
  switch (kind) {
    case "turnstile":
      return { type: "AntiTurnstileTaskProxyLess", websiteURL: pageUrl, websiteKey: siteKey }
    case "recaptcha_v3":
      return { type: "ReCaptchaV3TaskProxyLess", websiteURL: pageUrl, websiteKey: siteKey, pageAction: action ?? "verify" }
    default:
      return { type: "ReCaptchaV2TaskProxyLess", websiteURL: pageUrl, websiteKey: siteKey }
  }
}

export async function solve(
  kind: CaptchaKind,
  siteKey: string,
  pageUrl: string,
  ev: Evidence,
  action?: string,
): Promise<SolveResult> {
  const started = Date.now()
  if (!configured()) return { ok: false, token: null, error: "CAPSOLVER_API_KEY not configured", ms: 0 }

  const create = await req(`${BASE}/createTask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientKey: key(), task: taskFor(kind, siteKey, pageUrl, action) }),
    evidence: ev,
    note: `captcha createTask (${kind})`,
    timeoutMs: 20000,
  })
  const taskId = create.json?.taskId
  if (!taskId) {
    return { ok: false, token: null, error: create.json?.errorDescription ?? "createTask failed", ms: Date.now() - started }
  }

  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000))
    const got = await req(`${BASE}/getTaskResult`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientKey: key(), taskId }),
      timeoutMs: 20000,
    })
    const st = got.json?.status
    if (st === "ready") {
      const sol = got.json?.solution ?? {}
      return { ok: true, token: sol.token ?? sol.gRecaptchaResponse ?? null, error: null, ms: Date.now() - started }
    }
    if (st === "failed" || got.json?.errorId) {
      return { ok: false, token: null, error: got.json?.errorDescription ?? "solve failed", ms: Date.now() - started }
    }
  }
  return { ok: false, token: null, error: "timeout waiting for solution", ms: Date.now() - started }
}
