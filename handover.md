# Handover: spec #309 (Terminal Twin experiment runner)

Integration branch: `claude/gallant-curie-3so8w0`. Orchestrator steps: `docs/agents/implementing.md`.

| Ticket | Title | Blocked by | Status | Claimed by |
| --- | --- | --- | --- | --- |
| #310 | One RNG stream per source | | open | |
| #311 | Measurement warm-up for any yard start mode | | merged in branch (f289569) | |
| #312 | Strategy parameters per decision point | | merged in branch (b846cc4) | |
| #313 | Tracer, minimal tt:experiment end to end | | merged in branch (c346589) | |
| #314 | Guards, KPI catalogue and invalid replicates | #313 | merged in branch (187a5a5) | |
| #315 | Full config overrides and grid expansion | #312, #313 | merged in branch (8a8b0a9) | |
| #316 | Warm-up and horizon in experiments | #311, #313 | open | |
| #317 | Parallel replicates, heavy lock, cost guard and provenance | #313 | open | |
| #318 | Example experiments, glossary and first measured report | #310, #314, #315, #316 | open | |
| #319 | Run the browser smoke suite and fix regressions | all | open | |

## Next steps

- #310 regenerates every golden: run it after #311 and #312 are merged so no other ticket touches goldens in parallel.

## Open points

None yet.
