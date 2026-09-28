# SDK-DEMO-003R Verification Ledger

| Area | Candidate | Independent evidence | Result |
|---|---|---|---|
| T1–T3 + live admin revoke | `c869a92841511fc444ef42772bdae2e985303890` | Test Lab #28 | PASS |
| T4 convergence | `c57d4d0f579f601de91fcf3b7d7faca343d68c7d` | Test Lab #39 | PASS |
| T5 operator UI | `20726e395909e135782205d7fdad37d481aa5400` | Test Lab #41 | PASS |
| T6 engineering | `30197261cb179a43126fc0890dd56de9354ffec9` | superseded | SUPERSEDED |
| T6/T6.1 final | `b8735970315a8f5ab4a4656dfe6702d31ad47d13` | Test Lab #45 | PASS |

## #28 — T1–T3 cumulative
Candidate=actual SHA; source mutation none; browser-host 13/13; security 12/12; T2 6/6 + 2/2; browser-first 2213/2214 exit 0; Extension 4/4; artifact verification PASS.

## #39 — T4
Candidate=actual SHA; source mutation none; browser-host 13/13; security 12/12; T2 6/6 + 2/2; browser-first 2220/2221 exit 0; Extension 4/4; artifact verification PASS.

## #41 — T5
Candidate=actual SHA; source mutation none; browser-host 13/13; security 12/12; T2 6/6 + 2/2; browser-first 2234/2235 exit 0; Extension 5/5; artifact verification PASS.

## #45 — T6/T6.1 final
Candidate=actual SHA `b8735970315a8f5ab4a4656dfe6702d31ad47d13`; status PASS; source mutation none; Unit/Vitest PASS; SDK tests PASS; browser-host 13/13; security 12/12; T2 6/6 + 2/2; browser-first 2250/2251 exit 0; Extension 5/5; artifact verification PASS.

## Lineage audit
- `c869a928 → c57d4d0f`: +1 / behind 0
- `c57d4d0f → 20726e39`: +1 / behind 0
- `20726e39 → 30197261`: +1 / behind 0
- `30197261 → b8735970`: +1 / behind 0

No accepted milestone dropped prior accepted history.
