import { tool } from "@opencode-ai/plugin"
import { Evidence } from "../../src/core/http.ts"
import { findContactRoute, lastSearchError } from "../../src/core/docs.ts"
import { commitEvidence, json } from "../../src/core/runctx.ts"

export default tool({
  description:
    "Find where a human would write to about API access: a partner programme, a developer support form, or a generic inbox. Use on the relationship path before drafting outreach, so the draft has a real destination instead of nowhere.",
  args: { platform: tool.schema.string() },
  async execute(args, ctx) {
    const ev = new Evidence()
    const routes = await findContactRoute(args.platform, ev)
    await commitEvidence(ctx as any, ev)
    if (!routes.length) {
      return json({
        found: false,
        search_unavailable: lastSearchError,
        instruction: lastSearchError
          ? `Web search is unavailable (${lastSearchError}), so absence of a route here is not evidence there is none. Say that in human_action_required and leave outreach_draft.to null.`
          : "No contact route found. Say so in human_action_required rather than inventing an address, and leave outreach_draft.to null.",
      })
    }
    return json({
      found: true,
      routes,
      instruction:
        "Prefer a partner programme or support form over an address: a form reaches the queue that handles these. Put the chosen destination in outreach_draft.to.",
    })
  },
})
