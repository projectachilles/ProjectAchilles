# Lab endpoint: a throwaway Linux endpoint that runs the ProjectAchilles agent
# in the foreground, for demos and workshops. Not a production pattern.
# Build context is the repo root:
#   docker build --platform linux/amd64 -f deploy/lab-endpoint/Dockerfile .
# Started by docker-compose.lab.yml; see deploy/lab-endpoint/README.md.

# Agent and library tests ship amd64 only: always build with --platform linux/amd64
# (docker-compose.lab.yml and the tests do; Apple Silicon runs it emulated).
# The agent is cross-compiled, so the Go stage runs natively ($BUILDPLATFORM)
# instead of under emulation on Apple Silicon.
FROM --platform=$BUILDPLATFORM golang:1.26-bookworm@sha256:5de7c99eb78ca5e515a4c340235d0955ec5964a5071c492c15503d7c267da473 AS agent
# Keep equal to VERSION in agent/Makefile.
ARG AGENT_VERSION=0.7.3
WORKDIR /src
COPY agent/go.mod agent/go.sum ./
RUN go mod download
COPY agent/ ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags "-s -w -X main.version=${AGENT_VERSION}" -o /out/achilles-agent .

FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc
RUN apt-get update \
 && apt-get install -y --no-install-recommends socat curl ca-certificates kmod \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /opt/f0 /etc/modprobe.d /etc/ssh
COPY --from=agent /out/achilles-agent /usr/local/bin/achilles-agent
COPY deploy/lab-endpoint/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY deploy/lab-endpoint/enroll /usr/local/bin/enroll
COPY deploy/lab-endpoint/sshd_config.vendor-default /etc/ssh/sshd_config
# Strip CRs in case the files came from a Windows (autocrlf) checkout.
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh /usr/local/bin/enroll /etc/ssh/sshd_config \
 && chmod 0755 /usr/local/bin/entrypoint.sh /usr/local/bin/enroll
# Root on purpose: security tests need it, as on a real endpoint.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
