import { useState, type ReactNode } from "react"
import { Check, Copy, ExternalLink } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The StashUI registry has no plain card, so this is the one hand-written
 * container: a bordered panel with an optional titled header.
 */
export function Panel({
  title,
  aside,
  className,
  bodyClassName,
  children,
}: {
  title?: ReactNode
  aside?: ReactNode
  className?: string
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <section className={cn("rounded-2xl bg-card shadow-card ring-1 ring-white/[0.06]", className)}>
      {title !== undefined && (
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 className="text-[14px] font-semibold tracking-[-0.012em] text-foreground">{title}</h2>
          {aside}
        </header>
      )}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  )
}

/** Machine values: never proportional, never wrapped mid-token. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[13px] break-all", className)}>{children}</span>
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="font-mono text-[13px] text-ink-secondary">{children}</p>
}

export function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(9rem,auto)_1fr] items-baseline gap-x-4 gap-y-1 border-b border-border/60 py-2 last:border-b-0">
      <dt className="text-[13px] text-ink-secondary">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

export function Link({ href, children }: { href: string; children?: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-baseline gap-1 font-mono text-[13px] text-info underline-offset-4 hover:text-foreground hover:underline break-all"
    >
      {children ?? href}
      <ExternalLink className="size-3 shrink-0 translate-y-px" aria-hidden />
    </a>
  )
}

export function CopyButton({
  value,
  label = "Copy",
  className,
}: {
  value: string
  label?: string
  className?: string
}) {
  const [done, setDone] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Clipboard is blocked outside a secure context; fall back to a selection.
      const ta = document.createElement("textarea")
      ta.value = value
      document.body.appendChild(ta)
      ta.select()
      document.execCommand("copy")
      ta.remove()
    }
    setDone(true)
    toast.success("Copied to clipboard")
    setTimeout(() => setDone(false), 1400)
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={copy}
      className={cn("h-8 gap-1.5 px-2.5 text-[12px]", className)}
    >
      {done ? <Check className="size-3" /> : <Copy className="size-3" />}
      {label}
    </Button>
  )
}
