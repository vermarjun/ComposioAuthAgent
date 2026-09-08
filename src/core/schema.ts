/**
 * The contract. Agent #3 consumes `composio_auth_config` verbatim; the eval
 * grades `auth.scheme` and `acquisition.path`. Everything is a closed
 * vocabulary so a run is gradeable rather than merely readable.
 */

export const PATHS = ["none_needed", "dcr", "self_serve", "form", "relationship", "not_buildable"] as const
export type Path = (typeof PATHS)[number]

export const STATUSES = [
  "credentials_obtained",
  "no_app_required",
  "draft_ready",
  "outreach_queued",
  "blocked",
] as const
export type Status = (typeof STATUSES)[number]

export const BLOCKED_REASONS = [
  "needs_operator_account",
  "email_verification_required",
  "mfa_required",
  "captcha_blocked",
  "application_form_required",
  "redirect_uri_not_allowed",
  "sms_verification_required",
  "identity_verification_required",
  "public_client_only",
  "partner_program_required",
  "security_review_required",
  "paid_tier_required",
  "per_tenant_only",
  "no_public_api",
  "tos_prohibits",
  "deprecated",
  "discovery_failed",
] as const
export type BlockedReason = (typeof BLOCKED_REASONS)[number]

/** Mirrors Composio's own auth_schemes vocabulary (pulled from their v3 API). */
export const SCHEMES = [
  "OAUTH2",
  "DCR_OAUTH",
  "S2S_OAUTH2",
  "OAUTH1",
  "API_KEY",
  "BEARER_TOKEN",
  "BASIC",
  "BASIC_WITH_JWT",
  "NO_AUTH",
  "GOOGLE_SERVICE_ACCOUNT",
  "SAML",
  "UNKNOWN",
] as const
export type Scheme = (typeof SCHEMES)[number]

/** Schemes where no developer app exists and none ever will. */
export const USER_CREDENTIAL_SCHEMES: Scheme[] = [
  "API_KEY",
  "BEARER_TOKEN",
  "BASIC",
  "BASIC_WITH_JWT",
  "NO_AUTH",
]

/**
 * What kind of thing is in the way.
 *
 * Every blocked run used to look equally final, which is useless to whoever
 * reads it: "buy a CAPTCHA key" and "a person at Binance must approve you" are
 * not the same problem and do not go to the same team. The class is derived
 * from the reason, never reported by the agent.
 */
export const BLOCKER_CLASSES = ["config", "capability", "commercial", "human", "structural"] as const
export type BlockerClass = (typeof BLOCKER_CLASSES)[number]

const BLOCKER_CLASS: Record<BlockedReason, { klass: BlockerClass; unblocks: string }> = {
  needs_operator_account:        { klass: "config",     unblocks: "Put an operator account for this platform in the vault." },
  // Worded for both causes. An audit caught this claiming the key was missing
  // when it was configured and working, and the real problem was the plan's
  // inbox cap — which sent the reader to check the wrong thing.
  email_verification_required:   { klass: "config",     unblocks: "Give the agent a mailbox it can read: set AGENTMAIL_API_KEY if unset, or raise the plan's inbox limit if it is already configured." },
  // Deliberately "capability", not "config". A solver key clears reCAPTCHA v2
  // and Turnstile reliably; reCAPTCHA Enterprise and v3 score behaviour rather
  // than posing a puzzle, and no solver clears those dependably. Filing both
  // under config would promise an afternoon's work for something that is
  // sometimes not solvable at all.
  captcha_blocked:               { klass: "capability", unblocks: "A solver key (CAPSOLVER_API_KEY) clears reCAPTCHA v2 and Turnstile. reCAPTCHA Enterprise and v3 score behaviour and are not reliably solvable — those need a different route in, or a human." },
  redirect_uri_not_allowed:      { klass: "human",      unblocks: "Ask the platform to allowlist Composio's redirect URI, then retry registration." },
  mfa_required:                  { klass: "capability", unblocks: "Store the account's TOTP seed. Push-approval factors are device-bound and cannot be automated." },
  sms_verification_required:     { klass: "capability", unblocks: "Attach a real phone number the agent can read, e.g. a Twilio number." },
  identity_verification_required:{ klass: "structural", unblocks: "Requires a person's identity documents. Out of scope, and should stay that way." },
  // Airtable is the worked example: its registration endpoint only ever issues
  // public clients, and no retry produces a secret. A confidential client needs
  // the portal, which is a different route entirely.
  public_client_only:            { klass: "human",      unblocks: "This registration endpoint only issues public clients, so no secret exists to fetch. A confidential client has to be created in the platform's portal by a person." },
  paid_tier_required:            { klass: "commercial", unblocks: "Someone has to pay for the plan that exposes API access." },
  application_form_required:     { klass: "human",      unblocks: "A person submits the access request and waits on the queue." },
  partner_program_required:      { klass: "human",      unblocks: "A person at the platform has to approve a partnership. No browser gets through this." },
  security_review_required:      { klass: "human",      unblocks: "A review someone at the platform must pass you through." },
  per_tenant_only:               { klass: "structural", unblocks: "The app is registered inside each customer's own instance; no single global credential can exist." },
  no_public_api:                 { klass: "structural", unblocks: "Nothing to build against." },
  tos_prohibits:                 { klass: "structural", unblocks: "Closed by the platform's terms, not by a technical gate." },
  deprecated:                    { klass: "structural", unblocks: "The access this needed has been withdrawn." },
  discovery_failed:              { klass: "config",     unblocks: "Re-run; nothing conclusive was found about this platform." },
}

export function classify(reason: BlockedReason | null): { blocker_class: BlockerClass | null; unblocked_by: string | null } {
  if (!reason) return { blocker_class: null, unblocked_by: null }
  const hit = BLOCKER_CLASS[reason]
  return hit ? { blocker_class: hit.klass, unblocked_by: hit.unblocks } : { blocker_class: null, unblocked_by: null }
}

export type Packet = {
  run_id: string
  platform: string
  resolved: {
    origin: string | null
    homepage: string | null
    developer_docs: string | null
    registration_url: string | null
    already_in_composio: boolean
    composio_slug: string | null
    composio_managed: boolean
  }
  auth: {
    scheme: Scheme
    alternatives: Scheme[]
    authorization_endpoint: string | null
    token_endpoint: string | null
    registration_endpoint: string | null
    scopes_requested: string[]
    connect_time_fields: string[]
  }
  acquisition: {
    path: Path
    status: Status
    blocked_reason: BlockedReason | null
    human_action_required: string | null
    /** Derived from blocked_reason. Says what kind of thing is in the way. */
    blocker_class: BlockerClass | null
    /** Derived. The one change that would move this run forward. */
    unblocked_by: string | null
    form_draft: Record<string, string> | null
    outreach_draft: { to: string | null; subject: string; body: string } | null
    screenshots: string[]
    live_view_url: string | null
  }
  composio_auth_config: {
    toolkit: string
    auth_scheme: Scheme
    credentials: Record<string, string>
  } | null
  verification: {
    method: string | null
    result: string | null
    invalid_client: boolean | null
    checked_at: string | null
  }
  oracles: {
    composio_scheme: Scheme | null
    nango_auth_mode: string | null
    agreement: "agree" | "disagree" | "no_oracle" | null
  }
  evidence: string[]
  confidence: number
  notes: string | null
  created_at: string
  completed_at: string | null
}

export function emptyPacket(run_id: string, platform: string): Packet {
  return {
    run_id,
    platform,
    resolved: {
      origin: null,
      homepage: null,
      developer_docs: null,
      registration_url: null,
      already_in_composio: false,
      composio_slug: null,
      composio_managed: false,
    },
    auth: {
      scheme: "UNKNOWN",
      alternatives: [],
      authorization_endpoint: null,
      token_endpoint: null,
      registration_endpoint: null,
      scopes_requested: [],
      connect_time_fields: [],
    },
    acquisition: {
      path: "not_buildable",
      status: "blocked",
      // Deliberately null rather than a pessimistic guess. A seeded reason
      // silently passes validation when the agent omits the field, and the
      // packet then carries a confident, wrong diagnosis — Xero came back
      // "discovery_failed" when the agent had in fact found the login wall.
      blocked_reason: null,
      human_action_required: null,
      blocker_class: null,
      unblocked_by: null,
      form_draft: null,
      outreach_draft: null,
      screenshots: [],
      live_view_url: null,
    },
    composio_auth_config: null,
    verification: { method: null, result: null, invalid_client: null, checked_at: null },
    oracles: { composio_scheme: null, nango_auth_mode: null, agreement: null },
    evidence: [],
    confidence: 0,
    notes: null,
    created_at: new Date().toISOString(),
    completed_at: null,
  }
}

export type ValidationError = { field: string; message: string }

/**
 * Deliberately strict. `emit_packet` rejects on any error and hands the list
 * back to the model, which is how the agent is forced into the vocabulary
 * instead of inventing adjacent words.
 */
export function validatePacket(p: any): ValidationError[] {
  const errs: ValidationError[] = []
  const need = (cond: boolean, field: string, message: string) => {
    if (!cond) errs.push({ field, message })
  }

  need(typeof p?.platform === "string" && p.platform.length > 0, "platform", "required")
  need(PATHS.includes(p?.acquisition?.path), "acquisition.path", `must be one of: ${PATHS.join(", ")}`)
  need(STATUSES.includes(p?.acquisition?.status), "acquisition.status", `must be one of: ${STATUSES.join(", ")}`)
  need(SCHEMES.includes(p?.auth?.scheme), "auth.scheme", `must be one of: ${SCHEMES.join(", ")}`)

  const br = p?.acquisition?.blocked_reason
  need(br === null || br === undefined || BLOCKED_REASONS.includes(br), "acquisition.blocked_reason",
    `must be null or one of: ${BLOCKED_REASONS.join(", ")}`)

  if (p?.acquisition?.status === "blocked") {
    need(!!br, "acquisition.blocked_reason", "required when status is blocked")
    need(typeof p?.acquisition?.human_action_required === "string" && p.acquisition.human_action_required.length > 10,
      "acquisition.human_action_required", "required when status is blocked: say what a human must actually do")
  }

  if (p?.acquisition?.status !== "blocked" && br) {
    errs.push({
      field: "acquisition.blocked_reason",
      message: `must be null unless status is blocked (status is ${p?.acquisition?.status})`,
    })
  }

  if (p?.acquisition?.path === "none_needed" && p?.acquisition?.status !== "no_app_required") {
    errs.push({
      field: "acquisition.status",
      message: "path none_needed means there is no developer app to obtain, so status must be no_app_required",
    })
  }

  if (p?.acquisition?.status === "credentials_obtained") {
    const c = p?.composio_auth_config?.credentials
    need(typeof c?.client_id === "string" && c.client_id.length > 0,
      "composio_auth_config.credentials.client_id",
      "required when status is credentials_obtained, and must be a non-empty string")
    need(p?.verification?.invalid_client === false, "verification.invalid_client",
      "credentials must be verified before claiming they were obtained")
  }

  // The single most important guard: never invent a secret for a scheme that
  // has none. Matching only the exact key `client_secret` let the same value
  // through as `clientSecret`, `app_secret` or `consumerSecret`, so every
  // credential key is checked by shape.
  // The payload agent #3 consumes carries its own auth_scheme. It was never
  // validated nor compared to auth.scheme, so a packet claiming OAUTH2 at the
  // top could hand agent #3 an API_KEY config with a fabricated secret in it.
  const configScheme = p?.composio_auth_config?.auth_scheme
  if (configScheme !== undefined && configScheme !== null) {
    need(SCHEMES.includes(configScheme), "composio_auth_config.auth_scheme",
      `must be one of: ${SCHEMES.join(", ")}`)
  }

  // Both schemes are checked, because a mismatch is exactly how a secret slips
  // past a guard that only reads one of them.
  const guarded = [p?.auth?.scheme, configScheme].filter(
    (x) => x && USER_CREDENTIAL_SCHEMES.includes(x),
  )
  if (guarded.length) {
    const creds = p?.composio_auth_config?.credentials
    const secretish = /(^|[_-]?)(client|app|consumer|oauth)?[_-]?secret$/i
    for (const key of Object.keys(creds ?? {})) {
      const normalised = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
      if (secretish.test(normalised) && creds[key]) {
        errs.push({
          field: `composio_auth_config.credentials.${key}`,
          message: `scheme ${guarded[0]} has no developer app and therefore no secret; use path none_needed`,
        })
      }
    }
  }

  need(Array.isArray(p?.evidence) && p.evidence.length > 0, "evidence",
    "at least one URL that was actually fetched")
  need(typeof p?.confidence === "number" && p.confidence >= 0 && p.confidence <= 1, "confidence", "0..1")

  return errs
}
