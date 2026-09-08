/**
 * OAuth metadata discovery. No LLM anywhere in this file: the platform either
 * publishes the documents or it does not, and that is the finding.
 *
 * Chain:
 *   RFC 9728  /.well-known/oauth-protected-resource   names the auth server(s)
 *   RFC 8414  /.well-known/oauth-authorization-server the endpoints
 *   OIDC      /.well-known/openid-configuration       fallback
 */

import { Evidence, req, toOrigin } from "./http.ts"

export type AuthServerMetadata = {
  issuer: string | null
  authorization_endpoint: string | null
  token_endpoint: string | null
  registration_endpoint: string | null
  scopes_supported: string[]
  grant_types_supported: string[]
  token_endpoint_auth_methods_supported: string[]
  source: string
}

export type DiscoveryResult = {
  origin: string
  found: boolean
  supports_dcr: boolean
  metadata: AuthServerMetadata | null
  protected_resource: { resource: string | null; authorization_servers: string[] } | null
  tried: string[]
}

function parseMetadata(json: any, source: string): AuthServerMetadata {
  return {
    issuer: json.issuer ?? null,
    authorization_endpoint: json.authorization_endpoint ?? null,
    token_endpoint: json.token_endpoint ?? null,
    registration_endpoint: json.registration_endpoint ?? null,
    scopes_supported: Array.isArray(json.scopes_supported) ? json.scopes_supported : [],
    grant_types_supported: Array.isArray(json.grant_types_supported) ? json.grant_types_supported : [],
    token_endpoint_auth_methods_supported: Array.isArray(json.token_endpoint_auth_methods_supported)
      ? json.token_endpoint_auth_methods_supported
      : [],
    source,
  }
}

const WELL_KNOWN = ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]

async function fetchAsMetadata(origin: string, ev: Evidence): Promise<AuthServerMetadata | null> {
  for (const p of WELL_KNOWN) {
    const url = origin.replace(/\/+$/, "") + p
    const r = await req(url, { evidence: ev, note: "AS metadata probe" })
    if (r.ok && r.json && (r.json.authorization_endpoint || r.json.registration_endpoint)) {
      return parseMetadata(r.json, url)
    }
  }
  return null
}

export async function discover(input: string, ev: Evidence): Promise<DiscoveryResult> {
  const origin = toOrigin(input)
  const tried: string[] = []

  // RFC 9728 first: it tells us which auth server actually governs the resource,
  // which is frequently a different host than the resource itself.
  const prUrl = origin + "/.well-known/oauth-protected-resource"
  tried.push(prUrl)
  const pr = await req(prUrl, { evidence: ev, note: "protected resource metadata" })
  let protectedResource: DiscoveryResult["protected_resource"] = null

  if (pr.ok && pr.json) {
    const servers: string[] = Array.isArray(pr.json.authorization_servers) ? pr.json.authorization_servers : []
    protectedResource = { resource: pr.json.resource ?? null, authorization_servers: servers }
    for (const as of servers) {
      tried.push(as)
      const md = await fetchAsMetadata(toOrigin(as), ev)
      if (md) return { origin, found: true, supports_dcr: !!md.registration_endpoint, metadata: md, protected_resource: protectedResource, tried }
    }
  }

  // Fall back to asking the origin about itself.
  for (const p of WELL_KNOWN) tried.push(origin + p)
  const md = await fetchAsMetadata(origin, ev)
  if (md) {
    return { origin, found: true, supports_dcr: !!md.registration_endpoint, metadata: md, protected_resource: protectedResource, tried }
  }

  return { origin, found: false, supports_dcr: false, metadata: null, protected_resource: protectedResource, tried }
}

/**
 * A platform's MCP surface is very often the only place it speaks DCR, and it
 * is almost always at a predictable host. Cheap to try, high hit rate.
 *
 * The label is tried against several TLDs on purpose: notion.so's MCP server
 * lives at mcp.notion.com, and that mismatch is common enough to matter.
 */
export function mcpCandidates(input: string): string[] {
  const origin = toOrigin(input)
  let host: string
  try {
    host = new URL(origin).hostname
  } catch {
    return [origin]
  }
  const bare = host.replace(/^(www|api|app|mcp|auth)\./, "")
  const label = bare.split(".")[0] ?? bare
  const tlds = ["com", "app", "io", "so", "dev", "ai", "co"]
  const out = [
    `https://mcp.${bare}`,
    origin,
    ...tlds.map((t) => `https://mcp.${label}.${t}`),
    `https://api.${bare}`,
    `https://auth.${bare}`,
    `https://${bare}`,
  ]
  return [...new Set(out)]
}

/**
 * Probe candidates concurrently and prefer a DCR-capable answer over a merely
 * present one. Sequential probing of ten hosts was the slowest part of a run.
 */
export async function discoverBest(input: string, ev: Evidence): Promise<DiscoveryResult> {
  const cands = mcpCandidates(input)
  const results = await Promise.all(
    cands.map(async (c) => {
      const local = new Evidence()
      const r = await discover(c, local)
      return { r, local }
    }),
  )
  const dcr = results.find((x) => x.r.supports_dcr)
  if (dcr) {
    ev.merge(dcr.local)
    return dcr.r
  }
  const found = results.find((x) => x.r.found)
  if (found) {
    ev.merge(found.local)
    return found.r
  }
  // Nothing found: keep the evidence of the primary two probes only, so the
  // packet is not padded with eight 404s.
  results.slice(0, 2).forEach((x) => ev.merge(x.local))
  return {
    origin: toOrigin(input),
    found: false,
    supports_dcr: false,
    metadata: null,
    protected_resource: null,
    tried: cands,
  }
}
