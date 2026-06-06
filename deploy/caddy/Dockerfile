# Custom Caddy image — only needed for TLS_MODE=acme-dns.
#
# The official caddy image cannot do DNS-01 challenges on its own; the DNS
# provider module must be compiled in with xcaddy. deploy-server.sh builds
# this image automatically when CADDY_DNS_PROVIDER is set, passing the
# provider's Caddy module path as a build arg.
#
# Examples for CADDY_DNS_MODULE:
#   github.com/caddy-dns/cloudflare
#   github.com/caddy-dns/digitalocean
#   github.com/caddy-dns/route53
#   github.com/caddy-dns/azure
#   github.com/caddy-dns/googleclouddns
#
# For all other TLS modes (acme-http, internal, byo) the stock caddy:2-alpine
# image is used directly and this Dockerfile is not built.

ARG CADDY_VERSION=2.10.0

FROM caddy:${CADDY_VERSION}-builder AS builder

# Caddy module path for the DNS provider plugin (e.g. github.com/caddy-dns/cloudflare)
ARG CADDY_DNS_MODULE=github.com/caddy-dns/cloudflare

RUN xcaddy build \
    --with ${CADDY_DNS_MODULE}

FROM caddy:${CADDY_VERSION}-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
