/** Mirrors src/core/schema.ts on the server. Kept literal so the UI can only
 *  colour outcomes the backend can actually emit. */

export const PATHS = [
  "none_needed",
  "dcr",
  "self_serve",
  "form",
  "relationship",
  "not_buildable",
] as const
export type Path = (typeof PATHS)[number]

export const STATUSES = [
  "credentials_obtained",
  "no_app_required",
  "draft_ready",
  "outreach_queued",
  "blocked",
] as const
export type PacketStatus = (typeof STATUSES)[number]

export type Scheme = string

export type LogEntry = {
  at: string
  /** system | evidence | registration | browser | screenshot | captcha | mail */
  kind: string
  text: string
}

export type Packet = {
  run_id?: string
  platform: string
  resolved: {
    origin: string | null
    homepage?: string | null
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
    status: PacketStatus
    blocked_reason: string | null
    human_action_required: string | null
    blocker_class: "config" | "capability" | "commercial" | "human" | "structural" | null
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
  created_at?: string
  completed_at?: string | null
}

export type RunState = {
  run_id: string
  platform: string
  status: "queued" | "running" | "done" | "error"
  session_id?: string | null
  error: string | null
  live_view_url: string | null
  from_cache?: { run_id: string; at: string } | null
  log: LogEntry[]
  packet: Packet | null
  created_at: string
  updated_at: string
  completed_at?: string
}

export type RunSummary = {
  run_id: string
  platform: string
  status: RunState["status"]
  path: Path | null
  packet_status: PacketStatus | null
  created_at: string
}

export type Health = {
  ok?: boolean
  auth_required?: boolean
  opencode?: string
  model: { providerID: string; modelID: string } | null
  storage: string
  browser_provider: string
  /** Older builds report auto_submit; newer ones report acquisition_mode. */
  auto_submit?: boolean
  acquisition_mode?: string
  vault_configured?: boolean
  integrations: Record<string, boolean>
}

export type Session = { authed: boolean; required: boolean }

export type NewRun = {
  platform: string
  homepage?: string
  docs_url?: string
  notes?: string
  applicant?: { app_name?: string; contact_email?: string; redirect_uri?: string }
}
