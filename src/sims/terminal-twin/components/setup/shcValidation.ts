/** SHC equipment section: the nominal-trip readout and its validation messages. */
import { t } from '../../i18n/messages'
import { profileValid, shcNominalCycle } from '../../engine'
import { SCALE_LIMITS } from '../../scenario/limits'
import { useTwinStore } from '../../store/twinStore'
import type { SetupDraft } from '../../composables/useSetupDraft'

export const MAX_SHC = SCALE_LIMITS.shc.max

/** Derived readout: a nominal 300 m empty + 300 m loaded trip with lock, lift, lower and unlock. */
export function shcReadout(d: SetupDraft): string | null {
  const k = d.shcK
  const valid = [k.driveEmpty, k.driveLoaded, k.lift].every(profileValid)
  if (!valid || !(k.lockS >= 0) || !(k.unlockS >= 0)) return null
  const fmt = useTwinStore().fmt
  const { cycleS, perHour } = shcNominalCycle(k, 300)
  return t('setup.shc.readout', { distance: fmt.length(300), seconds: fmt.number(cycleS, 0), trips: fmt.number(perHour, 1) })
}

export function validateShc(d: SetupDraft): string | null {
  if (d.scenarioShcs <= 0) return null
  if (!Number.isInteger(d.shcCount) || d.shcCount < 1 || d.shcCount > MAX_SHC) return t('setup.shc.errorCount', { max: MAX_SHC })
  if (!shcReadout(d)) return t('setup.shc.errorKinematics')
  return null
}
