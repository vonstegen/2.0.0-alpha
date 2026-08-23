# ResonantOS 2.0.0-beta.1 Release Notes

ResonantOS `2.0.0-beta.1` is a browser-first tester build for the Augmentor
beta.1 gate. It keeps the Alpha runtime boundary: the Chrome Manifest V3
side-panel extension plus the authenticated local Node.js bridge started with
`npm run browser-first:bridge`.

Use these notes with [docs/augmentor-tester-runbook.md](augmentor-tester-runbook.md)
and the [docs/augmentor-future-list-acceptance-matrix.md](augmentor-future-list-acceptance-matrix.md).

## Safe To Test Today

- First-run setup through the local bridge and unpacked Chrome extension.
- Provider setup, Provider Fabric routing, visible fallback, and provider removal.
- Page understanding, highlight-to-ask, summaries, counterpoints, and explain-jargon actions.
- Cross-tab comparison with visible tab provenance.
- Restart-safe session summary context and Living Archive continuity proof paths.
- Governed Agent Control for safe click, type, and scroll actions.
- Agent Control stop/cancel and recovery UI.
- Add-on delegation controls, execution toggles, capability chips, and audit trail.
- OpenCode handoff as an external local tab, not an embedded or governed ResonantOS action surface.

## Human-Only Boundaries To Verify Refuse

Follow the refusal probes in
[docs/augmentor-tester-runbook.md](augmentor-tester-runbook.md#4-human-only-boundaries-verify-these-refuse).
The beta.1 build must refuse or hand off these actions instead of executing them:

- Public web form submit.
- Password, credential, payment, passkey, PIN, and security-code field typing.
- Saved credential autofill.
- Wallet connect, wallet sign, payments, purchases, and checkout.
- Email send and calendar write actions.

If any probe executes without explicit human action, stop testing that path and
file a security issue with redacted evidence.

## Deferred To Beta.2

The maintained source of truth is the
[docs/augmentor-future-list-acceptance-matrix.md](augmentor-future-list-acceptance-matrix.md).
Do not treat these as implemented beta.1 behavior:

- Personal connectors, including Gmail read/draft-only handoff and Calendar read-only availability.
- Voice mode and transcript-to-composer workflows.
- Shopping checkout, booking reservation, meeting scheduling write, and recurring task automation.
- Image/media understanding.
- Explicit `@tab` references.
- Opt-in preference memory and proactive suggestions.
- Third-party add-on install and uninstall flows.

## Known Limitations

- Bridge-connected testing uses a source checkout; the extension artifact does not include generated bridge credentials.
- `browser-first/resonantos-side-panel-extension/src/bridge-config.generated.js` is local state and must not be shared.
- Add-on disable is not uninstall; manual cleanup steps are documented in the tester runbook.
- The OpenCode cockpit opens a local ungoverned tab; ResonantOS does not audit actions taken inside that cockpit.
- Windows host helpers support the canonical `C:\Windows` system root path only for the Alpha/Beta browser-first boundary.
