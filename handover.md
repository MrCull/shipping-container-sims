# Handover: Terminal Twin engine backlog (#244)

Branch: `claude/ecstatic-ritchie-qf2qmr`. Delete this file before merging.

## The ask

Pick up the tickets nobody had started, check the recently closed PRs and tidy the tracker.

## Tracker work done

- Removed the stale `merged-in-branch` label from the 17 closed tickets of PR #266 (#246 to #261, #263).
- PR #281 merged its own `handover.md` to `main`. This branch deleted it; its open points are issue #282 (`needs-triage`).
- PR #279 (volume) and PR #281 (menu redesign) closed no open issue. PR #280 (hero spreaders, #273) is another
  session's work in progress, and branch `claude/optimistic-babbage-b6gk9n` claims #273 and #275: leave #273, #275
  and #276 to them.

## Ticket state

| Ticket | State | Notes |
|---|---|---|
| #268 measure the full-size peak day | done on this branch | Report section "Step: scale-1 measurements (#268)" in `src/sims/terminal-twin/docs/reports/throughput-and-speed-report.md`; run-speed and throughput guides updated |
| #272 opt-in berth overtaking | done on this branch | `quay.berthOvertaking`, fixture `berth-overtaking`, `tests/berth-overtaking.test.ts`; peak-day numbers in `docs/optimising/terminal-throughput.md` |
| #270 yard pre-fill shortfall | stopped, needs an owner decision | Both fixes in the ticket miss the target; findings and three options are in a comment on #270, label set to `needs-triage`. No code change kept |
| #269 cheaper invariants | not started, now unblocked by #268 | Its lever order should follow the #268 table, see below |
| #271 rail wait at split boundaries | not started | A first, partial look is below |

## What the numbers say (ENGINE_VERSION 0.54.0, commit 41d906b, 4-core cloud container)

- Peak day `--until vessels:5`: **358 s**, hash `1bb3036832c3e6`, 491,753 events, 401,145 checks, 9,163 moves, 0
  violations. The 554 s in the docs was another machine. Use 358 s as the before-run for #269 on this kind of machine.
- Invariants are 49.6 % of the profile, GC 13.0 %. Dearest invariants: `asc.wtp-handover` 11.4 %, `stowage.order`
  10.9 %, `landside.waiting-off-road` 9.8 %, `landside.segregation` 8.8 %, `landside.stranded-truck` 7.0 %. The 411
  full sweeps are 27 % of tracker time.
- For #269: `stowage.order` and `landside.segregation` are not in its lever list but cost more than most that are;
  `landside.stall-exclusive` (1.8 %) and `landside.leaves-complete` (0.4 %) are not worth doing. Outside the
  invariants, `hasLandside` is 7.7 % of the profile and looks like a cacheable lookup.
- Berth overtaking on the peak day: V005 waits 0 s instead of 268,337 s, V004 waits 37,625 s longer, the run ends
  4 h 08 min earlier, same moves, 0 violations. Recommendation on #244: leave it off in the TTI presets until there is
  a fairness guard.

## Also fixed

`tt:run --events` crashed at full size (`Invalid string length`: the log as one string is past V8's limit) and
`tt:sts` would have failed reading it. Both now work in chunks (`cli/runCli.ts`, `cli/eventLines.ts`, tests in
`tests/cli.test.ts` and `tests/event-lines.test.ts`). `tt:sts` read an 813 MB log in 13 s.

## Not finished

- **`tt:sts` on the whole scale-1 log was not run.** The session restarted while the event file was being written, so
  the file held only the first 135,722 s. The crane buckets in the report come from `tt:profile`, which computes the
  same thing in process. To finish: `pnpm run tt:run --preset "TTI Algeciras, peak day" --until vessels:5 --events
  <file>` (about 7 min, 1.4 GB or so), then `NODE_OPTIONS=--max-old-space-size=9000 pnpm run tt:sts <file>`.
- **#271, first look only (partial log, scale 1, first 135,722 s, not in the docs):** of 107,089 s of rail wait, 80 %
  was two waits of a crane in a `hatch-replace` package blocked by its lower neighbour loading on the same vessel, and
  9 % the same with the neighbour discharging. "Loading next to a discharging neighbour", the ticket's hypothesis, was
  2 %. If the whole log shows the same, the ticket's opt-in load bay order is the wrong fix and the hatch replacement
  at the range boundary is the thing to look at. The classifier was a scratch script (pair each `StsWaitingForRail`
  with the crane's next bucket event; class by the waiting crane's package kind, `blockedBy` side and that crane's
  package kind); rewrite it from that description.
- The peak-day check with overtaking used a scratch config (the preset with `quay.berthOvertaking: true` saved as
  JSON and run with `--fixture <file>`), so no preset was edited.

## Checks

`pnpm run verify` green on this branch. No golden moved; one golden added (`berth-overtaking`). No `ENGINE_VERSION`
bump: overtaking is off by default and `berth.asked` stays empty then. Browser smoke specs were not run (no UI change).
