# Browser-First Host

Intent citation: `docs/architecture/ADR-037-browser-first-chromium-resonantos.md`

This is the first runnable browser-first ResonantOS host. It launches the native CEF Chrome Runtime app in visible browser mode, loads the ResonantOS browser-layer extension, and loads Phantom from a local Chrome/Brave profile when available.

Run:

```bash
npm run browser-first:dev
```

Install and verify the desktop app:

```bash
npm run browser-first:install
npm run browser-first:prove-desktop
```

The installer defaults to `~/Applications/ResonantOS Browser.app`. Set `RESONANTOS_BROWSER_INSTALL_ROOT=/Applications` only when intentionally doing a system-wide install with the required permissions.

After building and signing the launcher bundle, the installer clears generated `com.apple.quarantine` and `com.apple.provenance` metadata and best-effort registers the app with Launch Services. If `lsregister` reports a Spotlight scan error from inside Codex, rerun the install or verification command from a normal macOS Terminal; sandboxed Codex sessions cannot reliably prove Launch Services registration.

`browser-first:verify-installed` clears the previous launch log, opens the installed macOS app through Launch Services, and waits until the diagnostics prove the native AppKit menu, CEF/Chromium, main workspace, local bridge, Phantom, and pinned extensions are all ready. It must be run from a normal desktop session, not from the Codex sandbox, because the sandbox blocks local bridge sockets and AppKit observation. If Launch Services reports `kLSNoExecutableErr` in a sandbox even though the bundle preflight is valid, the verifier falls back to the validated launcher executable and reports the real runtime blocker, usually the local bridge `EPERM` boundary. When the bridge fails with `listen EPERM 127.0.0.1`, the report marks `environmentBoundary.type` as `sandbox-localhost-bind`; do not treat missing menus, Phantom, or workspace readiness as product failures from that run because Chromium never had a chance to start.

`browser-native:verify-live` is the strict native Chromium gate. It fails if any native CEF smoke test is skipped, so it must also be run from a normal desktop session. This is the gate that proves native page load, embedded NSView rendering, same-session click/type/scroll, extension entrypoints, downloads, permission denial, context menus, standard browser menu commands, local Manifest V3 execution, and Phantom provider injection.

`browser-first:verify-desktop` runs both gates in sequence and writes durable evidence to `logs/browser-first-desktop-verification.json`. Use this command for final readiness checks because it preserves stdout, stderr, parsed verifier JSON, and the exact failed step if macOS or CEF still blocks launch.

`browser-first:audit-desktop` reads that report and returns `ready` only when the report proves the installed app, native CEF host, AppKit menus, main workspace, local bridge, pinned ResonantOS/Phantom extensions, and strict native smoke coverage all passed.

`browser-first:prove-desktop` is the final one-command gate. It runs `browser-first:verify-desktop`, then `browser-first:audit-desktop`, and returns `ready` only when both pass.

The macOS menu bar is owned by the native CEF/AppKit host, not by the HTML extension UI. A ready launch must expose the standard browser menus:

```text
ResonantOS Browser · File · Edit · View · Assistant · History · Bookmarks · Profiles · Tab · Window · Help
```

The host installs that menu before CEF starts and reasserts it after `CefInitialize()`. Launch diagnostics require the `browser.native.appkit_menu.installed` event with `phase: "post-cef"` before the browser is considered ready. If a desktop launch only shows `ResonantOS Browser`, rerun `npm run browser-first:verify-installed` from a normal Terminal and inspect the reported AppKit menu issue before shipping.

Optional:

```bash
npm run browser-first:dev -- --url=https://resonantos.com/dao/
```

Profile state is stored under:

```text
~/ResonantOS_User/BrowserFirst/Profiles/main
```

This is now the product-direction prototype. Electron/Tauri browser surfaces and external Chrome sidecars are research paths only.
