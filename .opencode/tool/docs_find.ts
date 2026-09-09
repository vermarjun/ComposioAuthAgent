import { tool } from "@opencode-ai/plugin"
import { Evidence } from "../../src/core/http.ts"
import { findRegistrationPage, search, lastSearchError } from "../../src/core/docs.ts"
import { commitEvidence, json } from "../../src/core/runctx.ts"

export default tool({
  description:
    "Find the page a human would have to open to register a developer app, or to request API access. Use when there is no dynamic client registration and you need to know whether the portal is self-serve or gated.",
  args: {
    platform: tool.schema.string(),
    query: tool.schema.string().optional().describe("Override the default searches"),
  },
  async execute(args, ctx) {
    const ev = new Evidence()
    const hits = args.query
      ? await search(args.query, ev, 5)
      : await findRegistrationPage(args.platform, ev)
    await commitEvidence(ctx as any, ev)
    if (!hits.length) {
      return json({
        found: false,
        search_unavailable: lastSearchError,
        note: lastSearchError
          ? `Web search is unavailable (${lastSearchError}); only conventional URLs were probed. Absence of a result is NOT evidence the platform has no developer portal — say that rather than concluding there is none.`
          : "No candidate pages found. Say so rather than guessing a URL.",
      })
    }
    return json({ found: true, candidates: hits })
  },
})
