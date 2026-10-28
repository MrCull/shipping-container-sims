/**
 * Regenerates the Terminal Twin home-page card image: the TTI Algeciras preset
 * mid-run, overview angle, 3D view only (no UI). Re-run whenever the visuals change:
 *
 *   npm run tt:card
 *
 * Output: src/sims/terminal-twin/assets/home-card.png (committed; the definition imports it).
 * It drives scripts/screenshot.mjs (headless Chromium, software WebGL), so it needs no running server.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = 'src/sims/terminal-twin/assets/home-card.png'

// Runs in the page: load the preset, run to mid-morning (vessels alongside, cranes working),
// freeze there, frame the overview, and hide everything but the 3D canvas.
const HOURS = Number(process.env.TT_CARD_HOURS ?? 1)
const prepare = `(async () => {
  const tt = window.__tt
  await tt.load('TTI Algeciras baseline', { seed: 7, startDateTime: new Date(2026, 0, 5, 10, 0).toISOString() })
  await tt.runTo(${HOURS} * 3600)
  tt.pause()
  const scene = document.querySelector('[data-testid=tt-scene]')
  for (const el of scene.children) if (!el.classList.contains('tt-canvas')) el.style.display = 'none'
  for (const sel of ['.tt-topbar', 'header', 'footer']) document.querySelectorAll(sel).forEach((el) => { el.style.display = 'none' })
  window.dispatchEvent(new Event('resize'))
  tt.cameraTo('STS104', 380)
  await new Promise((r) => setTimeout(r, 1500))
  return tt.atmosphere().scene
})()`

const result = spawnSync(
  process.execPath,
  [join(ROOT, 'scripts/screenshot.mjs'), '--path', '/sim/terminal-twin', '--width', '1200', '--height', '630', '--wait-for', '.tt-canvas', '--eval', prepare, '--wait', '2500', '--out', OUT, '--fail-on-error'],
  { cwd: ROOT, stdio: 'inherit' },
)
if (result.status === 0) console.log(`Home card written to ${OUT}`)
process.exit(result.status ?? 1)
