import { useState, type FormEvent } from "react"
import { KeyRound, Loader2, ShieldAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, api } from "@/lib/api"

export function Gate({ onAuthed }: { onAuthed: () => void | Promise<void> }) {
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || !password) return
    setBusy(true)
    setError(null)
    try {
      await api.login(password)
      setPassword("")
      await onAuthed()
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0
      if (status === 401) setError("Incorrect password.")
      else if (status === 429) setError("Too many attempts. Wait a minute, then try again.")
      else if (status === 0) setError("Cannot reach the control plane. Is the server running?")
      else setError(err instanceof Error ? err.message : "Login failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-16">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-lg border border-border bg-card p-8 shadow-card"
      >
        <div className="mb-7">
          <span className="mb-5 grid size-10 place-items-center rounded-lg border border-border bg-secondary text-foreground" aria-hidden>
            <KeyRound className="size-5" />
          </span>
          <p className="text-[12px] font-semibold tracking-[0.08em] text-ink-secondary uppercase">
            Auth acquisition agent
          </p>
          <h1 className="mt-2 text-[22px] font-semibold tracking-[-0.03em]">Restricted console</h1>
          <p className="mt-1.5 text-[14px] leading-5 text-ink-secondary">
            This instance holds live credentials. Enter the shared password to continue.
          </p>
        </div>

        <Label htmlFor="password" className="text-[12px] text-ink-secondary">
          Password
        </Label>
        <Input
          id="password"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1.5 font-mono"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "gate-error" : undefined}
        />

        {error && (
          <p
            id="gate-error"
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-md border border-border border-l-2 border-l-bad bg-secondary px-3 py-2 text-[12.5px] text-bad"
          >
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}

        <Button type="submit" disabled={busy} className="mt-4 h-10 w-full">
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {busy ? "Checking" : "Unlock"}
        </Button>
      </form>
    </main>
  )
}
