/**
 * Every outbound fetch in this system goes through here, for one reason: the
 * packet has to carry the URLs that were *actually* retrieved, not the URLs a
 * model remembers. `Evidence` is that ledger.
 */

export type EvidenceEntry = {
  url: string
  status: number | null
  ok: boolean
  contentType: string | null
  at: string
  note?: string
}

export class Evidence {
  private entries: EvidenceEntry[] = []

  record(e: EvidenceEntry) {
    this.entries.push(e)
  }

  urls(): string[] {
    return [...new Set(this.entries.filter((e) => e.ok).map((e) => e.url))]
  }

  all(): EvidenceEntry[] {
    return this.entries
  }

  merge(other: Evidence) {
    this.entries.push(...other.all())
  }
}

export const UA = "composio-auth-agent/1.0 (+https://composio.dev)"

export type FetchOpts = {
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  evidence?: Evidence
  note?: string
  /** Do not follow redirects; used by oauth_verify to inspect the 302 itself. */
  manualRedirect?: boolean
}

export type FetchResult = {
  ok: boolean
  status: number | null
  headers: Record<string, string>
  text: string
  json: any | null
  url: string
  error?: string
}

export async function req(url: string, opts: FetchOpts = {}): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? 15000
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  const at = new Date().toISOString()
  try {
    const r = await fetch(url, {
      method: opts.method ?? "GET",
      headers: { "user-agent": UA, ...(opts.headers ?? {}) },
      body: opts.body,
      signal: ctl.signal,
      redirect: opts.manualRedirect ? "manual" : "follow",
    })
    const text = await r.text().catch(() => "")
    let json: any = null
    try {
      json = JSON.parse(text)
    } catch {}
    const headers: Record<string, string> = {}
    r.headers.forEach((v, k) => (headers[k] = v))
    opts.evidence?.record({
      url,
      status: r.status,
      ok: r.ok || (opts.manualRedirect === true && r.status >= 300 && r.status < 400),
      contentType: r.headers.get("content-type"),
      at,
      note: opts.note,
    })
    return { ok: r.ok, status: r.status, headers, text, json, url }
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? `timeout after ${timeoutMs}ms` : String(e?.message ?? e)
    opts.evidence?.record({ url, status: null, ok: false, contentType: null, at, note: msg })
    return { ok: false, status: null, headers: {}, text: "", json: null, url, error: msg }
  } finally {
    clearTimeout(timer)
  }
}

/** Normalise "Linear", "linear.app", "https://linear.app/" to an origin. */
export function toOrigin(input: string): string {
  let s = input.trim()
  if (!/^https?:\/\//i.test(s)) s = "https://" + s
  try {
    return new URL(s).origin
  } catch {
    return "https://" + input.trim().toLowerCase().replace(/\s+/g, "")
  }
}
