/**
 * Password-only access control.
 *
 * There are no accounts here — one shared password gates the whole surface,
 * because the audience is two people and a login form with a username field
 * would be pretending otherwise.
 *
 * The session cookie is an HMAC over an expiry, signed with a secret derived
 * from the password itself. That means changing the password invalidates every
 * outstanding session for free, and there is no session table to keep.
 */

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto"
import type { Context, Next } from "hono"

const COOKIE = "aa_session"
const TTL_MS = 1000 * 60 * 60 * 12

/** Absent password disables the gate entirely, which is what local dev wants. */
export const enabled = () => Boolean(process.env.DASHBOARD_PASSWORD)

function secret(): string {
  // A per-process salt would log everyone out on restart, so the secret is
  // stable across restarts and derived only from the password.
  return createHmac("sha256", "auth-agent/session/v1")
    .update(process.env.DASHBOARD_PASSWORD ?? "")
    .digest("hex")
}

function sign(expiry: number): string {
  const mac = createHmac("sha256", secret()).update(String(expiry)).digest("hex")
  return `${expiry}.${mac}`
}

function valid(token: string | undefined): boolean {
  if (!token) return false
  const [expRaw, mac] = token.split(".")
  if (!expRaw || !mac) return false
  const expiry = Number(expRaw)
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false

  const expected = createHmac("sha256", secret()).update(expRaw).digest("hex")
  const a = Buffer.from(mac, "utf8")
  const b = Buffer.from(expected, "utf8")
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Constant-time compare so the password cannot be probed a character at a time. */
export function passwordMatches(candidate: unknown): boolean {
  const expected = process.env.DASHBOARD_PASSWORD ?? ""
  if (typeof candidate !== "string" || !expected) return false
  const a = createHmac("sha256", "cmp").update(candidate).digest()
  const b = createHmac("sha256", "cmp").update(expected).digest()
  return timingSafeEqual(a, b)
}

export function issueCookie(c: Context): void {
  const expiry = Date.now() + TTL_MS
  const secure = process.env.COOKIE_INSECURE === "true" ? "" : " Secure;"
  c.header(
    "Set-Cookie",
    `${COOKIE}=${sign(expiry)}; Path=/; HttpOnly; SameSite=Lax;${secure} Max-Age=${Math.floor(TTL_MS / 1000)}`,
  )
}

export function clearCookie(c: Context): void {
  c.header("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

function readCookie(c: Context): string | undefined {
  const raw = c.req.header("cookie") ?? ""
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=")
    if (k === COOKIE) return v.join("=")
  }
  return undefined
}

export function authed(c: Context): boolean {
  if (!enabled()) return true
  return valid(readCookie(c))
}

/**
 * Guards everything except the endpoints a locked-out browser still needs:
 * the login form itself, and the health probe the deploy script waits on.
 */
const OPEN_PATHS = new Set(["/api/login", "/api/logout", "/api/health"])

/**
 * Run artefacts are run data. Screenshots of a half-filled registration form
 * live under /artifacts, which was mounted outside the gate, so anyone holding
 * a run id could pull them with no password on a system whose entire access
 * control is one shared password.
 */
const GUARDED_PREFIXES = ["/api/", "/artifacts/"]

export async function guard(c: Context, next: Next) {
  if (!enabled()) return next()
  const path = c.req.path
  if (!GUARDED_PREFIXES.some((p) => path.startsWith(p))) return next()
  if (OPEN_PATHS.has(path)) return next()
  if (authed(c)) return next()
  return c.json({ error: "unauthorized" }, 401)
}

/**
 * Rate limit login attempts per IP. A single shared password is only as strong
 * as the number of guesses allowed against it.
 */
const attempts = new Map<string, { count: number; until: number }>()
const MAX_ATTEMPTS = 8
const LOCKOUT_MS = 1000 * 60 * 10
/**
 * The key is `x-forwarded-for`, which the client controls, so a spray of forged
 * values would grow this map without bound. Expired entries are swept and the
 * map is capped; evicting the oldest under pressure is safe because an attacker
 * who can rotate addresses was never being limited by this anyway.
 */
const MAX_TRACKED = 10_000

function sweep(): void {
  const now = Date.now()
  for (const [k, v] of attempts) if (now > v.until) attempts.delete(k)
  if (attempts.size <= MAX_TRACKED) return

  // Evicting oldest-first was itself a bypass: re-setting an existing Map key
  // does not move it in iteration order, so a locked-out address stayed among
  // the oldest and a flood of ~10k fresh forged addresses evicted its own
  // lockout, resetting it long before LOCKOUT_MS. Entries that are actively
  // locked out are therefore evicted last, and only if nothing else is left.
  const overflow = attempts.size - MAX_TRACKED
  const cold: string[] = []
  const locked: string[] = []
  for (const [k, v] of attempts) (v.count >= MAX_ATTEMPTS ? locked : cold).push(k)

  let removed = 0
  for (const k of cold) {
    if (removed >= overflow) break
    attempts.delete(k)
    removed++
  }
  for (const k of locked) {
    if (removed >= overflow) break
    attempts.delete(k)
    removed++
  }
}

export function rateLimited(ip: string): boolean {
  const rec = attempts.get(ip)
  if (!rec) return false
  if (Date.now() > rec.until) {
    attempts.delete(ip)
    return false
  }
  return rec.count >= MAX_ATTEMPTS
}

export function recordFailure(ip: string): void {
  const rec = attempts.get(ip) ?? { count: 0, until: Date.now() + LOCKOUT_MS }
  rec.count++
  rec.until = Date.now() + LOCKOUT_MS
  attempts.set(ip, rec)
  // Swept after the insert, not before, or the cap is always one behind.
  sweep()
}

export function clearFailures(ip: string): void {
  attempts.delete(ip)
}

export const newSecret = () => randomBytes(16).toString("hex")

/** Exposed for the memory-bound test. */
export const trackedAddresses = () => attempts.size
