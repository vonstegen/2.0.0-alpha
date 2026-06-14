# Security Pipeline Design

## Invoke Metadata

- Mode: `design`
- Target artifact: ResonantOS modular security pipeline
- Source refinement: internal design refinement artifacts, omitted from PR scope
- Previous MVP refinement: internal MVP refinement artifacts, omitted from PR scope
- Mode contract: Arcanum design mode
- Status: `pass`

## Template/Profile Selection

Selected profile: architecture design bundle.

Reason: the target is a repository feature architecture, not a spell or sigil lifecycle artifact. The design must provide the six required views and a plan-ready handoff without creating implementation tasks inside design mode.

## 1. Context View

ResonantOS needs a security-only CI control plane because its risk surface is broader than ordinary web app checks:

- npm app dependencies
- browser host add-on dependencies
- Rust/Tauri host dependencies
- Tauri IPC and capability boundaries
- provider secrets
- add-on manifests and grants
- browser automation host controls
- alpha packaging and artifact distribution

The existing `alpha-build.yml` proves build/test/package behavior. The new security pipeline should complement it, not absorb it.

## 2. High-Level Structure View

```text
GitHub event
  -> security workflow
    -> check registry
      -> check family selection
        -> check adapter runner
          -> check adapters
            -> normalized result
    -> CI status and artifact summary
```

Primary parts:

- `security workflow`: GitHub Actions entrypoint.
- `check registry`: declarative list of checks.
- `runner`: reads registry and executes enabled checks.
- `adapters`: one check implementation each.
- `result envelope`: stable output format for pass/fail/warn evidence.

## 3. Low-Level Components View

### Security Workflow

Candidate path:

```text
.github/workflows/security.yml
```

Responsibilities:

- run on `pull_request`, `push` to `dev`, and `workflow_dispatch`;
- use least-privilege `permissions: contents: read`;
- avoid secrets;
- set up Node and Rust only where needed;
- call the registry runner;
- run GitHub-native dependency review on pull requests.

### Check Registry

Candidate path:

```text
.github/security-pipeline/checks.yml
```

Candidate shape:

```yaml
version: 1
families:
  supply-chain:
    status: active
checks:
  - id: npm-lockfiles
    family: supply-chain
    policy: block
    adapter: npm-lockfiles
    surfaces:
      - .
      - addons/resonant-browser-host
      - addons/resonant-browser-native
```

### Runner

Candidate path:

```text
scripts/security-pipeline/run-check.mjs
```

Responsibilities:

- load registry;
- filter by family, id, or policy;
- invoke one adapter at a time;
- normalize pass, warn, block, skipped, and disabled outcomes;
- fail only when an enabled check with `policy: block` fails.

### Adapter Contract

Each adapter should accept:

```text
--check <check-id>
--config <registry-path>
```

Each adapter should emit:

```json
{
  "checkId": "npm-audit",
  "family": "supply-chain",
  "status": "pass",
  "policy": "block",
  "summary": "3 npm surfaces audited",
  "evidence": []
}
```

### MVP Adapters

- `npm-lockfiles`: validates dependency-bearing package surfaces have lockfiles.
- `npm-audit`: runs `npm ci --ignore-scripts` and high-severity audit.
- `rust-audit`: runs advisory checks for `src-tauri/Cargo.lock` and `crates/resonator-control/Cargo.lock`.
- `actions-hardening`: checks workflow permission/triggers/action pinning policy.

GitHub dependency review should remain a GitHub-native action job because it depends on pull request dependency diff context.

## 4. Workflow Process View

### Pull Request

```text
PR opened or updated
  -> run security workflow
  -> run registry checks
  -> run dependency review
  -> block only on policy:block failures
  -> report warnings for observe/warn checks
```

### Push To Dev

```text
push to dev
  -> run security workflow
  -> run registry checks
  -> skip dependency review if no PR diff context
```

### Add A Check

```text
create adapter
  -> add registry entry
  -> start at observe or warn unless deterministic enough for block
  -> validate locally
  -> promote to block after baseline is clean
```

### Remove Or Pause A Check

```text
set policy disabled
  -> record reason in registry comment or adjacent note
  -> keep adapter unless obsolete
```

## 5. Decision Flow View

### Should A Check Block?

```text
Is the check deterministic?
  no -> observe
  yes -> Is the repo baseline clean?
    no -> warn
    yes -> Does failure indicate unacceptable risk?
      yes -> block
      no -> warn
```

### Should A Security Concern Become A Family?

```text
Does it contain multiple checks or surfaces?
  yes -> family
  no -> single check

Does it need different policy timing than existing families?
  yes -> family
  no -> check under existing family
```

### Supply Chain MVP Decision

Supply chain becomes the MVP because dependency install, Rust crates, GitHub Actions, and packaged desktop artifacts are close to the release path and can be checked deterministically.

## 6. Dependency Interface View

### External CI Interfaces

- GitHub Actions workflow events and permissions.
- GitHub dependency review action for PR dependency diffs.
- npm registry and audit APIs.
- RustSec advisory database through `cargo-audit`.
- Optional later OpenSSF Scorecard.
- Optional later GitHub artifact attestations.

### Repo Interfaces

- npm lockfiles and package manifests.
- Rust lockfiles and Cargo manifests.
- `.github/workflows/*.yml`.
- future `.github/security-pipeline/checks.yml`.
- future `scripts/security-pipeline/*`.

### Security Boundary Rules

- Security jobs should not receive repository secrets.
- Audit/install jobs should prefer non-executing dependency materialization when possible.
- Build/package jobs remain separate from security scan jobs.
- Generated scan outputs must not contain raw secrets.
- Check adapters must report evidence, not mutate source files.

## Design Decisions

| Decision | Outcome |
| --- | --- |
| Pipeline type | Security-only control plane, not a generic CI framework. |
| Configuration | Registry-driven checks. |
| MVP family | Supply chain. |
| First workflow | Dedicated `security.yml`, separate from `alpha-build.yml`. |
| Policy states | `observe`, `warn`, `block`, `disabled`. |
| Promotion model | `observe -> warn -> block`. |
| First hardening posture | No secrets, least privilege, no package lifecycle scripts during audit installs. |

## Risks

- Over-abstracting before the first workflow exists. Mitigation: MVP must implement only supply chain plus the minimal registry runner.
- npm audit noise. Mitigation: start with high severity.
- action SHA pinning churn. Mitigation: let `actions-hardening` begin as `warn` until cleanup is done.
- cargo-audit tool installation trust. Mitigation: pin the tool version or use a pinned action only after action pinning policy is settled.
- registry becoming stale. Mitigation: require every adapter to have a local dry run and a clear owner/family.

## Unresolved Gaps

- Exact scanner versions and pinning strategy.
- Whether `addons/resonant-browser-native` should get a lockfile despite having no dependencies.
- Whether to enforce full action SHA pinning in MVP or warn first.
- Whether security results should be uploaded as artifacts in MVP.

## Handoff To Plan

Plan mode should convert this design into:

- implementation layering,
- one MVP work-pack,
- explicit SWUs,
- validation commands,
- first task-session route.
