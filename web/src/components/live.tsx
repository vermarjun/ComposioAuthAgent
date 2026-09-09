import { useEffect, useRef } from "react"
import { AlertTriangle, Radio, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { AnimatedSpan, Terminal } from "@/components/ui/magic-ui-terminal"
import { KIND_TONE, STAGES, clock, stageOf, toneClass } from "@/lib/vocab"
import type { RunState } from "@/lib/types"
import { cn } from "@/lib/utils"

const TAIL = 300

export function LivePanel({
  run,
  onAbort,
  aborting,
}: {
  run: RunState
  onAbort: () => void
  aborting: boolean
}) {
  const scroller = useRef<HTMLDivElement | null>(null)
  const active = run.status === "queued" || run.status === "running"
  const stage = stageOf(run)
  const entries = (run.log ?? []).slice(-TAIL)

  useEffect(() => {
    const element = scroller.current
    if (element) element.scrollTop = element.scrollHeight
  }, [entries.length])

  return (
    <div className="flex flex-col gap-3">
      {run.from_cache && (
        <div className="flex items-start gap-2.5 rounded-xl border border-border border-l-2 border-l-warn bg-card px-4 py-3 shadow-card">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-warn">This result is from a previous run.</p>
            <p className="mt-0.5 font-mono text-[11.5px] text-ink-secondary">
              replayed from {run.from_cache.run_id}
            </p>
          </div>
        </div>
      )}

      {run.live_view_url && (
        <a
          href={run.live_view_url}
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-center justify-between gap-3 rounded-xl bg-card px-4 py-3 shadow-card ring-1 ring-white/[0.06] transition-colors hover:bg-composer"
        >
          <span className="flex items-center gap-2.5">
            <Radio className="size-4 shrink-0 text-info" aria-hidden />
            <span className="text-[13px] font-medium text-foreground">Watch browser live</span>
          </span>
          <span className="hidden truncate font-mono text-[11px] text-ink-secondary sm:block">
            {run.live_view_url}
          </span>
        </a>
      )}

      <section className="overflow-hidden rounded-2xl bg-card shadow-card ring-1 ring-white/[0.06]">
        <header className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              active ? "animate-pulse bg-warn" : run.status === "error" ? "bg-bad" : "bg-ok",
            )}
            aria-hidden
          />
          <h2 className="text-[12.5px] font-medium">Run activity</h2>
          <span className="text-[11.5px] text-ink-secondary">
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </span>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-[11.5px] text-ink-secondary sm:inline">
              {STAGES[stage]} · {Math.min(stage + 1, STAGES.length)}/{STAGES.length}
            </span>
            {active && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onAbort}
                disabled={aborting}
                className="h-7 gap-1.5 px-2 text-[11px] text-ink-secondary hover:text-bad"
              >
                <Square className="size-3" aria-hidden />
                {aborting ? "Aborting" : "Abort"}
              </Button>
            )}
          </div>
        </header>

        <div
          ref={scroller}
          role="log"
          aria-live="polite"
          aria-label="Run activity log"
          tabIndex={0}
          className="thin-scroll h-[420px] overflow-y-auto bg-background"
        >
          <Terminal
            sequence={false}
            className="h-auto max-h-none w-full max-w-none border-0 bg-transparent [&>div:first-child]:hidden [&_code]:overflow-visible [&_pre]:p-4"
          >
            {entries.length === 0 ? (
              <AnimatedSpan startOnView={false} className="text-ink-secondary">
                <span>waiting for the agent to emit its first line…</span>
              </AnimatedSpan>
            ) : (
              entries.map((entry, index) => (
                <AnimatedSpan
                  key={`${entry.at}-${index}`}
                  startOnView={false}
                  className="grid grid-cols-[3.5rem_1fr] gap-x-2 font-mono text-[12px] leading-5 sm:grid-cols-[3.5rem_5.25rem_1fr]"
                >
                  <span className="text-ink-secondary">{clock(entry.at)}</span>
                  <span
                    className={cn(
                      "truncate",
                      toneClass[KIND_TONE[entry.kind] ?? "neutral"].split(" ")[0],
                    )}
                  >
                    {entry.kind}
                  </span>
                  <span className="col-span-2 mt-0.5 whitespace-pre-wrap break-words text-foreground sm:col-span-1 sm:mt-0 sm:break-all">
                    {entry.text}
                  </span>
                </AnimatedSpan>
              ))
            )}
          </Terminal>
        </div>
      </section>
    </div>
  )
}
