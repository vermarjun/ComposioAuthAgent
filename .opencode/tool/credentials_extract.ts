import { tool } from "@opencode-ai/plugin"
import { fromPage } from "../../src/core/extract.ts"
import { log, json } from "../../src/core/runctx.ts"

export default tool({
  description:
    "Read OAuth credentials off the page currently open in the browser. Interrogates the DOM for label/value pairs — readonly inputs, code blocks, table rows — rather than asking you to read them off a screenshot. Call this after an app has been registered in a portal.",
  args: { session: tool.schema.string().describe("From browser_session") },
  async execute(args, ctx) {
    const e = await fromPage(args.session)
    await log(ctx as any, "browser", e.client_id ? `extracted client_id ${e.client_id}` : "no client_id on page")
    return json({
      client_id: e.client_id,
      client_secret: e.client_secret,
      candidate_pairs: e.pairs,
      warnings: e.warnings,
      instruction: e.client_id
        ? "Verify with oauth_verify before reporting credentials_obtained."
        : "Nothing credential-shaped found. Check you are on the page shown after registration, reveal any masked field, then extract again. Do not invent a value from a screenshot.",
    })
  },
})
