/**
 * How far the agent may go without a human.
 *
 * A single AUTO_SUBMIT boolean conflated three very different actions: minting
 * a credential from a machine endpoint, registering an app in a portal we
 * already have an account on, and creating a new account somewhere. The first
 * is unattended by design, the last is a decision someone should make on
 * purpose, so they get separate levels.
 */

export type Mode = "readonly" | "register" | "full"

export function mode(): Mode {
  const raw = (process.env.ACQUISITION_MODE ?? "").toLowerCase()
  if (raw === "readonly" || raw === "register" || raw === "full") return raw
  // Back-compat with the flag this replaced.
  return process.env.AUTO_SUBMIT === "true" ? "full" : "register"
}

export const canRegisterViaDcr = () => true // a published machine endpoint, always allowed
export const canSubmitPortalForm = () => mode() !== "readonly"
export const canCreateAccount = () => mode() === "full"
export const canSendOutreach = () => false // always a human decision

export function describe(): string {
  const m = mode()
  return [
    `ACQUISITION_MODE is '${m}'.`,
    "RFC 7591 dynamic client registration is always permitted: it is an unattended machine-to-machine endpoint published for exactly this purpose.",
    m === "readonly"
      ? "You may NOT submit any portal form. Fill it, screenshot it, and stop at draft_ready."
      : "You MAY log into a developer portal with the stored operator account and submit an app-registration form.",
    m === "full"
      ? "You MAY also create a new operator account when none exists, using an agent-controlled mailbox."
      : "You may NOT create new accounts. If none exists, block with needs_operator_account.",
    "You may never send outreach. Drafting is your job; sending is a human's.",
  ].join("\n")
}
