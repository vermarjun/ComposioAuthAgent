import { useState } from "react"
import { ImageOff } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/origin-ui-dialog"

/** Artifacts can expire (signed S3 links, cleaned-up local runs), so a dead
 *  image has to say so rather than leaving an empty frame. */
export function Shot({ src, index }: { src: string; index: number }) {
  const [broken, setBroken] = useState(false)
  const name = src.split("/").pop() ?? src

  return (
    <Dialog>
      <DialogTrigger
        disabled={broken}
        className="group overflow-hidden rounded-md border border-border bg-secondary text-left disabled:cursor-default"
      >
        {broken ? (
          <span className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-1.5 text-ink-secondary">
            <ImageOff className="size-4" aria-hidden />
            <span className="text-[11px]">image unavailable</span>
          </span>
        ) : (
          <img
            src={src}
            alt={`Screenshot ${index + 1}`}
            loading="lazy"
            onError={() => setBroken(true)}
            className="aspect-[16/10] w-full object-cover object-top transition-opacity group-hover:opacity-80"
          />
        )}
        <span className="block truncate border-t border-border px-2 py-1 font-mono text-[11px] text-ink-secondary">
          {name}
        </span>
      </DialogTrigger>
      <DialogContent className="max-w-5xl sm:max-w-5xl">
        <DialogTitle className="font-mono text-[12.5px] break-all">{src}</DialogTitle>
        <img src={src} alt={`Screenshot ${index + 1}`} className="w-full rounded-md" />
      </DialogContent>
    </Dialog>
  )
}
