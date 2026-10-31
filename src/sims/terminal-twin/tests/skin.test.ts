import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SURFACE } from '../modules/dashboardPalette'
import { DATA_PALETTE, RAMP_PALETTE } from '../modules/colourBy'

/**
 * Terminal Twin skin (#122): every component takes its colours and fonts from the `--tt-*` tokens in `skin.css`,
 * and the text/surface pairs of the frosted panels meet WCAG AA.
 */
const root = join(__dirname, '..')
const skin = readFileSync(join(root, 'skin.css'), 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(vue|css)$/.test(name)) out.push(p)
  }
  return out
}

const surfaceFiles = [...walk(join(root, 'components')), join(root, 'TerminalTwin.vue')]

function tokens(): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of skin.matchAll(/(--tt-[\w-]+)\s*:\s*([^;]+);/g)) map.set(m[1]!, m[2]!.trim())
  return map
}

/** Style blocks only (template text may legitimately hold '#' characters). */
function styleOf(file: string): string {
  const text = readFileSync(file, 'utf8')
  if (file.endsWith('.css')) return text
  return [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
}

describe('skin tokens', () => {
  it('leaves no ad-hoc colours, fonts or global tokens in Terminal Twin components', () => {
    const offenders: string[] = []
    for (const file of surfaceFiles) {
      styleOf(file)
        .split('\n')
        .forEach((line, i) => {
          const at = `${relative(root, file)}:${i + 1}`
          if (/#[0-9a-fA-F]{3,8}\b/.test(line) || /\b(rgba?|hsla?)\(/.test(line)) offenders.push(`${at} colour: ${line.trim()}`)
          if (/font-family\s*:/.test(line) && !/font-family\s*:\s*var\(--tt-font(-mono)?\)/.test(line)) offenders.push(`${at} font: ${line.trim()}`)
          if (/var\(--(color|font)-/.test(line)) offenders.push(`${at} global token: ${line.trim()}`)
        })
    }
    expect(offenders).toEqual([])
  })

  it('defines Inter as the UI font and one accent, with amber and red apart', () => {
    const t = tokens()
    expect(t.get('--tt-font')).toMatch(/^'Inter'/)
    expect(t.get('--tt-accent')).toBeDefined()
    expect(t.get('--tt-warn')).not.toBe(t.get('--tt-accent'))
    expect(t.get('--tt-danger')).not.toBe(t.get('--tt-warn'))
  })

  it('keeps the chart surface of the dashboard palette in step with the token', () => {
    expect(tokens().get('--tt-chart-surface')).toBe(SURFACE)
  })

  it('keeps the colour-by categorical and ramp palettes in step with the --tt-data-N and --tt-ramp-N tokens', () => {
    const t = tokens()
    expect(DATA_PALETTE.map((_, i) => t.get(`--tt-data-${i}`))).toEqual([...DATA_PALETTE])
    expect(RAMP_PALETTE.map((_, i) => t.get(`--tt-ramp-${i}`))).toEqual([...RAMP_PALETTE])
    // no extra numbered token without a palette entry
    expect([...t.keys()].filter((k) => /^--tt-data-\d+$/.test(k))).toHaveLength(DATA_PALETTE.length)
    expect([...t.keys()].filter((k) => /^--tt-ramp-\d+$/.test(k))).toHaveLength(RAMP_PALETTE.length)
  })

  it('is scoped to Terminal Twin (never the :root of the other sims)', () => {
    expect(skin).not.toMatch(/:root/)
    expect(skin).toMatch(/\.terminal-twin/)
  })
})

type Rgb = [number, number, number]
function parseColour(value: string): { rgb: Rgb; a: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)
  if (hex) {
    const n = parseInt(hex[1]!, 16)
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], a: 1 }
  }
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value)
  if (rgba) return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], a: Number(rgba[4]) }
  throw new Error(`unparsable colour ${value}`)
}
const lin = (c: number): number => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const lum = ([r, g, b]: Rgb): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}
const over = (top: { rgb: Rgb; a: number }, under: Rgb): Rgb => top.rgb.map((c, i) => Math.round(c * top.a + under[i]! * (1 - top.a))) as Rgb

describe('WCAG AA on the frosted panels', () => {
  const t = tokens()
  const colour = (name: string) => parseColour(t.get(name) ?? '')
  // The scene behind a panel is anything from the near-black night sea to white sky.
  const backdrops: Rgb[] = [
    [0, 0, 0],
    [255, 255, 255],
    [10, 58, 85],
  ]

  for (const surface of ['--tt-panel', '--tt-surface']) {
    for (const text of ['--tt-text', '--tt-text-muted', '--tt-accent', '--tt-warn', '--tt-danger', '--tt-success']) {
      it(`${text} on ${surface} is at least 4.5:1`, () => {
        for (const bg of backdrops) {
          expect(contrast(colour(text).rgb, over(colour(surface), bg))).toBeGreaterThanOrEqual(4.5)
        }
      })
    }
  }

  it('the panel is translucent enough to be frosted but opaque enough to read', () => {
    const panel = colour('--tt-panel')
    expect(panel.a).toBeGreaterThan(0.7)
    expect(panel.a).toBeLessThan(1)
    expect(t.get('--tt-blur')).toMatch(/blur\(/)
  })

  it('text on the accent and status fills is at least 4.5:1', () => {
    expect(contrast(colour('--tt-on-accent').rgb, colour('--tt-accent').rgb)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(colour('--tt-text').rgb, colour('--tt-warn-bg').rgb)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(colour('--tt-warn').rgb, colour('--tt-warn-bg').rgb)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(colour('--tt-danger').rgb, colour('--tt-danger-bg').rgb)).toBeGreaterThanOrEqual(4.5)
  })
})
