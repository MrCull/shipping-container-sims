/**
 * The setup dialog's draft: everything the user edits before a run starts, loaded from the chosen
 * scenario and the store's last choice. The dialog shell creates it once and provides it; each
 * section component (`components/setup/Setup*Section.vue`) injects it and edits its own part.
 * Readouts and validation messages live next to the sections (`components/setup/*Validation.ts`).
 */
import { computed, inject, provide, reactive, ref, watch, type InjectionKey } from 'vue'
import { randomSeed, resolveScenario, scenarioCatalogue, useTwinStore } from '../store/twinStore'
import { fromLocalInputValue, toLocalInputValue } from '../modules/time'
import { validateScenario, type DecisionsConfig, type ScenarioCheck } from '../engine'
import { DEFAULT_ASC_KINEMATICS, DEFAULT_SHC_KINEMATICS, DEFAULT_STS_KINEMATICS, type YardSetup } from '../scenario/builder'
import { composeScenario, type ScenarioEdits } from '../scenario/compose'
import { applyOverrides, type ScenarioOverrides } from '../scenario/overrides'
import { peakTrucksPerHour } from '../scenario/validate'
import { DEFAULT_TRANSSHIPMENT } from '../scenario/dwell'
import { DEFAULT_WARM_UP_S, DEFAULT_YARD_TARGET_PCT, type AscKinematics, type ScenarioConfig, type ShcKinematics, type StsKinematics, type SubsystemMode, type VesselConfig, type YardStartMode } from '../scenario/types'
import { endFieldsOf, type EndFields } from '../modules/endConditions'

/** Plain deep copy (structuredClone cannot copy Vue reactive proxies). */
export const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export type BlockDraft = YardSetup['blocks'][number]
export const DEFAULT_BLOCK: BlockDraft = { bays: 20, tiers: 5, wtpPads: 5, transferStalls: 5 }
/** Subsystem modes the dialog edits (V11-10); the rest stay as the scenario has them. */
export const MODE_ROWS = ['quay', 'berth', 'yard'] as const
export const MODES = ['real', 'instant', 'off'] as const

const M_PER_FT = 0.3048
const M_PER_MILE = 1609.344

function createSetupDraft() {
  const store = useTwinStore()
  const catalogue = scenarioCatalogue()

  const name = ref(store.choice.name)
  const seed = ref(store.choice.seed)
  const start = ref(toLocalInputValue(new Date(store.choice.startDateTime)))
  const selected = computed(() => catalogue.find((c) => c.name === name.value))

  // Editable quay, cranes and vessel table, initialised from the chosen scenario.
  const quayLengthM = ref(0)
  const stsCount = ref(0)
  const vessels = ref<VesselConfig[]>([])
  // Transshipment dwell (median, hours) and the empty pool (TT-11).
  const dwellMedianH = ref(48)
  const poolCount = ref(0)
  const poolAgeDays = ref(7)
  // STS kinematics, variation, landside and decision points (TT-15).
  const stsK = ref<StsKinematics>(copy(DEFAULT_STS_KINEMATICS))
  const moveVariationPct = ref(0)
  const driverVariabilityPct = ref(0)
  const peakTrucks = ref(0)
  const gateIn = ref(0)
  const gateOut = ref(0)
  const decisions = ref<DecisionsConfig>({})
  const modes = ref<Record<(typeof MODE_ROWS)[number], SubsystemMode>>({ quay: 'real', berth: 'real', yard: 'real' })

  function loadDraft(scenario: string, overrides: ScenarioOverrides = {}): void {
    try {
      const config = applyOverrides(resolveScenario(scenario), overrides)
      quayLengthM.value = config.quay.lengthM
      stsCount.value = config.sts.length
      vessels.value = copy(config.vessels)
      const dwell = (config.transshipment ?? DEFAULT_TRANSSHIPMENT).dwell
      const medianS = dwell.kind === 'lognormal' ? dwell.medianS : dwell.kind === 'fixed' ? dwell.s : (dwell.minS + dwell.maxS) / 2
      dwellMedianH.value = Math.round((medianS / 3600) * 10) / 10
      poolCount.value = config.emptyPool?.count ?? 0
      poolAgeDays.value = (config.emptyPool?.maxAgeS ?? 7 * 86400) / 86400
      stsK.value = copy(config.kinematics.sts)
      moveVariationPct.value = config.moveVariationPct
      driverVariabilityPct.value = config.driverVariabilityPct ?? 0
      peakTrucks.value = peakTrucksPerHour(config)
      gateIn.value = config.landside?.gate.inLanes ?? 0
      gateOut.value = config.landside?.gate.outLanes ?? 0
      decisions.value = copy(config.decisions ?? {})
      modes.value = { quay: config.subsystems?.quay ?? 'real', berth: config.subsystems?.berth ?? 'real', yard: config.subsystems?.yard ?? 'real' }
    } catch {
      vessels.value = []
    }
  }
  loadDraft(name.value, store.choice.name === name.value ? store.choice.overrides : {})
  watch(name, (n) => loadDraft(n))

  // End conditions: the scenario's own are shown; they only replace it once the user edits a field.
  const scenarioEnd = computed<EndFields>(() => {
    try {
      return endFieldsOf(resolveScenario(name.value).endConditions)
    } catch {
      return { vessels: '', hours: '', moves: '' }
    }
  })
  const endFields = ref<EndFields>({ ...endFieldsOf(store.choice.endConditions ?? resolveScenario(name.value).endConditions) })
  watch(name, () => {
    endFields.value = { ...scenarioEnd.value }
  })
  const endEdited = computed(() => (Object.keys(endFields.value) as (keyof EndFields)[]).some((k) => String(endFields.value[k] ?? '') !== scenarioEnd.value[k]))

  const startDate = computed(() => fromLocalInputValue(start.value))
  /** Presets derive their layout (STS and block positions) from the counts; fixtures keep their hand-placed one. */
  const isPreset = computed(() => selected.value?.kind === 'preset')

  // SHC fleet and kinematics (scenarios with SHCs only). Edited in display units, kept in SI.
  const scenarioShcs = computed(() => {
    try {
      return resolveScenario(name.value).shcs?.length ?? 0
    } catch {
      return 0
    }
  })
  const shcCount = ref(0)
  const shcK = ref<ShcKinematics>(copy(DEFAULT_SHC_KINEMATICS))
  function loadShcDefaults(): void {
    let base: ReturnType<typeof resolveScenario> | null
    try {
      base = resolveScenario(name.value)
    } catch {
      base = null
    }
    const previous = store.choice.name === name.value ? store.choice.shc : undefined
    shcCount.value = previous?.count ?? base?.shcs?.length ?? 0
    shcK.value = copy(previous?.kinematics ?? base?.kinematics.shc ?? DEFAULT_SHC_KINEMATICS)
  }
  loadShcDefaults()
  watch(name, loadShcDefaults)

  // Yard blocks and ASC kinematics (scenarios with yard blocks only).
  const scenarioBlocks = computed(() => {
    try {
      return resolveScenario(name.value).yard?.blocks.length ?? 0
    } catch {
      return 0
    }
  })
  const yardBlocks = ref<BlockDraft[]>([])
  const ascK = ref<AscKinematics>(copy(DEFAULT_ASC_KINEMATICS))
  /** ASCs per block; the dialog defaults to two (TTI Algeciras), the engine config to one. */
  const ascsPerBlock = ref<1 | 2>(2)
  /** Yard start (TT-14): pre-filled (default), warm-up or empty; empty and warm-up need the landside (export boxes arrive by truck). */
  const startMode = ref<YardStartMode>('prefilled')
  const startTargetPct = ref(DEFAULT_YARD_TARGET_PCT)
  const startWarmUpH = ref(DEFAULT_WARM_UP_S / 3600)
  const scenarioHasLandside = computed(() => {
    try {
      return resolveScenario(name.value).landside !== undefined
    } catch {
      return false
    }
  })
  function loadYardDefaults(): void {
    let base: ReturnType<typeof resolveScenario> | null
    try {
      base = resolveScenario(name.value)
    } catch {
      base = null
    }
    const previous = store.choice.name === name.value ? store.choice.yard : undefined
    yardBlocks.value =
      previous?.blocks.map((b) => ({ ...b })) ??
      (base?.yard?.blocks ?? []).map((b) => ({
        bays: b.bays ?? DEFAULT_BLOCK.bays,
        tiers: b.tiers ?? DEFAULT_BLOCK.tiers,
        wtpPads: b.wtpPads,
        transferStalls: b.transferStalls ?? DEFAULT_BLOCK.transferStalls,
      }))
    ascK.value = copy(previous?.asc ?? base?.kinematics.asc ?? DEFAULT_ASC_KINEMATICS)
    ascsPerBlock.value = previous?.ascsPerBlock ?? 2
    // a preset chooses its own start mode; the dialog's default is pre-filled
    startMode.value = previous?.start?.mode ?? base?.yardStart?.mode ?? 'prefilled'
    startTargetPct.value = previous?.start?.targetPct ?? base?.yardStart?.targetPct ?? DEFAULT_YARD_TARGET_PCT
    startWarmUpH.value = (previous?.start?.warmUpS ?? base?.yardStart?.warmUpS ?? DEFAULT_WARM_UP_S) / 3600
    if (startMode.value !== 'prefilled' && !scenarioHasLandside.value) startMode.value = 'prefilled'
  }
  loadYardDefaults()
  watch(name, loadYardDefaults)

  const overrides = computed<ScenarioOverrides>(() => ({
    quayLengthM: quayLengthM.value,
    stsCount: stsCount.value,
    vessels: vessels.value,
    dwellMedianS: Math.round(dwellMedianH.value * 3600),
    emptyPool: { count: poolCount.value, maxAgeS: Math.round(poolAgeDays.value * 86400) },
    stsKinematics: stsK.value,
    moveVariationPct: moveVariationPct.value,
    driverVariabilityPct: driverVariabilityPct.value,
    ...(scenarioHasLandside.value
      ? { peakTrucksPerHour: peakTrucks.value, gate: { inLanes: gateIn.value, outLanes: gateOut.value } }
      : {}),
    decisions: decisions.value,
    subsystems: { ...modes.value },
    derive: isPreset.value,
  }))
  function yardStartConfig(): NonNullable<YardSetup['start']> {
    return startMode.value === 'prefilled'
      ? { mode: 'prefilled', targetPct: startTargetPct.value }
      : startMode.value === 'warmup'
        ? { mode: 'warmup', warmUpS: Math.round(startWarmUpH.value * 3600) }
        : { mode: 'empty' }
  }
  /** Everything the dialog edits, in the shape the store starts the run with. */
  const edits = computed<ScenarioEdits>(() => ({
    overrides: copy(overrides.value),
    shc: scenarioShcs.value > 0 ? { count: shcCount.value, kinematics: copy(shcK.value) } : undefined,
    yard:
      scenarioBlocks.value > 0
        ? { blocks: copy(yardBlocks.value), asc: copy(ascK.value), ascsPerBlock: ascsPerBlock.value, start: yardStartConfig() }
        : undefined,
  }))
  /** The scenario as it would start (selected fixture/preset + the edits above): what the plan previews and the checks validate. */
  const draftConfig = computed<ScenarioConfig | null>(() => {
    try {
      return composeScenario(resolveScenario(name.value), edits.value)
    } catch {
      return null
    }
  })
  const check = computed<ScenarioCheck>(() => {
    try {
      return validateScenario(composeScenario(resolveScenario(name.value), edits.value))
    } catch (err) {
      return { errors: [{ key: 'setup.check.invalid', params: { message: err instanceof Error ? err.message : String(err) } }], warnings: [] }
    }
  })

  // Display units: speeds m/s <-> km/h or mi/h; accelerations m/s² <-> m/s² or ft/s².
  const imperial = computed(() => store.display.units === 'imperial')
  const speedFactor = computed(() => (imperial.value ? 3600 / M_PER_MILE : 3.6))
  const accelFactor = computed(() => (imperial.value ? 1 / M_PER_FT : 1))

  function reroll(): void {
    seed.value = randomSeed()
  }

  return reactive({
    catalogue, name, seed, start, selected, startDate, isPreset, reroll,
    quayLengthM, stsCount, vessels, dwellMedianH, poolCount, poolAgeDays,
    stsK, moveVariationPct, driverVariabilityPct, peakTrucks, gateIn, gateOut, decisions, modes,
    endFields, endEdited,
    scenarioShcs, shcCount, shcK,
    scenarioBlocks, yardBlocks, ascK, ascsPerBlock, startMode, startTargetPct, startWarmUpH, scenarioHasLandside,
    edits, draftConfig, check, imperial, speedFactor, accelFactor,
  })
}

export type SetupDraft = ReturnType<typeof createSetupDraft>
const KEY: InjectionKey<SetupDraft> = Symbol('tt-setup-draft')

/** Create the draft and provide it to the section components below (call once, in the dialog shell). */
export function provideSetupDraft(): SetupDraft {
  const draft = createSetupDraft()
  provide(KEY, draft)
  return draft
}

/** The draft the dialog shell provided (call from a section component). */
export function useSetupDraft(): SetupDraft {
  const draft = inject(KEY)
  if (!draft) throw new Error('useSetupDraft: no SetupDialog above this component')
  return draft
}
