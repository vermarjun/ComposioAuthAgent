import { tool } from "@opencode-ai/plugin"
import * as vault from "../../src/core/vault.ts"
import * as b from "../../src/core/browser.ts"
import { log, json } from "../../src/core/runctx.ts"
import { mode } from "../../src/core/policy.ts"

export default tool({
  description:
    "Fill a developer-portal signup form with the provisioned operator identity. Types the generated password itself, so it never enters this conversation. Requires ACQUISITION_MODE=full. Open the signup page and call operator_account first.",
  args: {
    session: tool.schema.string(),
    platform: tool.schema.string(),
    submit: tool.schema.boolean().optional().describe("Press the submit control (default true)"),
  },
  async execute(args, ctx) {
    if (mode() !== "full") {
      return json({
        ok: false,
        reason: `ACQUISITION_MODE is '${mode()}', which does not permit creating accounts`,
        instruction: "Block with needs_operator_account and say an operator must create the account or raise the mode.",
      })
    }

    const acc = vault.get(args.platform)
    if (!acc) return json({ ok: false, reason: "no provisioned identity; call operator_account with action 'provision' first" })

    let fs = await b.fields(args.session)
    if (!fs.length) return json({ ok: false, reason: "no interactive elements — wait for the page and retry" })

    // Some signup pages show only "Sign up with email" until it is clicked.
    // Aborting there reported "no email field found" about a form one click away.
    if (!b.findEmailField(fs)) {
      const reveal = b.findRevealControl(fs)
      if (reveal) {
        await b.exec(["click", reveal.ref], args.session, 45000)
        await b.exec(["wait", "--load", "networkidle"], args.session, 25000)
        await b.exec(["wait", "--ms", "1500"], args.session, 6000)
        fs = await b.fields(args.session)
      }
    }

    const email = b.findEmailField(fs)
    const password = b.findPasswordField(fs)
    if (!email) return json({ ok: false, reason: "no email field found", saw: fs.slice(0, 12) })

    const filled: string[] = []
    if (await b.fillSecret(args.session, email.ref, acc.email)) filled.push("email")
    if (password && (await b.fillSecret(args.session, password.ref, acc.password))) filled.push("password")

    // Matched on the label as well as the inferred type: the snapshot carries
    // no type attribute, so `type === "password"` alone never matched and a
    // confirm field was silently left blank.
    const confirm = fs.filter(
      (f) =>
        f.ref !== password?.ref &&
        (f.type === "password" || /pass(word|code)|confirm|repeat|re-?enter/i.test(f.label)),
    )
    for (const c of confirm) {
      if (await b.fillSecret(args.session, c.ref, acc.password)) filled.push("confirm")
    }

    let submitted = false
    if (args.submit !== false) {
      const btn = b.findSubmit(fs)
      if (btn) submitted = (await b.exec(["click", btn.ref], args.session, 45000)).code === 0
      await b.exec(["wait", "--load", "networkidle"], args.session, 30000)
    }

    await log(ctx as any, "browser", `signup attempt as ${acc.email} (filled: ${filled.join("+")})`)
    return json({
      ok: filled.length > 0,
      filled,
      submitted,
      account_email: acc.email,
      inbox_id: acc.inbox_id,
      instruction:
        "Snapshot to see what the portal asked for next. If it sent a verification email, poll mail_wait on this inbox_id and open the link it contains. Remaining required fields (name, company, country) you can fill yourself with the applicant details from your brief.",
    })
  },
})
