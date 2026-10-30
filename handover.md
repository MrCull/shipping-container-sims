# Handover: spec #106 (integration branch `claude/add-props-and-modules`, PR #105)

Spec and ticket copies: scratchpad `spec-106.md`, `tickets106/<n>.md`. Implementer rules: `docs/agents/implementing.md`.

| Ticket | Title | Blocked by | Claimed by | Status |
|---|---|---|---|---|
| #107 | Single container factory | - | merged 132e368 | done |
| #108 | Stored properties, port rotation, inspector, docs | #107 | merged | done |
| #109 | Derived transit status, content status, dwell | #108 | merged | done |
| #110 | ROB bays | #108 | implementer (tt/110-rob-bays) | built, awaiting merge |
| #111 | Yard `grouped` (opt-in) | #108 | implementer (tt/111-yard-grouped) | built, awaiting merge |
| #112 | Empty allocation `iso-type-best-position` (opt-in) | #108 | | |
| #113 | Vessel `pod-weight` ordering (opt-in) | #108 | | |
| #114 | Flip defaults, one golden regeneration | #109 #111 #112 #113 | | |
| #115 | Bay viewer popup | #109 #110 | | |

Built, awaiting merge (in order): #110, #111, #112, #113 (branches tt/110-rob-bays, tt/111-yard-grouped, tt/112-empty-allocation-iso, tt/113-pod-weight-ordering). #112/#113 goldens need regenerating on merged tree (kpis.dwell from #109). Note: shc-model smoke spec timed out once under a full run and passed alone (load flake).
