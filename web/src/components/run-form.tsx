import { useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { ArrowUp } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { NewRun } from "@/lib/types"

export function RunForm({
  busy,
  onStart,
}: {
  busy: boolean
  onStart: (input: NewRun) => void
}) {
  const [platform, setPlatform] = useState("")
  const field = useRef<HTMLTextAreaElement>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    const name = platform.trim()
    if (!name || busy) {
      field.current?.focus()
      return
    }
    onStart({ platform: name })
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      e.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-[800px]" aria-label="Start a new run">
      <div className="flex min-h-[126px] flex-col rounded-[28px] bg-composer px-4 pb-3 pt-4 shadow-card ring-1 ring-white/[0.04] transition-shadow focus-within:ring-white/[0.10]">
        <textarea
          ref={field}
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter a platform name"
          aria-label="Platform name"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          rows={2}
          className="min-h-0 flex-1 resize-none border-0 bg-transparent px-1 text-[16px] leading-6 text-foreground outline-none placeholder:text-ink-secondary disabled:cursor-not-allowed"
        />
        <div className="flex items-center justify-end">
          <Button
            type="submit"
            size="icon"
            disabled={busy || !platform.trim()}
            className="size-9 shrink-0 rounded-full bg-foreground text-background shadow-none hover:bg-white"
            aria-label="Start run"
          >
            <ArrowUp className="size-[18px] stroke-[2.4]" aria-hidden />
          </Button>
        </div>
      </div>
    </form>
  )
}
