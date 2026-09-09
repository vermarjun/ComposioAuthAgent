import { KeyRound, LogOut } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Health } from "@/lib/types"

function Stat({
  label,
  value,
  tone,
  title,
}: {
  label: string
  value: string
  tone?: "ok" | "off" | "warn"
  title?: string
}) {
  return (
    <div
      className="flex shrink-0 items-baseline gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5"
      title={title}
    >
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-mono text-[11.5px]",
          tone === "ok" && "text-ok",
          tone === "warn" && "text-warn",
          tone === "off" && "text-muted-foreground",
          !tone && "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  )
}

export function Header({
  health,
  healthError,
  authRequired,
  onLogout,
}: {
  health: Health | null
  healthError: string | null
  authRequired: boolean
  onLogout: () => void
}) {
  const integrations = Object.entries(health?.integrations ?? {})
  const configured = integrations.filter(([, on]) => on).map(([k]) => k)
  const missing = integrations.filter(([, on]) => !on).map(([k]) => k)

  const submitMode =
    health?.acquisition_mode ??
    (health?.auto_submit === undefined ? null : health.auto_submit ? "auto-submit" : "draft only")

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-lg bg-foreground text-background shadow-sm" aria-hidden>
            <KeyRound className="size-4" />
          </span>
          <div>
            <h1 className="text-[15px] font-semibold tracking-[-0.02em]">Auth Acquisition</h1>
            <p className="text-[11.5px] text-muted-foreground">Agent control plane</p>
          </div>
        </div>

        <div className="order-3 w-full min-w-0 lg:order-none lg:w-auto lg:flex-1">
          <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
            {healthError ? (
              <span className="font-mono text-[12px] text-bad">health: {healthError}</span>
            ) : !health ? (
              <span className="font-mono text-[12px] text-muted-foreground">loading status…</span>
            ) : (
              <>
                <Stat
                  label="model"
                  value={
                    health.model ? `${health.model.providerID}/${health.model.modelID}` : "unset"
                  }
                  tone={health.model ? undefined : "off"}
                />
                <Stat label="storage" value={health.storage} />
                <Stat label="browser" value={health.browser_provider} />
                {submitMode && <Stat label="submit" value={submitMode} />}
                {health.vault_configured !== undefined && (
                  <Stat
                    label="vault"
                    value={health.vault_configured ? "configured" : "off"}
                    tone={health.vault_configured ? "ok" : "off"}
                  />
                )}
                <Stat
                  label="integrations"
                  value={`${configured.length}/${integrations.length}`}
                  tone={missing.length ? "warn" : configured.length ? "ok" : "off"}
                  title={
                    (configured.length ? `on: ${configured.join(", ")}` : "none configured") +
                    (missing.length ? ` — off: ${missing.join(", ")}` : "")
                  }
                />
              </>
            )}
          </div>
        </div>

        {authRequired && (
          <Button variant="ghost" size="sm" onClick={onLogout} className="h-8 gap-1.5 px-2">
            <LogOut className="size-3.5" aria-hidden />
            Log out
          </Button>
        )}
      </div>
    </header>
  )
}
