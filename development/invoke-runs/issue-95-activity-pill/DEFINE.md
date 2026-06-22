# DEFINE - Issue 95

## Goal

Implement the Agent Control overlay activity pill requirement from #95: the pill should communicate the current browser-control action in plain human language while the page overlay remains active for the full run.

## User Outcome

When Augmentor is operating a page, the human can glance at the page and understand whether the system is reading, clicking, typing, verifying, or waiting for them.

## Constraints

- Preserve Agent Control safety boundaries.
- Preserve detailed monitor/report/job evidence.
- Keep the implementation local to the overlay/run-state path.
- Add tests before implementation and keep validation deterministic.

## Out Of Scope

- New planner logic.
- New browser permission modes.
- Monitor redesign.
- Provider routing or model behavior.
