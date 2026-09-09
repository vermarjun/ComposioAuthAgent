import { tool } from "@opencode-ai/plugin"
import { Evidence } from "../../src/core/http.ts"
import * as vault from "../../src/core/vault.ts"
import { acquireInbox, configured as mailConfigured } from "../../src/core/mail.ts"
import { commitEvidence, log, json } from "../../src/core/runctx.ts"

export default tool({
  description:
    "Check whether an operator account exists for this platform, or provision a new one (an agent-controlled mailbox plus a generated password). Call this BEFORE trying to log into a developer portal. The password is stored in the vault and is never returned to you — portal_login types it for you.",
  args: {
    platform: tool.schema.string(),
    action: tool.schema.string().describe("'check' or 'provision'"),
    notes: tool.schema.string().optional().describe("Portal URL or signup quirks worth remembering"),
  },
  async execute(args, ctx) {
    if (!vault.configured()) {
      return json({
        available: false,
        reason: "VAULT_KEY is not configured, so no operator identity can be stored",
        instruction:
          "Do not attempt a signup. Block with needs_operator_account and say an operator must supply an account for this platform.",
      })
    }

    const existing = vault.get(args.platform)
    if (args.action === "check" || existing) {
      if (!existing) return json({ exists: false, instruction: "Call again with action 'provision' to create one." })
      vault.touch(args.platform, {})
      return json({
        exists: true,
        email: existing.email,
        status: existing.status,
        created_at: existing.created_at,
        notes: existing.notes,
        instruction:
          existing.status === "pending_verification"
            ? "This account was never verified. Log in and finish verification with mail_wait."
            : "Use portal_login to sign in. The password is in the vault; you do not need it.",
      })
    }

    if (!mailConfigured()) {
      return json({
        available: false,
        reason: "AGENTMAIL_API_KEY is not configured, so no mailbox can be created for a signup",
        instruction: "Block with email_verification_required and name the platform's signup URL.",
      })
    }

    const ev = new Evidence()
    // Mailboxes already bound to another platform must not be reused, or two
    // signups end up sharing an address and the OTPs interleave.
    const taken = vault.list().map((a) => a.email)
    const got = await acquireInbox(
      ev,
      `authagent-${vault.normalise(args.platform).replace(/\W+/g, "")}`,
      taken,
    )
    await commitEvidence(ctx as any, ev)
    if (!got.ok) {
      return json({
        available: false,
        reason: got.reason,
        existing_inboxes: got.existing.map((i) => i.address),
        instruction:
          "No mailbox is available, so block with email_verification_required and say the mailbox plan is out of inboxes. Do not invent an address.",
      })
    }
    const inbox = got.inbox

    const acc = vault.put({
      platform: args.platform,
      email: inbox.address,
      password: vault.generatePassword(),
      inbox_id: inbox.inbox_id,
      status: "pending_verification",
      created_at: new Date().toISOString(),
      last_used_at: null,
      notes: args.notes ?? null,
    })
    await log(ctx as any, "operator", `${got.reused ? "reused" : "provisioned"} ${acc.email} for ${args.platform}`)

    return json({
      exists: true,
      provisioned: true,
      email: acc.email,
      inbox_id: acc.inbox_id,
      status: acc.status,
      instruction:
        "Use this email in the signup form. portal_signup fills the password for you. Afterwards poll mail_wait for the verification link and open it — always pass from_contains with the platform's name, because this mailbox may be shared with other platforms.",
    })
  },
})
