# Bun runs the control plane, the opencode tools and the tests, so it is the base.
FROM oven/bun:1.3-debian

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates git unzip nodejs npm \
    && apt-get clean

# The agent runtime and the browser CLI.
RUN curl -fsSL https://opencode.ai/install | bash
ENV PATH="/root/.opencode/bin:${PATH}"
RUN npm i -g agent-browser xypro

# The browser deliberately runs on AWS Bedrock AgentCore, not in here, which is
# why there is no Chromium in this image. Set BROWSER_PROVIDER=local and run
# `agent-browser install --with-deps` if you ever need a container browser.

WORKDIR /app
COPY package.json ./
RUN bun install
COPY . .

# The dashboard is built into the image so the container serves a static bundle
# rather than needing a node toolchain at runtime.
RUN if [ -f web/package.json ]; then \
      cd web && (npm ci --silent || npm install --silent) && npm run build; \
    else echo "no web/ — the API will serve the fallback page"; fi

ENV PORT=8080 \
    OPENCODE_PORT=4096 \
    XYPRO_BASE_URL=http://127.0.0.1:1455/v1 \
    XYPRO_API_KEY=xypro \
    BROWSER_PROVIDER=agentcore
EXPOSE 8080

# xypro holds the ChatGPT Codex session, so it comes up first and the control
# plane waits for it. Mount the authenticated token dir at /root/.codex-proxy.
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
