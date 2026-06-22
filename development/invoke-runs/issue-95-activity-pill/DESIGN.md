# DESIGN - Issue 95

## Design

Separate public overlay labels from durable step trace labels.

The control run state can continue to record detailed step labels, notes, and details for the monitor and saved reports. Only the label passed to the page overlay for active step updates needs to be normalized into the public vocabulary.

## Public Action Vocabulary

- `reading`: read, inspect, forms, tabs, open, search, switch_tab
- `clicking`: click, scroll
- `typing`: type
- `waiting for you`: wait, approval-oriented blocked states
- `verifying`: existing runner verification calls
- `working`: fallback for unknown active work

## Containment

The page overlay command remains the same shape: `{ active, label, phase }`. No persistence schema changes are needed because the public label is not stored as the durable step record.

Navigation-like Agent Control steps map to `reading` so the visible pill stays in the issue's small public vocabulary while the detailed monitor/report action still records the actual step.
