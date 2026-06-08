# ResonantOS vNext — 2.0.0-alpha

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE.txt)

**ResonantOS is a browser-first AI operating layer.**  
It is not a dashboard — it is a Chromium-family browser where the AI assistant,
memory, add-ons, provider routing, and task monitor all live together in one
application.

This repository is the public source preview of ResonantOS vNext plus the
add-on SDK foundation. It is not a finished consumer release.

> **Status:** Public source preview — active development on the `dev` branch.
> See [`docs/PRODUCT_GUIDE_BROWSER_FIRST.md`](docs/PRODUCT_GUIDE_BROWSER_FIRST.md)
> for the product direction and [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md)
> for the operational checkpoint.

---

## Quick Start — Browser Preview (fastest path)

```bash
cd 2.0.0-alpha
npm install
npm run dev
```

This starts a Vite dev server on `http://127.0.0.1:1430`. Open that URL in any
browser to see the ResonantOS shell with the main AI workspace, chat rail, and
workspace navigation.

No Tauri, no native build, no Rust toolchain required.

---

## Full App — Browser-First (Chromium-native path)

The full ResonantOS browser runs as a Chromium-family app with a native browser
host, side panel, agent control overlay, and Living Archive integration.

```bash
npm run browser-first:install       # build + install the browser-first app
npm run browser-first:dev           # launch in development mode
```

See [`browser-first/README.md`](browser-first/README.md) and
[`docs/PRODUCT_GUIDE_BROWSER_FIRST.md`](docs/PRODUCT_GUIDE_BROWSER_FIRST.md)
for details.

---

## Desktop App — Tauri Shell (legacy / feature reservoir)

The older Tauri desktop shell is still available as a reference and feature
reservoir. It requires a Rust toolchain (pinned to 1.94.1):

```bash
rustup toolchain install 1.94.1
rustup override set 1.94.1
npm run tauri:dev
```

See [`docs/ALPHA_DISTRIBUTION.md`](docs/ALPHA_DISTRIBUTION.md) for packaging
instructions. Note that the active product path is now browser-first (per
ADR-037); the Tauri shell is not the primary development target.

---

## Provider & API Key Setup

ResonantOS routes AI model calls through a **provider fabric**. You need at
least one provider configured to use the chat and agent features.

Supported provider types (defined in `src/core/defaults.ts`):

| Provider        | Type               | Key Required |
|-----------------|--------------------|--------------|
| MiniMax         | `minimax`          | Yes          |
| OpenAI          | `openai`           | Yes          |
| Compatible      | `openai-compatible`| Varies       |
| Local LLM       | `local`            | No           |

### How to configure

1. Launch the app (browser or Tauri).
2. Open **Settings → Providers**.
3. Add a provider profile with your API key.
4. Assign a routing priority (fastest/cheapest first, fallback on failure).

> ⚠ Provider secrets are stored under `ResonantOS_User/Secrets/`. They are not
> shared, committed, or bundled.

For local models (e.g., Ollama, LM Studio, llama.cpp), add a `local` or
`openai-compatible` provider pointing to `http://localhost:{port}`.

---

## What's Included

- **ResonantOS shell** — workspace layout, chat rail, settings, add-on registry
- **Augmentor Chat** — default primary-agent add-on (configurable)
- **Living Archive** — default memory-system add-on (configurable)
- **Provider fabric** — routing, fallback, cost policy for AI model calls
- **Add-on SDK** — manifest validation, capability grants, registry helpers
- **Browser agent control** — mediated web page interaction via side panel
- **Resonant Engineer** — kernel-owned setup/repair/recovery assistant
- **MCP bridge examples** — `examples/living-archive-memory-service.mjs`

## Project Structure

```
├── browser-first/              # Chromium-native browser host & extension
├── src/
│   ├── core/
│   │   ├── contracts.ts        # Public interfaces and types
│   │   ├── defaults.ts         # Core services, providers, default state
│   │   └── policies.ts         # Archive write guards, provider selection
│   ├── sdk/addons/             # Add-on validation & registry helpers
│   └── …                       # React UI, workspace components
├── public/addons/index.json    # Default public add-on catalog
├── examples/                   # SDK reference services & MCP bridges
├── src-tauri/                  # Tauri desktop shell (legacy)
└── docs/                       # ADRs, product guide, project status
```

## Git Workflow

- Active development happens on `dev`.
- Commit to `dev` by default.
- `main` is the stable preview/release branch (not yet created).
- Do not commit directly to `main` unless explicitly instructed.
- Merge or PR `dev` into `main` only after deterministic validation.

## Validation

Before merging or tagging:

```bash
npm test -- --run               # Vitest (TypeScript/UI)
npm run build                   # TypeScript + Vite production build
```

If touching Rust/Tauri code (legacy path):

```bash
cd src-tauri
cargo fmt --check && cargo test
```

## Documentation

| Document | Purpose |
|----------|---------|
| [`docs/PRODUCT_GUIDE_BROWSER_FIRST.md`](docs/PRODUCT_GUIDE_BROWSER_FIRST.md) | Human-readable product overview |
| [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) | Operational checkpoint & validation snapshot |
| [`docs/ALPHA_DISTRIBUTION.md`](docs/ALPHA_DISTRIBUTION.md) | Build & share instructions for alpha testers |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contributor guidelines |
| [`AGENTS.md`](AGENTS.md) | AI coding agent instructions (internal) |

## License

MIT — see [LICENSE.txt](LICENSE.txt).
