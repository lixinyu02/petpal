ARG NODE_IMAGE=node:24.19.0-bookworm-slim
FROM ${NODE_IMAGE}
ARG NODE_IMAGE
ARG CODEX_VERSION=0.143.0
ARG DEBIAN_MIRROR=https://deb.debian.org/debian
ARG DEBIAN_SECURITY_MIRROR=https://deb.debian.org/debian-security
RUN node -e 'require("fs").writeFileSync("/tmp/petpal-node-ca.pem", require("tls").rootCertificates.join("\n"))' \
    && sed -i "s|http://deb.debian.org/debian-security|${DEBIAN_SECURITY_MIRROR}|g; s|http://deb.debian.org/debian|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::https::CaInfo=/tmp/petpal-node-ca.pem update --error-on=any \
    && apt-get -o Acquire::https::CaInfo=/tmp/petpal-node-ca.pem install -y --no-install-recommends \
    ca-certificates git bash python3 ripgrep xvfb x11vnc openbox xterm fonts-noto-cjk fonts-noto-color-emoji \
    chromium dbus-x11 xdg-utils xdotool wmctrl pcmanfm tint2 \
    && rm -rf /var/lib/apt/lists/* && rm /tmp/petpal-node-ca.pem \
    && npm install -g --ignore-scripts --no-audit --no-fund @openai/codex@${CODEX_VERSION} \
    && groupadd -g 10001 petpal && useradd -u 10001 -g 10001 -m petpal \
    && mkdir -p /runtime /workspaces/project /home/petpal/.cache /home/petpal/Desktop \
    && touch /runtime/.keep /workspaces/project/.keep \
    && chown -R 10001:10001 /runtime /workspaces /home/petpal
RUN set -eu; ARCH="$(node -p 'process.arch')"; \
    case "$ARCH" in x64|arm64) ;; *) echo "Unsupported Codex architecture" >&2; exit 1;; esac; \
    npm install -g --ignore-scripts --no-audit --no-fund --omit=optional \
      --fetch-timeout=300000 --fetch-retries=1 \
      "@openai/codex-linux-${ARCH}@npm:@openai/codex@${CODEX_VERSION}-linux-${ARCH}"; \
    test "$(codex --version)" = "codex-cli ${CODEX_VERSION}"
COPY --chmod=0555 start.sh /opt/petpal/start.sh
COPY --chmod=0444 exec.mjs /opt/petpal/exec.mjs
COPY --chmod=0555 browser.sh /opt/petpal/browser.sh
COPY --chmod=0444 browser.desktop /usr/share/applications/petpal-browser.desktop
RUN --network=none cp /usr/share/applications/petpal-browser.desktop /home/petpal/Desktop/Browser.desktop \
    && chmod 0755 /home/petpal/Desktop/Browser.desktop && chown 10001:10001 /home/petpal/Desktop/Browser.desktop \
    && dpkg-query -W > /opt/petpal/debian-packages.txt \
    && npm ls -g --json > /opt/petpal/npm-packages.json
LABEL top.magicdatou.petpal.desktop-protocol="1" top.magicdatou.petpal.agent-protocol="1" top.magicdatou.petpal.asset-revision="20261020.5" \
    top.magicdatou.petpal.build-node-image="${NODE_IMAGE}" top.magicdatou.petpal.build-debian-mirror="${DEBIAN_MIRROR}" top.magicdatou.petpal.build-security-mirror="${DEBIAN_SECURITY_MIRROR}"
ENV HOME=/home/petpal DISPLAY=:99
USER 10001:10001
WORKDIR /workspaces/project
ENTRYPOINT ["/opt/petpal/start.sh"]
