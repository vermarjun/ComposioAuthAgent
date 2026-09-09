import { expect, test, describe, afterAll } from "bun:test"
import { fromText } from "../src/core/extract.ts"
import { findEmailField, findPasswordField, findSubmit, type Field } from "../src/core/browser.ts"
import * as vault from "../src/core/vault.ts"

describe("credential extraction", () => {
  test("pulls client id and secret out of prose", () => {
    const e = fromText("Client ID: Iv1.8a61f9b3c6d24e07\nClient Secret = 9f2b1c47ae5d38016b7c0e9a4d5f2318cc7b91ea")
    expect(e.client_id).toBe("Iv1.8a61f9b3c6d24e07")
    expect(e.client_secret).toBe("9f2b1c47ae5d38016b7c0e9a4d5f2318cc7b91ea")
  })
  test("recognises the other names portals use", () => {
    expect(fromText("Consumer Key: abcd1234efgh5678").client_id).toBe("abcd1234efgh5678")
    expect(fromText("App Secret: zzzz9999yyyy8888").client_secret).toBe("zzzz9999yyyy8888")
  })
  test("does not mistake a callback URL for a credential", () => {
    const e = fromText("Callback URL: https://backend.composio.dev/api/v1/auth-apps/add")
    expect(e.client_id).toBeNull()
    expect(e.client_secret).toBeNull()
  })
})

const f = (ref: string, type: string, label: string, role = "textbox"): Field => ({ ref, role, type, label })

describe("login form detection", () => {
  test("finds email, password and submit on a conventional form", () => {
    const fs = [f("@e1", "email", "Email address"), f("@e2", "password", "Password"), f("@e3", "", "Log in", "button")]
    expect(findEmailField(fs)?.ref).toBe("@e1")
    expect(findPasswordField(fs)?.ref).toBe("@e2")
    expect(findSubmit(fs)?.ref).toBe("@e3")
  })
  test("falls back to a username field when there is no typed email input", () => {
    const fs = [f("@e1", "text", "Username"), f("@e2", "password", "Password")]
    expect(findEmailField(fs)?.ref).toBe("@e1")
  })
  test("handles a two-step form that shows only the email first", () => {
    const fs = [f("@e1", "email", "Email"), f("@e2", "", "Continue", "button")]
    expect(findEmailField(fs)?.ref).toBe("@e1")
    expect(findPasswordField(fs)).toBeUndefined()
    expect(findSubmit(fs)?.ref).toBe("@e2")
  })
})

describe("operator vault", () => {
  // Both are restored afterwards: an earlier version of this test leaked its
  // key and path into the process and wrote over the real vault.
  const KEY = process.env.VAULT_KEY
  const VPATH = process.env.OPERATOR_VAULT_PATH
  process.env.VAULT_KEY = "test-key-do-not-use"
  process.env.OPERATOR_VAULT_PATH = "/tmp/auth-agent-test-vault.enc"
  afterAll(() => {
    if (KEY === undefined) delete process.env.VAULT_KEY; else process.env.VAULT_KEY = KEY
    if (VPATH === undefined) delete process.env.OPERATOR_VAULT_PATH; else process.env.OPERATOR_VAULT_PATH = VPATH
  })

  test("generated passwords satisfy the usual portal rules", () => {
    for (let i = 0; i < 20; i++) {
      const p = vault.generatePassword()
      expect(p.length).toBe(20)
      expect(/[A-Z]/.test(p)).toBe(true)
      expect(/[a-z]/.test(p)).toBe(true)
      expect(/[0-9]/.test(p)).toBe(true)
      expect(/[^A-Za-z0-9]/.test(p)).toBe(true)
    }
  })
  test("round-trips an account through encryption", () => {
    vault.put({
      platform: "xero.com", email: "a@b.test", password: "s3cr3t!",
      inbox_id: "ib_1", status: "active",
      created_at: new Date().toISOString(), last_used_at: null, notes: null,
    })
    const got = vault.get("https://developer.xero.com/app/manage")
    expect(got?.email).toBe("a@b.test")
    expect(got?.password).toBe("s3cr3t!")
  })
  test("keys on the registrable label so aliases collide", () => {
    expect(vault.normalise("Linear.app")).toBe("linear.app")
    expect(vault.normalise("https://developer.xero.com/app")).toBe("xero.com")
  })
})

describe("control detection guards", () => {
  test("does not mistake a 'Forgot password?' link for the password input", () => {
    const fs: Field[] = [
      { ref: "@e1", role: "textbox", type: "", label: "Username or email address" },
      { ref: "@e2", role: "link", type: "", label: "Forgot password?" },
      { ref: "@e3", role: "textbox", type: "password", label: "Password" },
      { ref: "@e4", role: "button", type: "", label: "Sign in" },
    ]
    expect(findPasswordField(fs)?.ref).toBe("@e3")
    expect(findSubmit(fs)?.ref).toBe("@e4")
  })

  test("never returns a link as the submit control", () => {
    const fs: Field[] = [
      { ref: "@e1", role: "link", type: "", label: "Continue with Google" },
      { ref: "@e2", role: "button", type: "", label: "Log in" },
    ]
    expect(findSubmit(fs)?.ref).toBe("@e2")
  })

  test("a one-field form still yields the email box", () => {
    const fs: Field[] = [
      { ref: "@e1", role: "textbox", type: "", label: "Work address" },
      { ref: "@e2", role: "button", type: "", label: "Continue" },
    ]
    expect(findEmailField(fs)?.ref).toBe("@e1")
  })
})

describe("verification cannot be faked with a placeholder", () => {
  test("refuses obviously-empty client ids without touching the network", async () => {
    const { isPlaceholder } = await import("../src/core/verify.ts")
    for (const v of [
      "", "unavailable", "unknown", "none", "N/A", "TODO", "<client_id>", "abc",
      // Prose about the absence of a credential, seen in a real run.
      "not_obtained", "not-available", "no_client_id", "pending_approval",
      "your_client_id_here", "{{client_id}}", "client id missing", "REDACTED",
    ]) {
      expect(isPlaceholder(v), `${v} should be rejected`).toBe(true)
    }
    expect(isPlaceholder("Iv1.8a61f9b3c6d24e07")).toBe(false)
  })

  test("a placeholder probe reports invalid rather than accepted", async () => {
    const { verifyClientId } = await import("../src/core/verify.ts")
    const { Evidence } = await import("../src/core/http.ts")
    const v = await verifyClientId(
      "https://login.example.test/authorize", "unavailable",
      "https://cb.example.test", null, new Evidence(),
    )
    expect(v.invalid_client).toBe(true)
    expect(v.result).toContain("placeholder")
  })
})

describe("form control selection", () => {
  const f = (ref: string, role: string, label: string, type = ""): Field => ({ ref, role, type, label })

  test("prefers the form's own submit over a federated-identity button", async () => {
    const { findSubmit } = await import("../src/core/browser.ts")
    // Pipedream's real signup: the social buttons sit above the form's button.
    const fs = [
      f("@e2", "button", "Sign up with Google"),
      f("@e3", "button", "Sign up with GitHub"),
      f("@e8", "textbox", "Email"),
      f("@e9", "textbox", "Password"),
      f("@e4", "button", "Sign Up"),
    ]
    expect(findSubmit(fs)?.ref).toBe("@e4")
  })

  test("does not mistake carousel or cookie controls for submission", async () => {
    const { findSubmit } = await import("../src/core/browser.ts")
    const fs = [
      f("@e10", "button", "Manage Cookie Preferences"),
      f("@e12", "button", "Next slide"),
      f("@e20", "button", "Create account"),
    ]
    expect(findSubmit(fs)?.ref).toBe("@e20")
  })

  test("finds the control that reveals a hidden email form", async () => {
    const { findRevealControl } = await import("../src/core/browser.ts")
    const fs = [
      f("@e4", "button", "Sign up with Google"),
      f("@e6", "button", "Sign up with email"),
    ]
    expect(findRevealControl(fs)?.ref).toBe("@e6")
  })
})
