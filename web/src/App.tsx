import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, ChevronRight, Loader2, PanelLeft, SquarePen } from "lucide-react"
import { toast } from "sonner"

import { Gate } from "@/components/gate"
import { LivePanel } from "@/components/live"
import { ResultPanel } from "@/components/result"
import { RunForm } from "@/components/run-form"
import { Sidebar } from "@/components/sidebar"
import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/sonner"
import { ApiError, api } from "@/lib/api"
import type { Health, NewRun, RunState, RunSummary } from "@/lib/types"
import { STATUS_LABEL, STATUS_TONE, runTone, toneDot } from "@/lib/vocab"
import { cn } from "@/lib/utils"

const POLL_MS = 2500

export default function App() {
  const [phase, setPhase] = useState<"checking" | "gate" | "app">("checking")
  const [authRequired, setAuthRequired] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)

  const [health, setHealth] = useState<Health | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)

  const [runs, setRuns] = useState<RunSummary[]>([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [runsError, setRunsError] = useState<string | null>(null)

  const [run, setRun] = useState<RunState | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [pendingPlatform, setPendingPlatform] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [aborting, setAborting] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const runIdRef = useRef<string | null>(null)
  const requestRef = useRef(0)

  /** Any 401 means the cookie expired mid-session: fall back to the gate. */
  const guard = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) {
      requestRef.current += 1
      setPhase("gate")
      setRun(null)
      setSelectedRunId(null)
      setPendingPlatform(null)
      runIdRef.current = null
      return true
    }
    return false
  }, [])

  const checkSession = useCallback(async () => {
    try {
      const session = await api.session()
      setAuthRequired(session.required)
      setPhase(session.required && !session.authed ? "gate" : "app")
      setBootError(null)
    } catch (err) {
      setBootError(err instanceof Error ? err.message : "session check failed")
      setPhase("gate")
    }
  }, [])

  useEffect(() => {
    void checkSession()
  }, [checkSession])

  const loadHealth = useCallback(async () => {
    try {
      setHealth(await api.health())
      setHealthError(null)
    } catch (err) {
      if (guard(err)) return
      setHealthError(err instanceof Error ? err.message : "unavailable")
    }
  }, [guard])

  const loadRuns = useCallback(async () => {
    setRunsLoading(true)
    try {
      setRuns(await api.runs())
      setRunsError(null)
    } catch (err) {
      if (guard(err)) return
      setRunsError(err instanceof Error ? err.message : "could not load runs")
    } finally {
      setRunsLoading(false)
    }
  }, [guard])

  useEffect(() => {
    if (phase !== "app") return
    void loadHealth()
    void loadRuns()
  }, [phase, loadHealth, loadRuns])

  const openRun = useCallback(
    async (id: string) => {
      const request = ++requestRef.current
      const summary = runs.find((item) => item.run_id === id)

      runIdRef.current = id
      setSelectedRunId(id)
      setPendingPlatform(summary?.platform ?? "Loading run")
      setRun(null)
      setRunError(null)
      setStarting(false)
      setSidebarOpen(false)

      try {
        const next = await api.run(id)
        if (requestRef.current !== request || runIdRef.current !== id) return
        setRun(next)
        setPendingPlatform(next.platform)
      } catch (err) {
        if (guard(err) || requestRef.current !== request) return
        setRunError(err instanceof Error ? err.message : "could not load run")
      }
    },
    [guard, runs],
  )

  // Poll only while the selected run is live. A request that resolves after the
  // operator starts another chat is ignored via the selected run id.
  const live = run?.status === "queued" || run?.status === "running"
  useEffect(() => {
    if (phase !== "app" || !live || !run) return
    const id = run.run_id
    const timer = setInterval(async () => {
      try {
        const next = await api.run(id)
        if (runIdRef.current !== id) return
        setRun(next)
        if (next.status === "done" || next.status === "error") void loadRuns()
      } catch (err) {
        if (guard(err)) return
        setRunError(err instanceof Error ? err.message : "polling failed")
      }
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [phase, live, run, guard, loadRuns])

  async function start(input: NewRun) {
    const request = ++requestRef.current
    const platform = input.platform.trim()

    runIdRef.current = null
    setSelectedRunId(null)
    setPendingPlatform(platform)
    setRun(null)
    setRunError(null)
    setStarting(true)
    setSidebarOpen(false)

    try {
      const { run_id } = await api.startRun(input)
      if (requestRef.current !== request) return
      runIdRef.current = run_id
      setSelectedRunId(run_id)
      const next = await api.run(run_id)
      if (requestRef.current !== request || runIdRef.current !== run_id) return
      setRun(next)
      void loadRuns()
    } catch (err) {
      if (guard(err) || requestRef.current !== request) return
      const message = err instanceof Error ? err.message : "could not start the run"
      setRunError(message)
      toast.error(message)
    } finally {
      if (requestRef.current === request) setStarting(false)
    }
  }

  function newRun() {
    requestRef.current += 1
    runIdRef.current = null
    setSelectedRunId(null)
    setRun(null)
    setPendingPlatform(null)
    setRunError(null)
    setStarting(false)
    setAborting(false)
    setSidebarOpen(false)
  }

  async function abort() {
    if (!run) return
    setAborting(true)
    try {
      await api.abort(run.run_id)
      if (runIdRef.current !== run.run_id) return
      setRun(await api.run(run.run_id))
      void loadRuns()
    } catch (err) {
      if (!guard(err)) toast.error(err instanceof Error ? err.message : "abort failed")
    } finally {
      setAborting(false)
    }
  }

  async function logout() {
    try {
      await api.logout()
    } catch {
      // Logging out locally matters more than the server acknowledging it.
    }
    requestRef.current += 1
    setRun(null)
    setSelectedRunId(null)
    setPendingPlatform(null)
    runIdRef.current = null
    setPhase("gate")
  }

  if (phase === "checking") {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
      </main>
    )
  }

  if (phase === "gate") {
    return (
      <>
        {bootError && (
          <p className="fixed inset-x-0 top-0 z-50 border-b border-bad bg-card px-4 py-2 text-center font-mono text-[12px] text-bad">
            {bootError}
          </p>
        )}
        <Gate onAuthed={checkSession} />
        <Toaster position="bottom-right" theme="dark" />
      </>
    )
  }

  const platform = run?.platform ?? pendingPlatform
  const inConversation = Boolean(platform)
  const packetStatus = run?.packet?.acquisition.status
  const dashboardTone = packetStatus
    ? STATUS_TONE[packetStatus]
    : runTone(run?.status ?? "queued")
  const dashboardStatus = packetStatus
    ? (STATUS_LABEL[packetStatus] ?? packetStatus)
    : starting
      ? "starting"
      : (run?.status ?? "loading")

  return (
    <div className="min-h-dvh bg-background">
      <Sidebar
        open={sidebarOpen}
        runs={runs}
        loading={runsLoading}
        error={runsError}
        activeId={selectedRunId}
        health={health}
        healthError={healthError}
        authRequired={authRequired}
        onClose={() => setSidebarOpen(false)}
        onNew={newRun}
        onOpen={openRun}
        onRefresh={loadRuns}
        onLogout={logout}
      />

      <div className="min-h-dvh lg:pl-[260px]">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setSidebarOpen(true)}
          className="fixed left-3 top-3 z-30 size-9 bg-background/85 backdrop-blur lg:hidden"
          aria-label="Open sidebar"
        >
          <PanelLeft className="size-4" />
        </Button>

        {!inConversation ? (
          <main className="flex min-h-dvh items-center justify-center px-5 py-20 sm:px-8">
            <div className="flex w-full -translate-y-[3vh] flex-col items-center gap-7">
              <h1 className="text-center text-[28px] font-semibold tracking-[-0.035em] text-foreground sm:text-[30px]">
                What platform should we unlock?
              </h1>
              <RunForm busy={starting} onStart={start} />
            </div>
          </main>
        ) : (
          <main className="min-h-dvh">
            <header className="sticky top-0 z-20 flex h-16 items-center border-b border-border bg-background/90 px-14 backdrop-blur-xl lg:px-8">
              <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-4">
                <nav
                  className="flex min-w-0 items-center gap-2 text-[13px]"
                  aria-label="Breadcrumb"
                >
                  <span className="hidden text-muted-foreground sm:inline">Dashboard</span>
                  <ChevronRight className="hidden size-3.5 text-muted-foreground sm:block" aria-hidden />
                  <span className="truncate font-medium text-foreground">{platform}</span>
                </nav>

                <div className="flex shrink-0 items-center gap-2">
                  <span className="flex h-8 items-center gap-2 rounded-full bg-secondary px-3 text-[12px] text-ink-secondary">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        starting && "animate-pulse",
                        toneDot[dashboardTone],
                      )}
                      aria-hidden
                    />
                    <span className="capitalize">{dashboardStatus}</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={newRun}
                    className="hidden h-8 gap-2 rounded-lg px-3 text-[12px] text-ink-secondary sm:inline-flex"
                  >
                    <SquarePen className="size-3.5" aria-hidden />
                    New run
                  </Button>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={newRun}
                  className="size-8 sm:hidden"
                  aria-label="New run"
                >
                  <SquarePen className="size-4" />
                </Button>
              </div>
            </header>

            <div className="mx-auto w-full max-w-[1200px] px-5 py-8 sm:px-8 sm:py-10">
              <section className="mb-7 flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-0">
                  <p className="mb-2 text-[11px] font-semibold tracking-[0.11em] text-muted-foreground uppercase">
                    Auth acquisition run
                  </p>
                  <h1 className="truncate text-[28px] font-semibold tracking-[-0.035em] text-foreground sm:text-[32px]">
                    {platform}
                  </h1>
                  <p className="mt-1 text-[13px] text-ink-secondary">
                    Live research, registration, verification, and credential output.
                  </p>
                </div>
              </section>

              <div>
                {runError && (
                  <div
                    role="alert"
                    className="mb-4 flex items-start gap-2.5 rounded-lg border border-border border-l-2 border-l-bad bg-card px-4 py-3 shadow-card"
                  >
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />
                    <p className="text-[13px] leading-5 text-bad">{runError}</p>
                  </div>
                )}

                {!run ? (
                  <section className="overflow-hidden rounded-2xl bg-card shadow-card ring-1 ring-white/[0.06]">
                    <div className="flex h-11 items-center gap-2 border-b border-border px-4">
                      <span className="size-1.5 animate-pulse rounded-full bg-warn" aria-hidden />
                      <h2 className="text-[12.5px] font-medium">Activity</h2>
                    </div>
                    <div className="flex min-h-48 items-start gap-3 bg-secondary px-4 py-4 font-mono text-[12px] text-ink-secondary">
                      {starting && <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" aria-hidden />}
                      <span>
                        {runError
                          ? "The run could not be started. Create a new run to try again."
                          : `Starting acquisition for ${platform}…`}
                      </span>
                    </div>
                  </section>
                ) : (
                  <>
                    {run.status === "error" && run.error && (
                      <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-border border-l-2 border-l-bad bg-card px-4 py-3 shadow-card">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />
                        <p className="text-[13px] leading-5 text-bad">{run.error}</p>
                      </div>
                    )}

                    <LivePanel run={run} onAbort={abort} aborting={aborting} />

                    {run.packet && (
                      <div className="mt-4">
                        <ResultPanel packet={run.packet} />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </main>
        )}
      </div>

      <Toaster position="bottom-right" theme="dark" />
    </div>
  )
}
