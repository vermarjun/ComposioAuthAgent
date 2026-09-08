/**
 * Terminating a run.
 *
 * The agent cannot finish by writing a paragraph; it finishes by calling
 * emit_packet with an object that survives validation. A rejection hands the
 * field errors straight back so the model repairs its own output, which is what
 * keeps every run inside the closed vocabularies the eval reads.
 */

import { emptyPacket, validatePacket, classify, type Packet, type Scheme } from "./schema.ts"
import * as store from "./store.ts"
import { Evidence } from "./http.ts"
import * as composio from "./composio.ts"
import * as nango from "./nango.ts"

export type EmitResult =
  | { ok: true; packet: Packet }
  | { ok: false; errors: { field: string; message: string }[] }

export async function emit(runId: string, partial: any): Promise<EmitResult> {
  const run = await store.get(runId)
  if (!run) return { ok: false, errors: [{ field: "run_id", message: `unknown run ${runId}` }] }

  const base = emptyPacket(runId, run.platform)
  const packet: Packet = {
    ...base,
    ...partial,
    run_id: runId,
    platform: partial?.platform || run.platform,
    resolved: { ...base.resolved, ...(partial?.resolved ?? {}) },
    auth: { ...base.auth, ...(partial?.auth ?? {}) },
    acquisition: { ...base.acquisition, ...(partial?.acquisition ?? {}) },
    verification: { ...base.verification, ...(partial?.verification ?? {}) },
    oracles: { ...base.oracles, ...(partial?.oracles ?? {}) },
    created_at: run.created_at,
    completed_at: new Date().toISOString(),
  }

  // A credential reported in the natural OAuth shape is still a credential;
  // lift it into the payload agent #3 reads rather than bouncing the packet.
  const authAny = (partial?.auth ?? {}) as Record<string, any>
  if (!packet.composio_auth_config && authAny.client_id) {
    packet.composio_auth_config = {
      toolkit: packet.resolved.composio_slug ?? packet.platform,
      auth_scheme: packet.auth.scheme === "DCR_OAUTH" ? "OAUTH2" : packet.auth.scheme,
      credentials: {
        client_id: authAny.client_id,
        ...(authAny.client_secret ? { client_secret: authAny.client_secret } : {}),
        oauth_redirect_uri: authAny.redirect_uri ?? process.env.OAUTH_REDIRECT_URI ??
          "https://backend.composio.dev/api/v1/auth-apps/add",
        ...(authAny.scopes ? { scopes: String(authAny.scopes) } : {}),
      },
    }
  }

  // The agent supplies findings, not bookkeeping. Evidence, screenshots and the
  // live view come from what the run actually did — a screenshot the agent took
  // and then forgot to mention was invisible in the report until this existed.
  const logged = (kind: string) => run.log.filter((l) => l.kind === kind).map((l) => l.text)

  // The model's own evidence list is discarded, not merged. Unioning it in
  // meant a packet could cite URLs that were never fetched — the one claim the
  // packet makes about its own provenance, defeated by a field the model writes.
  packet.evidence = [...new Set(logged("evidence"))]

  const shots = logged("screenshot").filter((t) => t.startsWith("/") || t.startsWith("http"))
  packet.acquisition.screenshots = [
    ...new Set([...(partial?.acquisition?.screenshots ?? []), ...shots]),
  ]

  if (run.live_view_url) packet.acquisition.live_view_url = run.live_view_url

  // Both sides of this comparison are now fetched here rather than taken from
  // the packet. The agent was supplying the oracle value *and* the answer being
  // checked against it, which is not a check at all.
  packet.oracles = await resolveOracles(packet)

  // Derived here, never taken from the agent: the whole point is that the class
  // follows from the reason by a fixed rule rather than the model's mood.


  // A verification verdict is only believed if oauth_verify actually ran and
  // said so. Without this the guard stopped a model that forgot the field, not
  // one that filled in the value it knew validation wanted.
  // The verdict must be on record AND be about the credential being claimed.
  // Matching "some accepted verdict exists" would let a probe of one client_id
  // vouch for a different one.
  const claimedId = packet.composio_auth_config?.credentials?.client_id ?? ""
  const verdicts = run.log.filter((l) => l.kind === "verification").map((l) => l.text)
  const provedGood = verdicts.some(
    (t) => t.startsWith("accepted ") && (!claimedId || t.includes(claimedId)),
  )
  if (packet.verification.invalid_client === false && !provedGood) {
    return {
      ok: false,
      errors: [{
        field: "verification.invalid_client",
        message: claimedId
          ? `no oauth_verify call is on record for client_id ${claimedId}. Call oauth_verify with that exact id and emit again.`
          : "no oauth_verify call is on record for this run, so a verification verdict cannot be accepted.",
      }],
    }
  }

  // A credential the toolkit cannot actually be configured with is not a
  // completed acquisition. Airtable's registration endpoint issues public
  // clients with no secret, while Composio's Airtable config requires both —
  // so a packet claiming credentials_obtained there reads as a finished
  // platform in any dashboard and then fails at auth-config creation.
  // Only applies to a claim that is otherwise sound. Downgrading an unverified
  // claim would quietly convert a rejection into a plausible blocked packet.
  if (packet.acquisition.status === "credentials_obtained" && provedGood) {
    const creds = packet.composio_auth_config?.credentials ?? {}
    const slug = packet.resolved.composio_slug ?? composio.guessSlug(packet.platform)
    const kit = await composio.getToolkit(slug, new Evidence()).catch(() => null)
    const required = Object.entries(kit?.creation_fields ?? {})
      .filter(([mode]) => mode.includes("OAUTH"))
      .flatMap(([, f]) => f.required)

    const missing = [...new Set(required)].filter((f) => !creds[f])
    if (missing.includes("client_secret") && creds.client_id) {
      packet.acquisition.status = "blocked"
      packet.acquisition.blocked_reason = "public_client_only"
      packet.acquisition.human_action_required =
        `A client_id was obtained (${creds.client_id}) but this route issues no client_secret, and ${slug}'s Composio auth config requires one. A confidential client must be created in the platform's portal.`
      packet.notes = [packet.notes, `Registration succeeded but produced a public client. Missing required field(s): ${missing.join(", ")}.`]
        .filter(Boolean)
        .join(" ")
    }
  }


  // Derived last, so it reflects any reason set above rather than the one the
  // agent submitted.
  const { blocker_class, unblocked_by } = classify(packet.acquisition.blocked_reason)
  packet.acquisition.blocker_class = blocker_class
  packet.acquisition.unblocked_by = unblocked_by

  const errors = validatePacket(packet)
  if (errors.length) return { ok: false, errors }

  run.packet = packet
  run.status = "done"
  await store.put(run)
  return { ok: true, packet }
}

/**
 * Fetch what the registries say, independently of what the agent reported.
 *
 * Note the honest limit: the agent *sees* Composio's answer during the run,
 * because composio_lookup is how it learns the credential field names agent #3
 * expects. So this measures consistency, not independence, and the README says
 * so. What it does catch is the agent contradicting a source it had in hand.
 */
export async function resolveOracles(packet: Packet): Promise<Packet["oracles"]> {
  const ev = new Evidence()
  // Direct slug lookup only. `lookup` falls back to pulling the whole 500-item
  // catalog, which is fine while researching and needless overhead on every
  // single emit — the run has already resolved the slug by this point.
  const slug = packet.resolved.composio_slug ?? composio.guessSlug(packet.platform)
  const kit = await composio.getToolkit(slug, ev).catch(() => null)
  const nan = nango.lookup(packet.platform)

  return scoreOracles({
    ...packet,
    oracles: {
      composio_scheme: ((kit?.auth_schemes ?? [])[0] as Scheme) ?? null,
      nango_auth_mode: nan?.auth_mode ?? null,
      agreement: null,
    },
  })
}

/** Cross-check the agent's own answer against the two registries. */
export function scoreOracles(packet: Packet): Packet["oracles"] {
  const { composio_scheme, nango_auth_mode } = packet.oracles
  const claimed = packet.auth.scheme
  const oracle = composio_scheme ?? null
  if (!oracle) return { composio_scheme, nango_auth_mode, agreement: "no_oracle" }
  // DCR is a legitimate extra surface on an OAUTH2 toolkit rather than a
  // contradiction of it, so do not score that pair as a disagreement.
  const compatible = claimed === oracle || (claimed === "DCR_OAUTH" && oracle === "OAUTH2")
  return { composio_scheme, nango_auth_mode, agreement: compatible ? "agree" : "disagree" }
}
