/**
 * URL switches read once at startup (#322), for tests and debugging under software WebGL:
 * `?quality=low|medium|high|auto` starts at that quality setting (not remembered), and
 * `?render=off` keeps the whole per-frame update but skips the final draw (`__tt.renderOnce()`
 * draws one frame on demand). No parameter (or an invalid value) leaves today's behaviour.
 * They work in dev and production builds.
 */
import { QUALITY_SETTINGS, type QualitySetting } from './quality'

export interface UrlSwitches {
  /** The quality setting to start at; null keeps the remembered (or default) setting. */
  quality: QualitySetting | null
  /** False with `?render=off`: the frame update runs, the draw is skipped. */
  render: boolean
}

export function parseUrlSwitches(search: string): UrlSwitches {
  const params = new URLSearchParams(search)
  const q = params.get('quality')?.toLowerCase()
  return {
    quality: QUALITY_SETTINGS.find((s) => s === q) ?? null,
    render: params.get('render')?.toLowerCase() !== 'off',
  }
}

/** The switches of the page's own URL (all off where there is no window). */
export function urlSwitches(): UrlSwitches {
  return parseUrlSwitches(typeof window === 'undefined' ? '' : window.location.search)
}
