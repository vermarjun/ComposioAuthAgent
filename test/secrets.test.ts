import { expect, test, describe } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/**
 * A password is kept out of the model's context by convention — the tools type
 * it rather than returning it — and conventions rot. These tests fail if a
 * future edit starts passing it anywhere else.
 */
describe("operator password containment", () => {
  const TOOLS = join(import.meta.dir, "..", ".opencode", "tool")

  test("acc.password only ever reaches fillSecret", () => {
    const offenders: string[] = []
    for (const f of readdirSync(TOOLS).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(TOOLS, f), "utf8")
      for (const [i, line] of src.split("\n").entries()) {
        if (!/\bacc\.password\b/.test(line)) continue
        // The only sanctioned use: handing it straight to the browser.
        if (/fillSecret\s*\(/.test(line)) continue
        offenders.push(`${f}:${i + 1}  ${line.trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })

  test("no tool returns or logs a password field", () => {
    const offenders: string[] = []
    for (const f of readdirSync(TOOLS).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(TOOLS, f), "utf8")
      // A json({...}) or log() call that mentions the account's password.
      const risky = /(?:json|log)\s*\([^)]*\bacc\.password\b/s
      if (risky.test(src)) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })

  test("the vault never writes plaintext", async () => {
    const vault = await import("../src/core/vault.ts")
    const KEY = process.env.VAULT_KEY
    const VPATH = process.env.OPERATOR_VAULT_PATH
    process.env.VAULT_KEY = "containment-test-key"
    process.env.OPERATOR_VAULT_PATH = "/tmp/auth-agent-containment.enc"
    try {
      vault.put({
        platform: "leak.test", email: "a@b.test", password: "PLAINTEXT-CANARY-9271",
        inbox_id: null, status: "active",
        created_at: new Date().toISOString(), last_used_at: null, notes: null,
      })
      const raw = readFileSync("/tmp/auth-agent-containment.enc", "utf8")
      expect(raw).not.toContain("PLAINTEXT-CANARY-9271")
      expect(raw).not.toContain("leak.test")
      expect(vault.get("leak.test")?.password).toBe("PLAINTEXT-CANARY-9271")
    } finally {
      if (KEY === undefined) delete process.env.VAULT_KEY; else process.env.VAULT_KEY = KEY
      if (VPATH === undefined) delete process.env.OPERATOR_VAULT_PATH; else process.env.OPERATOR_VAULT_PATH = VPATH
    }
  })
})
