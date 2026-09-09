/**
 * A mailbox the agent controls, so an email verification step is a pause rather
 * than a dead end.
 *
 * AgentMail when configured (inboxes on demand, no domain setup). Without a key
 * the tools stay callable and return a typed "not configured" so the agent
 * blocks with `email_verification_required` instead of inventing a code.
 */

import { Evidence, req } from "./http.ts"

const BASE = "https://api.agentmail.to/v0"

const key = () => process.env.AGENTMAIL_API_KEY
export const configured = () => Boolean(key())

function auth() {
  return { authorization: `Bearer ${key()}`, "content-type": "application/json" }
}

export type Inbox = { inbox_id: string; address: string }

export async function listInboxes(ev: Evidence): Promise<Inbox[]> {
  if (!configured()) return []
  const r = await req(`${BASE}/inboxes`, { headers: auth(), evidence: ev, note: "list agent inboxes" })
  const items = r.json?.inboxes ?? r.json?.data ?? []
  return items.map((i: any) => ({
    inbox_id: i.inbox_id ?? i.id,
    address: i.address ?? i.email ?? i.inbox_id,
  }))
}

export type InboxResult =
  | { ok: true; inbox: Inbox; reused: boolean }
  | { ok: false; reason: string; existing: Inbox[] }

/**
 * Get a mailbox, preferring an existing one.
 *
 * Plans cap the number of inboxes — the free tier is three — so creating a
 * fresh one per platform runs out almost immediately and then every signup
 * fails with an error that looks like a bug. Reusing is also the better
 * behaviour: an operator identity should be stable, not a new address each run.
 */
export async function acquireInbox(
  ev: Evidence,
  username?: string,
  avoid: string[] = [],
): Promise<InboxResult> {
  if (!configured()) return { ok: false, reason: "AGENTMAIL_API_KEY not configured", existing: [] }

  const r = await req(`${BASE}/inboxes`, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify(username ? { username } : {}),
    evidence: ev,
    note: "create agent inbox",
  })

  if (r.ok && r.json?.inbox_id) {
    return { ok: true, reused: false, inbox: { inbox_id: r.json.inbox_id, address: r.json.email ?? r.json.address } }
  }

  const existing = await listInboxes(ev)
  const limitHit = r.json?.code === "limit_exceeded" || /limit/i.test(String(r.json?.message ?? ""))

  if (limitHit) {
    // Prefer a mailbox no other platform has claimed.
    const free = existing.find((i) => !avoid.includes(i.address) && !avoid.includes(i.inbox_id))
    if (free) return { ok: true, reused: true, inbox: free }

    // Otherwise share one. A single mailbox serving several platforms is how a
    // person does this, and refusing to share turned a three-inbox plan into a
    // hard cap of three platforms, ever. Messages are told apart by sender, so
    // mail_wait must filter on `from_contains`.
    if (existing.length) {
      return { ok: true, reused: true, inbox: existing[0]! }
    }

    return {
      ok: false,
      reason: `inbox limit reached and no mailbox exists to share (${existing.length} found)`,
      existing,
    }
  }

  return { ok: false, reason: r.json?.message ?? `inbox creation failed (HTTP ${r.status})`, existing }
}

/** Kept for callers that only want a mailbox and do not care which. */
export async function createInbox(ev: Evidence, username?: string): Promise<Inbox | null> {
  const r = await acquireInbox(ev, username)
  return r.ok ? r.inbox : null
}

export type Message = { from: string; subject: string; text: string; at: string }

export async function listMessages(inboxId: string, ev: Evidence): Promise<Message[]> {
  if (!configured()) return []
  const r = await req(`${BASE}/inboxes/${encodeURIComponent(inboxId)}/messages`, {
    headers: auth(),
    evidence: ev,
    note: "poll inbox",
  })
  const items = r.json?.messages ?? r.json?.data ?? []
  return items.map((m: any) => ({
    from: m.from ?? m.sender ?? "",
    subject: m.subject ?? "",
    text: m.text ?? m.preview ?? m.html ?? "",
    at: m.timestamp ?? m.created_at ?? "",
  }))
}

const LINK_RE = /https?:\/\/[^\s"'<>)\]]+/gi
const CODE_RE = /(code|otp|pin|passcode|verification)\D{0,15}?(\d{4,8})/gi
const ANY_CODE_RE = /\b(\d{6,8})\b/
const YEARISH = (d: string) => d.length === 4 && Number(d) >= 1900 && Number(d) <= 2099

export type Extracted = { otp: string | null; links: string[]; from: string; subject: string }

/**
 * Picking the code out of a verification email is fiddlier than it looks. A
 * naive "keyword then digits" regex happily matches the word "Verify" in a
 * subject line against a copyright year further down the body, so candidates
 * are scored rather than taken first-come: six digits beat four, a real code
 * word beats the weaker "verification", and anything year-shaped is demoted.
 */
export function extract(m: Message): Extracted {
  const hay = `${m.subject}\n${m.text}`

  type Cand = { code: string; score: number }
  const cands: Cand[] = []
  for (const match of hay.matchAll(CODE_RE)) {
    const word = match[1]!.toLowerCase()
    const code = match[2]!
    let score = 0
    if (code.length === 6) score += 4
    else if (code.length > 4) score += 2
    if (["code", "otp", "pin", "passcode"].includes(word)) score += 3
    if (YEARISH(code)) score -= 6
    cands.push({ code, score })
  }
  cands.sort((a, b) => b.score - a.score)

  let otp = cands.length && cands[0]!.score > 0 ? cands[0]!.code : null
  if (!otp) {
    const any = ANY_CODE_RE.exec(hay)?.[1]
    if (any && !YEARISH(any)) otp = any
  }

  return {
    otp,
    links: [...new Set(hay.match(LINK_RE) ?? [])].slice(0, 10),
    from: m.from,
    subject: m.subject,
  }
}

/** Poll until something arrives from `fromContains`, or give up. */
export async function waitFor(
  inboxId: string,
  ev: Evidence,
  opts: { fromContains?: string; timeoutMs?: number; intervalMs?: number } = {},
): Promise<Extracted | null> {
  if (!configured()) return null
  const deadline = Date.now() + (opts.timeoutMs ?? 120000)
  const interval = opts.intervalMs ?? 5000
  const seen = new Set<string>()
  while (Date.now() < deadline) {
    for (const m of await listMessages(inboxId, ev)) {
      const id = m.at + m.subject
      if (seen.has(id)) continue
      seen.add(id)
      if (opts.fromContains && !m.from.toLowerCase().includes(opts.fromContains.toLowerCase())) continue
      const e = extract(m)
      if (e.otp || e.links.length) return e
    }
    await new Promise((r) => setTimeout(r, interval))
  }
  return null
}
