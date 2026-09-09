import {
  KeyRound,
  LogOut,
  PanelLeftClose,
  SquarePen,
} from "lucide-react"

import { History } from "@/components/history"
import { Button } from "@/components/ui/button"
import type { Health, RunSummary } from "@/lib/types"
import { cn } from "@/lib/utils"

export function Sidebar({
  open,
  runs,
  loading,
  error,
  activeId,
  health,
  healthError,
  authRequired,
  onClose,
  onNew,
  onOpen,
  onRefresh,
  onLogout,
}: {
  open: boolean
  runs: RunSummary[]
  loading: boolean
  error: string | null
  activeId: string | null
  health: Health | null
  healthError: string | null
  authRequired: boolean
  onClose: () => void
  onNew: () => void
  onOpen: (id: string) => void
  onRefresh: () => void
  onLogout: () => void
}) {
  const ready = Boolean(health?.ok) && !healthError

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px] transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r border-border bg-background transition-transform duration-200 ease-out lg:translate-x-0",
          open ? "visible translate-x-0" : "invisible -translate-x-full lg:visible",
        )}
        aria-label="Application sidebar"
      >
        <div className="flex h-16 items-center gap-2 px-3">
          <div className="flex min-w-0 flex-1 items-center gap-2.5 px-2">
            <span
              className="grid size-7 shrink-0 place-items-center rounded-lg bg-composer text-foreground"
              aria-hidden
            >
              <KeyRound className="size-3.5" />
            </span>
            <span className="truncate text-[14px] font-semibold tracking-[-0.015em]">
              Auth Acquisition
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="size-8 lg:hidden"
            aria-label="Close sidebar"
          >
            <PanelLeftClose className="size-4" />
          </Button>
        </div>

        <div className="px-2 pb-5">
          <Button
            type="button"
            variant="ghost"
            onClick={onNew}
            className="h-11 w-full justify-start gap-3 rounded-xl bg-surface-active px-3 text-[14px] font-medium hover:bg-secondary"
          >
            <SquarePen className="size-[18px] text-foreground" aria-hidden />
            New run
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-9 items-center justify-between px-5">
            <p className="text-[12px] font-medium text-ink-secondary">Previous chats</p>
            {loading && (
              <span className="size-1.5 animate-pulse rounded-full bg-info" aria-label="Loading" />
            )}
          </div>
          <History
            runs={runs}
            loading={loading}
            error={error}
            activeId={activeId}
            onOpen={onOpen}
            onRefresh={onRefresh}
          />
        </div>

        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-ink-secondary">
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                healthError ? "bg-bad" : ready ? "bg-ok" : "animate-pulse bg-warn",
              )}
              aria-hidden
            />
            <span>{healthError ? "System unavailable" : ready ? "System ready" : "Checking system"}</span>
          </div>
          {authRequired && (
            <Button
              type="button"
              variant="ghost"
              onClick={onLogout}
              className="h-9 w-full justify-start gap-3 rounded-md px-3 text-[12.5px] font-normal text-ink-secondary"
            >
              <LogOut className="size-3.5" aria-hidden />
              Log out
            </Button>
          )}
        </div>
      </aside>
    </>
  )
}
