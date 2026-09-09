import { tool } from "@opencode-ai/plugin"
import { start, provider } from "../../src/core/browser.ts"
import { runId, setLiveView, log, json } from "../../src/core/runctx.ts"

export default tool({
  description:
    "Start a browser session for this run and get back the session name. Pass that name as the `session` argument to every browser_* tool afterwards so this run does not collide with another. On AgentCore it also returns a Live View URL a human can open to watch the browser in real time.",
  args: {},
  async execute(_args, ctx) {
    const id = (await runId(ctx as any)) ?? "adhoc"
    const s = await start(id)
    await setLiveView(ctx as any, s.live_view_url)
    await log(ctx as any, "browser", `session ${s.name} (${s.provider}) ${s.live_view_url ?? ""}`)
    if (!s.ok) {
      return json({
        ok: false,
        session: s.name,
        reason: s.note,
        instruction:
          "The browser did not start, so every navigation will fail. Do not continue down the browser path — retry browser_session once, and if it fails again block with needs_operator_account and say the browser could not be launched.",
      })
    }
    return json({
      ok: true,
      session: s.name,
      provider: s.provider,
      live_view_url: s.live_view_url,
      note: s.note,
      how_to_use: `Pass session="${s.name}" to every browser_agent_browser_* tool call.`,
      warning:
        provider() === "agentcore" && !s.live_view_url
          ? "No Live View URL. AgentCore may not be enabled on this AWS account."
          : undefined,
    })
  },
})
