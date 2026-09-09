/** Generates the objective half of the gold set: whether a platform speaks DCR
 *  is a fact about its well-known documents, not a judgement call. */
import { Evidence } from "../src/core/http.ts"
import { discoverBest } from "../src/core/discover.ts"
import * as nango from "../src/core/nango.ts"

const LIST = process.argv.slice(2)
const out: string[] = []
await Promise.all(
  LIST.map(async (p) => {
    const ev = new Evidence()
    const d = await discoverBest(p, ev)
    const n = nango.lookup(p)
    out.push([p, d.supports_dcr ? "DCR" : "-", d.metadata?.registration_endpoint ?? "", n?.auth_mode ?? ""].join("\t"))
  }),
)
out.sort().forEach((l) => console.log(l))
