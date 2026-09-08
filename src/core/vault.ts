/**
 * Operator accounts.
 *
 * A developer portal will not issue a client_id to an anonymous visitor: you
 * log in, or you sign up. So the agent needs an identity per platform, and that
 * identity has to outlive the run that created it — otherwise every run signs
 * up again and leaves a trail of abandoned accounts.
 *
 * This is the store for those identities. Encrypted at rest with AES-256-GCM
 * because it holds real passwords for real accounts, and never returned to the
 * model in full: the browser tools fill fields, the model sees a handle.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

export type OperatorAccount = {
  platform: string
  email: string
  password: string
  /** AgentMail inbox backing `email`, when the account was provisioned by us. */
  inbox_id: string | null
  status: "active" | "pending_verification" | "locked"
  created_at: string
  last_used_at: string | null
  /** Free-text breadcrumbs: portal URL, which signup flow was used, quirks. */
  notes: string | null
}

/**
 * Resolved per call, not once at import. As a module constant this silently
 * ignored any OPERATOR_VAULT_PATH set after the first import, which is how a
 * test with its own key ended up writing over the real vault.
 */
const vaultPath = () => process.env.OPERATOR_VAULT_PATH ?? join(process.cwd(), "runs", "vault.enc")

/**
 * A missing key is not an error: it means the operator has not opted into
 * storing credentials, and the agent should block with needs_operator_account
 * rather than inventing an identity.
 */
export const configured = () => Boolean(process.env.VAULT_KEY)

function key(): Buffer {
  return scryptSync(process.env.VAULT_KEY ?? "", "auth-agent/vault/v1", 32)
}

function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv("aes-256-gcm", key(), iv)
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()])
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(".")
}

function decrypt(blob: string): string {
  const [ivB, tagB, dataB] = blob.split(".")
  if (!ivB || !tagB || !dataB) throw new Error("vault: malformed ciphertext")
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64"))
  d.setAuthTag(Buffer.from(tagB, "base64"))
  return Buffer.concat([d.update(Buffer.from(dataB, "base64")), d.final()]).toString("utf8")
}

type Vault = Record<string, OperatorAccount>

function load(): Vault {
  if (!configured() || !existsSync(vaultPath())) return {}
  try {
    return JSON.parse(decrypt(readFileSync(vaultPath(), "utf8")))
  } catch {
    // A wrong VAULT_KEY must not silently look like an empty vault, or the
    // agent will cheerfully sign up for a second account on every platform.
    throw new Error("vault: could not decrypt — is VAULT_KEY the same one that wrote it?")
  }
}

function save(v: Vault): void {
  mkdirSync(dirname(vaultPath()), { recursive: true })
  writeFileSync(vaultPath(), encrypt(JSON.stringify(v, null, 2)), { mode: 0o600 })
}

/** Platforms are keyed by registrable label so linear.app and Linear collide. */
export function normalise(platform: string): string {
  return platform.trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/\/.*$/, "")
    .replace(/^(www|api|app|mcp|auth|developer|developers)\./, "")
}

export function get(platform: string): OperatorAccount | null {
  return load()[normalise(platform)] ?? null
}

export function put(acc: OperatorAccount): OperatorAccount {
  const v = load()
  v[normalise(acc.platform)] = acc
  save(v)
  return acc
}

export function touch(platform: string, patch: Partial<OperatorAccount>): OperatorAccount | null {
  const v = load()
  const k = normalise(platform)
  if (!v[k]) return null
  v[k] = { ...v[k]!, ...patch, last_used_at: new Date().toISOString() }
  save(v)
  return v[k]!
}

export function list(): { platform: string; email: string; status: string; created_at: string }[] {
  return Object.values(load()).map((a) => ({
    platform: a.platform, email: a.email, status: a.status, created_at: a.created_at,
  }))
}

/**
 * Portals reject passwords that miss a class, and a random base64 string fails
 * "must contain a symbol" surprisingly often, so each class is guaranteed.
 */
export function generatePassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ"
  const lower = "abcdefghijkmnopqrstuvwxyz"
  const digit = "23456789"
  const symbol = "!@#$%^&*-_=+"
  const all = upper + lower + digit + symbol
  const pick = (set: string) => set[randomBytes(1)[0]! % set.length]!
  const chars = [pick(upper), pick(lower), pick(digit), pick(symbol)]
  while (chars.length < 20) chars.push(pick(all))
  // Fisher-Yates so the guaranteed classes are not always in positions 0-3.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0]! % (i + 1)
    ;[chars[i], chars[j]] = [chars[j]!, chars[i]!]
  }
  return chars.join("")
}
