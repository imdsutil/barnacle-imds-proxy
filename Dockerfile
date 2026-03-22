FROM golang:1.26-alpine@sha256:d4c4845f5d60c6a974c6000ce58ae079328d03ab7f721a0734277e69905473e5 AS builder
ENV CGO_ENABLED=0
WORKDIR /backend
COPY backend/go.* .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod download
COPY backend/. .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath -ldflags="-s -w" -o bin/service

FROM --platform=$BUILDPLATFORM node:24-alpine AS client-builder
WORKDIR /ui
# cache packages in layer
COPY ui/package.json /ui/package.json
COPY ui/pnpm-lock.yaml /ui/pnpm-lock.yaml
RUN --mount=type=cache,target=/root/.pnpm-store \
    corepack enable && \
    corepack prepare pnpm --activate && \
    pnpm install --frozen-lockfile
# install
COPY ui /ui
COPY description.json /ui/public/description.json
COPY logo.svg /ui/src/logo.svg
RUN pnpm run build

FROM alpine
ARG DESCRIPTION="Description not set"
LABEL org.opencontainers.image.title="Barnacle IMDS Proxy" \
    org.opencontainers.image.description="${DESCRIPTION}" \
    org.opencontainers.image.vendor="Matt Miller" \
    com.docker.desktop.extension.api.version="0.4.2" \
    com.docker.extension.screenshots='[{"alt":"Barnacle IMDS Proxy UI","url":"https://raw.githubusercontent.com/imds-tools/barnacle-imds-proxy/refs/heads/main/screenshots/screenshot1.png"}]' \
    com.docker.desktop.extension.icon="https://raw.githubusercontent.com/imds-tools/barnacle-imds-proxy/refs/heads/main/logo.svg" \
    com.docker.extension.detailed-description="<p>Intercepts container requests to cloud Instance Metadata Service (IMDS) endpoints and forwards them to a server you control. Adds headers identifying the source container, so you can serve different metadata to different containers.</p><h3>Why</h3><p>Testing IMDS-dependent code locally is annoying. Containers expect a metadata service at 169.254.169.254 (or the IPv6 equivalents), and it isn't there. Barnacle puts a proxy at those addresses inside the Docker Desktop VM and routes requests to your own server.</p><h3>How it works</h3><p>Add the label <code>imds-proxy.enabled=true</code> to a container and point the extension at your IMDS server URL. The extension automatically connects labeled containers to the proxy networks and forwards their IMDS requests with container identity headers attached.</p><h3>Supported providers</h3><ul><li>AWS / GCP — 169.254.169.254 (IPv4) and fd00:ec2::254 (IPv6)</li><li>OpenStack — fd00:a9fe:a9fe::254 (IPv6)</li></ul>" \
    com.docker.extension.publisher-url="https://github.com/millermatt" \
    com.docker.extension.additional-urls='[{"title":"Documentation","url":"https://github.com/imds-tools/barnacle-imds-proxy"}, {"title":"Terms of Service","url":"https://github.com/imds-tools/barnacle-imds-proxy/blob/main/LICENSE"}]' \
    com.docker.extension.categories="networking,testing-tools" \
    com.docker.extension.changelog="https://raw.githubusercontent.com/imds-tools/barnacle-imds-proxy/refs/heads/main/CHANGELOG.md"

COPY --from=builder /backend/bin/service /
COPY docker-compose.yaml .
COPY metadata.json .
COPY logo.svg .
COPY --from=client-builder /ui/build ui
CMD ["/service", "-socket", "/run/guest-services/backend.sock"]
