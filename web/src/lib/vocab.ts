import type { LogEntry, PacketStatus, Path, RunState } from "./types"

/** One colour per outcome, fixed across every surface. */
export type Tone = "ok" | "info" | "warn" | "bad" | "neutral"

export const STATUS_TONE: Record<PacketStatus, Tone> = {
  credentials_obtained: "ok",
  no_app_required: "info",
  draft_ready: "warn",
  outreach_queued: "warn",
  blocked: "bad",
}

export const STATUS_LABEL: Record<PacketStatus, string> = {
  credentials_obtained: "credentials obtained",
  no_app_required: "no app required",
  draft_ready: "draft ready",
  outreach_queued: "outreach queued",
  blocked: "blocked",
}

export const PATH_LABEL: Record<Path, string> = {
  none_needed: "none needed",
  dcr: "dynamic client registration",
  self_serve: "self-serve portal",
  form: "application form",
  relationship: "partner relationship",
  not_buildable: "not buildable",
}

export const toneClass: Record<Tone, string> = {
  ok: "text-ok border-border bg-secondary",
  info: "text-info border-border bg-secondary",
  warn: "text-warn border-border bg-secondary",
  bad: "text-bad border-border bg-secondary",
  neutral: "text-ink-secondary border-border bg-secondary",
}

export const toneDot: Record<Tone, string> = {
  ok: "bg-ok",
  info: "bg-info",
  warn: "bg-warn",
  bad: "bg-bad",
  neutral: "bg-muted-foreground",
}

export const runTone = (s: RunState["status"]): Tone =>
  s === "done" ? "ok" : s === "error" ? "bad" : s === "running" ? "warn" : "neutral"

/** Log kinds the agent actually emits, and how each one reads. */
export const KIND_TONE: Record<string, Tone> = {
  system: "neutral",
  evidence: "info",
  registration: "ok",
  browser: "warn",
  screenshot: "info",
  verification: "ok",
  captcha: "warn",
  mail: "info",
  operator: "warn",
  failed: "bad",
}

export const STAGES = [
  "Catalog lookup",
  "Discovery",
  "Acquisition",
  "Verification",
  "Packet",
] as const

const KIND_STAGE: Record<string, number> = {
  system: 0,
  evidence: 1,
  registration: 2,
  browser: 2,
  screenshot: 2,
  captcha: 2,
  verification: 3,
  mail: 2,
  operator: 2,
  failed: 2,
}

/**
 * Which pipeline stage the run has actually reached, read off the log rather
 * than off a timer. The text check is a fallback for older runs, recorded
 * before the verify tool logged under its own kind.
 */
export function stageOf(run: RunState | null): number {
  if (!run) return 0
  if (run.packet || run.status === "done") return STAGES.length - 1
  let stage = 0
  for (const e of run.log ?? []) {
    stage = Math.max(stage, KIND_STAGE[e.kind] ?? 0)
    if (/verif|invalid_client|token exchange/i.test(e.text)) stage = Math.max(stage, 3)
  }
  return stage
}

export const clock = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString([], { hour12: false })
}

export const stamp = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

export const lineOf = (e: LogEntry) => `${clock(e.at)}  ${e.kind.padEnd(12)}  ${e.text}`
