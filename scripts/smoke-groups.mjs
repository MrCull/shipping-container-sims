// The smoke groups, in run order. Each smoke spec file belongs to exactly one, through a Playwright tag on its tests
// (scripts/check-smoke-groups.mjs); scripts/smoke-select.mjs picks the groups a change needs. `core` always runs.
export const GROUPS = ['core', 'shell', 'camera', 'setup', 'analysis', 'vessel', 'equipment', 'yard', 'engine', 'yardshift']
