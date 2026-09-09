import { RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { STATUS_LABEL, STATUS_TONE, runTone, toneDot } from "@/lib/vocab"
import type { RunSummary } from "@/lib/types"
import { cn } from "@/lib/utils"

export function History({
  runs,
  loading,
  error,
  activeId,
  onOpen,
  onRefresh,
}: {
  runs: RunSummary[]
  loading: boolean
  error: string | null
  activeId: string | null
  onOpen: (id: string) => void
  onRefresh: () => void
}) {
  if (error) {
    return (
      <div className="px-3 py-2">
        <p className="px-2 text-[12px] leading-5 text-bad">Couldn’t load previous chats.</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          className="mt-1 h-8 gap-2 px-2 text-[12px] text-muted-foreground"
        >
          <RefreshCw className="size-3" aria-hidden />
          Try again
        </Button>
      </div>
    )
  }

  if (runs.length === 0) {
    return (
      <p className="px-5 py-2 text-[12px] leading-5 text-muted-foreground">
        {loading ? "Loading chats…" : "Your previous runs will appear here."}
      </p>
    )
  }

  return (
    <nav className="thin-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Previous chats">
      {runs.map((run) => {
        const tone = run.packet_status ? STATUS_TONE[run.packet_status] : runTone(run.status)
        const outcome = run.packet_status
          ? (STATUS_LABEL[run.packet_status] ?? run.packet_status)
          : run.status === "error"
            ? "failed"
            : run.status === "done"
              ? "completed"
              : run.status

        return (
          <button
            key={run.run_id}
            type="button"
            onClick={() => onOpen(run.run_id)}
            aria-current={activeId === run.run_id ? "page" : undefined}
            className={cn(
              "group mb-0.5 w-full rounded-lg px-3 py-2.5 text-left outline-none transition-colors",
              "hover:bg-surface-active focus-visible:ring-2 focus-visible:ring-ring/50",
              activeId === run.run_id && "bg-surface-active hover:bg-surface-active",
            )}
          >
            <span className="block truncate text-[13.5px] font-medium text-foreground">
              {run.platform}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <span className={cn("size-1.5 shrink-0 rounded-full", toneDot[tone])} aria-hidden />
              <span className="truncate">{outcome}</span>
            </span>
          </button>
        )
      })}
    </nav>
  )
}
