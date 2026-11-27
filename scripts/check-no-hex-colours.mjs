// Ratchet on hex colours in .vue files under src/: components take colours from design tokens (src/assets/main.css,
// or a sim's own token file such as terminal-twin/skin.css or yardshift/styles/palette.css), so only .vue files are
// checked. Counted: #rgb, #rgba, #rrggbb and #rrggbbaa in <style> blocks (CSS comments ignored) and in inline
// style= / :style attributes of the template. scripts/hex-colour-baseline.json holds the allowed count per file: a
// file may go down, never up, and a file not in it must have none. `--update` lowers the baseline to today's counts
// (never raises one, never adds a file).
// Test: node --test scripts/test-check-no-hex-colours.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/g
const STYLE_BLOCK = /(<style\b[^>]*>)([\s\S]*?)<\/style>/g
const STYLE_ATTR = /\s(?:v-bind)?:?style\s*=\s*(["'])([\s\S]*?)\1/g

/** Blanks CSS block comments and `//` line comments (not `://`), keeping newlines so line numbers still match. */
function withoutComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** The template part of a single-file component (outer <template> to its last </template>), or '' when none. */
function templateRange(source) {
  const start = source.search(/<template\b/)
  const end = source.lastIndexOf('</template>')
  return start < 0 || end < start ? null : [start, end]
}

/** Every hex colour in a .vue source's style blocks and inline style attributes: `{ line, hex }` in file order. */
export function hexColours(source) {
  const lineAt = (i) => source.slice(0, i).split('\n').length
  const found = []
  for (const m of source.matchAll(STYLE_BLOCK)) {
    const offset = m.index + m[1].length
    for (const h of withoutComments(m[2]).matchAll(HEX)) found.push({ at: offset + h.index, hex: h[0] })
  }
  const range = templateRange(source)
  if (range) {
    const tpl = source.slice(range[0], range[1])
    for (const m of tpl.matchAll(STYLE_ATTR)) {
      const offset = range[0] + m.index + m[0].length - m[2].length - 1
      for (const h of m[2].matchAll(HEX)) found.push({ at: offset + h.index, hex: h[0] })
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => ({ line: lineAt(f.at), hex: f.hex }))
}

/** Files over their allowed count (`over`) and files under it (`lowered`, the baseline should come down). */
export function compareToBaseline(counts, baseline) {
  const over = []
  const lowered = []
  for (const file of Object.keys(counts).sort()) {
    const count = counts[file]
    const allowed = baseline[file] ?? 0
    if (count > allowed) over.push({ file, count, allowed })
  }
  for (const file of Object.keys(baseline).sort()) {
    const count = counts[file] ?? 0
    if (count < baseline[file]) lowered.push({ file, count, allowed: baseline[file] })
  }
  return { over, lowered }
}

/** The baseline lowered to today's counts: never raised, no new files, zeros dropped, keys sorted. */
export function lowerBaseline(counts, baseline) {
  const next = {}
  for (const file of Object.keys(baseline).sort()) {
    const n = Math.min(baseline[file], counts[file] ?? 0)
    if (n > 0) next[file] = n
  }
  return next
}

/** Every .vue file under a folder, as forward-slash paths relative to the repo root. */
function vueFiles(root, dir) {
  const out = []
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...vueFiles(root, p)) }
    else if (e.name.endsWith('.vue')) out.push(p.split(sep).join('/'))
  }
  return out
}

function main() {
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
  const baselinePath = join(root, 'scripts', 'hex-colour-baseline.json')
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
  const found = {}
  const counts = {}
  for (const file of vueFiles(root, 'src')) {
    const hits = hexColours(readFileSync(join(root, file), 'utf8'))
    if (hits.length) { found[file] = hits; counts[file] = hits.length }
  }
  const rel = relative(root, baselinePath)
  if (process.argv.includes('--update')) {
    writeFileSync(baselinePath, JSON.stringify(lowerBaseline(counts, baseline), null, 2) + '\n')
    console.log(`check-no-hex-colours: lowered ${rel} to today's counts (never raised)`)
  }
  const { over, lowered } = compareToBaseline(counts, baseline)
  if (over.length) {
    const lines = over.map(({ file, count, allowed }) => {
      const where = found[file].map((h) => `  ${file}:${h.line}: ${h.hex}`).join('\n')
      return `${file}: ${count} hex colours, allowed ${allowed}\n${where}`
    })
    console.error(
      'Hex colours in .vue files: use a design token (src/assets/main.css or the sim\'s token file) instead of a new hex ' +
      `literal. A file may only go down from its count in ${rel}.\n${lines.join('\n')}`,
    )
    process.exit(1)
  }
  if (lowered.length && !process.argv.includes('--update')) {
    const lines = lowered.map(({ file, count, allowed }) => `  ${file}: ${count} (baseline ${allowed})`)
    console.error(`Hex colour counts went down; lower the baseline with \`node scripts/check-no-hex-colours.mjs --update\` and commit ${rel}:\n${lines.join('\n')}`)
    process.exit(1)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
