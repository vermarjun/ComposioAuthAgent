import { useState, type ReactNode } from "react"
import { AlertOctagon, CheckCircle2, Eye, EyeOff, HelpCircle, XCircle } from "lucide-react"

import { Button } from "@/components/ui/button"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { NumberTicker } from "@/components/ui/number-ticker"
import { CopyButton, Empty, KV, Link, Mono, Panel } from "@/components/primitives"
import { SecretRow } from "@/components/secret-row"
import { Shot } from "@/components/shot"
import { PATH_LABEL, STATUS_LABEL, STATUS_TONE, toneClass, toneDot } from "@/lib/vocab"
import type { Packet } from "@/lib/types"
import { cn } from "@/lib/utils"

const dash = (v: string | null | undefined) => (v && String(v).length ? v : null)

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <TableRow>
      <TableHead className="w-56 align-top font-normal text-ink-secondary">{label}</TableHead>
      <TableCell className="align-top">{value ?? <Empty>—</Empty>}</TableCell>
    </TableRow>
  )
}

function Banner({ packet }: { packet: Packet }) {
  const status = packet.acquisition.status
  const tone = STATUS_TONE[status] ?? "neutral"
  const agreement = packet.oracles?.agreement ?? null

  const Icon =
    tone === "ok"
      ? CheckCircle2
      : tone === "bad"
        ? XCircle
        : tone === "warn"
          ? AlertOctagon
          : HelpCircle

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Icon
            className={cn("mt-0.5 size-5 shrink-0", toneClass[tone].split(" ")[0])}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-[15px] font-medium text-foreground">
              {STATUS_LABEL[status] ?? status}
            </p>
            <p className="mt-0.5 font-mono text-[12.5px] text-ink-secondary">
              {packet.platform} · {PATH_LABEL[packet.acquisition.path] ?? packet.acquisition.path} ·{" "}
              {packet.auth.scheme}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-6">
          <div className="text-right">
            <p className="text-[11.5px] text-ink-secondary">Oracles</p>
            <p className="font-mono text-[13px] text-foreground">{agreement ?? "no_oracle"}</p>
          </div>
          <div className="text-right">
            <p className="text-[11.5px] text-ink-secondary">Confidence</p>
            <p className="font-mono text-[13px] text-foreground">
              <NumberTicker
                value={Math.round((packet.confidence ?? 0) * 100)}
                className="font-mono text-[13px] tracking-normal text-current dark:text-current"
              />
              %
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ResultPanel({ packet }: { packet: Packet }) {
  const [payloadShown, setPayloadShown] = useState(false)
  const creds = packet.composio_auth_config?.credentials ?? {}
  const credEntries = Object.entries(creds).filter(([, v]) => v !== null && v !== undefined)
  const blocked = packet.acquisition.status === "blocked"
  const invalid = packet.verification?.invalid_client
  const verifyTone = invalid === false ? "ok" : invalid === true ? "bad" : "neutral"
  const shots = packet.acquisition.screenshots ?? []
  const evidence = packet.evidence ?? []
  const configJson = JSON.stringify(packet.composio_auth_config, null, 2)

  // The credentials card masks secrets, so printing them in full two panels
  // lower defeats it. A screenshot of this page must never carry a live one.
  const redactedJson = JSON.stringify(
    packet.composio_auth_config
      ? {
          ...packet.composio_auth_config,
          credentials: Object.fromEntries(
            Object.entries(packet.composio_auth_config.credentials ?? {}).map(([k, v]) => [
              k,
              /secret|token|password|key/i.test(k) && v ? "•".repeat(24) : v,
            ]),
          ),
        }
      : null,
    null,
    2,
  )
  const hasSecret = redactedJson !== configJson

  return (
    <div className="flex flex-col gap-3">
      <Banner packet={packet} />

      {blocked && (
        <Panel title="What a human must do">
          <p className="mb-2 flex flex-wrap items-center gap-2">
            <code className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[12px] text-bad">
              {packet.acquisition.blocked_reason ?? "unspecified"}
            </code>
            {packet.acquisition.blocker_class && (
              <span
                className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] tracking-wide text-ink-secondary uppercase"
                title="What kind of thing is in the way — this decides who picks it up"
              >
                {packet.acquisition.blocker_class}
              </span>
            )}
          </p>
          {/* The single change that would move this run forward. A config
              blocker is an engineer's afternoon; a human one is a BD email. */}
          {packet.acquisition.unblocked_by && (
            <p className="mb-2 text-[13px] leading-relaxed text-ink-secondary">
              <span className="font-mono text-[11px] tracking-wide uppercase">unblocked by </span>
              {packet.acquisition.unblocked_by}
            </p>
          )}
          <p className="text-[13.5px] leading-relaxed text-foreground">
            {packet.acquisition.human_action_required ?? "No action was recorded for this block."}
          </p>
          {dash(packet.resolved.registration_url) && (
            <p className="mt-3">
              <Link href={packet.resolved.registration_url!}>
                {packet.resolved.registration_url}
              </Link>
            </p>
          )}
        </Panel>
      )}

      <Panel
        title="Credentials"
        aside={
          credEntries.length > 0 ? (
            <span className="font-mono text-[11px] text-ink-secondary">
              {packet.composio_auth_config?.toolkit} · {packet.composio_auth_config?.auth_scheme}
            </span>
          ) : undefined
        }
      >
        {credEntries.length === 0 ? (
          <Empty>
            No credentials in this packet
            {packet.acquisition.path === "none_needed"
              ? " — this platform has no developer app to obtain."
              : "."}
          </Empty>
        ) : (
          <div>
            {credEntries.map(([k, v]) => (
              <SecretRow key={k} name={k} value={String(v)} />
            ))}
          </div>
        )}
      </Panel>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Auth" bodyClassName="p-0">
          <div
            role="region"
            className="thin-scroll overflow-x-auto"
            tabIndex={0}
            aria-label="Auth details"
          >
            <Table>
              <TableBody>
                <Row label="scheme" value={<Mono>{packet.auth.scheme}</Mono>} />
                <Row
                  label="alternatives"
                  value={
                    packet.auth.alternatives?.length ? (
                      <Mono>{packet.auth.alternatives.join(", ")}</Mono>
                    ) : null
                  }
                />
                <Row
                  label="authorization_endpoint"
                  value={
                    dash(packet.auth.authorization_endpoint) && (
                      <Link href={packet.auth.authorization_endpoint!} />
                    )
                  }
                />
                <Row
                  label="token_endpoint"
                  value={
                    dash(packet.auth.token_endpoint) && <Link href={packet.auth.token_endpoint!} />
                  }
                />
                <Row
                  label="registration_endpoint"
                  value={
                    dash(packet.auth.registration_endpoint) && (
                      <Link href={packet.auth.registration_endpoint!} />
                    )
                  }
                />
                <Row
                  label="scopes_requested"
                  value={
                    packet.auth.scopes_requested?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {packet.auth.scopes_requested.map((s) => (
                          <code
                            key={s}
                            className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[11.5px]"
                          >
                            {s}
                          </code>
                        ))}
                      </div>
                    ) : null
                  }
                />
                <Row
                  label="connect_time_fields"
                  value={
                    packet.auth.connect_time_fields?.length ? (
                      <Mono>{packet.auth.connect_time_fields.join(", ")}</Mono>
                    ) : null
                  }
                />
              </TableBody>
            </Table>
          </div>
        </Panel>

        <div className="flex flex-col gap-3">
          <Panel title="Resolved">
            <dl>
              <KV label="origin">
                {dash(packet.resolved.origin) ? (
                  <Link href={packet.resolved.origin!} />
                ) : (
                  <Empty>—</Empty>
                )}
              </KV>
              <KV label="developer docs">
                {dash(packet.resolved.developer_docs) ? (
                  <Link href={packet.resolved.developer_docs!} />
                ) : (
                  <Empty>—</Empty>
                )}
              </KV>
              <KV label="registration url">
                {dash(packet.resolved.registration_url) ? (
                  <Link href={packet.resolved.registration_url!} />
                ) : (
                  <Empty>—</Empty>
                )}
              </KV>
              <KV label="already in composio">
                <Mono
                  className={packet.resolved.already_in_composio ? "text-ok" : "text-ink-secondary"}
                >
                  {String(packet.resolved.already_in_composio)}
                  {packet.resolved.composio_slug ? ` · ${packet.resolved.composio_slug}` : ""}
                  {packet.resolved.composio_managed ? " · managed" : ""}
                </Mono>
              </KV>
            </dl>
          </Panel>

          <Panel title="Verification">
            <div
              className={cn(
                "flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md border px-3 py-2",
                toneClass[verifyTone],
              )}
            >
              <span className="flex items-center gap-2">
                <span className={cn("size-1.5 rounded-full", toneDot[verifyTone])} aria-hidden />
                <span className="font-mono text-[12.5px]">
                  invalid_client = {invalid === null || invalid === undefined ? "null" : String(invalid)}
                </span>
              </span>
              <span className="font-mono text-[12px]">
                {dash(packet.verification?.method) ?? "no method"}
              </span>
              <span className="font-mono text-[12px]">
                {dash(packet.verification?.result) ?? "no result"}
              </span>
              {dash(packet.verification?.checked_at) && (
                <span className="font-mono text-[12px]">
                  {packet.verification.checked_at}
                </span>
              )}
            </div>
          </Panel>
        </div>
      </div>

      <Panel title="Cross-checks" bodyClassName="p-0">
        <div
          role="region"
          className="thin-scroll overflow-x-auto"
          tabIndex={0}
          aria-label="Cross-check details"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-56">Oracle</TableHead>
                <TableHead>Says</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="text-ink-secondary">composio catalog</TableCell>
                <TableCell>
                  <Mono>{dash(packet.oracles?.composio_scheme) ?? "not listed"}</Mono>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="text-ink-secondary">nango providers</TableCell>
                <TableCell>
                  <Mono>{dash(packet.oracles?.nango_auth_mode) ?? "not listed"}</Mono>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="text-ink-secondary">this run</TableCell>
                <TableCell>
                  <Mono>{packet.auth.scheme}</Mono>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="text-ink-secondary">agreement</TableCell>
                <TableCell>
                  <Mono
                    className={cn(
                      packet.oracles?.agreement === "agree" && "text-ok",
                      packet.oracles?.agreement === "disagree" && "text-bad",
                    )}
                  >
                    {packet.oracles?.agreement ?? "no_oracle"}
                  </Mono>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </Panel>

      <Panel
        title="Payload for agent #3"
        aside={
          <span className="flex items-center gap-1.5">
            {hasSecret && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPayloadShown((v) => !v)}
                className="h-7 gap-1.5 px-2 text-[11px]"
              >
                {payloadShown ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                {payloadShown ? "Hide secrets" : "Reveal secrets"}
              </Button>
            )}
            {/* Copy always yields the real payload, masked on screen or not. */}
            {packet.composio_auth_config && <CopyButton value={configJson} label="Copy JSON" />}
          </span>
        }
        bodyClassName={packet.composio_auth_config ? "p-0" : undefined}
      >
        {packet.composio_auth_config ? (
          <pre
            role="region"
            tabIndex={0}
            aria-label="Agent payload"
            className="thin-scroll max-h-80 overflow-auto p-4 font-mono text-[12px] leading-5"
          >
            {payloadShown ? configJson : redactedJson}
          </pre>
        ) : (
          <Empty>
            Nothing to hand over. This run produced no auth config, so agent #3 has no toolkit
            to configure.
          </Empty>
        )}
      </Panel>

      {packet.acquisition.form_draft && (
        <Panel
          title="Form draft"
          aside={
            <CopyButton
              value={JSON.stringify(packet.acquisition.form_draft, null, 2)}
              label="Copy JSON"
            />
          }
        >
          <dl>
            {Object.entries(packet.acquisition.form_draft).map(([k, v]) => (
              <KV key={k} label={k}>
                <Mono>{String(v)}</Mono>
              </KV>
            ))}
          </dl>
        </Panel>
      )}

      {packet.acquisition.outreach_draft && (
        <Panel
          title="Outreach draft"
          aside={
            <CopyButton value={packet.acquisition.outreach_draft.body} label="Copy body" />
          }
        >
          <dl className="mb-3">
            <KV label="to">
              <Mono>{dash(packet.acquisition.outreach_draft.to) ?? "recipient unknown"}</Mono>
            </KV>
            <KV label="subject">
              <Mono>{packet.acquisition.outreach_draft.subject}</Mono>
            </KV>
          </dl>
          <pre
            role="region"
            tabIndex={0}
            aria-label="Outreach draft body"
            className="thin-scroll max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-secondary p-3 font-mono text-[12px] leading-5"
          >
            {packet.acquisition.outreach_draft.body}
          </pre>
        </Panel>
      )}

      {shots.length > 0 && (
        <Panel title={`Screenshots · ${shots.length}`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {shots.map((src, i) => (
              <Shot key={src + i} src={src} index={i} />
            ))}
          </div>
        </Panel>
      )}

      <Panel title={`Evidence · ${evidence.length}`}>
        {evidence.length === 0 ? (
          <Empty>No URLs were recorded for this run.</Empty>
        ) : (
          <ul className="flex flex-col gap-1">
            {evidence.map((url, i) => (
              <li key={url + i} className="flex items-baseline gap-2">
                <span className="w-6 shrink-0 text-right font-mono text-[11.5px] text-ink-secondary">
                  {i + 1}
                </span>
                <Link href={url} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {dash(packet.notes) && (
        <Panel title="Notes">
          <p className="text-[13.5px] leading-relaxed text-foreground">{packet.notes}</p>
        </Panel>
      )}
    </div>
  )
}
