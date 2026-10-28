<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { randomSeed, resolveScenario, scenarioCatalogue, useTwinStore } from '../../store/twinStore'
import { fromLocalInputValue, toLocalInputValue } from '../../modules/time'
import { t } from '../../i18n/messages'
import { browserDisplayDefaults } from '../../i18n/display'
import { travelTime, type AxisProfile } from '../../engine'
import { DEFAULT_ASC_KINEMATICS, DEFAULT_SHC_KINEMATICS, type YardSetup } from '../../scenario/builder'
import { applyOverrides, LIMITS, validateOverrides, type OverrideCheck, type ScenarioOverrides } from '../../scenario/overrides'
import type { AscKinematics, ShcKinematics, UnitSystem, VesselConfig } from '../../scenario/types'
import { DEFAULT_TRANSSHIPMENT } from '../../scenario/dwell'
import VesselTable from '../setup/VesselTable.vue'
import { endConditionsFromFields, endFieldsOf, type EndFields } from '../../modules/endConditions'

/** Spec scale limit for the SHC fleet. */
const MAX_SHC = 120
/** Yard limits: blocks, 20 ft bays, tiers, and pads/stalls (which must fit the 25.4 m ASC span at 5.5 m pitch). */
const YARD_LIMITS = { blocks: 8, bays: 60, tiers: 8, pads: 5, stalls: 5 }

const store = useTwinStore()
const catalogue = scenarioCatalogue()

/** Offered locales; the browser's and the current one are added if missing. */
const COMMON_LOCALES = ['en-GB', 'en-US', 'de-DE', 'es-ES', 'fr-FR', 'it-IT', 'nl-NL', 'pt-BR', 'ja-JP', 'zh-CN']
const UNIT_SYSTEMS: UnitSystem[] = ['metric', 'imperial']
const browserLocale = browserDisplayDefaults(typeof navigator === 'undefined' ? [] : navigator.languages ?? []).locale

function localeName(tag: string): string {
  try {
    return new Intl.DisplayNames([tag], { type: 'language' }).of(tag) ?? tag
  } catch {
    return tag
  }
}

const localeOptions = computed(() => {
  const tags = [...new Set([browserLocale, store.display.locale, ...COMMON_LOCALES])]
  return tags.map((tag) => {
    const name = `${localeName(tag)} · ${tag}`
    return { tag, label: tag === browserLocale ? t('setup.localeBrowser', { name }) : name }
  })
})

const preview = computed(() => {
  const fmt = store.fmt
  const sample = new Date(fromLocalInputValue(start.value) ?? Date.now())
  const { date, time } = fmt.dateTime(sample)
  return t('setup.preview', { date, time, number: fmt.number(1234567.89, 2), weekStart: fmt.weekdayName(fmt.firstDayOfWeek()) })
})

const name = ref(store.choice.name)
const seed = ref(store.choice.seed)
const start = ref(toLocalInputValue(new Date(store.choice.startDateTime)))
const formError = ref<string | null>(null)

const selected = computed(() => catalogue.find((c) => c.name === name.value))

// Editable quay, cranes and vessel table, initialised from the chosen scenario.
const quayLengthM = ref(0)
const stsCount = ref(0)
const vessels = ref<VesselConfig[]>([])
// Transshipment dwell (median, hours) and the empty pool (TT-11).
const dwellMedianH = ref(48)
const poolCount = ref(0)
const poolAgeDays = ref(7)

function loadDraft(scenario: string, overrides: ScenarioOverrides = {}): void {
  try {
    const config = applyOverrides(resolveScenario(scenario), overrides)
    quayLengthM.value = config.quay.lengthM
    stsCount.value = config.sts.length
    vessels.value = JSON.parse(JSON.stringify(config.vessels))
    const dwell = (config.transshipment ?? DEFAULT_TRANSSHIPMENT).dwell
    const medianS = dwell.kind === 'lognormal' ? dwell.medianS : dwell.kind === 'fixed' ? dwell.s : (dwell.minS + dwell.maxS) / 2
    dwellMedianH.value = Math.round((medianS / 3600) * 10) / 10
    poolCount.value = config.emptyPool?.count ?? 0
    poolAgeDays.value = (config.emptyPool?.maxAgeS ?? 7 * 86400) / 86400
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
const overrides = computed<ScenarioOverrides>(() => ({
  quayLengthM: quayLengthM.value,
  stsCount: stsCount.value,
  vessels: vessels.value,
  dwellMedianS: Math.round(dwellMedianH.value * 3600),
  emptyPool: { count: poolCount.value, maxAgeS: Math.round(poolAgeDays.value * 86400) },
}))
/** The scenario as it would start (selected fixture/preset + the edits above). */
const draftConfig = computed(() => {
  try {
    return applyOverrides(resolveScenario(name.value), overrides.value)
  } catch {
    return null
  }
})
const check = computed<OverrideCheck>(() => {
  try {
    return validateOverrides(applyOverrides(resolveScenario(name.value), overrides.value))
  } catch (err) {
    return { errors: [{ key: 'setup.check.invalid', params: { message: err instanceof Error ? err.message : String(err) } }], warnings: [] }
  }
})

/** Key figures of the scenario as edited, in the chosen units (the config itself stays SI). */
const summary = computed(() => {
  const config = draftConfig.value
  if (!config) return []
  const fmt = store.fmt
  const sts = config.kinematics.sts
  return [
    { label: t('setup.summary.quay'), value: fmt.length(config.quay.lengthM), testid: 'quay' },
    { label: t('setup.summary.sts'), value: fmt.number(config.sts.length, 0), testid: 'sts' },
    {
      label: t('setup.summary.containers'),
      value: fmt.number(config.vessels.reduce((n, v) => n + v.discharge, 0), 0),
      testid: 'containers',
    },
    { label: t('setup.summary.gantry'), value: fmt.speed(sts.gantry.vMax), testid: 'gantry' },
    { label: t('setup.summary.trolley'), value: fmt.speed(sts.trolley.vMax), testid: 'trolley' },
    { label: t('setup.summary.hoist'), value: fmt.speed(sts.hoistLoaded.vMax), testid: 'hoist' },
  ]
})

// ── SHC fleet and kinematics (scenarios with SHCs only). Edited in display units, kept in SI. ──
/** Plain deep copy (structuredClone cannot copy Vue reactive proxies). */
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
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

// ── Yard blocks and ASC kinematics (scenarios with yard blocks only). ──
type BlockDraft = YardSetup['blocks'][number]
const DEFAULT_BLOCK: BlockDraft = { bays: 20, tiers: 5, wtpPads: 5, transferStalls: 5 }
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
}
loadYardDefaults()
watch(name, loadYardDefaults)

function setBlockCount(raw: string): void {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n) || n < 1 || n > YARD_LIMITS.blocks) return
  const list = yardBlocks.value.slice(0, n)
  while (list.length < n) list.push({ ...(list[list.length - 1] ?? DEFAULT_BLOCK) })
  yardBlocks.value = list
}

const M_PER_FT = 0.3048
const M_PER_MILE = 1609.344
const imperial = computed(() => store.display.units === 'imperial')
/** m/s ↔ km/h or mi/h; m/s² ↔ m/s² or ft/s². */
const speedFactor = computed(() => (imperial.value ? 3600 / M_PER_MILE : 3.6))
const accelFactor = computed(() => (imperial.value ? 1 / M_PER_FT : 1))
const speedUnit = computed(() => t(imperial.value ? 'unit.label.mih' : 'unit.label.kmh'))
const accelUnit = computed(() => t(imperial.value ? 'unit.label.fts2' : 'unit.label.ms2'))
const round2 = (n: number) => Math.round(n * 100) / 100

type ProfileKey = 'driveEmpty' | 'driveLoaded'
const shcFields = computed(() => [
  { id: 'shc-v-empty', label: t('setup.shc.emptySpeed', { unit: speedUnit.value }), profile: 'driveEmpty' as ProfileKey, key: 'vMax' as keyof AxisProfile, factor: speedFactor.value },
  { id: 'shc-v-loaded', label: t('setup.shc.loadedSpeed', { unit: speedUnit.value }), profile: 'driveLoaded' as ProfileKey, key: 'vMax' as keyof AxisProfile, factor: speedFactor.value },
  { id: 'shc-accel', label: t('setup.shc.accel', { unit: accelUnit.value }), profile: 'driveEmpty' as ProfileKey, key: 'accel' as keyof AxisProfile, factor: accelFactor.value },
  { id: 'shc-decel', label: t('setup.shc.decel', { unit: accelUnit.value }), profile: 'driveEmpty' as ProfileKey, key: 'decel' as keyof AxisProfile, factor: accelFactor.value },
])
function setProfile(profile: ProfileKey, key: keyof AxisProfile, factor: number, raw: string): void {
  shcK.value[profile][key] = Number(raw) / factor
}

/** Derived readout: a nominal 300 m empty + 300 m loaded trip with lock, lift, lower and unlock. */
const nominalTrip = computed(() => {
  const k = shcK.value
  const valid = [k.driveEmpty, k.driveLoaded, k.lift].every((p) => p.vMax > 0 && p.accel > 0 && p.decel > 0)
  if (!valid || !(k.lockS >= 0) || !(k.unlockS >= 0)) return null
  const seconds =
    travelTime(300, k.driveEmpty) + travelTime(300, k.driveLoaded) + 2 * travelTime(k.liftHeightM, k.lift) + k.lockS + k.unlockS
  return t('setup.shc.readout', {
    distance: store.fmt.length(300),
    seconds: store.fmt.number(seconds, 0),
    trips: store.fmt.number(3600 / seconds, 1),
  })
})

type AscAxis = 'gantry' | 'trolley' | 'hoistLoaded'
const yardSpeedFields = computed(() => [
  { id: 'asc-v-gantry', label: t('setup.yard.gantrySpeed', { unit: speedUnit.value }), axis: 'gantry' as AscAxis },
  { id: 'asc-v-trolley', label: t('setup.yard.trolleySpeed', { unit: speedUnit.value }), axis: 'trolley' as AscAxis },
  { id: 'asc-v-hoist', label: t('setup.yard.hoistSpeed', { unit: speedUnit.value }), axis: 'hoistLoaded' as AscAxis },
])
function setAscSpeed(axis: AscAxis, raw: string): void {
  ascK.value[axis].vMax = Number(raw) / speedFactor.value
}

const yardValid = computed(() => ascK.value.gantry.vMax > 0 && ascK.value.trolley.vMax > 0 && ascK.value.hoistLoaded.vMax > 0 && ascK.value.hoistEmpty.vMax > 0)
/** Derived readout: capacity and a nominal pad-to-slot cycle (40 m along, 12 m across, 3 tiers). */
const yardReadout = computed(() => {
  const k = ascK.value
  if (!yardValid.value || !(k.lockS >= 0) || !(k.unlockS >= 0)) return null
  const lift = 8.7
  const seconds =
    2 * Math.max(travelTime(40, k.gantry), travelTime(12, k.trolley)) +
    2 * travelTime(lift, k.hoistEmpty) +
    2 * travelTime(lift, k.hoistLoaded) +
    k.lockS +
    k.unlockS
  const capacity = yardBlocks.value.reduce((n, b) => n + b.bays * 8 * b.tiers, 0)
  return t('setup.yard.readout', {
    capacity: store.fmt.number(capacity, 0),
    distance: store.fmt.length(40),
    seconds: store.fmt.number(seconds, 0),
    cycles: store.fmt.number(3600 / seconds, 1),
  })
})

function reroll(): void {
  seed.value = randomSeed()
}

async function submit(): Promise<void> {
  const startAt = startDate.value
  if (!startAt) {
    formError.value = t('setup.errorStart')
    return
  }
  if (!Number.isInteger(seed.value) || seed.value < 0) {
    formError.value = t('setup.errorSeed')
    return
  }
  if (check.value.errors.length > 0) {
    formError.value = t(check.value.errors[0].key, check.value.errors[0].params)
    return
  }
  if (scenarioShcs.value > 0 && (!Number.isInteger(shcCount.value) || shcCount.value < 1 || shcCount.value > MAX_SHC)) {
    formError.value = t('setup.shc.errorCount', { max: MAX_SHC })
    return
  }
  if (scenarioShcs.value > 0 && !nominalTrip.value) {
    formError.value = t('setup.shc.errorKinematics')
    return
  }
  if (scenarioBlocks.value > 0) {
    if (yardBlocks.value.length < 1 || yardBlocks.value.length > YARD_LIMITS.blocks) {
      formError.value = t('setup.yard.errorBlocks', { max: YARD_LIMITS.blocks })
      return
    }
    const bad = yardBlocks.value.findIndex(
      (b) =>
        ![b.bays, b.tiers, b.wtpPads, b.transferStalls].every(Number.isInteger) ||
        b.bays < 1 || b.bays > YARD_LIMITS.bays ||
        b.tiers < 1 || b.tiers > YARD_LIMITS.tiers ||
        b.wtpPads < 1 || b.wtpPads > YARD_LIMITS.pads ||
        b.transferStalls < 0 || b.transferStalls > YARD_LIMITS.stalls,
    )
    if (bad >= 0) {
      formError.value = t('setup.yard.errorBlock', {
        n: bad + 1,
        maxBays: YARD_LIMITS.bays,
        maxTiers: YARD_LIMITS.tiers,
        maxPads: YARD_LIMITS.pads,
        maxStalls: YARD_LIMITS.stalls,
      })
      return
    }
    if (!yardReadout.value) {
      formError.value = t('setup.yard.errorKinematics')
      return
    }
  }
  const end = endEdited.value ? endConditionsFromFields(endFields.value, vessels.value.length) : null
  if (end && !end.ok) {
    formError.value = t(end.error)
    return
  }
  formError.value = null
  await store
    .startScenario({
      endConditions: end?.value,
      name: name.value,
      seed: seed.value,
      startDateTime: startAt.toISOString(),
      overrides: JSON.parse(JSON.stringify(overrides.value)),
      shc: scenarioShcs.value > 0 ? { count: shcCount.value, kinematics: copy(shcK.value) } : undefined,
      yard: scenarioBlocks.value > 0 ? { blocks: copy(yardBlocks.value), asc: copy(ascK.value), ascsPerBlock: ascsPerBlock.value } : undefined,
    })
    .catch(() => {})
}
</script>

<template>
  <div class="backdrop">
    <form
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tt-setup-title"
      @submit.prevent="submit"
    >
      <h2 id="tt-setup-title">
        {{ t('setup.title') }}
      </h2>
      <p class="intro">
        {{ t('setup.intro') }}
      </p>

      <fieldset class="field">
        <legend>{{ t('setup.scenario') }}</legend>
        <label
          v-for="c in catalogue"
          :key="c.name"
          class="choice"
          :class="{ active: c.name === name }"
        >
          <input
            v-model="name"
            type="radio"
            name="tt-scenario"
            :value="c.name"
          >
          <span class="choice-name">{{ c.name }}</span>
          <span class="choice-kind">{{ t(`setup.kind.${c.kind}`) }}</span>
        </label>
        <p
          v-if="selected"
          class="hint"
        >
          {{ selected.description }}
        </p>
        <p class="hint muted">
          {{ t('setup.presetsSoon') }}
        </p>
        <dl
          v-if="summary.length"
          class="summary"
          :aria-label="t('setup.summary')"
          data-testid="tt-setup-summary"
        >
          <div
            v-for="item in summary"
            :key="item.testid"
            class="summary-item"
          >
            <dt>{{ item.label }}</dt>
            <dd :data-testid="`tt-summary-${item.testid}`">
              {{ item.value }}
            </dd>
          </div>
        </dl>
      </fieldset>

      <div class="row">
        <label class="field">
          <span>{{ t('setup.seed') }}</span>
          <span class="seed">
            <input
              v-model.number="seed"
              type="number"
              min="0"
              step="1"
              name="seed"
              required
            >
            <button
              type="button"
              class="btn"
              :title="t('setup.rerollHint')"
              @click="reroll"
            >
              {{ t('setup.reroll') }}
            </button>
          </span>
        </label>
        <label class="field">
          <span>{{ t('setup.start') }}</span>
          <input
            v-model="start"
            type="datetime-local"
            name="start"
            required
          >
        </label>
      </div>

      <div class="row">
        <label class="field">
          <span>{{ t('setup.quayLength') }}</span>
          <input
            v-model.number="quayLengthM"
            type="number"
            :min="LIMITS.quayLengthM.min"
            :max="LIMITS.quayLengthM.max"
            step="any"
            name="quayLength"
          >
        </label>
        <label class="field">
          <span>{{ t('setup.stsCount') }}</span>
          <input
            v-model.number="stsCount"
            type="number"
            :min="LIMITS.sts.min"
            :max="LIMITS.sts.max"
            step="1"
            name="stsCount"
          >
        </label>
      </div>

      <fieldset class="field">
        <legend>{{ t('setup.vessels') }}</legend>
        <VesselTable
          v-model="vessels"
          :start-date-time="startDate"
        />
      </fieldset>

      <fieldset
        class="field"
        data-testid="tt-flows"
      >
        <legend>{{ t('setup.flows.title') }}</legend>
        <p class="hint">
          {{ t('setup.flows.hint') }}
        </p>
        <div class="grid">
          <label>
            <span>{{ t('setup.flows.dwellMedianH') }}</span>
            <input
              v-model.number="dwellMedianH"
              type="number"
              min="0.1"
              step="any"
              name="dwellMedianH"
            >
          </label>
          <label>
            <span>{{ t('setup.flows.poolCount') }}</span>
            <input
              v-model.number="poolCount"
              type="number"
              min="0"
              step="1"
              name="poolCount"
            >
          </label>
          <label>
            <span>{{ t('setup.flows.poolAgeDays') }}</span>
            <input
              v-model.number="poolAgeDays"
              type="number"
              min="0"
              step="any"
              name="poolAgeDays"
            >
          </label>
        </div>
      </fieldset>

      <fieldset
        class="field"
        data-testid="tt-end-conditions"
      >
        <legend>{{ t('setup.end.title') }}</legend>
        <p class="hint">
          {{ t('setup.end.hint') }}
        </p>
        <div class="grid">
          <label class="mini">
            <span>{{ t('setup.end.vessels') }}</span>
            <input
              v-model="endFields.vessels"
              type="number"
              step="any"
              name="end-vessels"
              :placeholder="t('setup.end.vesselsPlaceholder')"
            >
          </label>
          <label class="mini">
            <span>{{ t('setup.end.hours') }}</span>
            <input
              v-model="endFields.hours"
              type="number"
              step="any"
              name="end-hours"
              :placeholder="t('setup.end.off')"
            >
          </label>
          <label class="mini">
            <span>{{ t('setup.end.moves') }}</span>
            <input
              v-model="endFields.moves"
              type="number"
              step="any"
              name="end-moves"
              :placeholder="t('setup.end.off')"
            >
          </label>
        </div>
      </fieldset>

      <ul
        v-if="check.errors.length || check.warnings.length"
        class="checks"
      >
        <li
          v-for="(e, i) in check.errors"
          :key="`e${i}`"
          class="error"
        >
          ⛔ {{ t(e.key, e.params) }}
        </li>
        <li
          v-for="(w, i) in check.warnings"
          :key="`w${i}`"
          class="warning"
        >
          ⚠ {{ t(w.key, w.params) }}
        </li>
      </ul>

      <fieldset class="field">
        <legend>{{ t('setup.display') }}</legend>
        <div class="row">
          <label class="field">
            <span>{{ t('setup.locale') }}</span>
            <select
              name="locale"
              data-testid="tt-locale"
              :value="store.display.locale"
              @change="store.setDisplay({ locale: ($event.target as HTMLSelectElement).value })"
            >
              <option
                v-for="o in localeOptions"
                :key="o.tag"
                :value="o.tag"
              >
                {{ o.label }}
              </option>
            </select>
          </label>
          <div
            class="field"
            role="radiogroup"
            :aria-label="t('setup.units')"
          >
            <span>{{ t('setup.units') }}</span>
            <label
              v-for="u in UNIT_SYSTEMS"
              :key="u"
              class="unit-choice"
            >
              <input
                type="radio"
                name="tt-units"
                :value="u"
                :checked="store.display.units === u"
                :data-testid="`tt-units-${u}`"
                @change="store.setDisplay({ units: u })"
              >
              {{ t(`setup.units.${u}`) }}
            </label>
          </div>
        </div>
        <p
          class="hint"
          data-testid="tt-display-preview"
        >
          {{ preview }}
        </p>
      </fieldset>

      <fieldset
        v-if="scenarioShcs > 0"
        class="field"
      >
        <legend>{{ t('setup.shc.title') }}</legend>
        <div class="grid">
          <label class="mini">
            <span>{{ t('setup.shc.count') }}</span>
            <input
              v-model.number="shcCount"
              type="number"
              min="1"
              :max="MAX_SHC"
              step="1"
              name="shc-count"
            >
          </label>
          <label
            v-for="f in shcFields"
            :key="f.id"
            class="mini"
          >
            <span>{{ f.label }}</span>
            <input
              type="number"
              min="0"
              step="any"
              :name="f.id"
              :value="round2(shcK[f.profile][f.key] * f.factor)"
              @input="setProfile(f.profile, f.key, f.factor, ($event.target as HTMLInputElement).value)"
            >
          </label>
          <label class="mini">
            <span>{{ t('setup.shc.lockUnlock') }}</span>
            <span class="pair">
              <input
                v-model.number="shcK.lockS"
                type="number"
                min="0"
                step="any"
                name="shc-lock"
                :aria-label="t('setup.shc.lockTime')"
              >
              <input
                v-model.number="shcK.unlockS"
                type="number"
                min="0"
                step="any"
                name="shc-unlock"
                :aria-label="t('setup.shc.unlockTime')"
              >
            </span>
          </label>
        </div>
        <p
          v-if="nominalTrip"
          class="hint"
          data-testid="tt-shc-readout"
        >
          {{ nominalTrip }}
        </p>
      </fieldset>

      <fieldset
        v-if="scenarioBlocks > 0"
        class="field"
      >
        <legend>{{ t('setup.yard.title') }}</legend>
        <div class="grid">
          <label class="mini">
            <span>{{ t('setup.yard.blocks') }}</span>
            <input
              type="number"
              min="1"
              :max="YARD_LIMITS.blocks"
              step="1"
              name="yard-blocks"
              :value="yardBlocks.length"
              @change="setBlockCount(($event.target as HTMLInputElement).value)"
            >
          </label>
        </div>
        <div
          v-for="(b, i) in yardBlocks"
          :key="i"
          class="grid"
          :data-testid="`tt-yard-block-${i + 1}`"
        >
          <span class="blockname">{{ t('setup.yard.block', { n: i + 1 }) }}</span>
          <label class="mini">
            <span>{{ t('setup.yard.bays') }}</span>
            <input
              v-model.number="b.bays"
              type="number"
              min="1"
              :max="YARD_LIMITS.bays"
              step="1"
              :name="`yard-bays-${i + 1}`"
            >
          </label>
          <label class="mini">
            <span>{{ t('setup.yard.tiers') }}</span>
            <input
              v-model.number="b.tiers"
              type="number"
              min="1"
              :max="YARD_LIMITS.tiers"
              step="1"
              :name="`yard-tiers-${i + 1}`"
            >
          </label>
          <label class="mini">
            <span>{{ t('setup.yard.wtpPads') }}</span>
            <input
              v-model.number="b.wtpPads"
              type="number"
              min="1"
              :max="YARD_LIMITS.pads"
              step="1"
              :name="`yard-pads-${i + 1}`"
            >
          </label>
          <label class="mini">
            <span>{{ t('setup.yard.stalls') }}</span>
            <input
              v-model.number="b.transferStalls"
              type="number"
              min="0"
              :max="YARD_LIMITS.stalls"
              step="1"
              :name="`yard-stalls-${i + 1}`"
            >
          </label>
        </div>
        <div
          class="grid"
          role="radiogroup"
          :aria-label="t('setup.yard.ascs')"
          data-testid="tt-yard-ascs"
        >
          <span class="blockname">{{ t('setup.yard.ascs') }}</span>
          <label class="unit-choice">
            <input
              v-model.number="ascsPerBlock"
              type="radio"
              name="yard-ascs"
              :value="1"
              data-testid="tt-yard-ascs-1"
            >
            {{ t('setup.yard.ascsOne') }}
          </label>
          <label class="unit-choice">
            <input
              v-model.number="ascsPerBlock"
              type="radio"
              name="yard-ascs"
              :value="2"
              data-testid="tt-yard-ascs-2"
            >
            {{ t('setup.yard.ascsTwo') }}
          </label>
        </div>
        <div class="grid">
          <label
            v-for="f in yardSpeedFields"
            :key="f.id"
            class="mini"
          >
            <span>{{ f.label }}</span>
            <input
              type="number"
              min="0"
              step="any"
              :name="f.id"
              :value="round2(ascK[f.axis].vMax * speedFactor)"
              @input="setAscSpeed(f.axis, ($event.target as HTMLInputElement).value)"
            >
          </label>
          <label class="mini">
            <span>{{ t('setup.yard.lockUnlock') }}</span>
            <span class="pair">
              <input
                v-model.number="ascK.lockS"
                type="number"
                min="0"
                step="any"
                name="asc-lock"
                :aria-label="t('setup.yard.lockTime')"
              >
              <input
                v-model.number="ascK.unlockS"
                type="number"
                min="0"
                step="any"
                name="asc-unlock"
                :aria-label="t('setup.yard.unlockTime')"
              >
            </span>
          </label>
        </div>
        <p class="hint">
          {{ t('setup.yard.rowsNote') }}
        </p>
        <p
          v-if="ascsPerBlock === 2"
          class="hint"
        >
          {{ t('setup.yard.twinNote') }}
        </p>
        <p
          v-if="yardReadout"
          class="hint"
          data-testid="tt-yard-readout"
        >
          {{ yardReadout }}
        </p>
      </fieldset>

      <p
        v-if="formError || store.error"
        class="error"
      >
        {{ formError ?? store.error }}
      </p>

      <div class="buttons">
        <button
          v-if="store.hasScenario"
          type="button"
          class="btn"
          @click="store.cancelSetup()"
        >
          {{ t('setup.cancel') }}
        </button>
        <button
          type="submit"
          class="btn primary"
          :disabled="store.loading"
        >
          {{ store.loading ? t('setup.starting') : t('setup.startButton') }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.6rem;
}

@media (max-width: 560px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.mini {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.mini input {
  padding: 0.4rem 0.5rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text);
  font-family: var(--tt-font-mono);
  color-scheme: dark;
  min-width: 0;
}

.blockname {
  align-self: end;
  font-weight: 600;
  min-width: 5em;
}

.pair {
  display: flex;
  gap: 0.3rem;
}

.pair input {
  width: 50%;
}

.backdrop {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(10, 14, 26, 0.72);
  backdrop-filter: blur(3px);
}

.dialog {
  width: min(52rem, 100%);
  max-height: 100%;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.4rem 1.5rem;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  font-family: var(--font-body);
  color: var(--color-text);
}

h2 {
  font-size: 1.25rem;
  font-weight: 700;
}

.intro,
.hint {
  color: var(--color-text-muted);
  font-size: 0.85rem;
  line-height: 1.5;
}

.muted {
  font-style: italic;
}

fieldset {
  border: none;
  padding: 0;
  margin: 0;
  min-width: 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.85rem;
}

legend,
.field > span {
  color: var(--color-text-muted);
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 0.4rem;
}

.choice {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  cursor: pointer;
}

.choice.active {
  border-color: var(--color-primary);
  background: rgba(59, 130, 246, 0.1);
}

.choice-name {
  font-family: var(--tt-font-mono);
}

.choice-kind {
  margin-left: auto;
  font-size: 0.72rem;
  color: var(--color-text-muted);
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

@media (max-width: 560px) {
  .row {
    grid-template-columns: 1fr;
  }
}

.row > * {
  min-width: 0;
}

input[type='number'],
input[type='datetime-local'],
select {
  padding: 0.45rem 0.6rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text);
  font-family: var(--tt-font-mono);
  color-scheme: dark;
  min-width: 0;
  width: 100%;
}

.unit-choice {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  cursor: pointer;
}

.summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem 1rem;
  margin-top: 0.6rem;
  font-size: 0.8rem;
}

@media (max-width: 560px) {
  .summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.summary dt {
  color: var(--color-text-muted);
  font-size: 0.72rem;
}

.summary dd {
  margin: 0;
  font-family: var(--tt-font-mono);
  font-variant-numeric: tabular-nums;
}

.seed {
  display: flex;
  gap: 0.4rem;
}

.seed input {
  flex: 1;
}

.btn {
  padding: 0.45rem 0.9rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text);
  font-size: 0.85rem;
  white-space: nowrap;
}

.btn:hover:not(:disabled) {
  border-color: var(--color-primary);
}

.btn.primary {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
  font-weight: 600;
  min-width: 6rem;
}

.buttons {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.error {
  color: var(--color-danger);
  font-size: 0.85rem;
}

.checks {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0;
  margin: 0;
}

.warning {
  color: var(--color-accent);
  font-size: 0.85rem;
}
</style>
