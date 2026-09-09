import { tool } from "@opencode-ai/plugin"
import { Evidence } from "../../src/core/http.ts"
import { waitFor, configured } from "../../src/core/mail.ts"
import { commitEvidence, json } from "../../src/core/runctx.ts"

export default tool({
  description:
    "Wait for mail to arrive in an agent inbox and pull out the one-time code and any verification links. Call it right after submitting a form that triggers a verification email.",
  args: {
    inbox_id: tool.schema.string(),
    from_contains: tool.schema.string().describe("REQUIRED sender fragment, e.g. 'typeform'. One mailbox serves several platforms, so an unfiltered read returns whichever mail arrived last — which has already meant following another platform's verification link."),
    timeout_seconds: tool.schema.number().optional(),
  },
  async execute(args, ctx) {
    if (!configured()) return json({ ok: false, reason: "AGENTMAIL_API_KEY not configured" })
    const ev = new Evidence()
    if (!args.from_contains || !args.from_contains.trim()) {
      return json({
        ok: false,
        reason: "from_contains is required",
        instruction:
          "This mailbox is shared between platforms. Pass the platform's name so you read its mail and not another run's — an unfiltered read has already followed the wrong platform's verification link.",
      })
    }
    const got = await waitFor(args.inbox_id, ev, {
      fromContains: args.from_contains,
      timeoutMs: Math.min((args.timeout_seconds ?? 120) * 1000, 240000),
    })
    await commitEvidence(ctx as any, ev)
    return json(got ? { ok: true, ...got } : { ok: false, reason: "nothing arrived before the timeout" })
  },
})
