/** TTI Algeciras: the terminal folder (constants, scenery and how its presets present). */
import type { TerminalProfile } from '../types'
import { PEAK_DAY_PRESET_NAME, TTI_PRESET_NAME } from './constants'
import { TTI_SCENERY } from './scenery'

export const TTI_ALGECIRAS: TerminalProfile = {
  id: 'tti-algeciras',
  label: 'TTI Algeciras',
  presets: {
    [TTI_PRESET_NAME]: { copy: { tagline: 'preset.baseline.tagline', description: 'preset.baseline.description' }, derivedBays: true },
    // A long peak-day run should stay readable: the daylight lock starts on.
    [PEAK_DAY_PRESET_NAME]: { copy: { tagline: 'preset.peakDay.tagline', description: 'preset.peakDay.description' }, derivedBays: true, daylightLockDefault: true },
  },
  scenery: TTI_SCENERY,
}
