/** STS equipment section: the nominal-cycle readout and its validation message. */
import { t } from '../../i18n/messages'
import { profileValid, stsCycleGeometry, stsNominalCycle } from '../../engine'
import { useTwinStore } from '../../store/twinStore'
import type { SetupDraft } from '../../composables/useSetupDraft'

export function stsValid(d: SetupDraft): boolean {
  const k = d.stsK
  return [k.gantry, k.trolley, k.hoistLoaded, k.hoistEmpty].every(profileValid)
}

/** Derived readout: the nominal discharge cycle of one crane and the moves per hour it implies. */
export function stsReadout(d: SetupDraft): string | null {
  const k = d.stsK
  const config = d.draftConfig
  if (!config || !stsValid(d) || !(k.lockS >= 0) || !(k.unlockS >= 0)) return null
  const fmt = useTwinStore().fmt
  const { cycleS, perHour } = stsNominalCycle(k, config.layout.stsSafeHoistM, stsCycleGeometry(config))
  return t('setup.sts.readout', { seconds: fmt.number(cycleS, 0), moves: fmt.number(perHour, 1) })
}

export function validateSts(d: SetupDraft): string | null {
  return stsValid(d) ? null : t('setup.sts.errorKinematics')
}
