import { tool } from "@opencode-ai/plugin"
import { lookup, toComposioScheme } from "../../src/core/nango.ts"
import { json } from "../../src/core/runctx.ts"

export default tool({
  description:
    "Check the platform against Nango's open-source provider registry (992 APIs), a second independently maintained oracle. Often supplies the registration_url and a published 'how to register your own OAuth app' guide directly. Offline lookup, effectively free — always call it.",
  args: { platform: tool.schema.string() },
  async execute(args) {
    const p = lookup(args.platform)
    if (!p) return json({ found: false })
    return json({
      found: true,
      slug: p.slug,
      display_name: p.display_name,
      auth_mode: p.auth_mode,
      equivalent_composio_scheme: toComposioScheme(p.auth_mode),
      authorization_url: p.authorization_url,
      token_url: p.token_url,
      registration_url: p.registration_url,
      setup_guide_url: p.setup_guide_url,
      docs: p.docs,
    })
  },
})
