/**
 * The acquisition machinery, exercised with no model in the loop.
 *
 * Everything the agent *decides* is skipped here; everything it *does* is
 * executed. That makes this the check that separates "the LLM is misbehaving"
 * from "the tools are broken", and it runs without a model provider at all.
 *
 *   bun run eval/deterministic.ts linear.app stripe.com xero.com
 *   bun run eval/deterministic.ts --register linear.app     # actually mints a client
 *
 * Registration is opt-in because it creates a real record at a real company.
 */

import { Evidence } from "../src/core/http.ts"
import { discoverBest } from "../src/core/discover.ts"
import { registerClient, defaultClientMetadata } from "../src/core/dcr.ts"
import { verifyClientId } from "../src/core/verify.ts"
import * as composio from "../src/core/composio.ts"
import * as nango from "../src/core/nango.ts"
import { emptyPacket, validatePacket, USER_CREDENTIAL_SCHEMES, type Packet, type Scheme } from "../src/core/schema.ts"

const args = process.argv.slice(2)
const doRegister = args.includes("--register")
const platforms = args.filter((a) => !a.startsWith("--"))
if (!platforms.length) {
  console.error("usage: bun run eval/deterministic.ts [--register] <platform> [...]")
  process.exit(1)
}

const REDIRECT = process.env.OAUTH_REDIRECT_URI ?? "https://backend.composio.dev/api/v1/auth-apps/add"

async function one(platform: string): Promise<Packet> {
  const ev = new Evidence()
  const p = emptyPacket("det-" + platform.replace(/\W+/g, "-"), platform)

  const [disc, kit] = await Promise.all([discoverBest(platform, ev), composio.lookup(platform, ev)])
  const nan = nango.lookup(platform)

  p.resolved.origin = disc.origin
  p.resolved.already_in_composio = Boolean(kit)
  p.resolved.composio_slug = kit?.slug ?? null
  p.resolved.composio_managed = Boolean(kit?.managed_schemes?.some((s) => String(s).includes("OAUTH")))

  p.oracles.composio_scheme = (kit?.auth_schemes?.[0] as Scheme) ?? null
  p.oracles.nango_auth_mode = nan?.auth_mode ?? null

  p.auth.authorization_endpoint = disc.metadata?.authorization_endpoint ?? null
  p.auth.token_endpoint = disc.metadata?.token_endpoint ?? null
  p.auth.registration_endpoint = disc.metadata?.registration_endpoint ?? null
  p.auth.alternatives = (kit?.auth_schemes ?? []).filter((s) => s !== "OAUTH2") as Scheme[]

  // Connect-time fields are the part everyone forgets: a connector that ships
  // without shopify's `subdomain` fails on its first real user.
  const modes = kit?.connect_fields ?? {}
  p.auth.connect_time_fields = [...new Set(Object.values(modes).flatMap((f) => f.required))]

  if (disc.supports_dcr) {
    p.auth.scheme = "DCR_OAUTH"
    p.acquisition.path = "dcr"

    if (doRegister) {
      const meta = defaultClientMetadata({
        scope: (disc.metadata?.scopes_supported ?? []).join(" ") || undefined,
      })
      const reg = await registerClient(disc.metadata!.registration_endpoint!, meta, ev)
      if (reg.ok && reg.client_id) {
        const v = await verifyClientId(disc.metadata!.authorization_endpoint!, reg.client_id, REDIRECT, reg.scope, ev)
        p.verification = {
          method: v.method, result: v.result,
          invalid_client: v.invalid_client, checked_at: new Date().toISOString(),
        }
        p.composio_auth_config = {
          toolkit: kit?.slug ?? platform,
          auth_scheme: "OAUTH2",
          credentials: {
            client_id: reg.client_id,
            ...(reg.client_secret ? { client_secret: reg.client_secret } : {}),
            oauth_redirect_uri: REDIRECT,
            ...(reg.scope ? { scopes: reg.scope } : {}),
          },
        }
        p.acquisition.status = v.invalid_client ? "blocked" : "credentials_obtained"
        p.acquisition.blocked_reason = null
        p.acquisition.human_action_required = null
        if (v.invalid_client) {
          p.acquisition.blocked_reason = "discovery_failed"
          p.acquisition.human_action_required = "The platform rejected the client it just issued; inspect the registration response."
        }
      } else {
        p.acquisition.status = "blocked"
        p.acquisition.blocked_reason = "application_form_required"
        p.acquisition.human_action_required = `Registration endpoint refused the request (${reg.error}). Register the app by hand.`
      }
    } else {
      p.acquisition.status = "draft_ready"
      p.acquisition.blocked_reason = null
      p.acquisition.human_action_required = "Re-run with --register to mint the credential."
    }
  } else {
    const scheme = (nango.toComposioScheme(nan?.auth_mode ?? null) as Scheme) ?? (kit?.auth_schemes?.[0] as Scheme) ?? "UNKNOWN"
    p.auth.scheme = scheme
    if (USER_CREDENTIAL_SCHEMES.includes(scheme)) {
      p.acquisition.path = "none_needed"
      p.acquisition.status = "no_app_required"
      p.acquisition.blocked_reason = null
      p.acquisition.human_action_required = null
    } else {
      p.acquisition.path = "self_serve"
      p.acquisition.status = "blocked"
      p.acquisition.blocked_reason = "needs_operator_account"
      p.acquisition.human_action_required =
        `No dynamic registration. A human must register an app in ${platform}'s developer portal; the agent's browser path handles this.`
    }
  }

  p.evidence = ev.urls()
  p.confidence = disc.found ? 0.9 : 0.4
  p.completed_at = new Date().toISOString()
  return p
}

let failures = 0
for (const platform of platforms) {
  const p = await one(platform)
  const errs = validatePacket(p)
  const creds = p.composio_auth_config?.credentials
  console.log(`\n=== ${platform} ===`)
  console.log(`  scheme        ${p.auth.scheme}   path ${p.acquisition.path}   status ${p.acquisition.status}`)
  console.log(`  registration  ${p.auth.registration_endpoint ?? "-"}`)
  if (creds?.client_id) {
    console.log(`  client_id     ${creds.client_id}`)
    console.log(`  client_secret ${creds.client_secret ? creds.client_secret.slice(0, 10) + "…(" + creds.client_secret.length + ")" : "(public client)"}`)
    console.log(`  verified      ${p.verification.result}`)
  }
  if (p.acquisition.blocked_reason) console.log(`  blocked       ${p.acquisition.blocked_reason}`)
  console.log(`  oracles       composio=${p.oracles.composio_scheme ?? "-"}  nango=${p.oracles.nango_auth_mode ?? "-"}`)
  if (p.auth.connect_time_fields.length) console.log(`  connect fields ${p.auth.connect_time_fields.join(", ")}`)
  console.log(`  evidence      ${p.evidence.length} urls`)
  if (errs.length) {
    failures++
    console.log(`  SCHEMA ERRORS:`)
    errs.forEach((e) => console.log(`    ${e.field}: ${e.message}`))
  } else {
    console.log(`  packet        valid`)
  }
}
console.log(`\n${platforms.length - failures}/${platforms.length} packets valid`)
process.exit(failures ? 1 : 0)
