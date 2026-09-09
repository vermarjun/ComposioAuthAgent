/**
 * Reading credentials off a developer portal.
 *
 * After an app is registered the portal shows the client id and secret once,
 * usually in a readonly input or a copy-to-clipboard block, labelled in a dozen
 * different ways: "Client ID", "Consumer Key", "App ID", "API Key". Asking the
 * model to eyeball a screenshot for this is the least reliable way to do it and
 * the easiest way to hallucinate a plausible-looking secret.
 *
 * So the page is interrogated directly. A script walks the DOM pairing labels
 * with values, and a text pass catches what the DOM pass misses.
 */

import { exec } from "./browser.ts"

export type Extracted = {
  client_id: string | null
  client_secret: string | null
  /** Everything label-like that was found, for the packet's audit trail. */
  pairs: { label: string; value: string; source: string }[]
  warnings: string[]
}

const ID_LABELS = [
  "client id", "client_id", "clientid", "app id", "application id", "consumer key",
  "api key id", "key id", "oauth client id", "integration id", "app key",
]
const SECRET_LABELS = [
  "client secret", "client_secret", "clientsecret", "app secret", "consumer secret",
  "api secret", "secret key", "oauth client secret", "private key", "app password",
]

/**
 * Runs in the page. Deliberately dependency-free and defensive: it executes in
 * whatever the portal's environment happens to be.
 */
const PAGE_SCRIPT = `(() => {
  const out = [];
  const clean = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const plausible = (v) => v && v.length >= 8 && v.length <= 200 && !/\\s/.test(v);

  // 1. Readonly / disabled inputs are the most common presentation.
  for (const el of document.querySelectorAll("input, textarea")) {
    const v = clean(el.value);
    if (!plausible(v)) continue;
    let label = "";
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l) label = clean(l.textContent);
    }
    if (!label) label = clean(el.getAttribute("aria-label") || el.getAttribute("name") || el.getAttribute("placeholder"));
    if (!label) {
      // Walk up looking for a nearby text node acting as a label.
      let p = el.parentElement, hops = 0;
      while (p && hops++ < 3 && !label) {
        const t = clean(p.textContent).slice(0, 80);
        if (t && t !== v) label = t;
        p = p.parentElement;
      }
    }
    out.push({ label: label.slice(0, 80), value: v, source: "input" });
  }

  // 2. code / pre / [data-clipboard] blocks.
  for (const el of document.querySelectorAll("code, pre, [data-clipboard-text], [data-copy]")) {
    const v = clean(el.getAttribute("data-clipboard-text") || el.getAttribute("data-copy") || el.textContent);
    if (!plausible(v)) continue;
    let label = "";
    let p = el.parentElement, hops = 0;
    while (p && hops++ < 3 && !label) {
      const t = clean(p.textContent).replace(v, "").slice(0, 80);
      if (t) label = t;
      p = p.parentElement;
    }
    out.push({ label: label.slice(0, 80), value: v, source: "code" });
  }

  // 3. Definition-list and table rows: label in one cell, value in the next.
  for (const row of document.querySelectorAll("tr, dl > div, .row")) {
    const cells = row.querySelectorAll("td, th, dt, dd, div, span");
    if (cells.length < 2) continue;
    const label = clean(cells[0].textContent).slice(0, 80);
    const value = clean(cells[cells.length - 1].textContent);
    if (label && plausible(value) && label !== value) {
      out.push({ label, value, source: "row" });
    }
  }
  return JSON.stringify(out.slice(0, 120));
})()`

function matches(label: string, needles: string[]): boolean {
  const l = label.toLowerCase()
  return needles.some((n) => l.includes(n))
}

/** Reject UI chrome that happens to sit next to a value. */
function isNoise(value: string): boolean {
  return (
    /^(https?:|\/|#)/i.test(value) ||
    /^(copy|show|hide|reveal|regenerate|delete|save|cancel)$/i.test(value) ||
    /^[•*]+$/.test(value)
  )
}

export async function fromPage(session: string): Promise<Extracted> {
  const warnings: string[] = []
  const r = await exec(["eval", PAGE_SCRIPT], session, 45000)

  let raw: { label: string; value: string; source: string }[] = []
  if (r.code === 0) {
    // agent-browser serialises the expression result, so a string return
    // arrives JSON-encoded and has to be unwrapped before it will parse.
    const text = r.stdout.trim()
    let payload = text
    try {
      const once = JSON.parse(text)
      if (typeof once === "string") payload = once
      else if (Array.isArray(once)) raw = once
    } catch {
      /* not JSON at the outer level; fall through to the array scan */
    }
    if (!raw.length) {
      const m = payload.match(/\[[\s\S]*\]/)
      if (m) {
        try {
          raw = JSON.parse(m[0])
        } catch {
          warnings.push("page script returned unparseable output")
        }
      } else if (text) {
        warnings.push("page script produced no JSON array")
      }
    }
  } else {
    warnings.push(`page script failed: ${r.stderr.trim().slice(0, 160)}`)
  }

  const pairs = raw.filter((p) => p.value && !isNoise(p.value))

  const idHit = pairs.find((p) => matches(p.label, ID_LABELS))
  const secretHit = pairs.find((p) => matches(p.label, SECRET_LABELS))

  // A secret shown as bullets means it is present but still hidden; that is a
  // different problem from "not on this page" and the agent should click reveal.
  if (!secretHit && raw.some((p) => matches(p.label, SECRET_LABELS) && /^[•*]+$/.test(p.value))) {
    warnings.push("a secret field is present but masked — click its reveal/show control, then extract again")
  }

  return {
    client_id: idHit?.value ?? null,
    client_secret: secretHit?.value ?? null,
    pairs: pairs.slice(0, 40),
    warnings,
  }
}

/** Fallback for portals that render credentials as plain prose. */
export function fromText(text: string): Extracted {
  const pairs: Extracted["pairs"] = []
  const re = /([A-Za-z][A-Za-z ._-]{2,40})\s*[:=]\s*([A-Za-z0-9._~+/-]{8,200})/g
  for (const m of text.matchAll(re)) {
    pairs.push({ label: m[1]!.trim(), value: m[2]!.trim(), source: "text" })
  }
  return {
    client_id: pairs.find((p) => matches(p.label, ID_LABELS))?.value ?? null,
    client_secret: pairs.find((p) => matches(p.label, SECRET_LABELS))?.value ?? null,
    pairs: pairs.slice(0, 40),
    warnings: [],
  }
}
