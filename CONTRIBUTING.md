# Contributing to ResonantOS vNext

Thank you for your interest in ResonantOS. This document covers the basics for
contributors. For the detailed agent/coding workflow, see [`AGENTS.md`](AGENTS.md).

## Code of Conduct

Be respectful, constructive, and assume good faith. This project is early-stage
and experimental — focus on making things better, not on assigning blame.

## Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/ResonantOS/2.0.0-alpha.git
   cd 2.0.0-alpha
   ```
2. Install dependencies: `npm install`
3. Start the browser dev server: `npm run dev`
4. Open `http://127.0.0.1:1430` in your browser.

See the [README](README.md) for all run modes and provider setup.

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `dev`  | Active development. All PRs target `dev`. |
| `main` | Stable preview/release branch. Created from `dev` after validation. |

**Do not commit directly to `main`.** Always work through `dev`.

## Pull Request Process

1. Open PRs against the `dev` branch.
2. Prefix the PR title with the area of change (e.g., `browser-first:`, `sdk:`,
   `archive:`, `docs:`).
3. Include a summary of what the change does and why.
4. Ensure all deterministic checks pass:
   ```bash
   npm test -- --run
   npm run build
   ```
5. For Rust changes, also run from `src-tauri/`:
   ```bash
   cargo fmt --check && cargo test
   ```
6. Add or update tests when changing behavior. Both Vitest and `node --test`
   suites are used — run the full suite before pushing.
7. When adding a module, moving ownership between modules, changing host routes,
   or moving behavior out of `App.tsx`, follow the
   [module ownership PR checklist](docs/architecture/MODULE-OWNERSHIP.md#pull-request-checklist-hook)
   and update the ownership map in the same PR.

## Code Style

- **TypeScript / React:** Strict TypeScript with explicit types. Prefer pure
  functions and avoid mutable shared state. Follow the patterns in `src/core/`.
- **Rust:** Standard `cargo fmt` style. Use the workspace toolchain pin
  (`1.94.1`).
- **Tests:** Place tests next to the source file or in the relevant `test/`
  directory. Use descriptive test names that explain what behavior is covered.

## Commit Messages

Write descriptive commit messages in the imperative mood:

```
browser-first: Add side panel chat hydration
archive: Fix move import rollback cleanup
```

The first word after the prefix should be a verb (`Add`, `Fix`, `Extract`,
`Harden`, `Document`, etc.).

## Reporting Issues

Open a GitHub issue with:

- A clear, short title.
- Steps to reproduce (if a bug).
- Expected vs. actual behavior.
- Environment: OS, Node.js version, browser (if applicable).
- Relevant log output or error messages.

## Provider Configuration

Never commit API keys, provider secrets, or wallet credentials. Secrets belong
in `ResonantOS_User/Secrets/` (gitignored). Use the Settings → Providers UI
to configure provider profiles.

## Questions

Start with the docs in `docs/`. If you're unsure about the architecture, read
the ADRs (`docs/architecture/ADR-*.md`) and the
[Product Guide](docs/PRODUCT_GUIDE_BROWSER_FIRST.md).
