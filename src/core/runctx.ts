/**
 * The bridge between an opencode tool call and the run it belongs to. Tools are
 * handed a sessionID and nothing else, so everything run-scoped is resolved
 * here: which platform, where to log, where evidence accumulates.
 */

import { Evidence } from "./http.ts"
import * as store from "./store.ts"

export type Ctx = { sessionID?: string; agent?: string }

export async function runFor(ctx: Ctx): Promise<store.RunState | null> {
  if (!ctx?.sessionID) return null
  return store.getBySession(ctx.sessionID)
}

/**
 * Appends are read-modify-write on the whole run, and the scout is explicitly
 * told to call independent tools in the same turn. Two of them landing together
 * meant the second read a copy from before the first wrote, and one tool's
 * evidence silently vanished. Serialised per run, which is enough because a run
 * only ever moves through one process.
 */
const queues = new Map<string, Promise<unknown>>()

function serialise<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(runId) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  // Keep the chain from growing without bound once a run goes quiet.
  queues.set(runId, next.catch(() => undefined))
  next.finally(() => {
    if (queues.get(runId) === next) queues.delete(runId)
  }).catch(() => undefined)
  return next
}

async function append(ctx: Ctx, entries: { kind: string; text: string }[]): Promise<void> {
  if (!ctx?.sessionID || !entries.length) return
  const first = await runFor(ctx)
  if (!first) return
  await serialise(first.run_id, async () => {
    // Re-read inside the critical section: the copy above may already be stale.
    const run = await store.get(first.run_id)
    if (!run) return
    const at = new Date().toISOString()
    for (const e of entries) run.log.push({ at, kind: e.kind, text: e.text })
    await store.put(run)
  })
}

export async function log(ctx: Ctx, kind: string, text: string): Promise<void> {
  await append(ctx, [{ kind, text }])
}

/**
 * Evidence is recorded against the run rather than returned to the model,
 * because the packet must cite what was fetched even if the model forgets to
 * mention it.
 */
export async function commitEvidence(ctx: Ctx, ev: Evidence): Promise<void> {
  await append(ctx, ev.urls().map((url) => ({ kind: "evidence", text: url })))
}

export async function setLiveView(ctx: Ctx, url: string | null): Promise<void> {
  if (!url) return
  const first = await runFor(ctx)
  if (!first) return
  await serialise(first.run_id, async () => {
    const run = await store.get(first.run_id)
    if (!run) return
    run.live_view_url = url
    await store.put(run)
  })
}

export async function runId(ctx: Ctx): Promise<string | null> {
  return (await runFor(ctx))?.run_id ?? null
}

export const json = (v: unknown) => JSON.stringify(v, null, 2)
