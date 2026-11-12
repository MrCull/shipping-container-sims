/**
 * Procedural sky environment (#248). Pure TypeScript: the colours of the sky dome that feeds reflections on the standard
 * materials, how strongly they reflect, and a cache that builds one environment per lighting mode (day, dusk, night),
 * never per frame. `AtmosphereRig` turns the colours into a PMREM texture on the GPU side.
 */
import type { LightingMode } from './atmosphere'

export interface Rgb {
  r: number
  g: number
  b: number
}
export interface SkyColours {
  zenith: Rgb
  horizon: Rgb
  ground: Rgb
  /** A soft bright patch where the sun (or moon) is, so a glossy side face picks up a highlight. */
  sun: Rgb
}

const c = (r: number, g: number, b: number): Rgb => ({ r, g, b })

const SKY: Record<LightingMode, SkyColours> = {
  day: { zenith: c(0.18, 0.4, 0.82), horizon: c(0.78, 0.86, 0.95), ground: c(0.3, 0.29, 0.27), sun: c(1, 0.96, 0.85) },
  dusk: { zenith: c(0.16, 0.2, 0.42), horizon: c(1, 0.55, 0.28), ground: c(0.18, 0.15, 0.15), sun: c(1, 0.6, 0.3) },
  night: { zenith: c(0.01, 0.02, 0.06), horizon: c(0.05, 0.08, 0.16), ground: c(0.03, 0.03, 0.04), sun: c(0.35, 0.42, 0.6) },
}

export const skyColours = (mode: LightingMode): SkyColours => SKY[mode]

/** How strongly the environment lights the standard materials at a daylight level (0 to 1): full by day, a faint sheen at night. */
export const environmentIntensity = (daylight: number): number => 0.12 + 0.55 * Math.min(1, Math.max(0, daylight))

/** One built environment per lighting mode. `builds` counts the real builds (asserted in tests and shown in the dev API). */
export class EnvironmentCache<T> {
  builds = 0
  private readonly made = new Map<LightingMode, T>()
  constructor(private readonly build: (mode: LightingMode) => T) {}

  get(mode: LightingMode): T {
    let env = this.made.get(mode)
    if (env === undefined) {
      env = this.build(mode)
      this.builds++
      this.made.set(mode, env)
    }
    return env
  }

  values(): T[] {
    return [...this.made.values()]
  }

  clear(): void {
    this.made.clear()
  }
}
