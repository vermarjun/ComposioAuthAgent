/**
 * Nango's providers.yaml as a second, independently maintained oracle. 992
 * providers, a different company, a different process. Agreement across two
 * registries is a much stronger claim than agreement with one.
 *
 * Hand-rolled parser rather than a YAML dependency: we only need four scalar
 * fields per top-level block and the file shape is stable.
 */

import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

export type NangoProvider = {
  slug: string
  display_name: string | null
  auth_mode: string | null
  authorization_url: string | null
  token_url: string | null
  registration_url: string | null
  setup_guide_url: string | null
  docs: string | null
}

let CACHE: Map<string, NangoProvider> | null = null

const CANDIDATES = [
  process.env.NANGO_YAML_PATH,
  join(process.cwd(), "data", "nango.yaml"),
  join(import.meta.dir ?? ".", "..", "..", "data", "nango.yaml"),
].filter(Boolean) as string[]

function scalar(line: string): string | null {
  const v = line.slice(line.indexOf(":") + 1).trim()
  if (!v || v === "|" || v === ">") return null
  return v.replace(/^['"]|['"]$/g, "")
}

export function load(): Map<string, NangoProvider> {
  if (CACHE) return CACHE
  CACHE = new Map()
  const path = CANDIDATES.find((p) => existsSync(p))
  if (!path) return CACHE

  const lines = readFileSync(path, "utf8").split("\n")
  let cur: NangoProvider | null = null
  for (const line of lines) {
    const top = /^([A-Za-z0-9_.-]+):\s*$/.exec(line)
    if (top) {
      if (cur) CACHE.set(cur.slug, cur)
      cur = {
        slug: top[1]!,
        display_name: null, auth_mode: null, authorization_url: null,
        token_url: null, registration_url: null, setup_guide_url: null, docs: null,
      }
      continue
    }
    if (!cur) continue
    // Only first-level keys (4 spaces); nested blocks are ignored on purpose.
    const kv = /^ {4}([a-z_]+):(.*)$/.exec(line)
    if (!kv) continue
    const k = kv[1]!
    if (k === "display_name") cur.display_name = scalar(line)
    else if (k === "auth_mode") cur.auth_mode = scalar(line)
    else if (k === "authorization_url") cur.authorization_url = scalar(line)
    else if (k === "token_url") cur.token_url = scalar(line)
    else if (k === "registration_url") cur.registration_url = scalar(line)
    else if (k === "setup_guide_url") cur.setup_guide_url = scalar(line)
    else if (k === "docs") cur.docs = scalar(line)
  }
  if (cur) CACHE.set(cur.slug, cur)
  return CACHE
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")

/**
 * Callers pass "Linear", "linear.app" and "https://linear.app" interchangeably,
 * so match on the registrable label as well as the raw string. Without this,
 * every domain-shaped input misses the registry entirely.
 */
function variants(name: string): string[] {
  const raw = name.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")
  const host = raw.replace(/^(www|api|app|mcp|auth)\./, "")
  const label = host.split(".")[0] ?? host
  return [...new Set([norm(name), norm(raw), norm(host), norm(label)])].filter(Boolean)
}

export function lookup(name: string): NangoProvider | null {
  const m = load()
  const cands = variants(name)
  if (!cands.length) return null

  for (const target of cands) {
    const direct = m.get(target)
    if (direct) return direct
    for (const p of m.values()) {
      if (norm(p.slug) === target) return p
      if (p.display_name && norm(p.display_name) === target) return p
    }
  }

  // Prefix match last, shortest slug wins so "notion" beats "notion-scim".
  let best: NangoProvider | null = null
  for (const target of cands) {
    for (const p of m.values()) {
      if (norm(p.slug).startsWith(target) && (!best || p.slug.length < best.slug.length)) best = p
    }
    if (best) return best
  }
  return null
}

/** Nango's vocabulary -> Composio's, so the two oracles can be compared. */
export function toComposioScheme(authMode: string | null): string | null {
  if (!authMode) return null
  const map: Record<string, string> = {
    OAUTH2: "OAUTH2", OAUTH1: "OAUTH1", OAUTH2_CC: "S2S_OAUTH2",
    MCP_OAUTH2: "DCR_OAUTH", MCP_OAUTH2_GENERIC: "DCR_OAUTH",
    API_KEY: "API_KEY", BASIC: "BASIC", NONE: "NO_AUTH", JWT: "BASIC_WITH_JWT",
    TWO_STEP: "API_KEY", SIGNATURE: "API_KEY", TBA: "OAUTH1", APP: "OAUTH2",
  }
  return map[authMode] ?? null
}
