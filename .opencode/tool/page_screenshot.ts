import { tool } from "@opencode-ai/plugin"
import { screenshot } from "../../src/core/browser.ts"
import { runId, log, json } from "../../src/core/runctx.ts"

export default tool({
  description:
    "Capture the current browser page into the run's artefact store and return a URL the report can render. Use it after filling a form so a human can see exactly what would be submitted.",
  args: {
    session: tool.schema.string().describe("From browser_session"),
    label: tool.schema.string().describe("Short slug, e.g. 'registration-form-filled'"),
  },
  async execute(args, ctx) {
    const id = (await runId(ctx as any)) ?? "adhoc"
    const safe = args.label.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 60)
    const url = await screenshot(id, args.session, safe)
    if (url) await log(ctx as any, "screenshot", url)
    return json(
      url
        ? { ok: true, url }
        : {
            ok: false,
            note: "Nothing was captured. Either the session is closed, or the browser is on an error page rather than the page you meant to photograph — check the current URL, navigate back to the real page, and try again.",
          },
    )
  },
})
