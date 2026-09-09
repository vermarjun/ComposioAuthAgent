/** The run brief handed to auth-scout. Kept in one place so the eval and the
 *  API cannot drift apart. */

import { describe as describePolicy } from "./core/policy.ts"

export type RunInput = {
  platform: string
  homepage?: string
  docs_url?: string
  notes?: string
  applicant?: {
    app_name?: string
    homepage?: string
    contact_email?: string
    redirect_uri?: string
    privacy_policy_url?: string
    description?: string
  }
}

export function brief(input: RunInput): string {
  const a = input.applicant ?? {}
  const app = a.app_name ?? process.env.APPLICANT_APP_NAME ?? "Composio"
  const home = a.homepage ?? process.env.APPLICANT_HOMEPAGE ?? "https://composio.dev"
  const email = a.contact_email ?? process.env.APPLICANT_CONTACT_EMAIL ?? "support@composio.dev"
  const redirect =
    a.redirect_uri ?? process.env.OAUTH_REDIRECT_URI ?? "https://backend.composio.dev/api/v1/auth-apps/add"
  const privacy = a.privacy_policy_url ?? process.env.APPLICANT_PRIVACY_URL ?? "https://composio.dev/privacy"
  const desc =
    a.description ??
    "Composio gives AI agents authenticated access to SaaS tools on behalf of end users."

  return [
    `Platform: ${input.platform}`,
    input.homepage ? `Homepage: ${input.homepage}` : null,
    input.docs_url ? `Developer docs (supplied): ${input.docs_url}` : null,
    input.notes ? `Operator notes: ${input.notes}` : null,
    "",
    "Applicant details, for any form or registration you fill:",
    `  application name: ${app}`,
    `  homepage: ${home}`,
    `  contact email: ${email}`,
    `  redirect / callback URI: ${redirect}`,
    `  privacy policy: ${privacy}`,
    `  description: ${desc}`,
    "",
    describePolicy(),
    "",
    "Work the problem and finish by calling emit_packet.",
  ]
    .filter(Boolean)
    .join("\n")
}
