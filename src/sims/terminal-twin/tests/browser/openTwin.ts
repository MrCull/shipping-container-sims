/**
 * The one way smoke specs boot the Terminal Twin (#325, spec #320): open the sim with the #322 URL switches, wait for
 * the dev API, load a scenario and return once it is ready.
 *
 * Defaults are the fast ones: `?quality=low` and `?render=off` (the frame update, frame counter, poses and overlays
 * all run; only the draw is skipped). A spec opts in only to what it checks, with a one-line reason at the call:
 * - `render: true` when it reads pixels, takes a screenshot that must show the scene, or asserts draw calls
 *   (or call `__tt.renderOnce()` to draw one frame on demand);
 * - `quality: 'high'` (or another level) when it checks the quality ladder or High-only detail;
 *   `quality: null` keeps the remembered setting (specs about remembering it);
 * - `viewport` when it checks layout at a size other than the config's 1280x720.
 * A non-visual assertion waits on state (`__tt.clock()`, `__tt.scene().frames`, `__tt.ui()`), never on drawn frames.
 *
 * `devApi: false` is for production-build specs (no `window.__tt`): it waits for the setup dialog instead, and a
 * scenario is then picked in the dialog by the spec.
 * `freshPage: false` reuses a page that already shows the twin at the same URL.
 * On the worker's shared page (`twinTest.ts`, #329) the page sits on the reset route after its reset, and the twin is
 * opened by routing there in-app (`window.__appVisit`), with no page load.
 */
import { expect, type Page } from '@playwright/test'
import type { TwinDevApi } from '../../dev/devApi'
import type { QualitySetting } from '../../modules/quality'
import { RESET_PATH } from '../../../../utils/smokeReset'

export type LoadOptions = NonNullable<Parameters<TwinDevApi['load']>[1]>

export interface OpenTwinOptions {
  /** Fixture or preset to load through `__tt.load` (none: stay at the setup dialog). */
  scenario?: string
  /** Options passed to `__tt.load` (seed, start time, overrides, end conditions...). */
  load?: LoadOptions
  /** Starting quality (default 'low'); null leaves the switch out, so the remembered setting applies. */
  quality?: QualitySetting | null
  /** Draw every frame (default false: `?render=off`). */
  render?: boolean
  /** Viewport to set before opening (default: the config's 1280x720). */
  viewport?: { width: number; height: number }
  /** Extra URL parameters, e.g. `{ benchmark: 'quick' }` or `{ viewer: 'container-40' }`. */
  params?: Record<string, string>
  /** False for production builds: wait for the setup dialog, not `window.__tt` (default true). */
  devApi?: boolean
  /** False reuses a page already at this URL with the twin booted (default true: always navigate). */
  freshPage?: boolean
}

/** The sim URL with the switches for these options (Low quality and render off unless the spec opts in). */
export function twinUrl(options: Pick<OpenTwinOptions, 'quality' | 'render' | 'params'> = {}): string {
  const search = new URLSearchParams()
  const quality = options.quality === undefined ? 'low' : options.quality
  if (quality) search.set('quality', quality)
  if (!options.render) search.set('render', 'off')
  for (const [key, value] of Object.entries(options.params ?? {})) search.set(key, value)
  const query = search.toString()
  return `/sim/terminal-twin${query ? `?${query}` : ''}`
}

/** Opens the Terminal Twin with fast defaults and, given a scenario, loads it (resolves once the scenario is ready). */
export async function openTwin(page: Page, options: OpenTwinOptions = {}): Promise<void> {
  const url = twinUrl(options)
  if (options.viewport) await page.setViewportSize(options.viewport)
  const devApi = options.devApi ?? true
  const current = new URL(page.url(), 'http://localhost')
  const reuse = options.freshPage === false && current.pathname + current.search === url
  if (current.pathname === RESET_PATH) await page.evaluate((target) => window.__appVisit!(target), url)
  else if (!reuse) await page.goto(url)
  if (!devApi) {
    await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeVisible()
    return
  }
  await page.waitForFunction(() => !!window.__tt)
  if (options.scenario) await page.evaluate(([name, load]) => window.__tt!.load(name, load), [options.scenario, options.load ?? {}] as const)
}
