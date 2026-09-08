/**
 * Finding the page a human would have to open: the developer portal, the
 * "create an OAuth app" screen, or the access-request form.
 *
 * Firecrawl when a key is present, otherwise a small set of conventional URLs
 * probed directly. The fallback is not as good, but it means the system never
 * hard-depends on a third-party search bill.
 */

import { Evidence, req, toOrigin } from "./http.ts"

export type DocHit = { url: string; title: string | null; snippet: string | null; source: string }

const FC = "https://api.firecrawl.dev/v1/search"

/**
 * Set when search is configured but refusing to answer — an exhausted plan
 * returns 402 and an empty result set, which is indistinguishable from "nothing
 * matched" unless it is recorded. Silently returning nothing made the agent
 * conclude a platform had no developer portal.
 */
export let lastSearchError: string | null = null

export async function search(query: string, ev: Evidence, limit = 5): Promise<DocHit[]> {
  const key = process.env.FIRECRAWL_API_KEY
  if (!key) {
    lastSearchError = "FIRECRAWL_API_KEY not configured"
    return []
  }
  const r = await req(FC, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ query, limit }),
    evidence: ev,
    note: `search: ${query}`,
    timeoutMs: 30000,
  })
  if (r.status === 402) {
    lastSearchError = "search plan is out of credits (HTTP 402)"
    return []
  }
  if (!r.ok) {
    lastSearchError = `search failed: HTTP ${r.status}`
    return []
  }
  lastSearchError = null
  const items = r.json?.data ?? []
  return items.map((d: any) => ({
    url: d.url,
    title: d.title ?? null,
    snippet: (d.description ?? d.markdown ?? "").slice(0, 300) || null,
    source: "firecrawl",
  }))
}

const CONVENTIONAL = [
  "/developers", "/developer", "/docs/api", "/api", "/docs",
  "/settings/developers", "/oauth/applications", "/developer/apps",
]

/** Where partner and contact pages conventionally live. */
const CONTACT_PATHS = [
  "/partners", "/partner", "/partnerships", "/partner-program",
  "/contact", "/contact-us", "/support", "/developers/support",
  "/company/contact", "/about/contact",
]

export async function conventional(input: string, ev: Evidence): Promise<DocHit[]> {
  const origin = toOrigin(input)
  const hits: DocHit[] = []
  await Promise.all(
    CONVENTIONAL.map(async (p) => {
      const url = origin + p
      const r = await req(url, { evidence: ev, note: "conventional dev-docs probe", timeoutMs: 8000 })
      if (r.ok && r.status === 200) {
        const m = /<title[^>]*>([^<]{0,200})<\/title>/i.exec(r.text)
        hits.push({ url, title: m?.[1]?.trim() ?? null, snippet: null, source: "conventional" })
      }
    }),
  )
  return hits
}

/** Ranked "where does a human register an app for this platform" candidates. */
export async function findRegistrationPage(platform: string, ev: Evidence): Promise<DocHit[]> {
  const queries = [
    `${platform} create OAuth app client id client secret developer portal`,
    `${platform} API access request developer application form`,
  ]
  const results = (await Promise.all(queries.map((q) => search(q, ev, 4)))).flat()
  if (results.length) return dedupe(results)
  return dedupe(await conventional(platform, ev))
}

function dedupe(hits: DocHit[]): DocHit[] {
  const seen = new Set<string>()
  return hits.filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true)))
}

// ── contact discovery ─────────────────────────────────────────────────────────

export type ContactRoute = {
  kind: "partner_program" | "support_form" | "email" | "docs_contact"
  url: string | null
  email: string | null
  title: string | null
}

const MAILTO_RE = /mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/gi
const BARE_EMAIL_RE = /\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g

/** Generic inboxes are a better outreach target than a named individual. */
const GOOD_LOCALPARTS = [
  "partners", "partner", "developers", "developer", "api", "integrations",
  "platform", "bizdev", "partnerships", "support", "hello", "sales",
]

function rankEmail(addr: string): number {
  const local = addr.split("@")[0]!.toLowerCase()
  const i = GOOD_LOCALPARTS.indexOf(local)
  if (i >= 0) return 100 - i
  if (/no-?reply|donotreply|abuse|postmaster|privacy|legal|security/.test(local)) return -100
  return 0
}

/**
 * Where a human would write to about API access. Prefers a named programme or
 * a support form over an address, because a form goes to the queue that
 * actually handles these and an address often does not.
 */
export async function findContactRoute(platform: string, ev: Evidence): Promise<ContactRoute[]> {
  const queries = [
    `${platform} API partner program apply integration partnership`,
    `${platform} developer support contact API access request`,
  ]
  let hits = (await Promise.all(queries.map((q) => search(q, ev, 4)))).flat()

  // Search is not always available; conventional paths are weaker but real.
  if (!hits.length) {
    const origin = toOrigin(platform)
    const probed = await Promise.all(
      CONTACT_PATHS.map(async (path) => {
        const url = origin + path
        const r = await req(url, { evidence: ev, note: "conventional contact probe", timeoutMs: 8000 })
        if (!r.ok || r.status !== 200) return null
        const m = /<title[^>]*>([^<]{0,200})<\/title>/i.exec(r.text)
        return { url, title: m?.[1]?.trim() ?? null, snippet: null, source: "conventional" }
      }),
    )
    hits = probed.filter(Boolean) as DocHit[]
  }

  const routes: ContactRoute[] = []
  for (const h of hits.slice(0, 6)) {
    const u = h.url.toLowerCase()
    const kind: ContactRoute["kind"] =
      /partner|partnership/.test(u) ? "partner_program"
      : /contact|support|help|ticket/.test(u) ? "support_form"
      : "docs_contact"
    routes.push({ kind, url: h.url, email: null, title: h.title })
  }

  // Then look for an address on the best candidate page.
  const best = routes[0]
  if (best?.url) {
    const r = await req(best.url, { evidence: ev, note: "contact page scan", timeoutMs: 20000 })
    if (r.ok && r.text) {
      const found = [
        ...[...r.text.matchAll(MAILTO_RE)].map((m) => m[1]!),
        ...[...r.text.matchAll(BARE_EMAIL_RE)].map((m) => m[1]!),
      ]
      const ranked = [...new Set(found)].map((a) => ({ a, s: rankEmail(a) }))
        .filter((x) => x.s > -100)
        .sort((x, y) => y.s - x.s)
      if (ranked.length) routes.push({ kind: "email", url: best.url, email: ranked[0]!.a, title: null })
    }
  }
  return routes
}
