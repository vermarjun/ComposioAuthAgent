// Runs before any page script, via agent-browser --init-script.
//
// A headed Chrome launched with --disable-blink-features=AutomationControlled
// already fixes the two loudest tells: the User-Agent no longer says
// HeadlessChrome, and the screen reports real dimensions instead of 800x600.
// What is left are the artefacts an automated context still carries, and each
// one below was chosen because it was observably wrong when measured, not
// because a stealth checklist somewhere lists it.
//
// Deliberately conservative: every patch here makes an automated browser look
// like the ordinary one it already mostly is. None of it defeats behavioural
// scoring — reCAPTCHA Enterprise and v3 watch how the pointer moves and how
// long a form takes, and no property patch touches that.

(() => {
  const def = (obj, prop, get) => {
    try {
      Object.defineProperty(obj, prop, { get, configurable: true })
    } catch {}
  }

  // 1. navigator.webdriver. The single most checked property in existence.
  //    The launch flag usually clears it; this covers the case where it does not.
  if (navigator.webdriver) {
    def(Navigator.prototype, "webdriver", () => undefined)
  }

  // 2. window.chrome.runtime. Real Chrome exposes it; an automated context
  //    often has window.chrome as a bare object with nothing on it.
  if (window.chrome && !window.chrome.runtime) {
    window.chrome.runtime = {
      id: undefined,
      connect: () => ({ onMessage: { addListener() {} }, postMessage() {}, disconnect() {} }),
      sendMessage: () => {},
      onMessage: { addListener() {} },
    }
  }
  if (!window.chrome) {
    window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} }
  }

  // 3. Permissions.query for notifications returns "denied" in an automated
  //    context while Notification.permission says "default" — the mismatch is
  //    itself the signal, so make them agree.
  const origQuery = navigator.permissions && navigator.permissions.query
  if (origQuery) {
    navigator.permissions.query = (params) =>
      params && params.name === "notifications"
        ? Promise.resolve({ state: Notification.permission, onchange: null })
        : origQuery.call(navigator.permissions, params)
  }

  // 4. A plausible plugin set. An empty PluginArray is a giveaway; so is one
  //    whose entries have no mimeTypes hanging off them, which is why these are
  //    built as real-shaped objects rather than bare strings.
  if (navigator.plugins.length === 0) {
    const make = (name, filename, desc) => ({
      name, filename, description: desc, length: 1,
      0: { type: "application/pdf", suffixes: "pdf", description: desc },
    })
    const list = [
      make("PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
      make("Chrome PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
      make("Chromium PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
    ]
    def(Navigator.prototype, "plugins", () => Object.assign(list, { item: (i) => list[i], namedItem: (n) => list.find((p) => p.name === n) }))
  }

  // 5. Function.prototype.toString. Every patch above is detectable by
  //    stringifying the function and finding "[native code]" missing, so the
  //    patched functions report themselves as native.
  const nativeToString = Function.prototype.toString
  const patched = new WeakSet()
  if (navigator.permissions && navigator.permissions.query) patched.add(navigator.permissions.query)
  Function.prototype.toString = function () {
    if (patched.has(this)) return `function ${this.name || ""}() { [native code] }`
    return nativeToString.call(this)
  }
  patched.add(Function.prototype.toString)
})()
