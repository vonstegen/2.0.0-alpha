# T2 — Read-Only Discovery

## Finding
Status/discovery previously crossed into installation mutation.

## Decision
**READ/DISCOVERY REPORTS STATE. EXPLICIT INSTALL MUTATES STATE.**

Discovery may cache canonical manifests. It does not install. Explicit install is separate and grants nothing.

## Evidence
Dedicated status-read-only and grant-regression suites remain green through later exact-SHA Test Lab runs.

## Status
CLOSED.
