/**
 * opencode as the agent runtime.
 *
 * It is spawned as a child of this process and spoken to over its HTTP API.
 * Runs are started with prompt_async and never awaited inline: App Runner caps
 * a request at 120 seconds and an acquisition run is minutes long, so the
 * control plane hands back a run_id immediately and the frontend polls.
 */

import { spawn, type ChildProcess } from "node:child_process"

const PORT = Number(process.env.OPENCODE_PORT ?? 4096)
export const BASE = `http://127.0.0.1:${PORT}`

let child: ChildProcess | null = null

async function ping(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/doc`, { signal: AbortSignal.timeout(2000) })
    return r.ok
  } catch {
    return false
  }
}

let supervising = false
let stopping = false

/**
 * Restart the agent runtime if it dies.
 *
 * Without this the control plane stays healthy while every run fails, because
 * /api/health only reports on itself. That is a worse failure than being down:
 * it looks like the agent is broken rather than absent.
 */
function supervise(cwd: string): void {
  if (supervising) return
  supervising = true
  setInterval(async () => {
    if (stopping || (await ping())) return
    console.error("[opencode] not answering; restarting")
    try {
      child?.kill("SIGKILL")
    } catch {}
    child = null
    await launch(cwd)
  }, 15000).unref?.()
}

function launch(cwd: string): Promise<void> {
  child = spawn("opencode", ["serve", "--port", String(PORT), "--hostname", "127.0.0.1"], {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  child.stdout?.on("data", (d) => process.stdout.write(`[opencode] ${d}`))
  child.stderr?.on("data", (d) => process.stderr.write(`[opencode] ${d}`))
  child.on("exit", (c) => {
    if (!stopping) console.error(`[opencode] exited with ${c}; supervisor will restart it`)
  })
  return waitReady()
}

async function waitReady(): Promise<void> {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    if (await ping()) {
      console.log("[opencode] ready on", BASE)
      return
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error("opencode server did not become ready within 60s")
}

export async function start(cwd: string): Promise<void> {
  if (await ping()) {
    console.log("[opencode] reusing server already on", BASE)
    supervise(cwd)
    return
  }
  await launch(cwd)
  supervise(cwd)

}

export function stop() {
  stopping = true
  child?.kill("SIGTERM")
}

async function api(path: string, init?: RequestInit): Promise<any> {
  const r = await fetch(BASE + path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`opencode ${path} -> ${r.status}: ${text.slice(0, 300)}`)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function createSession(title: string): Promise<string> {
  const s = await api("/session", { method: "POST", body: JSON.stringify({ title }) })
  return s.id
}

export type ModelRef = { providerID: string; modelID: string }

export function model(): ModelRef {
  const raw = process.env.AGENT_MODEL ?? "xypro/gpt-5.5"
  const [providerID, ...rest] = raw.split("/")
  return { providerID: providerID!, modelID: rest.join("/") }
}

/** Fire and forget: the run continues server-side after this resolves. */
export async function promptAsync(sessionId: string, agent: string, text: string): Promise<void> {
  await api(`/session/${sessionId}/prompt_async`, {
    method: "POST",
    body: JSON.stringify({ model: model(), agent, parts: [{ type: "text", text }] }),
  })
}

export async function messages(sessionId: string): Promise<any[]> {
  return api(`/session/${sessionId}/message`)
}

/**
 * opencode records a provider failure on the assistant message and then simply
 * stops. Without this the run sits in `running` until the staleness timer,
 * which reads as a hang rather than the quota error it usually is.
 */
export async function sessionError(sessionId: string): Promise<string | null> {
  try {
    const ms = await messages(sessionId)
    for (let i = ms.length - 1; i >= 0; i--) {
      const err = ms[i]?.info?.error
      if (!err) continue
      const msg = err?.data?.message ?? err?.name ?? "provider error"
      return /does not exist or you do not have access|rate|quota|limit/i.test(String(msg))
        ? `model unavailable — ${msg}`
        : String(msg)
    }
  } catch {}
  return null
}

export async function abort(sessionId: string): Promise<void> {
  await api(`/session/${sessionId}/abort`, { method: "POST" }).catch(() => {})
}
