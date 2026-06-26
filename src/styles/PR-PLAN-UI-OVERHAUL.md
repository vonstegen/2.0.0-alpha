# PR Plan: UI/UX Visual Refresh

**Branch:** `uiux-dev`
**Target:** `dev`
**Area prefix:** `ui:`
**Design system source:** `michelnavarra/resonant-os-design-system` (ROSI v0.3, "Coherent Verdant")

---

## Goal

Full visual refresh of ResonantOS using Michel Navarra's ROSI design system
as the source of truth. Migrate from the current warm-brown palette to the
Coherent Verdant token system (64 tokens, 5 atoms). Initial work lands in
`src/styles/`; module-level CSS follows.

---

## Key Palette Shift

| Property     | Current (`base.css`)          | ROSI v0.3                          |
|--------------|-------------------------------|------------------------------------|
| Background   | `#151413` warm brown          | `#0F1411` green-warm dark          |
| Text primary | `#e8e3d8` warm beige          | `#EAF1EC` green-tint white         |
| Accent       | `#10b981` emerald             | `#3FB286` Coherent Verdant         |
| Secondary    | `#d97706` amber               | (removed — single accent family)   |
| Fonts        | DM Sans + JetBrains Mono      | system-ui + Inter + ui-monospace   |
| Borders      | neutral                       | green-tinted, calibrated alphas    |

---

## Task List

### Phase 0 — Import Design System (`michelnavarra/resonant-os-design-system`)

- [ ] Create `uiux-dev` branch from `dev`
- [ ] Copy design system project files into a dedicated directory (e.g. `src/styles/rosi-design-system/`)
- [ ] Remove `.git/` folder from the copied snapshot
- [x] Review licenses — MIT, compatible
- [x] Review for secrets / API keys / credentials — none found
- [ ] Remove `reference/` folder (contains snapshots of our own CSS, not needed)
- [ ] Remove `.github/sync-watch.sh` (Michel's internal cron, not relevant to us)
- [ ] Commit the copied snapshot with attribution to Michel in the commit message
- [ ] Open PR into `dev`

### Phase 1 — Token Migration (`src/styles/base.css`)

Replace current `base.css` custom properties with ROSI v0.3 tokens.
Source of truth: `rosi-design-system/tokens/tokens.css` (64 tokens).

- [ ] Strip `--rosi-` prefix from all token names (use `--surface-base`, `--accent-default`, etc.)
- [ ] Merge new tokens into `base.css` `:root` — blend with or replace existing vars
- [ ] Map and replace current color vars → new token names (prefix stripped):
  - `--bg-primary` → `--surface-base`
  - `--bg-secondary` → `--surface-raised`
  - `--bg-tertiary` → `--surface-overlay`
  - `--text-primary` → `--text-primary` (same name, new value)
  - `--text-secondary` → `--text-secondary` (same name, new value)
  - `--text-muted` → `--text-tertiary`
  - `--accent` / `--accent-hover` → `--accent-default` / `--accent-bright`
  - `--secondary` (`#d97706`) → decide: keep for warnings or drop
  - `--info` / `--warning` / `--danger` → `--status-info` / `--status-warning` / `--status-error`
- [ ] **Decision: fonts** — ROSI specifies system-ui + Inter + ui-monospace;
      current uses DM Sans + JetBrains Mono (Google Fonts). Options:
  - (a) Adopt ROSI fonts (system-ui stack) — removes external font dependency
  - (b) Keep DM Sans / JetBrains Mono — preserves current feel, keeps Google Fonts load
  - (c) Hybrid — e.g. keep JetBrains Mono for code, switch body to system-ui
- [ ] Apply font decision to `base.css`
- [ ] Add new token categories not in current `base.css`:
  - Border tokens (subtle/default/strong/glow)
  - Spacing scale (space-0 through space-8)
  - Border-radius scale (xs through full)
  - Sizing tokens (icon, avatar, control heights)
  - Elevation/shadow tokens
  - Motion/easing tokens
  - Z-index tokens
- [ ] Add opacity map for tokens that use varying alpha levels.
      Rule: round in increments of 0.01 or 0.02 max per value.
  - Border family (0.14→0.15 / 0.20 / 0.40 / 0.55)
  - Accent family (0.08 / 0.12 / 0.18→0.20)
  - Surface (0.055→0.06 / 0.20 / 0.72 / 0.94→0.95)
  - Status tones (bg: 0.08, 0.10, 0.12 already clean /
      border: 0.28→0.30, 0.32, 0.34→0.35)
- [ ] Remove or keep Google Fonts `@import` (depends on font decision above)
- [ ] Verify contrast ratios (ROSI provides AAA on all primary text)
- [ ] Update `--ch-*` channel vars or remove if no longer needed

### Phase 2 — Shell & Layout (`src/styles/shell.css`, `responsive.css`)

- [ ] Update shell background gradients to use ROSI surface/accent tokens
- [ ] Revise shell grid (dock, main, chat rail proportions)
- [ ] Update topbar height and styling
- [ ] Align responsive breakpoints with ROSI spec (1280/920/760/600px)
- [ ] Review zoom-stage scaling behavior

### Phase 3 — Component Styles (module CSS files)

Migrate module CSS to use ROSI tokens and atom patterns.
Atom specs in `rosi-design-system/reference/ui-extraction-browser-v3.md`.

- [ ] Workspace cards (`src/styles/workspace-cards.css`) → ROSI Card atom
- [ ] Chat rail (`src/modules/chat/chat-rail.css`, `messages.css`)
- [ ] Settings panel (`src/modules/settings/settings.css`) → ROSI Card (subnav) + Input + Button atoms
- [ ] Archive view (`src/modules/archive/archive.css`)
- [ ] Browser module (`src/modules/browser/browser.css`)
- [ ] Delegation UI (`src/modules/delegation/delegation.css`)
- [ ] Recovery screens (`src/modules/recovery/recovery.css`)
- [ ] Addon workspaces (hermes, opencode, obsidian, paperclip, compute)

### Phase 4 — Polish & QA

- [ ] Cross-browser check (Chrome, Firefox, Edge)
- [ ] Confirm no regressions in existing functionality
- [ ] Verify cascade order in `src/styles.css` still correct
- [ ] Screenshot before/after for PR description
- [ ] Verify all ROSI contrast ratios hold in practice

---

## Files in Scope

```
src/styles/rosi-design-system/     ← ROSI snapshot (imported from Michel)
  tokens/tokens.css              ← 64 CSS custom properties (source of truth)
  tokens/tokens.json             ← W3C Design Tokens spec
  guide/                         ← HTML color guide
  reference/                     ← extraction docs, atom specs

src/styles/base.css              ← tokens, palette, typography (primary migration target)
src/styles/shell.css             ← app shell grid, backgrounds
src/styles/responsive.css        ← breakpoints
src/styles/workspace-cards.css   ← card components
src/styles.css                   ← import order (cascade)
src/modules/*/                   ← per-module CSS
```

## Notes

- ROSI is dark-only, no light theme — matches our current approach.
- ROSI drops the secondary amber accent (`#d97706`). Status colors
  (warning amber, error red, info blue) cover those use cases. Decide
  whether any current amber usage needs a replacement or maps to
  `--rosi-status-warning`.
- Font change (DM Sans → system-ui) removes the Google Fonts dependency
  but changes the visual feel significantly. Test early.
- Keep cascade order in `src/styles.css` stable — add new imports at the
  right position, don't reorder existing ones without testing.
- Token changes in `base.css` propagate everywhere — test globally after
  each token update.
- Commit granularly: one logical change per commit for easy review/revert.
- The `--ch-*` primitive channel vars in current `base.css` may become
  unnecessary if ROSI's pre-mixed rgba tokens cover all alpha use cases.
