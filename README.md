# Auth Acquisition Agent

Type a platform name. The agent figures out how that platform lets a third
party act on a user's behalf, then goes and gets the credential. If it can't,
it says exactly what stopped it and what a person has to do.

Live: https://authagent.13-201-224-106.sslip.io/

## Why bother

Credentials come into existence three ways, and only one of them is hard.

Most platforms just want an API key from the user. Nothing to acquire, no
developer app, and 1,235 of Composio's 1,517 toolkits work like this.

Some publish an RFC 7591 registration endpoint. A machine posts a JSON body and
gets back a real `client_id` and `client_secret`. No human anywhere. That's 86
toolkits today and the number is climbing fast, mostly on MCP surfaces.

The rest need a person to open a developer portal, log in, fill a form, and
sometimes wait for approval. 85 OAuth toolkits sit here. Composio has
hand-written registration guides for 45 apps. Nango has 164 across 992
providers. Both are miles behind their own catalogues, because this step runs
at human speed. So that's the step that gets a browser.

## What comes out

One typed packet, never prose:

```
acquisition.status   credentials_obtained | no_app_required | draft_ready
                     | outreach_queued | blocked
blocked_reason       needs_operator_account | email_verification_required
                     | mfa_required | captcha_blocked | application_form_required
                     | partner_program_required | security_review_required | ...
```

The credential payload is shaped like Composio's own auth-config API, so
nothing downstream has to translate it.

Three rules a validator enforces before any packet ships:

1. `credentials_obtained` needs a `client_id` and a verification that actually
   spent it against the platform's authorize endpoint. Claiming a credential
   isn't the same as having one.
2. API-key, bearer and basic schemes may never carry a `client_secret`. There's
   no app to have a secret. An agent that returns one made it up.
3. `blocked` needs a typed reason and a concrete next action for a human. A
   blocked run is a good outcome when it's honest.

## How it runs

```
browser ── POST /api/runs ─▶ Hono control plane   (run_id in <1s, then polling)
                                   │
                           opencode serve (child process)
                             tools   .opencode/tool/*.ts
                             mcp     agent-browser
                                   │
              ┌────────────────────┼────────────────────┐
        AgentCore cloud       DynamoDB + S3          model via xypro
           browser         (local disk if no AWS)
```

opencode gives you the tool loop, sessions, retries and per-tool permissions.
What's written here is the thirteen tools (`composio_lookup`, `nango_lookup`,
`auth_discover`, `dcr_register`, `oauth_verify`, `docs_find`, `contact_find`,
`portal_signup`, `portal_login`, `credentials_extract`, `mail_wait`,
`captcha_solve`, `emit_packet`), the agent prompts, the validator, and a
control plane with a React dashboard that streams a run while it happens.

Two decisions worth knowing about. The model never sees a password: the login
tool looks the account up itself and types the value, so nothing lands in a
tool result or a run log. And credentials are read out of the DOM, never off a
screenshot, because asking a model to read a secret from an image is the
fastest way to get a convincing hallucination.

## Run it

```bash
cp .env.example .env    # a COMPOSIO_API_KEY and a model endpoint is the minimum
bun install
bun run dev             # http://127.0.0.1:8080
bun test
bun run eval            # scores against eval/golden.csv
```

`scripts/deploy-ec2.sh <pem> <user@host>` puts it on a single box behind TLS.
`DEMO.md` walks four runs end to end, including the one that gets blocked.

Credential values in `eval/results.*.json` and `DEMO.md` are redacted. The real
ones were minted live during those runs.
