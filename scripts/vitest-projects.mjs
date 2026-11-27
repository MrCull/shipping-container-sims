/**
 * Vitest projects: one per sim folder that has unit tests (named by sim id, discovered from `src/sims/<id>/`, so a
 * new sim needs no config edit) plus `shared` for every test outside `src/sims/`. Used by vitest.config.ts and
 * scripts/test-sim.mjs.
 *
 * Test: node --test scripts/test-vitest-projects.mjs
 */
import { readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** The name of the project for tests outside `src/sims/`. */
export const SHARED_PROJECT = 'shared'

/**
 * The projects a list of test file paths (repo-relative, `/`-separated) needs.
 * @param {string[]} testFiles
 * @returns {{ sims: string[], shared: boolean }} sim ids sorted, and whether any test sits outside `src/sims/`
 */
export function projectsOf(testFiles) {
  const sims = new Set()
  let shared = false
  for (const f of testFiles) {
    const m = /^src\/sims\/([^/]+)\//.exec(f)
    if (m) sims.add(m[1])
    else shared = true
  }
  return { sims: [...sims].sort(), shared }
}

/** Every `*.test.ts` under `<root>/src`, repo-relative with `/` separators. */
export function listTestFiles(root) {
  const out = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.test.ts')) out.push(relative(root, p).split(sep).join('/'))
    }
  }
  walk(join(root, 'src'))
  return out
}

/** The ids of the sims under `<root>/src/sims/` that have at least one unit test. */
export function simIdsWithTests(root) {
  return projectsOf(listTestFiles(root)).sims
}
