/**
 * RFC 7591 dynamic client registration. This is the only path in the whole
 * system that ends with a real client_secret and no human in the loop.
 */

import { Evidence, req } from "./http.ts"

export type ClientMetadata = {
  client_name: string
  redirect_uris: string[]
  client_uri?: string
  logo_uri?: string
  contacts?: string[]
  scope?: string
  grant_types?: string[]
  response_types?: string[]
  token_endpoint_auth_method?: string
  software_id?: string
}

export type RegistrationResult = {
  ok: boolean
  status: number | null
  client_id: string | null
  client_secret: string | null
  client_id_issued_at: number | null
  client_secret_expires_at: number | null
  registration_access_token: string | null
  registration_client_uri: string | null
  scope: string | null
  error: string | null
  /** Set when a field had to be removed for the server to accept the body. */
  dropped_fields?: (keyof ClientMetadata)[]
  raw: any
}

export function defaultClientMetadata(overrides: Partial<ClientMetadata> = {}): ClientMetadata {
  const redirect =
    process.env.OAUTH_REDIRECT_URI ?? "https://backend.composio.dev/api/v1/auth-apps/add"
  return {
    client_name: process.env.APPLICANT_APP_NAME ?? "Composio",
    redirect_uris: [redirect],
    client_uri: process.env.APPLICANT_HOMEPAGE ?? "https://composio.dev",
    contacts: [process.env.APPLICANT_CONTACT_EMAIL ?? "support@composio.dev"].filter(Boolean),
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
    ...overrides,
  }
}

/**
 * Fields a server may reject outright, in the order worth dropping.
 *
 * RFC 7591 says a server ignores metadata it does not understand. Airtable does
 * not: it answers "Request body does not match the expected schema" for
 * token_endpoint_auth_method and returns 201 the moment it is omitted. Rather
 * than guess per-platform, a schema rejection retries with the likely offender
 * removed.
 */
const OPTIONAL_FIELDS: (keyof ClientMetadata)[] = [
  "token_endpoint_auth_method",
  "logo_uri",
  "contacts",
  "software_id",
  "scope",
]

const SCHEMA_REJECTION = /does not match the expected schema|invalid_client_metadata|unrecognized|unknown field|not allowed|unexpected propert/i

export async function registerClient(
  registrationEndpoint: string,
  metadata: ClientMetadata,
  ev: Evidence,
): Promise<RegistrationResult> {
  let attempt = await postRegistration(registrationEndpoint, metadata, ev)

  // Peel optional fields off one at a time while the server keeps complaining
  // about the shape of the body.
  const trimmed: ClientMetadata = { ...metadata }
  for (const field of OPTIONAL_FIELDS) {
    if (attempt.ok || !attempt.error || !SCHEMA_REJECTION.test(attempt.error)) break
    if (!(field in trimmed)) continue
    delete trimmed[field]
    attempt = await postRegistration(registrationEndpoint, trimmed, ev)
    if (attempt.ok) {
      attempt.dropped_fields = OPTIONAL_FIELDS.filter((f) => f in metadata && !(f in trimmed))
    }
  }
  return attempt
}

async function postRegistration(
  registrationEndpoint: string,
  metadata: ClientMetadata,
  ev: Evidence,
): Promise<RegistrationResult> {
  const r = await req(registrationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(metadata),
    evidence: ev,
    note: "RFC 7591 client registration",
    timeoutMs: 25000,
  })

  const j = r.json ?? {}
  // Spec says 201; several real servers answer 200.
  const ok = (r.status === 201 || r.status === 200) && !!j.client_id

  return {
    ok,
    status: r.status,
    client_id: j.client_id ?? null,
    client_secret: j.client_secret ?? null,
    client_id_issued_at: j.client_id_issued_at ?? null,
    client_secret_expires_at: j.client_secret_expires_at ?? null,
    registration_access_token: j.registration_access_token ?? null,
    registration_client_uri: j.registration_client_uri ?? null,
    scope: j.scope ?? null,
    // Servers disagree on where the reason lives, and reading only two keys
    // degraded real answers to a bare "HTTP 400". Typeform returns
    // {description: "redirect_uri domain not allowed: ..."} and Brevo returns
    // {detail: "... must be a loopback address"} — both were being discarded,
    // so the agent could not tell a redirect-URI problem from a dead endpoint
    // and reported needs_operator_account without ever trying the portal.
    error: ok
      ? null
      : j.error_description ?? j.error ?? j.description ?? j.detail ?? j.message ??
        (typeof j.errors?.[0] === "string" ? j.errors[0] : j.errors?.[0]?.message) ??
        r.error ?? (r.text ? r.text.slice(0, 300) : `HTTP ${r.status}`),
    raw: j,
  }
}
