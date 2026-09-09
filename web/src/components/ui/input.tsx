import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A plain themed input.
 *
 * This replaced the registry's marketing input, which wrapped the field in a
 * motion.div carrying a hardcoded `#3b82f6` hover gradient and `bg-gray-50
 * text-black`. Two things were wrong with it here: the colours ignored the
 * paper/ink theme, so the field read as a cold grey hole in a warm panel, and
 * the wrapper had no width of its own — the inner `w-full` resolved against a
 * shrink-to-fit parent, so in a flex row the field collapsed and clipped its
 * own placeholder.
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      data-slot="input"
      className={cn(
        "flex h-9 w-full min-w-0 rounded-md border border-input bg-card px-3 py-1",
        "text-[13.5px] text-foreground shadow-card transition-[color,box-shadow,border-color]",
        "placeholder:text-muted-foreground",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-60",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = "Input"

export { Input }
