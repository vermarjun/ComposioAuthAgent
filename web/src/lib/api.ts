import type { Health, NewRun, RunState, RunSummary, Session } from "./types"

/** Thrown for any non-2xx. Callers switch on `status`; 401 means the session
 *  died underneath us and the app must fall back to the gate. */
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = "ApiError"
  }
}

/**
 * Fixed messages by status. A failing response body is never rendered: a
 * static host, a proxy or a captive portal will happily return an HTML error
 * page, and echoing it puts markup and paths on screen instead of an answer.
 */
const MESSAGE: Record<number, string> = {
  401: "Session expired",
  403: "Not permitted",
  429: "Too many attempts",
}

const messageFor = (status: number) =>
  MESSAGE[status] ?? (status >= 500 ? "Control plane error" : "Request failed")

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      ...init,
    })
  } catch {
    throw new ApiError(0, "API unreachable")
  }

  const isJson = (res.headers.get("content-type") ?? "").includes("application/json")
  const text = await res.text()
  let body: any = null
  if (isJson && text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }

  // Anything that is not JSON did not come from the control plane: a static
  // host, the SPA fallback, a proxy error page. The status is still carried so
  // a bare 401 bounces to the gate, but the body never reaches the screen.
  if (!isJson) throw new ApiError(res.status, "API unreachable")

  if (!res.ok) {
    // Auth-shaped failures get fixed wording; for the rest the control plane's
    // own `error` is more useful, as long as it is a sentence and not a page.
    const own = typeof body?.error === "string" && body.error.length <= 200
    throw new ApiError(res.status, MESSAGE[res.status] ?? (own ? body.error : messageFor(res.status)))
  }

  return body as T
}

export const api = {
  session: () => req<Session>("/api/session"),
  login: (password: string) =>
    req<{ ok: true }>("/api/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => req<{ ok: true }>("/api/logout", { method: "POST" }),
  health: () => req<Health>("/api/health"),
  runs: () => req<RunSummary[]>("/api/runs"),
  run: (id: string) => req<RunState>(`/api/runs/${id}`),
  startRun: (input: NewRun) =>
    req<{ run_id: string; status: string }>("/api/runs", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  abort: (id: string) => req<{ ok: true }>(`/api/runs/${id}/abort`, { method: "POST" }),
}
