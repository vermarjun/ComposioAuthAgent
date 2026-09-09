import { tool } from "@opencode-ai/plugin"
import { emit, scoreOracles } from "../../src/core/packet.ts"
import { runId, json } from "../../src/core/runctx.ts"
import { PATHS, STATUSES, SCHEMES, BLOCKED_REASONS } from "../../src/core/schema.ts"

export default tool({
  description:
    `THE ONLY WAY TO FINISH A RUN. Submit the acquisition packet. Rejected packets come back with field errors — fix them and call again. Never answer in prose instead of calling this.

Vocabularies (use these exact strings):
  acquisition.path   : ${PATHS.join(" | ")}
  acquisition.status : ${STATUSES.join(" | ")}
  auth.scheme        : ${SCHEMES.join(" | ")}
  blocked_reason     : ${BLOCKED_REASONS.join(" | ")}

Credentials go in composio_auth_config.credentials, e.g.

  {
    "platform": "linear.app",
    "auth": { "scheme": "DCR_OAUTH", "authorization_endpoint": "...", "registration_endpoint": "..." },
    "acquisition": { "path": "dcr", "status": "credentials_obtained" },
    "composio_auth_config": {
      "toolkit": "linear",
      "auth_scheme": "OAUTH2",
      "credentials": { "client_id": "...", "client_secret": "...", "scopes": "read write" }
    },
    "verification": { "method": "authorize_endpoint_probe", "result": "...", "invalid_client": false },
    "oracles": { "composio_scheme": "OAUTH2", "nango_auth_mode": "OAUTH2" },
    "confidence": 0.9
  }

Omit blocked_reason entirely unless the status is blocked. Pick the reason that
names the FIRST thing that actually stopped you, not the most impressive one:
"the signup form wanted a phone number" is sms_verification_required, not
partner_program_required. The packet derives a blocker class from your choice
(config / capability / commercial / human / structural), and that class is what
tells Composio whether to spend an engineer, a budget line, or a BD person — so
a wrong reason sends the work to the wrong desk.

Rules enforced by validation:
  - status credentials_obtained requires a client_id AND verification.invalid_client === false
  - status blocked requires a blocked_reason and a concrete human_action_required
  - API_KEY / BEARER_TOKEN / BASIC / NO_AUTH must never carry a client_secret; use path none_needed
  - evidence must contain at least one URL that was actually fetched`,
  args: {
    packet: tool.schema
      .string()
      .describe("The full packet as a JSON object string. Omit run_id and evidence; they are filled in for you."),
  },
  async execute(args, ctx) {
    let parsed: any
    try {
      parsed = JSON.parse(args.packet)
    } catch (e: any) {
      return json({ accepted: false, errors: [{ field: "packet", message: `not valid JSON: ${e.message}` }] })
    }

    const id = await runId(ctx as any)
    if (!id) return json({ accepted: false, errors: [{ field: "run_id", message: "no run bound to this session" }] })

    const r = await emit(id, parsed)
    if (!r.ok) {
      return json({
        accepted: false,
        errors: r.errors,
        instruction: "Fix exactly these fields and call emit_packet again.",
      })
    }
    const oracles = scoreOracles(r.packet)
    return json({
      accepted: true,
      run_id: id,
      oracle_agreement: oracles.agreement,
      summary: `${r.packet.acquisition.path} / ${r.packet.acquisition.status}`,
      note: "Run complete. Stop now; do not call any further tools.",
    })
  },
})
