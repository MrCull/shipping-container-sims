/**
 * Captures README screenshots: home portal + gameplay waits (10s default; 15s for Stowage Master).
 * Requires: npm run build && npm run preview (default http://127.0.0.1:4173)
 * Usage: BASE_URL=http://127.0.0.1:4173 node scripts/capture-readme-media.mjs
 */
import { chromium } from 'playwright'
import { mkdir, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'docs', 'readme')
const BASE_URL = process.env.BASE_URL?.replace(/\/$/, '') ?? 'http://127.0.0.1:4173'
const GAMEPLAY_WAIT_MS = Number(process.env.GAMEPLAY_WAIT_MS ?? 10_000)
/** Longer wait for Stowage Master so the 3D scene and crane motion read clearly in the README shot. */
const STOWAGE_MASTER_WAIT_MS = Number(process.env.STOWAGE_MASTER_WAIT_MS ?? 15_000)
const VIEWPORT = { width: 1280, height: 720 }

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: VIEWPORT })
  const page = await context.newPage()

  // --- Home portal ---
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 60_000 })
  await page.getByRole('heading', { name: /READY TO PLAY/i }).waitFor({ state: 'visible', timeout: 30_000 })
  await page.screenshot({ path: join(OUT_DIR, 'home-portal.png'), fullPage: true })

  // --- Stowage Master: level 1 → briefing → START → wait 10s → screenshot ---
  await page.goto(`${BASE_URL}/sim/stowage-master`, { waitUntil: 'networkidle', timeout: 60_000 })
  await page.locator('h1.game-title').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: /^Level 1\b/i }).click()
  await page.getByRole('button', { name: 'START' }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'START' }).click()
  await page.locator('.timer-widget').waitFor({ state: 'visible', timeout: 15_000 })
  await sleep(STOWAGE_MASTER_WAIT_MS)
  await page.screenshot({ path: join(OUT_DIR, 'stowage-master-gameplay.png') })

  // --- Contenga: Play → wait 10s → screenshot + GIF frames ---
  await page.goto(`${BASE_URL}/sim/container-stack`, { waitUntil: 'networkidle', timeout: 60_000 })
  await page.locator('.start-screen .title, .card .title').filter({ hasText: 'Contenga' }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'Play' }).click()
  await page.locator('.score-bar .stat').filter({ hasText: 'Moves' }).waitFor({ state: 'visible', timeout: 15_000 })
  await sleep(GAMEPLAY_WAIT_MS)
  await page.screenshot({ path: join(OUT_DIR, 'contenga-gameplay.png') })

  const gifDir = join(OUT_DIR, '.contenga-gif-frames')
  await mkdir(gifDir, { recursive: true })
  for (let i = 0; i < 4; i++) {
    await page.screenshot({ path: join(gifDir, `frame${String(i).padStart(2, '0')}.png`) })
    await sleep(400)
  }

  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-framerate',
      '2.5',
      '-i',
      join(gifDir, 'frame%02d.png'),
      '-frames:v',
      '4',
      '-vf',
      'fps=8,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse',
      join(OUT_DIR, 'contenga.gif'),
    ],
    { stdio: 'inherit' },
  )
  await rm(gifDir, { recursive: true, force: true })

  // --- Box Empire: Start Tutorial → wait 10s (3D + narrator UI) ---
  await page.goto(`${BASE_URL}/sim/box-empire`, { waitUntil: 'networkidle', timeout: 60_000 })
  await page.locator('h1.start-title').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: /Start Tutorial/i }).click()
  await page.getByRole('dialog', { name: 'Narrator' }).waitFor({ state: 'visible', timeout: 20_000 })
  await sleep(GAMEPLAY_WAIT_MS)
  await page.screenshot({ path: join(OUT_DIR, 'box-empire-gameplay.png') })

  await browser.close()

  console.log(`Wrote screenshots and contenga.gif under ${OUT_DIR}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
