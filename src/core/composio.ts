/**
 * Composio's own catalog, used for three different jobs:
 *   1. dedupe      - do they already ship this toolkit, and is auth managed?
 *   2. field spec  - the exact credential field names agent #3 will expect
 *   3. oracle      - a human-maintained answer to "what auth does this app use",
 *                    produced by a different process than this agent
 */

import { Evidence, req } from "./http.ts"
import type { Scheme } from "./schema.ts"

const BASE = "https://backend.composio.dev/api/v3"

export type ComposioToolkit = {
  slug: string
  name: string
  auth_schemes: Scheme[]
  managed_schemes: Scheme[]
  no_auth: boolean
  tools_count: number | null
  app_url: string | null
  /** auth_scheme -> required/optional field names for creating an auth config */
  creation_fields: Record<string, { required: string[]; optional: string[] }>
  /** auth_scheme -> fields the end user supplies at connect time (subdomain etc) */
  connect_fields: Record<string, { required: string[]; optional: string[] }>
}

function key(): Record<string, string> {
  const k = process.env.COMPOSIO_API_KEY
  return k ? { "x-api-key": k } : {}
}

export function guessSlug(name: string): string {
  // Callers pass "OpenAI", "openai.com" and "https://openai.com" alike. Naive
  // punctuation replacement turned the second into "openai_com", which 404s.
  const bare = name.trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/\/.*$/, "")
    .replace(/^(www|api|app|mcp|auth|developer|developers)\./, "")
  const label = /\.[a-z]{2,}$/.test(bare) ? bare.split(".")[0]! : bare
  return label.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

function fieldNames(block: any): { required: string[]; optional: string[] } {
  const pick = (arr: any) => (Array.isArray(arr) ? arr.map((f: any) => f?.name).filter(Boolean) : [])
  return { required: pick(block?.required), optional: pick(block?.optional) }
}

export async function getToolkit(slug: string, ev: Evidence): Promise<ComposioToolkit | null> {
  const url = `${BASE}/toolkits/${encodeURIComponent(slug)}`
  const r = await req(url, { headers: key(), evidence: ev, note: "composio toolkit lookup" })
  if (!r.ok || !r.json || r.json.error) return null
  const d = r.json

  const creation: ComposioToolkit["creation_fields"] = {}
  const connect: ComposioToolkit["connect_fields"] = {}
  for (const c of d.auth_config_details ?? []) {
    const mode = c?.mode
    if (!mode) continue
    creation[mode] = fieldNames(c?.fields?.auth_config_creation)
    connect[mode] = fieldNames(c?.fields?.connected_account_initiation)
  }

  return {
    slug: d.slug ?? slug,
    name: d.name ?? slug,
    auth_schemes: (d.auth_schemes ?? Object.keys(creation)) as Scheme[],
    managed_schemes: (d.composio_managed_auth_schemes ?? []) as Scheme[],
    no_auth: !!d.no_auth,
    tools_count: d?.meta?.tools_count ?? null,
    app_url: d?.meta?.app_url ?? null,
    creation_fields: creation,
    connect_fields: connect,
  }
}

/** Fuzzy fallback when the guessed slug 404s. */
export async function searchToolkits(name: string, ev: Evidence): Promise<{ slug: string; name: string }[]> {
  const url = `${BASE}/toolkits?limit=500`
  const r = await req(url, { headers: key(), evidence: ev, note: "composio catalog search", timeoutMs: 25000 })
  if (!r.ok || !r.json?.items) return []
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")
  const target = norm(name)
  return (r.json.items as any[])
    .filter((t) => {
      const s = norm(t.slug ?? ""), n = norm(t.name ?? "")
      return s === target || n === target || s.includes(target) || target.includes(s)
    })
    .slice(0, 8)
    .map((t) => ({ slug: t.slug, name: t.name }))
}

export async function lookup(name: string, ev: Evidence): Promise<ComposioToolkit | null> {
  const direct = await getToolkit(guessSlug(name), ev)
  if (direct) return direct
  const hits = await searchToolkits(name, ev)
  if (!hits.length) return null
  return getToolkit(hits[0]!.slug, ev)
}
