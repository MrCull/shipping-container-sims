# Handover: Terminal Twin menu redesign

Branch: `claude/wonderful-hawking-2f8x5u`. Delete this file before merging.

## The ask

The owner said the Terminal Twin main menu (the setup dialog) and the sim's other menus look amateur and dated, not
like a state-of-the-art terminal twin system. Wanted: a much more modern, clean design, look and feel.

## Direction chosen

Dark "control room" glass: dark translucent panels over the 3D view, cool white text, hairline borders, one bright
signal-blue accent, tabular mono figures. It matches the app's dark header, which the old light skin clashed with.
All colour lives in `src/sims/terminal-twin/skin.css` tokens (`--tt-*`), so the theme is one file; structure and
layout changes are per component.

Rules that must keep holding:

- `tests/skin.test.ts`: components use `--tt-*` tokens only (no hex, rgb or global tokens in component styles), and
  the text tokens meet WCAG AA on `--tt-panel` and `--tt-surface`.
- Smoke specs find things by `data-testid`, role and visible text ("Start", "New scenario"). Keep every test id,
  role and label. `--tt-data-rob` must stay `#c8cacd` (colour-by smoke).
- No em dash anywhere; commit trailer is only `Claude-Session:`.

## How to look at it

`pnpm exec vite --port 5200`, then open `/sim/terminal-twin`. One screenshot: `pnpm run screenshot --path
/sim/terminal-twin --wait 3000`.

## Stages

| # | Stage | State |
|---|-------|-------|
| 1 | Dark tokens in `skin.css` (whole sim restyled through tokens) | done |
| 2 | Setup dialog: rail layout, scenario cards, detail pane, form fields, vessel table | done (not yet run through verify or smoke) |
| 3 | Top bar: clock, segmented transport, icon action buttons, status pill, settings | done (not yet run through verify or smoke) |
| 4 | HUD: KPI strip (one glass strip), overlay bar, HUD pills; side panel buttons | done, same caveat |
| 5 | Modals: saves and shortcut help restyled; dashboard chrome and dark chart palette restored | done, same caveat |
| 6 | Visual review of: colour-by menu, run-to popup, final report, bay viewer, inspector with a selection, phone widths | next |
| 7 | Docs (`terminal-twin-AGENTS.md`, `docs/browser-host.md` skin and palette lines say "light"), `pnpm run verify`, smoke suite, open PR | todo |

## Notes for whoever continues

- Screenshot scripts used for review live only in the session scratchpad; `pnpm run screenshot` does the same job.
- Dashboard charts: `modules/dashboardPalette.ts` is back on the dark categorical set that was validated on
  `#1a1a19` before the light skin (#122); `--tt-chart-surface` matches it (`tests/skin.test.ts` checks that).
- The top bar must stay two rows at 1280 px wide: `terminal-twin-hud.smoke.ts` checks HUD regions do not overlap.
