import { tool } from "@opencode-ai/plugin"
import { Evidence } from "../../src/core/http.ts"
import { lookup } from "../../src/core/composio.ts"
import { commitEvidence, json } from "../../src/core/runctx.ts"

export default tool({
  description:
    "Look the platform up in Composio's live toolkit catalog. Tells you three things: whether Composio already ships it and whether its OAuth is Composio-managed (if managed, there is nothing to acquire), the exact credential field names agent #3 expects, and the connect-time fields an end user must supply such as subdomain. Call this early — it is cheap and often decisive.",
  args: { platform: tool.schema.string().describe("Platform name, e.g. 'Linear'") },
  async execute(args, ctx) {
    const ev = new Evidence()
    const t = await lookup(args.platform, ev)
    await commitEvidence(ctx as any, ev)
    if (!t) return json({ found: false, note: "Not in Composio's catalog. This would be a new toolkit." })
    const managedOauth = t.managed_schemes.some((s) => String(s).includes("OAUTH"))
    return json({
      found: true,
      slug: t.slug,
      name: t.name,
      auth_schemes: t.auth_schemes,
      composio_managed_auth_schemes: t.managed_schemes,
      already_managed: managedOauth,
      tools_count: t.tools_count,
      // Only the OAuth-shaped modes matter here, and the full field map for
      // every mode was the single largest thing in the agent's context.
      auth_config_creation_fields: Object.fromEntries(
        Object.entries(t.creation_fields).filter(([m]) => m.includes("OAUTH")),
      ),
      connect_time_fields: [
        ...new Set(Object.values(t.connect_fields).flatMap((f) => f.required)),
      ],
      note: managedOauth
        ? "Composio already operates a shared OAuth app here. Record it as context and keep going: a dedicated app still wins on branding, scopes and rate limits."
        : "No Composio-managed OAuth app. This is exactly the gap this agent exists to close.",
    })
  },
})
