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
| 3 | Top bar: clock, transport, actions, settings | next |
| 4 | HUD: KPI strip, overlay bar, colour-by menu, events and inspector panels | todo |
| 5 | Modals: saves, shortcut help, final report, dashboard chrome | todo |
| 6 | Docs (`terminal-twin-AGENTS.md`, `docs/browser-host.md` skin section), `pnpm run verify`, smoke suite | todo |

## Known gaps

- Dashboard charts still use the light chart surface (`--tt-chart-surface` = `SURFACE` in
  `modules/dashboardPalette.ts`, palette validated for light). A dark chart surface needs `dashboardOptions.ts`
  text and grid colours changed and the palette re-checked.
