/**
 * A stand-in developer portal.
 *
 * The self-serve path is the hardest thing this system does and the only one
 * that cannot be exercised against real companies on demand: it needs an
 * account, it creates real records, and a failed attempt is somebody's support
 * ticket. So the shape of the journey is reproduced here — login wall, app
 * list, registration form, credentials shown once — and the agent is pointed at
 * it.
 *
 * Deliberately awkward in the ways real portals are: the login is two-step, the
 * secret starts masked behind a reveal control, and the form has a required
 * field nobody would guess.
 *
 *   bun run test/fixtures/portal-server.ts 5232
 */

const PORT = Number(process.argv[2] ?? 5232)

const ACCOUNTS = new Map<string, string>() // email -> password
const SESSIONS = new Set<string>()
const APPS: { name: string; homepage: string; callback: string; id: string; secret: string }[] = []

/** Seeded so a test can log in without a signup flow. */
ACCOUNTS.set("operator@auth-agent.test", "correct-horse-battery-staple")

const page = (title: string, body: string) => new Response(
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
   <style>body{font-family:system-ui;max-width:640px;margin:60px auto;padding:0 20px;line-height:1.6}
   input,button{font:inherit;padding:8px;margin:4px 0;display:block;width:100%;box-sizing:border-box}
   label{font-size:13px;color:#555;margin-top:12px;display:block}
   .cred{background:#f4f4f5;padding:12px;border-radius:6px;margin:8px 0}</style></head>
   <body>${body}</body></html>`,
  { headers: { "content-type": "text/html; charset=utf-8" } },
)

const cookie = (req: Request) =>
  (req.headers.get("cookie") ?? "").split(";").map((s) => s.trim().split("="))
    .find(([k]) => k === "sid")?.[1]

const authed = (req: Request) => { const c = cookie(req); return Boolean(c && SESSIONS.has(c)) }

const redirect = (to: string, setCookie?: string) =>
  new Response(null, { status: 302, headers: { location: to, ...(setCookie ? { "set-cookie": setCookie } : {}) } })

const rand = (n: number) =>
  Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("")

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    if (path === "/") return redirect(authed(req) ? "/apps" : "/login")

    // Step one asks only for the email, the way Asana and Google do.
    if (path === "/login" && req.method === "GET") {
      const email = url.searchParams.get("email")
      if (!email) {
        return page("Sign in", `<h1>Sign in</h1><form method="GET" action="/login">
          <label for="e">Email address</label><input id="e" name="email" type="email" required>
          <button type="submit">Continue</button></form>`)
      }
      return page("Sign in", `<h1>Sign in</h1><p>${email}</p>
        <form method="POST" action="/login">
        <input type="hidden" name="email" value="${email}">
        <label for="p">Password</label><input id="p" name="password" type="password" required>
        <button type="submit">Log in</button></form>`)
    }

    if (path === "/login" && req.method === "POST") {
      const f = await req.formData()
      const email = String(f.get("email") ?? ""), password = String(f.get("password") ?? "")
      if (ACCOUNTS.get(email) !== password) {
        return page("Sign in", `<h1>Sign in</h1><p style="color:#b00">Incorrect password.</p>
          <form method="POST" action="/login"><input type="hidden" name="email" value="${email}">
          <label for="p">Password</label><input id="p" name="password" type="password">
          <button type="submit">Log in</button></form>`)
      }
      const sid = rand(24); SESSIONS.add(sid)
      return redirect("/apps", `sid=${sid}; Path=/; HttpOnly`)
    }

    if (path === "/signup" && req.method === "POST") {
      const f = await req.formData()
      const email = String(f.get("email") ?? ""), password = String(f.get("password") ?? "")
      if (!email || password.length < 8) return page("Sign up", `<h1>Sign up</h1><p style="color:#b00">Password too short.</p>`)
      ACCOUNTS.set(email, password)
      const sid = rand(24); SESSIONS.add(sid)
      return redirect("/apps", `sid=${sid}; Path=/; HttpOnly`)
    }

    if (path === "/signup") {
      return page("Sign up", `<h1>Create a developer account</h1><form method="POST" action="/signup">
        <label for="e">Email address</label><input id="e" name="email" type="email" required>
        <label for="p">Password</label><input id="p" name="password" type="password" required>
        <label for="p2">Confirm password</label><input id="p2" name="confirm" type="password" required>
        <button type="submit">Create account</button></form>`)
    }

    if (!authed(req)) return redirect("/login")

    if (path === "/apps") {
      const rows = APPS.map((a) => `<li>${a.name} — <a href="/apps/${a.id}">${a.id}</a></li>`).join("")
      return page("My apps", `<h1>My apps</h1><ul>${rows || "<li>None yet.</li>"}</ul>
        <p><a href="/apps/new">Create a new OAuth app</a></p>`)
    }

    if (path === "/apps/new" && req.method === "GET") {
      return page("New OAuth app", `<h1>Create a new OAuth app</h1>
        <form method="POST" action="/apps/new">
        <label for="n">Application name</label><input id="n" name="name" required>
        <label for="h">Homepage URL</label><input id="h" name="homepage" type="url" required>
        <label for="c">Authorization callback URL</label><input id="c" name="callback" type="url" required>
        <label for="d">Description</label><input id="d" name="description">
        <label for="cc">Country of incorporation</label><input id="cc" name="country" required>
        <button type="submit">Register application</button></form>`)
    }

    if (path === "/apps/new" && req.method === "POST") {
      const f = await req.formData()
      const callback = String(f.get("callback") ?? "")
      if (!callback.startsWith("https://")) {
        return page("New OAuth app", `<h1>Create a new OAuth app</h1>
          <p style="color:#b00">The callback URL must be https.</p>`)
      }
      const app = {
        name: String(f.get("name") ?? ""), homepage: String(f.get("homepage") ?? ""),
        callback, id: "Iv1." + rand(16), secret: rand(40),
      }
      APPS.push(app)
      return redirect(`/apps/${app.id}`)
    }

    const m = /^\/apps\/(.+)$/.exec(path)
    if (m) {
      const app = APPS.find((a) => a.id === m[1])
      if (!app) return page("Not found", "<h1>No such app</h1>")
      // The secret starts masked behind a reveal control, as GitHub's does.
      const revealed = url.searchParams.get("reveal") === "1"
      return page(app.name, `<h1>${app.name}</h1>
        <div class="cred"><label for="cid">Client ID</label>
          <input id="cid" readonly value="${app.id}"></div>
        <div class="cred"><label for="csec">Client Secret</label>
          <input id="csec" readonly value="${revealed ? app.secret : "••••••••••••••••"}">
          ${revealed ? "" : `<a href="/apps/${app.id}?reveal=1">Show client secret</a>`}</div>
        <table><tr><td>Callback URL</td><td>${app.callback}</td></tr></table>
        <p><a href="/apps">Back to apps</a></p>`)
    }

    return new Response("not found", { status: 404 })
  },
})

console.log(`fixture portal on http://127.0.0.1:${PORT}`)
console.log(`  seeded account: operator@auth-agent.test / correct-horse-battery-staple`)
