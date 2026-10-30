# Handover: spec #106 (integration branch `claude/add-props-and-modules`, PR #105)

Spec and ticket copies: scratchpad `spec-106.md`, `tickets106/<n>.md`. Implementer rules: `docs/agents/implementing.md`.

| Ticket | Title | Blocked by | Claimed by | Status |
|---|---|---|---|---|
| #107 | Single container factory | - | merged 132e368 | done |
| #108 | Stored properties, port rotation, inspector, docs | #107 | merged | done |
| #109 | Derived transit status, content status, dwell | #108 | implementer (tt/109-transit-status) | in progress |
| #110 | ROB bays | #108 | implementer (tt/110-rob-bays) | in progress |
| #111 | Yard `grouped` (opt-in) | #108 | implementer (tt/111-yard-grouped) | in progress |
| #112 | Empty allocation `iso-type-best-position` (opt-in) | #108 | | |
| #113 | Vessel `pod-weight` ordering (opt-in) | #108 | | |
| #114 | Flip defaults, one golden regeneration | #109 #111 #112 #113 | | |
| #115 | Bay viewer popup | #109 #110 | | |

Next: merge #109-#111 as they report; then start #112, #113. Note: shc-model smoke spec timed out once under a full run and passed alone (load flake).
