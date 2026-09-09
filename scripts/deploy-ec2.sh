#!/usr/bin/env bash
#
# Deploy to an EC2 box over SSH.
#
#   scripts/deploy-ec2.sh ~/keys/box.pem ubuntu@1.2.3.4
#
# Installs the runtime directly and runs under systemd rather than Docker. The
# image would have to bundle bun, opencode, agent-browser and xypro, and then
# still have the Codex credentials mounted in — so the container buys nothing
# here except a build step that can fail on deploy day. `--docker` is kept for
# when that trade changes.
#
# Idempotent: run it again to redeploy.

set -euo pipefail

PEM="${1:?usage: deploy-ec2.sh <pem> <user@host> [--docker]}"
TARGET="${2:?usage: deploy-ec2.sh <pem> <user@host> [--docker]}"
MODE="${3:-direct}"
APP_DIR="/opt/auth-agent"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

ssh_() { ssh -i "$PEM" -o StrictHostKeyChecking=accept-new "$TARGET" "$@"; }
say()  { echo; echo "==> $*"; }

say "checking the box"
ssh_ 'echo "  $(uname -sr)"; echo "  $(nproc) cpu, $(free -g 2>/dev/null | awk "/Mem:/{print \$2}")GB ram"'

say "building the dashboard locally"
if [ -d "$REPO_DIR/web" ]; then
  ( cd "$REPO_DIR/web" && { npm ci --silent 2>/dev/null || npm install --silent; } && npm run build )
  echo "  web/dist built"
else
  echo "  no web/ — the API will serve the fallback page"
fi

say "installing the runtime"
ssh_ 'set -e
  command -v curl >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq curl; }
  command -v unzip >/dev/null || sudo apt-get install -y -qq unzip
  command -v node  >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - >/dev/null && sudo apt-get install -y -qq nodejs; }
  [ -x "$HOME/.bun/bin/bun" ]      || curl -fsSL https://bun.sh/install | bash >/dev/null
  # Pinned to match the laptop. Unpinned installs drifted the box to 1.18.30
  # while local ran 1.18.18. Note VERSION must be set on the *bash* side of the
  # pipe, not the curl side, or the installer silently ignores it.
  $HOME/.opencode/bin/opencode --version 2>/dev/null | grep -q 1.18.18 || curl -fsSL https://opencode.ai/install | VERSION=1.18.18 bash >/dev/null
  # Pinned: the box had drifted to 0.27.0 while the laptop ran 0.35.2, and the
  # agent drives this binary by CLI contract (snapshot -i --json, --init-script,
  # fill <ref>). An unpinned `npm i -g` reintroduces that gap on any redeploy.
  agent-browser --version 2>/dev/null | grep -q 0.35.2 || sudo npm i -g --silent agent-browser@0.35.2
  # NOTE: xypro is deliberately NOT installed from npm here. See "shipping
  # xypro" below -- the published 1.0.0 predates function calling.
  # The browser runs headed on a virtual display. Headless Chrome is
  # fingerprinted -- navigator.webdriver aside, real portals score the missing
  # plugins, the 800x600 screen and the HeadlessChrome UA -- and a flagged
  # agent cannot complete a signup. Xvfb costs ~10MB and removes the whole class.
  command -v Xvfb >/dev/null || sudo apt-get install -y -qq xvfb x11-utils
  [ -d "$HOME/.agent-browser/browsers" ] || agent-browser install --with-deps
  # Ubuntu 23.10+ restricts unprivileged user namespaces via AppArmor, which
  # makes Chrome die with "No usable sandbox!". Lifting it keeps the Chrome
  # sandbox rather than resorting to --no-sandbox.
  sudo sysctl -wq kernel.apparmor_restrict_unprivileged_userns=0 2>/dev/null || true
  echo "kernel.apparmor_restrict_unprivileged_userns=0" | sudo tee /etc/sysctl.d/60-chrome-userns.conf >/dev/null
  echo "  bun $($HOME/.bun/bin/bun --version), opencode $($HOME/.opencode/bin/opencode --version 2>/dev/null || echo ?)"'

say "shipping the repo"
ssh_ "sudo mkdir -p $APP_DIR && sudo chown -R \$(id -un):\$(id -gn) $APP_DIR"
rsync -az --delete \
  --exclude node_modules --exclude 'web/node_modules' --exclude .git \
  --exclude runs --exclude '.env' --exclude '.env.production' --exclude 'eval/results*.json' \
  --exclude '*.pem' \
  -e "ssh -i $PEM -o StrictHostKeyChecking=accept-new" \
  "$REPO_DIR/" "$TARGET:$APP_DIR/"

say "shipping secrets"
# The box needs different values from the laptop: a headless browser with
# --no-sandbox, a Secure cookie because Caddy terminates TLS, and TRUST_PROXY
# on because something in front now rewrites x-forwarded-for. Shipping .env
# verbatim overwrote all four on every redeploy, so .env.production wins when
# it exists.
ENV_FILE="$REPO_DIR/.env.production"
[ -f "$ENV_FILE" ] || ENV_FILE="$REPO_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  scp -q -i "$PEM" "$ENV_FILE" "$TARGET:$APP_DIR/.env"
  echo "  shipped $(basename "$ENV_FILE")"
else
  echo "  no local .env — create $APP_DIR/.env on the box"
fi

# xypro holds a ChatGPT session that cannot be established headlessly, so the
# authenticated token directory travels from a machine that has a browser.
if [ -f "$HOME/.codex-proxy/tokens.json" ]; then
  ssh_ "mkdir -p ~/.codex-proxy"
  scp -q -i "$PEM" "$HOME/.codex-proxy/tokens.json" "$TARGET:~/.codex-proxy/tokens.json"
  echo "  Codex credentials copied"
else
  echo "  WARNING: no ~/.codex-proxy/tokens.json — run 'xypro auth' locally first"
fi

say "shipping xypro"
# The npm-published xypro@1.0.0 predates the "Discover models at runtime, and
# support function calling" commit, and the version number was never bumped --
# so the box looked identical to the laptop while silently lacking tool calls.
# The model then emitted its tool calls as plain text ("to=composio_lookup
# code:") into the content channel, opencode saw no tool calls, and every run
# died with "the required acquisition tools are not available in this session".
# Ship the local build instead; express is its only runtime dependency.
XYPRO_SRC="${XYPRO_SRC:-$HOME/Desktop/xypro}"
if [ -d "$XYPRO_SRC/proxy/dist" ]; then
  rsync -az --exclude node_modules --exclude .git \
    -e "ssh -i $PEM -o StrictHostKeyChecking=accept-new" \
    "$XYPRO_SRC/" "$TARGET:~/xypro/"
  ssh_ 'cd ~/xypro && npm install --omit=dev --silent'
  echo "  shipped local xypro build ($(grep -c tool_calls "$XYPRO_SRC/proxy/dist/codex.js") tool_calls refs)"
else
  echo "  WARNING: no local xypro checkout at $XYPRO_SRC — the box will keep whatever it has."
  echo "           If runs fail with 'tools are not available', this is why."
fi

say "installing dependencies on the box"
ssh_ "cd $APP_DIR && \$HOME/.bun/bin/bun install --silent"

say "writing services"
ssh_ "sudo tee /etc/systemd/system/xypro.service >/dev/null <<UNIT
[Unit]
Description=xypro (Codex -> OpenAI proxy) - local build, has function calling
After=network.target

[Service]
User=\$(id -un)
Environment=HOME=\$HOME
WorkingDirectory=\$HOME/xypro
ExecStart=/usr/bin/node \$HOME/xypro/proxy/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT"

ssh_ "sudo tee /etc/systemd/system/xvfb.service >/dev/null <<UNIT
[Unit]
Description=Xvfb virtual display :99 (headed Chrome on a display-less box)
After=network.target

[Service]
User=\$(id -un)
ExecStart=/usr/bin/Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT"

ssh_ "sudo tee /etc/systemd/system/auth-agent.service >/dev/null <<UNIT
[Unit]
Description=Auth Acquisition Agent
After=network.target xypro.service xvfb.service
Wants=xypro.service xvfb.service

[Service]
User=\$(id -un)
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
Environment=HOME=\$HOME
Environment=PATH=\$HOME/.bun/bin:\$HOME/.opencode/bin:/usr/local/bin:/usr/bin:/bin
Environment=DISPLAY=:99
ExecStart=\$HOME/.bun/bin/bun run src/server.ts
Restart=always
RestartSec=5
# On a 2GB box a headed Chrome peaks around 550MB on top of a ~660MB baseline,
# so memory pressure is real rather than theoretical. Bias the OOM killer
# towards this service and its browser. If something has to die it should be
# the agent, which systemd restarts. Positive adj = killed first.
OOMScoreAdjust=200

[Install]
WantedBy=multi-user.target
UNIT"

say "starting"
ssh_ "sudo systemctl daemon-reload
      sudo systemctl enable --now xvfb.service xypro.service auth-agent.service
      sudo systemctl restart xvfb.service xypro.service auth-agent.service"

say "waiting for health"
HEALTHY=no
for _ in $(seq 1 40); do
  if ssh_ 'curl -sf localhost:8080/api/health >/dev/null 2>&1'; then HEALTHY=yes; break; fi
  sleep 3
done

if [ "$HEALTHY" = yes ]; then
  ssh_ 'curl -s localhost:8080/api/health'
  echo
else
  echo "  did not come up. logs:"
  ssh_ 'sudo journalctl -u auth-agent -n 40 --no-pager'
  exit 1
fi

HOST="${TARGET#*@}"
say "live"
cat <<EOF
  https://authagent.13-201-224-106.sslip.io/        (public)

  8080 is deliberately NOT open in the security group. A Caddy in front on
  80/443 carries a vhost proxying the hostname above to port 8080 on this
  host. Everything reaches the agent over TLS or not at all.

  logs      ssh -i $PEM $TARGET 'sudo journalctl -u auth-agent -f'
  restart   ssh -i $PEM $TARGET 'sudo systemctl restart auth-agent'
  verify    scripts/smoke.sh https://authagent.13-201-224-106.sslip.io <password>
  proxy     ssh -i $PEM $TARGET 'sudo caddy reload --config /etc/caddy/Caddyfile'
EOF
