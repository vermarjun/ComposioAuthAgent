import { tool } from "@opencode-ai/plugin"
import { Evidence } from "../../src/core/http.ts"
import { registerClient, defaultClientMetadata } from "../../src/core/dcr.ts"
import { commitEvidence, log, json } from "../../src/core/runctx.ts"

export default tool({
  description:
    "Register an OAuth client with a platform using RFC 7591 dynamic client registration, and get back a real client_id and client_secret with no human involved. Only call this when auth_discover reported a registration_endpoint. This performs a real write against the platform.",
  args: {
    registration_endpoint: tool.schema.string().describe("From auth_discover"),
    scope: tool.schema.string().optional().describe("Space-separated scopes to request"),
    client_name: tool.schema.string().optional().describe("Defaults to the configured applicant name"),
  },
  async execute(args, ctx) {
    const ev = new Evidence()
    const meta = defaultClientMetadata({
      ...(args.client_name ? { client_name: args.client_name } : {}),
      ...(args.scope ? { scope: args.scope } : {}),
    })
    const r = await registerClient(args.registration_endpoint, meta, ev)
    await commitEvidence(ctx as any, ev)
    await log(ctx as any, "registration", r.ok ? `client_id ${r.client_id}` : `failed: ${r.error}`)
    return json({
      ok: r.ok,
      http_status: r.status,
      client_id: r.client_id,
      client_secret: r.client_secret,
      client_secret_expires_at: r.client_secret_expires_at,
      granted_scope: r.scope,
      error: r.error,
      sent_client_metadata: meta,
      // Some servers publish a registration endpoint but allowlist who may use
      // it. That is a different finding from "no DCR here" and must not be
      // flattened into one.
      disallowed_redirect_uris: r.raw?.disallowed_uris ?? undefined,
      note: r.ok && !r.client_secret
        ? "Public client: the server issued no secret. This is valid; record client_secret as null."
        : !r.ok && (r.raw?.error === "invalid_redirect_uri" || r.raw?.disallowed_uris)
        ? "The platform supports DCR but does not allow this redirect URI. Keep scheme DCR_OAUTH and path dcr, and report blocked_reason redirect_uri_not_allowed. The human action is to get the redirect URI allowlisted with the platform, not to register an app by hand."
        : !r.ok
        ? "Registration was refused. Keep scheme DCR_OAUTH and path dcr — the platform does support dynamic registration — and report why it refused."
        : undefined,
    })
  },
})
