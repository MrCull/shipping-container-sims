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
| 6 | Visual review of colour-by menu, saves, shortcut help, dashboard, side panels at 1440 px | done |
| 7 | Docs (`docs/browser-host.md` skin and palette), `pnpm run verify` | done, green (2145 tests) |
| 8 | Smoke specs: presets, hud, phone, display, saves, kpi, colour-by, debugger, dashboard, bay-viewer | done: all pass except the `@load` colour-by spec, which needs a real GPU |
| 9 | Pull request opened | done |

## Light and dark toggle (second request)

Done: `store/themeStore.ts`, a light token block in `skin.css` (`/* @theme light */`), theme buttons in the top bar
(`tt-theme-toggle`) and the setup dialog rail (`tt-setup-theme-toggle`), theme-aware chart palette
(`chartPalette(theme)`), tests (`tests/theme-store.test.ts`, both themes in `tests/skin.test.ts`, a smoke test in
`terminal-twin-hud.smoke.ts`). Details: "Skin and landing page" in `docs/browser-host.md`.

PR #281 checks: "Lint, build and test" passes. "Build and Deploy Job" (Azure preview) fails with "maximum number of
staging environments": an Azure limit, not the code; the owner has to delete an old preview environment. The smoke
job is skipped until the PR carries the `smoke` label.

## Still open (ideas, none blocking)

- Not yet looked at closely on the dark skin: final report panel, bay viewer, inspector with a selection, the
  departure banner, phone widths of the running HUD. They are restyled through the tokens only.
- The rest of the smoke suite (camera, atmosphere, landside and so on) was not run here; it does not touch menus.
  Run it from the Actions tab or with the `smoke` label on the PR.
- The shared sim header ("Terminal Twin" in the pixel font, the Menu button) belongs to `src/pages/SimPage`, shared
  by every sim, so it was left alone.
- Button, segmented-control and dialog styles are repeated per component. A shared `ui/` set (TtButton, TtSegmented,
  TtDialog) would remove the repetition.

## Notes for whoever continues

- Screenshot scripts used for review live only in the session scratchpad; `pnpm run screenshot` does the same job.
- Dashboard charts: `modules/dashboardPalette.ts` is back on the dark categorical set that was validated on
  `#1a1a19` before the light skin (#122); `--tt-chart-surface` matches it (`tests/skin.test.ts` checks that).
- The top bar is two rows at 1280 px and wider (below 1380 px the action buttons drop their icons to fit);
  `terminal-twin-hud.smoke.ts` checks HUD regions do not overlap. The clock markup must read day, date, time
  (`terminal-twin-display.smoke.ts`); the time is placed first with CSS grid only.
