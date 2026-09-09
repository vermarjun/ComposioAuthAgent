import { tool } from "@opencode-ai/plugin"
import { Evidence } from "../../src/core/http.ts"
import { verifyClientId, verifyClientCredentials } from "../../src/core/verify.ts"
import { commitEvidence, log, json } from "../../src/core/runctx.ts"

export default tool({
  description:
    "Prove a client_id actually works by building the real authorize URL and asking the platform about it. Stops at the redirect and never completes a user consent flow. You MUST call this before claiming credentials were obtained.",
  args: {
    authorization_endpoint: tool.schema.string().describe("Authorize URL, or the token URL when passing a client_secret"),
    client_id: tool.schema.string(),
    client_secret: tool.schema.string().optional().describe("Supply it when you have one: exchanging it for a token proves the pair, where the authorize probe only infers"),
    redirect_uri: tool.schema.string().optional(),
    scope: tool.schema.string().optional(),
    token_endpoint: tool.schema.string().optional(),
  },
  async execute(args, ctx) {
    const ev = new Evidence()
    const redirect =
      args.redirect_uri ??
      process.env.OAUTH_REDIRECT_URI ??
      "https://backend.composio.dev/api/v1/auth-apps/add"
    // Prefer the grant when a secret is in hand: it is proof, not inference.
    const tokenUrl = args.token_endpoint ?? (args.client_secret ? args.authorization_endpoint : null)
    const v =
      args.client_secret && tokenUrl
        ? await verifyClientCredentials(tokenUrl, args.client_id, args.client_secret, args.scope ?? null, ev)
        : await verifyClientId(args.authorization_endpoint, args.client_id, redirect, args.scope ?? null, ev)
    await commitEvidence(ctx as any, ev)
    // The run must carry proof this ran, or emit_packet has nothing to check a
    // claimed verdict against.
    await log(
      ctx as any,
      "verification",
      // "accepted" is the word emit_packet looks for, so an inconclusive probe
      // must not use it — it proved nothing.
      `${v.invalid_client ? "rejected" : v.result.startsWith("inconclusive") ? "inconclusive" : "accepted"} client_id ${args.client_id} at ${v.checked_url} (${v.result})`,
    )
    return json(v)
  },
})
