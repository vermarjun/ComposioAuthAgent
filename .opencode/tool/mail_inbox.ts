import { tool } from "@opencode-ai/plugin"
import { Evidence } from "../../src/core/http.ts"
import { createInbox, configured } from "../../src/core/mail.ts"
import { commitEvidence, log, json } from "../../src/core/runctx.ts"

export default tool({
  description:
    "Create an email inbox the agent controls, for a developer-portal signup that sends a verification code or link. Use the returned address in the form.",
  args: { username: tool.schema.string().optional() },
  async execute(args, ctx) {
    if (!configured()) {
      return json({
        ok: false,
        reason: "AGENTMAIL_API_KEY not configured",
        instruction:
          "Do not invent an address. If the portal needs email verification, block with email_verification_required.",
      })
    }
    const ev = new Evidence()
    const inbox = await createInbox(ev, args.username)
    await commitEvidence(ctx as any, ev)
    if (!inbox) return json({ ok: false, reason: "inbox creation failed" })
    await log(ctx as any, "mail", `inbox ${inbox.address}`)
    return json({ ok: true, ...inbox })
  },
})
