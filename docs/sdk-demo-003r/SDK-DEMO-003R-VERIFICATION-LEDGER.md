# SDK-DEMO-003R Verification Ledger

| Area | Candidate | Independent evidence | Result |
|---|---|---|---|
| T1–T3 + live admin revoke | `c869a92841511fc444ef42772bdae2e985303890` | VIGIL Test Lab issue #28 | PASS |
| T4 convergence | `c57d4d0f579f601de91fcf3b7d7faca343d68c7d` | VIGIL Test Lab issue #39 | PASS |
| T5 operator UI | `20726e395909e135782205d7fdad37d481aa5400` | VIGIL Test Lab issue #41 | PENDING FINAL RECORD |

## T1–T3 cumulative acceptance

Final independent run on `c869a928...`:
- Unit/Vitest PASS
- SDK tests PASS
- Browser-host 13/13
- Security/adversarial 12/12
- T2 status 6/6
- T2 grant regression 2/2
- Browser-first exit 0 with platform skip only
- graphical Extension 4/4
- source mutation none

## T4 acceptance

Issue #39 tested exact SHA `c57d4d0f...` and reported:
- actual SHA = requested SHA
- status PASS
- source mutation none
- Browser-host 13/13
- Security/adversarial 12/12
- T2 status 6/6
- T2 grant regression 2/2
- Browser-first 2220/2221, exit 0
- Extension 4/4
- artifact verification PASS

## T5 engineering evidence

Engineering work order #40 reports:
- browser-first 2234 pass / 0 fail / 1 platform skip
- graphical Extension 5/5 including real operator UI flow
- T1 adversarial 12/12
- UI tests 9/9
- bridge tests 5/5
- SDK Vitest 58/58
- browser-host 13/13

Do not convert this section to independent PASS until Test Lab #41 posts its final machine report.
