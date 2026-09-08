/**
 * Proof, not assertion. Build the real authorize URL with the credential we
 * just minted and ask the platform about it. A platform that does not know the
 * client_id says so, loudly and in a machine-readable way.
 *
 * Deliberately stops at the redirect. We never complete a user consent flow.
 */

import { Evidence, req } from "./http.ts"

export type VerifyResult = {
  method: string
  checked_url: string
  status: number | null
  invalid_client: boolean
  result: string
}

const INVALID_MARKERS = [
  "invalid_client",
  "unauthorized_client",
  "client not found",
  "unknown client",
  "invalid client_id",
  "application not found",
]

/**
 * A login page renders happily for a client_id that means nothing, so a probe
 * with a placeholder comes back "accepted" and looks like proof. Seen live: an
 * agent passed the literal string "unavailable" and Xero answered 200.
 */
const PLACEHOLDERS = new Set([
  "", "unavailable", "unknown", "none", "null", "undefined", "n/a", "na",
  "todo", "tbd", "placeholder", "your_client_id", "client_id", "xxx", "-",
])

/**
 * An exact-match list was not enough. A run reported `client_id=not_obtained`
 * and the probe dutifully "verified" it, because a login page renders happily
 * for any string. Anything that reads as prose about the absence of a
 * credential is treated as an absence.
 */
const PLACEHOLDER_SHAPES = [
  /^not[_\s-]/i,          // not_obtained, not-available
  /^no[_\s-]/i,           // no_client_id
  /obtained$/i,
  /^pending/i,
  /unavailable|unknown|placeholder|example|redacted|missing|required/i,
  /^your[_\s-]/i,
  /^<.*>$/,
  /^\{\{.*\}\}$/,
]

export function isPlaceholder(clientId: string): boolean {
  const c = clientId.trim().toLowerCase()
  if (PLACEHOLDERS.has(c) || c.length < 4) return true
  if (PLACEHOLDER_SHAPES.some((re) => re.test(c))) return true
  // A real client_id is an opaque token, not a sentence.
  return /\s/.test(c)
}

export async function verifyClientId(
  authorizationEndpoint: string,
  clientId: string,
  redirectUri: string,
  scope: string | null,
  ev: Evidence,
): Promise<VerifyResult> {
  if (isPlaceholder(clientId)) {
    return {
      method: "authorize_endpoint_probe",
      checked_url: authorizationEndpoint,
      status: null,
      invalid_client: true,
      result: `refused: "${clientId}" is a placeholder, not a client_id. Obtain a real one before verifying.`,
    }
  }

  const u = new URL(authorizationEndpoint)
  u.searchParams.set("response_type", "code")
  u.searchParams.set("client_id", clientId)
  u.searchParams.set("redirect_uri", redirectUri)
  u.searchParams.set("state", "verify-" + Math.random().toString(36).slice(2, 10))
  if (scope) u.searchParams.set("scope", scope)
  // PKCE: many servers reject the request outright without it, which would
  // look like a bad client_id if we did not send one.
  u.searchParams.set("code_challenge", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
  u.searchParams.set("code_challenge_method", "S256")

  const r = await req(u.toString(), {
    evidence: ev,
    manualRedirect: true,
    note: "authorize-endpoint client_id probe",
    timeoutMs: 20000,
  })

  const hay = (r.text + " " + JSON.stringify(r.headers)).toLowerCase()
  const invalid = INVALID_MARKERS.some((m) => hay.includes(m))

  let result: string
  if (invalid) result = `rejected: platform reports an invalid client (HTTP ${r.status})`
  else if (r.status && r.status >= 300 && r.status < 400) result = `accepted: redirected to consent/login (HTTP ${r.status})`
  else if (r.status === 200) result = "accepted: consent or login page rendered (HTTP 200)"
  else if (r.status === null) result = `inconclusive: ${r.error ?? "request failed"}`
  else result = `inconclusive: HTTP ${r.status}`

  return {
    method: "authorize_endpoint_probe",
    checked_url: u.toString(),
    status: r.status,
    invalid_client: invalid,
    result,
  }
}


/**
 * The strongest verification available: exchange the credentials for a token.
 *
 * The authorize-endpoint probe only asks whether a login page renders, which is
 * weak — it answers "inconclusive" for a perfectly good credential, and renders
 * happily for a bad one. A client_credentials grant either returns a token or
 * it does not, and a wrong secret is refused outright. When a platform supports
 * it, this is proof rather than inference.
 */
export async function verifyClientCredentials(
  tokenEndpoint: string,
  clientId: string,
  clientSecret: string,
  scope: string | null,
  ev: Evidence,
): Promise<VerifyResult> {
  if (isPlaceholder(clientId)) {
    return {
      method: "token_endpoint_grant",
      checked_url: tokenEndpoint,
      status: null,
      invalid_client: true,
      result: `refused: "${clientId}" is a placeholder, not a client_id.`,
    }
  }

  const body = {
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    ...(scope ? { scope } : {}),
  }

  // Servers split roughly evenly between JSON and form encoding here, and a
  // rejection for the wrong content type looks exactly like a bad credential.
  const attempts: { headers: Record<string, string>; body: string }[] = [
    { headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body as Record<string, string>).toString(),
    },
  ]

  let last = { status: null as number | null, text: "" }
  for (const a of attempts) {
    const r = await req(tokenEndpoint, {
      method: "POST",
      headers: a.headers,
      body: a.body,
      evidence: ev,
      note: "token-endpoint client_credentials grant",
      timeoutMs: 25000,
    })
    last = { status: r.status, text: r.text }

    if (r.ok && r.json?.access_token) {
      return {
        method: "token_endpoint_grant",
        checked_url: tokenEndpoint,
        status: r.status,
        invalid_client: false,
        result: `proved: the platform issued an access token for this client (HTTP ${r.status})`,
      }
    }
    const err = String(r.json?.error ?? "")
    if (err === "invalid_client" || err === "unauthorized_client") {
      return {
        method: "token_endpoint_grant",
        checked_url: tokenEndpoint,
        status: r.status,
        invalid_client: true,
        result: `rejected: the platform refused this client (${err})`,
      }
    }
  }

  // unsupported_grant_type and friends say nothing about the credential.
  return {
    method: "token_endpoint_grant",
    checked_url: tokenEndpoint,
    status: last.status,
    invalid_client: false,
    result: `inconclusive: the token endpoint neither issued a token nor rejected the client (HTTP ${last.status})`,
  }
}
