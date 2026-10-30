/** Yard section: limits, the capacity/cycle readout and its validation messages. */
import { t } from '../../i18n/messages'
import { ascNominalCycle } from '../../engine'
import { SCALE_LIMITS } from '../../scenario/limits'
import { useTwinStore } from '../../store/twinStore'
import type { SetupDraft } from '../../composables/useSetupDraft'

/** Yard limits: blocks, 20 ft bays, tiers, and pads/stalls (which must fit the 25.4 m ASC span at 5.5 m pitch). */
export const YARD_LIMITS = { blocks: SCALE_LIMITS.blocks.max, bays: SCALE_LIMITS.bays.max, tiers: SCALE_LIMITS.tiers.max, pads: SCALE_LIMITS.pads, stalls: SCALE_LIMITS.stalls }

function yardValid(d: SetupDraft): boolean {
  const k = d.ascK
  return k.gantry.vMax > 0 && k.trolley.vMax > 0 && k.hoistLoaded.vMax > 0 && k.hoistEmpty.vMax > 0
}

/** Derived readout: capacity and a nominal pad-to-slot cycle (40 m along, 12 m across, 3 tiers). */
export function yardReadout(d: SetupDraft): string | null {
  const k = d.ascK
  if (!yardValid(d) || !(k.lockS >= 0) || !(k.unlockS >= 0)) return null
  const fmt = useTwinStore().fmt
  const { cycleS, perHour } = ascNominalCycle(k, 40, 12, 8.7)
  const capacity = d.yardBlocks.reduce((n, b) => n + b.bays * 8 * b.tiers, 0)
  return t('setup.yard.readout', {
    capacity: fmt.number(capacity, 0),
    distance: fmt.length(40),
    seconds: fmt.number(cycleS, 0),
    cycles: fmt.number(perHour, 1),
  })
}

export function validateYard(d: SetupDraft): string | null {
  if (d.scenarioBlocks <= 0) return null
  if (d.yardBlocks.length < 1 || d.yardBlocks.length > YARD_LIMITS.blocks) return t('setup.yard.errorBlocks', { max: YARD_LIMITS.blocks })
  const bad = d.yardBlocks.findIndex(
    (b) =>
      ![b.bays, b.tiers, b.wtpPads, b.transferStalls].every(Number.isInteger) ||
      b.bays < 1 || b.bays > YARD_LIMITS.bays ||
      b.tiers < 1 || b.tiers > YARD_LIMITS.tiers ||
      b.wtpPads < 1 || b.wtpPads > YARD_LIMITS.pads ||
      b.transferStalls < 0 || b.transferStalls > YARD_LIMITS.stalls,
  )
  if (bad >= 0) {
    return t('setup.yard.errorBlock', { n: bad + 1, maxBays: YARD_LIMITS.bays, maxTiers: YARD_LIMITS.tiers, maxPads: YARD_LIMITS.pads, maxStalls: YARD_LIMITS.stalls })
  }
  if (!yardReadout(d)) return t('setup.yard.errorKinematics')
  if (d.startMode === 'prefilled' && !(d.startTargetPct >= 0 && d.startTargetPct <= 100)) return t('setup.yard.errorTarget')
  if (d.startMode === 'warmup' && !(d.startWarmUpH >= 1 && d.startWarmUpH <= 720)) return t('setup.yard.errorWarmUp')
  return null
}
