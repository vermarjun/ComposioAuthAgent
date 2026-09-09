import { tool } from "@opencode-ai/plugin"
import { Evidence } from "../../src/core/http.ts"
import { discoverBest } from "../../src/core/discover.ts"
import { commitEvidence, json } from "../../src/core/runctx.ts"

export default tool({
  description:
    "Discover a platform's OAuth metadata by fetching its well-known documents (RFC 9728 protected resource, RFC 8414 authorization server, OIDC config). Tries the platform's MCP host too. Returns the real endpoints and whether RFC 7591 dynamic client registration is supported. No guessing: it either found the documents or it did not.",
  args: {
    platform: tool.schema
      .string()
      .describe("Domain or name, e.g. 'linear.app', 'notion.so', 'Stripe'"),
  },
  async execute(args, ctx) {
    const ev = new Evidence()
    const d = await discoverBest(args.platform, ev)
    await commitEvidence(ctx as any, ev)
    return json({
      origin: d.origin,
      found: d.found,
      supports_dcr: d.supports_dcr,
      authorization_endpoint: d.metadata?.authorization_endpoint ?? null,
      token_endpoint: d.metadata?.token_endpoint ?? null,
      registration_endpoint: d.metadata?.registration_endpoint ?? null,
      scopes_supported: d.metadata?.scopes_supported ?? [],
      metadata_source: d.metadata?.source ?? null,
      // Only worth showing when nothing was found; otherwise it is ten dead URLs.
      ...(d.found ? {} : { hosts_tried: d.tried }),
    })
  },
})
