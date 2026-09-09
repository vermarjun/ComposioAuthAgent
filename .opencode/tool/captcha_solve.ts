import { tool } from "@opencode-ai/plugin"
import { Evidence } from "../../src/core/http.ts"
import { solve, configured } from "../../src/core/captcha.ts"
import { commitEvidence, log, json } from "../../src/core/runctx.ts"

export default tool({
  description:
    "Solve a CAPTCHA that is blocking a legitimate developer-app registration, returning a token to inject into the page. Scope is narrow on purpose: registering Composio's own app under its own identity. If no solver is configured, block with captcha_blocked rather than working around it.",
  args: {
    kind: tool.schema.string().describe("turnstile | recaptcha_v2 | recaptcha_v3"),
    site_key: tool.schema.string().describe("Read from the page's widget element"),
    page_url: tool.schema.string(),
    action: tool.schema.string().optional().describe("pageAction, reCAPTCHA v3 only"),
  },
  async execute(args, ctx) {
    if (!configured()) {
      return json({ ok: false, error: "CAPSOLVER_API_KEY not configured", instruction: "Block with captcha_blocked." })
    }
    const ev = new Evidence()
    const r = await solve(args.kind as any, args.site_key, args.page_url, ev, args.action)
    await commitEvidence(ctx as any, ev)
    await log(ctx as any, "captcha", r.ok ? `solved in ${r.ms}ms` : `failed: ${r.error}`)
    return json(r)
  },
})
