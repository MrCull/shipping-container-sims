# Crane plan (#288): cost and prediction accuracy

Measured against ENGINE_VERSION 0.54.0, branch `tt/288-crane-plan`, base main at 9fffaa2.

## Cost on the peak day

`tt:run --preset "TTI Algeciras, peak day" --until time:7200`, run directly with `tsx` (not `pnpm run`) under the heavy
lock, twice per side, alternating:

| | wall run 1 | wall run 2 | event-log hash |
|---|---|---|---|
| main (9fffaa2) | 53.3 s | 52.9 s | `0b4a244bab40fb` |
| crane plan branch | 51.2 s | 51.1 s | `0b4a244bab40fb` |

The event-log hash is identical, so the plan changes no event. The plan costs nothing measurable (the difference is
noise, in the branch's favour): one plan is built per vessel when its cranes are assigned, and the read recalculation runs
only when a view, `tt:plan` or the final report asks.

## Prediction accuracy (estimator v1, nominal cycle, no transport delay)

`pnpm run tt:plan --preset "TTI Algeciras, peak day" --vessel V001 --until vessels:1` (estimator before the first-package
change described below):

- finish predicted 9:19:36, actual 11:33:44 (the estimator is a lower bound: 2 h 14 min early);
- predicted conflict 0 s, actual rail wait 18,550 s over the vessel's cranes;
- mean package start error 4,853 s.

Why the prediction shows no conflict while rail wait is large: the cranes of a vessel all work their bays in ascending
order at the same nominal pace, so in the plan a crane reaches its boundary bay only after its neighbour has left it. The
rail wait comes from the cranes working at different real paces (hatch lashing waits, transport waits, twin lifts), which a
nominal estimator cannot see. A window is predicted only when the nominal paths overlap, so conflict seconds are a floor on
the pace-mismatch loss, not an estimate of it. Calibrating the estimator from the run (per crane measured moves per hour)
is the step that would make the prediction useful, and is out of scope of #288 (successor).

At sim time 7200 on the same preset (branch): V001 predicted conflict 0 s against 2,155 s actual rail wait, V002 0 s
against 2,089 s.

## Estimator change in this PR

A package now starts when the crane takes it and its duration includes the gantry travel from the previous bay (earlier the
travel was added before the predicted start while the engine marks the package started at once). Predicted finishes are
unchanged; start errors no longer carry a constant offset per crane.
