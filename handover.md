# Handover: spec #309 (Terminal Twin experiment runner)

Integration branch: `claude/gallant-curie-3so8w0`. Orchestrator steps: `docs/agents/implementing.md`.

| Ticket | Title | Blocked by | Status | Claimed by |
| --- | --- | --- | --- | --- |
| #310 | One RNG stream per source | | merged in branch (4cff9d6) | |
| #311 | Measurement warm-up for any yard start mode | | merged in branch (f289569) | |
| #312 | Strategy parameters per decision point | | merged in branch (b846cc4) | |
| #313 | Tracer, minimal tt:experiment end to end | | merged in branch (c346589) | |
| #314 | Guards, KPI catalogue and invalid replicates | #313 | merged in branch (187a5a5) | |
| #315 | Full config overrides and grid expansion | #312, #313 | merged in branch (8a8b0a9) | |
| #316 | Warm-up and horizon in experiments | #311, #313 | merged in branch (907df2f) | |
| #317 | Parallel replicates, heavy lock, cost guard and provenance | #313 | merged in branch (e860163) | |
| #318 | Example experiments, glossary and first measured report | #310, #314, #315, #316 | merged in branch (65c4531) | |
| #319 | Run the browser smoke suite and fix regressions | all | done: CI run 45050346902, SMOKE: 157 passed, 0 failed, 0 flaky, 0 skipped (render budget re-measured for #310 in 79a6605) | |

## Next steps

- #310 merged (ENGINE_VERSION 0.59.0, goldens regenerated). Its follow-up for #318: paired-dual-cycle does not save empty driving once RNG is per-source; an experiment should measure it.

## Open points

None yet.
