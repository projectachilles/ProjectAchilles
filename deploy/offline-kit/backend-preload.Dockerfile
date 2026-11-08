# Offline kit: the backend image plus what it would otherwise download on a
# first start. `backend` is the regular image (backend/Dockerfile), passed in
# as a named build context by docker-bake.hcl.
#
# Both paths below are named-volume mount points in docker-compose.yml
# (repo-cache -> /app/data, go-cache -> /root/go). Docker copies an image's
# files into a named volume the first time that empty volume is mounted, so a
# fresh install starts with the test library and Go caches already in place.
FROM backend

ARG TESTS_REPO_URL=https://github.com/ubercylon8/f0_library.git
ARG TESTS_REPO_REF=main
# Space-separated test UUIDs whose Go modules are pre-downloaded.
ARG KIT_TESTS=""

# The same clone the backend makes (gitSyncService.ts clone()). The backend
# looks for it at /data/f0_library unless TESTS_LOCAL_PATH says otherwise
# (path.resolve(__dirname, '../../data/f0_library') from /app/dist), which is
# outside the repo-cache volume; the link makes both paths hold this copy.
RUN git clone --branch "$TESTS_REPO_REF" --single-branch --depth 1 \
        --filter=blob:none --sparse "$TESTS_REPO_URL" /app/data/f0_library \
    && git -C /app/data/f0_library sparse-checkout set tests_source preludeorg-libraries utils \
    && mkdir -p /data && ln -s /app/data/f0_library /data/f0_library

# Same environment as a build in the container: GOCACHE from docker-compose.yml,
# CGO_ENABLED=0 and GOARCH=amd64 from buildService.ts (cache keys include them).
ENV GOCACHE=/root/go/build-cache
RUN set -e; \
    for uuid in $KIT_TESTS; do \
        dir=$(find /app/data/f0_library/tests_source -mindepth 2 -maxdepth 2 -type d -name "$uuid"); \
        [ -n "$dir" ] || { echo "test $uuid is not in $TESTS_REPO_URL ($TESTS_REPO_REF)" >&2; exit 1; }; \
        (cd "$dir" && go mod download); \
    done; \
    for os in linux windows; do CGO_ENABLED=0 GOOS=$os GOARCH=amd64 go build std; done
