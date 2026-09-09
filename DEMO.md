# Four minutes with it

Open the URL, enter the password, and type a platform name. Everything below
takes one run each.

---

## 1. Linear — it hands you a real secret

Type `linear.app`.

About a minute later:

```
path: dcr        status: credentials_obtained
client_id        REDACTED
client_secret    REDACTED
verification     accepted: consent page rendered (HTTP 200), invalid_client false
```

Those exact values are from one run; yours will differ, because the credential
is minted fresh each time. That secret is real and was minted during the run. Linear publishes an RFC 7591
registration endpoint, so a machine can register an OAuth client with no human
anywhere in the loop. Nine of the twenty platforms on the primary
eval set hand one over this way, and the named ones below all do: Salesforce,
NetSuite, PayPal, Atlassian and Stripe each answer the probe with a live
registration endpoint (`bun run eval/probe.ts <domain>` re-derives it).

The credential is never claimed on faith. Before the packet says
`credentials_obtained`, the agent builds the real authorize URL with the new
client_id and asks Linear about it. A platform that does not recognise a client
says so, and the packet would say `blocked` instead.

That check is itself checked. The probe writes its verdict to the run, and the
packet is refused if it claims a verification no probe actually performed —
otherwise the guard only stops a model that forgets the field, not one that
fills in the value it knows validation wants.

## 2. OpenAI — the answer is "there is nothing to get"

Type `openai.com`.

```
path: none_needed    status: no_app_required
```

1,235 of Composio's 1,517 toolkits authenticate with a user-supplied API key.
No developer app exists on those platforms and none ever will, so there is no
client_secret to find — and an agent that returns one has invented it.

The validator enforces this: a packet carrying a `client_secret` on an
`API_KEY`, `BASIC`, `BEARER_TOKEN` or `NO_AUTH` scheme is rejected outright.
Recognising that there is nothing to acquire is a result, not a failure.

## 3. Xero — blocked, and precise about why

Type `xero.com`.

```
path: self_serve     status: blocked
blocked_reason       needs_operator_account
action               Log in to or create a Xero operator account at
                     https://developer.xero.com/app/manage, then complete the
                     app registration.
```

Xero has no dynamic registration and its portal is behind a login. With no
operator identity configured for Xero, the honest answer is a named blocker and
the exact URL a person needs — not a guess.

Give it an identity and it does not stop there, which is the next one.

## 4. The portal path — signup, login, form, credentials

This is the part that matters most, because route 3 is what gates most of the
catalogue and an agent that stops at a login wall has not done the job.

```bash
bun run portal:fixture      # a stand-in developer portal on :5232
```

Then run `127.0.0.1:5232`. The agent, unaided:

1. opens a browser session
2. works the **two-step login** — email, Continue, then email and password
3. navigates to "create a new OAuth app"
4. fills every field, including a "Country of incorporation" it has to infer
5. **screenshots the filled form before submitting**, so a human can check it
6. submits, reveals the masked secret, and reads both values out of the DOM
7. verifies and emits `credentials_obtained`

The fixture exists because this path cannot be demonstrated against real
companies on demand: it needs an account, it creates real records, and a failed
attempt is somebody's support ticket. It is deliberately awkward in the ways
real portals are.

Two things worth knowing about how it does this:

- **The model never sees a password.** `portal_login` looks the account up,
  finds the fields itself, and types the value. No password enters the
  conversation, a tool result, or a run log.
- **Credentials are read from the DOM, not from a screenshot.** Asking a model
  to read a secret off an image is the easiest way to get a plausible-looking
  hallucination.

---

## The number that explains why this exists

```
1,517 Composio toolkits

OAuth toolkits                        207
  with a Composio-managed OAuth app   122
  requiring BYO client_id/secret       85   <-- registered by hand, one at a time
```

Composio has hand-written the "how to register your OAuth app" guide for 45
apps. Nango, doing the same job in the open, has 164 across 992 providers. Both
are far behind their own catalogues, because the work is a person opening a
developer portal and filling in a form.

## Where it is weakest

- The gold set is 20 rows on one sheet and 19 on the other. One flipped label
  moves a percentage by four or five points, so read every figure here with
  that width.
- The same set does not score identically twice. Two consecutive runs of the
  second set on the same commit minted 14 and 9 credentials: the classification
  is stable, the count of live registrations is not, because it depends on
  endpoints that rate limit and occasionally refuse what they accepted a minute
  earlier.
- Dynamic registration is concentrated in MCP surfaces today. It is growing
  quickly, but it does not reach the long tail yet.
- Portal work presumes an operator identity exists, or that
  `ACQUISITION_MODE=full` permits creating one. That is a policy decision for
  Composio, not something the agent should assume.

`eval/LABELLING.md` records the one label changed after the grader existed, and
the row where the agent disagrees with the label and has the better argument.
