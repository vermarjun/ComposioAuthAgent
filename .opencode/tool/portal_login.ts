import { tool } from "@opencode-ai/plugin"
import * as vault from "../../src/core/vault.ts"
import * as b from "../../src/core/browser.ts"
import { log, json } from "../../src/core/runctx.ts"

export default tool({
  description:
    "Sign in to a developer portal using the stored operator account. Finds the email and password fields on the current page and fills them itself, so the password never enters this conversation. Open the login page first.",
  args: {
    session: tool.schema.string().describe("From browser_session"),
    platform: tool.schema.string(),
    submit: tool.schema.boolean().optional().describe("Press the submit control (default true)"),
  },
  async execute(args, ctx) {
    const acc = vault.get(args.platform)
    if (!acc) return json({ ok: false, reason: "no operator account for this platform; call operator_account first" })

    const fs = await b.fields(args.session)
    if (!fs.length) {
      return json({ ok: false, reason: "no interactive elements — the page may still be loading; wait and retry" })
    }

    const email = b.findEmailField(fs)
    const password = b.findPasswordField(fs)
    if (!email && !password) {
      return json({ ok: false, reason: "no email or password field on this page; is this the login screen?", saw: fs.slice(0, 12) })
    }

    const filled: string[] = []
    if (email && (await b.fillSecret(args.session, email.ref, acc.email))) filled.push("email")
    // Some portals ask for the email first and reveal the password field after.
    if (password && (await b.fillSecret(args.session, password.ref, acc.password))) filled.push("password")

    let submitted = false
    if (args.submit !== false) {
      const btn = b.findSubmit(fs)
      if (btn) {
        const r = await b.exec(["click", btn.ref], args.session, 45000)
        submitted = r.code === 0
      }
      await b.exec(["wait", "--load", "networkidle"], args.session, 30000)
    }

    vault.touch(args.platform, {})
    await log(ctx as any, "browser", `login attempt as ${acc.email} (filled: ${filled.join("+") || "nothing"})`)

    const url = (await b.exec(["get", "url"], args.session, 20000)).stdout.trim()
    return json({
      ok: filled.length > 0,
      filled,
      submitted,
      current_url: url,
      account_email: acc.email,
      instruction:
        password || !email
          ? "Snapshot the page to confirm the result. A password prompt still showing means the credentials were rejected or a second step is required."
          : "Only the email field existed, so this is a two-step form. Snapshot, then call portal_login again once the password field appears.",
    })
  },
})
