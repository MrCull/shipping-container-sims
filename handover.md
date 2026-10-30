# Handover: spec #106 (integration branch `claude/add-props-and-modules`, PR #105)

Spec and ticket copies: scratchpad `spec-106.md`, `tickets106/<n>.md`. Implementer rules: `docs/agents/implementing.md`.

| Ticket | Title | Blocked by | Claimed by | Status |
|---|---|---|---|---|
| #107 | Single container factory | - | merged 132e368 | done |
| #108 | Stored properties, port rotation, inspector, docs | #107 | merged | done |
| #109 | Derived transit status, content status, dwell | #108 | merged | done |
| #110 | ROB bays | #108 | merged | done |
| #111 | Yard `grouped` (opt-in) | #108 | merged | done |
| #112 | Empty allocation `iso-type-best-position` (opt-in) | #108 | merged | done |
| #113 | Vessel `pod-weight` ordering (opt-in) | #108 | merged | done |
| #114 | Flip defaults, one golden regeneration | #109 #111 #112 #113 | merged | done |
| #115 | Bay viewer popup | #109 #110 | implementer (tt/115-bay-viewer) | in progress |

Merge #114 and #115 as they report (#114 regenerates goldens: merge before #115 if both are done, or regenerate on the merged tree). Then full smoke once, /code-review, finish.
