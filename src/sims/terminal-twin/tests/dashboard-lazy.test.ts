/**
 * ECharts must stay out of the initial bundle: nothing may import it statically
 * except `modules/chartLib.ts`, and that module is reached only by dynamic
 * `import()`. (The prod smoke test checks the built output as well.)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return name === 'tests' || name === 'assets' ? [] : sources(full)
    return /\.(ts|vue)$/.test(name) ? [full] : []
  })
}

describe('chart library loading', () => {
  const files = sources(ROOT).map((f) => ({ file: relative(ROOT, f), text: readFileSync(f, 'utf8') }))

  it('imports echarts at runtime only from modules/chartLib.ts', () => {
    const offenders = files
      .filter((f) => f.file !== join('modules', 'chartLib.ts'))
      .filter((f) => /^\s*import\s+(?!type\b)[^'"]*from\s+['"]echarts/m.test(f.text) || /^\s*import\s+['"]echarts/m.test(f.text))
      .map((f) => f.file)
    expect(offenders).toEqual([])
  })

  it('reaches chartLib only through a dynamic import()', () => {
    const staticImports = files
      .filter((f) => /^\s*import\s[^\n]*from\s+['"][^'"]*chartLib['"]/m.test(f.text) && !/^\s*import\s+type\b[^\n]*chartLib/m.test(f.text))
      .map((f) => f.file)
    expect(staticImports).toEqual([])
    expect(files.some((f) => /import\(\s*['"][^'"]*chartLib['"]\s*\)/.test(f.text))).toBe(true)
  })

  it('loads the dashboard component itself lazily too', () => {
    const root = files.find((f) => f.file === 'TerminalTwin.vue')!
    expect(root.text).toMatch(/defineAsyncComponent\(\(\) => import\('\.\/components\/DashboardTab\.vue'\)\)/)
    expect(root.text).not.toMatch(/^import DashboardTab/m)
  })
})
