# Security Policy

## Report Privately

Do not open a public issue for a suspected vulnerability.

**Disclosure contact:** Vladimir Rondelli at `rondellivladimir@gmail.com`.

Email that address with the subject prefix
`[SECURITY]`. Include only the minimum information needed to understand and
reproduce the problem:

- affected version or commit;
- affected extension or bridge surface;
- reproduction steps using test data;
- expected impact; and
- a safe way to contact you for follow-up.

Do not send access tokens, provider keys, wallet credentials, cookies, browser
profiles, login databases, private user content, or unredacted production logs.
If sensitive evidence is necessary, first use email to agree on a secure
transfer method. No project PGP key is currently published.

The disclosure contact owns initial triage and coordinates remediation and any
public disclosure. General support, non-sensitive bugs, and feature requests
belong in the public issue forms described in [SUPPORT.md](SUPPORT.md).

## Response Targets

| Stage | Target |
| --- | --- |
| Acknowledge the report | 3 business days |
| Assign severity and scope | 7 business days |
| Provide a fix or mitigation plan for a confirmed high-impact finding | 14 business days |

These are response targets for the active alpha, not a paid support guarantee.
Public disclosure timing is coordinated with the reporter after users have a
reasonable remediation path.

## Supported Security Boundary

Security reports are accepted for the current browser-first alpha:

- the Chrome Manifest V3 side panel, new-tab page, content scripts, background
  service worker, and their message boundaries;
- the authenticated loopback Node.js bridge and its capability tokens;
- provider routing, subprocess invocation, and process environment handling;
- memory-service and local-service listener exposure;
- add-on manifests, capability grants, allowed-tools declarations, and scoped
  bridge APIs; and
- repository and release integrity, including CI credentials, action pinning,
  artifacts, and provenance.

The latest `dev` branch and alpha tags still in active testing receive security
fixes. A third-party dependency report is in scope when it demonstrates impact
on this repository. Social engineering, disruption that requires already
trusted local access, and reports without a plausible repository impact are out
of scope.

## Researcher Expectations

Good-faith research must use accounts and data you are authorized to access.
Do not exfiltrate data, access third-party accounts, disrupt provider services,
modify trusted memory outside disposable test data, bypass required human
approval boundaries, or publish details before coordinated disclosure.

Good-faith work within this policy will not be treated as abuse by the project.

## Terminal Allowlist Policy

The ResonantOS subprocess posture is closed and explicit. There are two
mechanisms for spawning a child process from a host module:

1. **Head allowlist.** Read-only / inspection binaries are allowlisted
   by command head in
   `scripts/security-pipeline/checks/lib/terminal-allowlist.mjs`:
   `command`, `which`, `where`, `ps`, `nm`, `rg`, `git`, plus the
   reviewed user-installed runtimes `hermes`, `ollama`, `uv`,
   `opencode`, `python` (Hermes venv), and `openssl` (CP-BR1 + bridge
   TLS). Each head allowlist entry is reviewed; shell wrappers
   (`sh`, `bash`, `zsh`, `cmd`, `powershell`, `pwsh`) are NEVER on
   the head allowlist.

2. **Per-site approval marker.** Platform-dispatch helpers that cannot
   be allowlisted as fixed binaries carry a reviewed `approved_by`
   marker in
   `.github/security-pipeline/checks.yml` under
   `recordSets.browser-first-production-spawns`. The closed set of
   off-list approved heads is:

   ```
   open         (macOS file open / Finder reveal)
   xdg-open     (Linux desktop dispatch)
   explorer.exe (Windows Explorer)
   osascript    (macOS folder picker)
   powershell.exe (Windows folder picker)
   zenity       (Linux GTK folder picker)
   kdialog      (Linux KDE folder picker)
   ```

   These heads are intentional platform abstractions: the file
   picker, for example, dispatches to whichever OS-native dialog the
   host supports, and that dispatch is non-deterministic across OS
   versions. Each per-site record pins the absolute program path
   (`/usr/bin/open`, `/usr/bin/zenity`, etc.), declares `shell: false`
   with a fixed argv, declares an explicit `env_vars` allowlist (no
   `process.env` spread), and carries a `resolution` block that
   documents how the program is located.

Every off-list spawn site must satisfy all four invariants:

- `shell: false`;
- env-clear: explicit `env_vars` allowlist (no `process.env` spread);
- pinned executable root: the program is resolved to a fixed absolute
  path or to one of a closed list of install roots; no ambient PATH
  lookup for the head allowlist;
- no argv secret: no token, credential, provider secret, wallet
  material, or private filesystem path appears in `args` or
  `env_vars`.

### Adding a future reviewed spawn

To add a new reviewed spawn site, edit
`.github/security-pipeline/checks.yml`:

- **Fixed / pinned command.** Add the head to `ALLOWLIST.allow` in
  `lib/terminal-allowlist.mjs` AND add a per-site record in
  `recordSets.browser-first-production-spawns` with the four
  invariants above. Document the resolution and approved_by in a
  comment.
- **Platform-dispatch helper.** Add a per-site record in
  `recordSets.browser-first-production-spawns` with the four
  invariants. The head is added to the closed set in
  `subprocess-off-list-closed-set.test.mjs` (the regression guard)
  and a review comment explains why the head is not a fixed binary.

A future change that introduces an off-list spawn without an
allowlist entry or a reviewed marker is caught by
`subprocess-off-list-closed-set.test.mjs` (CP-SEC-1).
