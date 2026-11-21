// Fail when a browser smoke spec (*.smoke.ts under src/) has a test with no smoke group tag, or names more than one
// group (on one test, or across the tests of one file). A group is a Playwright tag, in the details argument
// (`test('title', { tag: '@camera' }, ...)`) or the title (`test('title @core', ...)`); other tags (`@load`,
// `@baseline`) are not groups and are not counted. Groups: scripts/smoke-groups.mjs; path map: scripts/smoke-select.mjs.
// Test: node --test scripts/test-check-smoke-groups.mjs
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GROUPS } from './smoke-groups.mjs'

const GROUP_TAG = new RegExp(`@(${GROUPS.join('|')})\\b`, 'g')
const TEST_CALL = /(^|\n)[ \t]*test\((['`])/g

/** The tests of a spec source: line number and the group tags in its title and details argument. */
function testsOf(source) {
  const tests = []
  let m
  TEST_CALL.lastIndex = 0
  while ((m = TEST_CALL.exec(source))) {
    const q = m[2]
    let j = m.index + m[0].length
    while (j < source.length && source[j] !== q) j += source[j] === '\\' ? 2 : 1
    const title = source.slice(m.index + m[0].length, j)
    const rest = source.slice(j + 1, j + 400)
    const end = rest.search(/async\b|=>|\bfunction\b|\n/)
    const head = title + ' ' + (end < 0 ? rest : rest.slice(0, end))
    const line = source.slice(0, m.index + m[1].length).split('\n').length
    tests.push({ line, groups: [...new Set([...head.matchAll(GROUP_TAG)].map((g) => g[1]))] })
  }
  return tests
}

/** Problems with one spec file's group tags, as "file:line: reason" (empty when it has exactly one group). */
export function groupProblems(file, source) {
  const tests = testsOf(source)
  if (!tests.length) return [`${file}: no group tag (no test found)`]
  const problems = []
  for (const t of tests) {
    if (!t.groups.length) problems.push(`${file}:${t.line}: no group tag`)
    else if (t.groups.length > 1) problems.push(`${file}:${t.line}: more than one group (${t.groups.join(', ')})`)
  }
  const all = [...new Set(tests.flatMap((t) => t.groups))]
  if (all.length > 1 && !problems.length) problems.push(`${file}: more than one group (${all.join(', ')})`)
  return problems
}

/** The one group of a spec source, or null when it has none or several. */
export function groupOfSource(source) {
  const all = [...new Set(testsOf(source).flatMap((t) => t.groups))]
  return all.length === 1 ? all[0] : null
}

/** Every *.smoke.ts file under a folder, as paths relative to the repo root. */
export function smokeSpecs(root, dir = 'src') {
  const out = []
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...smokeSpecs(root, p)) }
    else if (e.name.endsWith('.smoke.ts')) out.push(p)
  }
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
  const specs = smokeSpecs(root)
  const problems = specs.flatMap((f) => groupProblems(relative(root, join(root, f)), readFileSync(join(root, f), 'utf8')))
  if (problems.length) {
    console.error(`check-smoke-groups: every smoke spec needs exactly one group tag (${GROUPS.map((g) => '@' + g).join(' ')}):`)
    for (const p of problems) console.error(`  ${p}`)
    process.exit(1)
  }
  console.log(`check-smoke-groups: ${specs.length} smoke specs, one group each.`)
}
