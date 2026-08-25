# Authoring a new add-on against the bench

The bench is your local end-to-end sandbox for an add-on under
development. It runs the bridge + every add-on stub you can find
under `examples/addons/` inside one Docker container so you can
exercise the full wire path against a real addon runtime, not just
against unit tests.

This doc is the bench-specific workflow. The SDK contract and the
"what should my manifest look like" walkthrough are in
[`docs/addons/authoring.md`](../../docs/addons/authoring.md) — read
that first if you haven't shipped an add-on before.

## How the bench finds your add-on

When you start the bench, the entrypoint script:

1. Enumerates `examples/addons/*.json` (currently hard-coded; the
   `bench/discovery.mjs` work will replace this with manifest-driven
   enumeration).
2. Starts a stub HTTP server per discovered add-on, on the port
   declared in the addon's `service.entrypoint`.
3. Waits for each stub's `/healthz` to return 200.
4. Starts the bridge.
5. The bridge writes `bridge-config.generated.js` into the extension
   directory and binds to `0.0.0.0:47773`.

So the moment `npm run bench:up` finishes, every add-on whose
manifest you've dropped into `examples/addons/` is reachable from
the bridge dispatcher and from your desktop browser's dev panel.

## Adding a new OpenAI-compatible add-on

If your add-on speaks `/api/v1/chat/completions` (the same shape the
real DeepSeek / Cordis stack uses), this is the entire flow:

1. **Write the manifest** at
   `examples/addons/addon.<your-id>.json`. Use one of the bundled
   ones (`addon.deepseek-harness.json`, `addon.recursive-mas.json`,
   `addon.reference-memory.json`) as a starting point. See the
   [Anatomy of a manifest section](../../docs/addons/authoring.md#anatomy-of-a-manifest)
   for the field reference.

2. **Pick a port.** The bench currently maps addons to fixed ports:
   - `addon.deepseek-harness` → 3080
   - `addon.recursive-mas` → 4891
   - `addon.reference-memory` → 4888

   For any new addon, update `bench/entrypoint.sh` to start another
   `stub.mjs` and pick an unused port. Then update your manifest's
   `service.entrypoint` to `http://127.0.0.1:<your-port>`.

3. **Validate the manifest** before booting:
   ```bash
   npm run validate:manifest -- examples/addons/addon.<your-id>.json
   ```

4. **Boot the bench:**
   ```bash
   npm run bench:up
   ```
   The bench should print `[bench-entry] starting stub addon.<your-id> on :<port>`.
   If you see `FATAL: addon.<your-id> did not become healthy`, your
   port is wrong or your stub doesn't speak `/healthz`.

5. **See it in the dev panel:**
   `http://127.0.0.1:47773/dev/external-agent-runtimes/` shows all
   addons, including your new one.

6. **Round-trip through the dispatcher:**
   ```bash
   npm run bench:roundtrip
   ```
   This dispatches every declared tool of every discovered addon
   through the real `dispatchExternalAgentRuntime` to the real stub
   servers. Look for `ALLOW` lines for your addon.

## Adding an add-on with a different protocol

The bench's `bench/stub.mjs` only speaks the OpenAI-compatible
`/api/v1/chat/completions` shape. For a new protocol (e.g. plain
REST JSON, stdio, WebSocket):

- **Today**: write your own stub script (Node, Python, anything that
  binds the port) and run it outside the bench container. Set the
  manifest's `service.entrypoint` to `http://host.docker.internal:<port>`
  if the bench needs to reach it from inside the container (macOS /
  Windows Docker Desktop only; on Linux you'd use the host's LAN IP).

- **Roadmap**: `bench/discovery.mjs` will enumerate manifests and
  pick the right stub per protocol via `bench/stubs/index.mjs`.
  `bench/stubs/openai-compatible.mjs`, `rest-json.mjs`,
  `stdio-bridge.mjs`, `noop.mjs` are the planned shapes.

## Adding a real add-on implementation

Once your stub proves the wire contract works, replace the stub with
your real implementation:

1. Move your real server out of the bench's bundled stubs. Run it
   on your host machine on a known port.
2. Update the manifest's `service.entrypoint` to point at the host
   port. From the bench container's perspective, that's
   `http://host.docker.internal:<port>` (macOS / Windows) or your
   host's LAN IP (Linux).
3. Widen the bridge's IP allowlist if necessary
   (`RESONANTOS_BRIDGE_ALLOWED_IPS` in `docker-compose.bench.yml`)
   so it accepts connections from your real service.
4. Re-run the round-trip. The same `npm run bench:roundtrip`
   command will exercise your real implementation instead of the
   stub.

## Hot-iterate on the manifest

The bench reads `examples/addons/*.json` at startup, so manifest
edits need a `bench:reset` to take effect:

```bash
# after editing examples/addons/addon.<your-id>.json
npm run bench:reset    # down --volumes + build
npm run bench:up
```

The audit ledger is on the `bench-state` Docker volume, so verdicts
from before the reset survive the restart. Wipe them with the
explicit `--volumes` flag (which `bench:reset` does for you).

## Iterating on the dispatcher

If you're changing
`browser-first/host/external-agent-runtime-dispatcher.mjs` or
`browser-first/host/addon-delegation-host-service.mjs`, the bench
image needs to rebuild:

```bash
npm run bench:reset
npm run bench:up
```

Because `bench/bench.Dockerfile` does `COPY . /app/repo/` and then
`npm install --omit=dev`, the new code is bundled into the image.

## Common pitfalls

**My new manifest doesn't appear in the dev panel.**
- Filename must be exactly `${id}.json` (e.g. `addon.weather.json`).
- Validation must pass. Run the validator manually.
- The dev panel reads `body.addons`; the bridge returns
  `{ok, status, body: {addons, generatedAt}}`. If you've modified
  the bridge's response shape, check the panel renderer.

**The bridge returns 403 for my dispatch call.**
- The `dev-roundtrip` caller has these pre-minted grants: `network`,
  `providers`, `agent-delegation`, `archive-intake-write`,
  `memory-provider`. If your tool requires a capability outside
  this set, the bridge denies. Either add the capability to
  `minimalLauncherCallerGrants` in `run-bridge-minimal.mjs`, or use
  a caller id whose grants you control.

**The bench keeps restarting.**
- Check `docker logs resonant-bench`. Most common cause: the audit
  ledger fails to write because the volume is unwritable. Run
  `docker compose -f docker-compose.bench.yml down --volumes` to
  wipe and rebuild.

**The dev panel shows the addon but the JSON fetch returns 500.**
- The audit ledger is failing silently. Look at the bridge log for
  `[bridge-audit-ledger] write failed`. Usually caused by a missing
  `RESONANTOS_USER_ROOT` mount — the bench sets this to
  `/var/lib/resonant-bench`.

## Where the bench lives in CI

`npm run bench:ci` is on the roadmap. It will:

1. Bring up the bench detached.
2. Wait for `/healthz` on every addon stub.
3. Run `bench/roundtrip.mjs`.
4. Capture the audit ledger as a CI artifact.
5. Tear down with `down --volumes`.
6. Exit 0 only if every dispatched tool got `200 OK` with a
   non-empty assistant reply.

Until `bench:ci` lands, `bench:up` + `bench:roundtrip` is the
manual version. Run them in PR review when an add-on changes.

## Roadmap for the bench

The bench is intentionally small. The next pieces are:

- **`bench/discovery.mjs`** — replace the hard-coded three-stub
  startup with manifest enumeration. Adds a new addon by dropping a
  manifest, no compose edit.
- **`bench/stubs/<protocol>.mjs`** — per-protocol stub router.
  Adding a new protocol becomes "one new file under `bench/stubs/`".
- **`RESONANTOS_ADDON_HOST_OVERRIDE_<ID>`** — launcher env hook for
  addons that run outside the bench container. Lets you iterate on
  your real implementation without rebuilding the bench image.
- **`bench:ci`** — non-interactive variant for PR gating.
- **`docs/authoring.md` §Iteration workflow** — keep this doc in
  sync as the bench grows.

## Cross-references

- [`docs/addons/authoring.md`](../../docs/addons/authoring.md) — the
  full add-on authoring guide.
- [ADR-018: Add-on SDK V0](../../docs/architecture/ADR-018-addon-sdk-v0.md)
  — formal manifest contract.
- [ADR-031: Agent Add-on SDK Lessons from Hermes](../../docs/architecture/ADR-031-agent-addon-sdk-lessons-from-hermes.md)
  — wire format for `agent-addon` / `local-service`.
- [`browser-first/host/external-agent-runtime-dispatcher.mjs`](../../browser-first/host/external-agent-runtime-dispatcher.mjs)
  — the dispatcher the bench exercises.