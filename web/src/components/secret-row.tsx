import { useState } from "react"
import { Eye, EyeOff } from "lucide-react"

import { Button } from "@/components/ui/button"
import { CopyButton } from "@/components/primitives"

/** Secrets are masked on every render. Reveal is per-value and never sticky. */
export function SecretRow({ name, value }: { name: string; value: string }) {
  const [shown, setShown] = useState(false)
  const secret = /secret|token|password|key/i.test(name)
  const masked = "•".repeat(Math.min(Math.max(value.length, 12), 40))

  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-1 border-b border-border/60 py-2 last:border-b-0 sm:grid-cols-[minmax(10rem,auto)_1fr_auto] sm:items-center">
      <span className="font-mono text-[12px] text-ink-secondary">{name}</span>
      <span className="min-w-0 font-mono text-[12.5px] break-all">
        {secret && !shown ? (
          <span className="text-ink-secondary select-none">{masked}</span>
        ) : (
          value
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {secret && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShown((v) => !v)}
            className="h-7 gap-1.5 px-2 text-[11px]"
          >
            {shown ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
            {shown ? "Hide" : "Reveal"}
          </Button>
        )}
        <CopyButton value={value} />
      </span>
    </div>
  )
}
