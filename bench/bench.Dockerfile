# ResonantOS addon SDK test bench.
# Single-container image that bundles the bridge + three addon stubs and
# supervises them with a tiny init script. The addon manifests under
# examples/addons/ declare service.entrypoint=http://127.0.0.1:<port>;
# because everything shares one network namespace inside this container,
# those literals resolve to the stubs the same way they would on a
# developer's local workstation.
#
# Build:    docker build -f bench/bench.Dockerfile -t resonant-bench/bench .
# Run:      docker compose -f docker-compose.bench.yml up
# Tear down: docker compose -f docker-compose.bench.yml down --volumes

FROM node:22.13-bookworm-slim

# Non-root user for the running services. The audit ledger writes to
# /var/lib/resonant-bench; the addon stub logs to /var/log/resonant-bench.
RUN groupadd --system bench \
 && useradd  --system --gid bench --create-home --shell /bin/bash bench \
 && mkdir -p /app/repo /var/lib/resonant-bench /var/log/resonant-bench \
 && chown -R bench:bench /var/lib/resonant-bench /var/log/resonant-bench

WORKDIR /app/repo

# Copy the entire repo into the image. Build context must be the repo
# root so this works for `docker compose -f docker-compose.bench.yml build`.
COPY --chown=bench:bench . /app/repo/
# Ensure bench user owns the entire repo tree before USER bench (COPY
# --chown= can be flaky for nested directories under BuildKit).
RUN chown -R bench:bench /app/repo

# Install only the host runtime the bridge needs. The repo's package.json
# has many test/lint deps we don't need inside the bench; install prod
# deps via `npm install --omit=dev` to keep the image small.
USER bench
RUN npm install --omit=dev --no-audit --no-fund --loglevel=warn
# Bench scripts.
COPY --chown=bench:bench bench/entrypoint.sh /app/bench/entrypoint.sh
COPY --chown=bench:bench bench/stub.mjs      /app/bench/stub.mjs
COPY --chown=bench:bench bench/roundtrip.mjs /app/bench/roundtrip.mjs
RUN chmod +x /app/bench/entrypoint.sh

ENV NODE_ENV=production \
    RESONANTOS_REPO_ROOT=/app/repo \
    RESONANTOS_USER_ROOT=/var/lib/resonant-bench \
    ADDON_STUB_LOG_DIR=/var/log/resonant-bench

EXPOSE 47773

# `exec` so PID 1 is the supervisor — Docker forwards SIGTERM cleanly and
# the bridge + stubs all receive it together.
ENTRYPOINT ["/app/bench/entrypoint.sh"]
CMD ["up"]