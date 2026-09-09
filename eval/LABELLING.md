# How the gold set was labelled

20 platforms, stratified rather than sampled. A random draw of famous SaaS apps
flatters this agent, because the famous ones are the ones with clean public
docs.

## Two labels per row

`expected_scheme` — the scheme a third party would use to act **for a user**.
Where a platform supports several, the label is the one a connector would
actually pick, and the others are acceptable in `auth.alternatives`.

`expected_path` — the route by which a credential is obtained. Also collapsed
into `coarse`, which is the label I trust more:

| coarse | meaning |
|---|---|
| `machine` | a machine can obtain the credential unaided (`dcr`) |
| `none` | no developer app exists at all (`none_needed`) |
| `human` | a person must open a portal or a queue (`self_serve`, `form`, `relationship`) |

Exact path is scored too, but the boundary between `self_serve` and `form` is a
judgement about a signup flow, and I would not defend every one of those calls
to two decimal places. The `machine` / `none` / `human` split is decidable, and
it is also the split that decides what Composio actually does next.

## Where the labels come from

- **The ten `dcr` rows are not judgement at all.** They were produced by
  fetching each platform's RFC 8414 / RFC 9728 documents and reading
  `registration_endpoint`. The `source` column is the document that was fetched.
  A row is `dcr` if and only if that field was present. This half of the gold
  set is reproducible with `bun run eval/probe.ts <platforms>`.
- **The `none_needed` rows** were read from each platform's own authentication
  docs, confirming the credential is issued to the account holder and that no
  client_id/client_secret concept exists.
- **The `human` rows** were labelled by opening the linked registration page and
  recording what it demands before it will issue credentials.

All labelling was done before the grader existed, and the grader was not tuned
against these rows afterwards.

## A label that changed after the fact

`asana.com` was originally labelled `dcr` / `machine` on the strength of its
published `registration_endpoint`. Running the agent against it showed the
endpoint answers `400 invalid_redirect_uri` and names Composio's callback in
`disallowed_uris`: Asana supports dynamic registration but allowlists who may
use it. The credential is therefore not obtainable unattended, and the row is
now `form` / `human` with the failing endpoint as its source.

The scheme label stayed `DCR_OAUTH`, because the platform genuinely speaks DCR.
What changed is the path.

**The agent then disagreed with the new label too, and it has the better
argument.** It reports `path: dcr`, `blocked_reason: redirect_uri_not_allowed`,
and:

> Have Asana allowlist `https://backend.composio.dev/api/v1/auth-apps/add` for
> the Composio DCR client, then retry RFC 7591 registration at
> `https://mcp.asana.com/register`.

That is more useful than `form`, which implies a registration form exists to
fill in. There is none; the fix is an allowlist entry. The row is scored as a
miss anyway and the label has been left alone. Moving it a second time to match
the agent would be tuning the grader against the thing it grades, and the honest
version of this number includes a row where the answer is better than the key.

## Known soft spots

- `servicenow.com` is labelled `form`, but the honest answer is per-tenant: the
  OAuth app is registered inside each customer's own instance, so Composio can
  never hold one global secret. The agent is expected to surface
  `per_tenant_only`, and scoring it as `form` slightly undersells a correct answer.
- `stripe.com` legitimately answers to both `DCR_OAUTH` and `API_KEY`. It is
  labelled `DCR_OAUTH` because that is the route that yields a credential
  without a human, which is the decision the packet exists to drive.
- 20 rows is small. One flipped label moves accuracy by five points, and the
  numbers should be read with that in mind.


---

# The second set, and why seven of its labels moved

`eval/golden-composio100.csv` is drawn from the 100 apps researched in the
previous survey, and inherits that project's labels for `primary_auth` and
`access`. Graded against those labels as written, this agent scored 53% on
scheme and 26% on exact path — bad enough to be worth looking at rather than
reporting.

Nearly every miss ran the same way: the agent answered `DCR_OAUTH` / `dcr`
where the label said `OAUTH2` or `API_KEY`, **and came back with a credential
the platform then accepted**. So either the agent was inventing dynamic
registration on seven platforms and the credentials were fictional, or the
labels were out of date.

That is decidable without an opinion. `eval/probe.ts` fetches each platform's
RFC 8414 / RFC 9728 documents and reads `registration_endpoint`:

```
ahrefs.com     DCR   https://api.ahrefs.com/mcp/register
airtable.com   DCR   https://airtable.com/oauth2/v1/register
apify.com      DCR   https://console-backend.apify.com/oauth/apps
attio.com      DCR   https://app.attio.com/oauth/register
cloudflare.com DCR   https://mcp.cloudflare.com/register
consensus.app  DCR   https://consensus.app/oauth/register/
klaviyo.com    DCR   https://mcp.klaviyo.com/register
aircall.io     -
```

Seven of the eight publish one. Those seven rows were relabelled to `DCR_OAUTH`
/ `dcr` / `machine`, with the failing document as the row's `source`. The
original labels were not wrong when they were written — they predate these
platforms shipping MCP surfaces with dynamic registration, which is a fast
moving thing.

**This is a label change made after results existed, so it needs the same
scrutiny as the asana row above.** The distinction that makes it legitimate:
the correction was decided by a deterministic probe of the platforms' own
documents, using the same rule the first gold set already used for its `dcr`
rows, and applied to every row that rule matched rather than only the ones the
agent got "wrong". `aircall.io` failed the probe and was left alone, and the
agent is still scored a miss on it.

Anyone can re-derive the change:

```bash
bun run eval/probe.ts attio.com apify.com cloudflare.com klaviyo.com \
  consensus.app airtable.com ahrefs.com aircall.io
```

The pre-relabel numbers are kept in
`eval/results.golden-composio100.pre-relabel.json`, and both are reported.

**One platform the rule matched and was not relabelled.** `devin.ai` answers the
same probe with a `registration_endpoint` at `https://auth.devin.ai/oidc/register`.
It was left as `API_KEY` / `none_needed` because the scopes that endpoint
advertises are consumer identity — `openid profile email phone address` — not
API delegation: it is Devin's own login, not a surface a third party registers
against to act for a user. The distinction is a judgement, so it is written down
rather than left for someone re-running the command to find. The agent reached
`API_KEY` / `none_needed` for Devin independently, so relabelling would not have
changed its score either way.
