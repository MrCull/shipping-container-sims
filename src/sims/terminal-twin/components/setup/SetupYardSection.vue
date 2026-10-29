<script setup lang="ts">
import { useSetupDraft } from '../../composables/useSetupDraft'
import { computed } from 'vue'
import { t } from '../../i18n/messages'

const d = useSetupDraft()
import { DEFAULT_BLOCK, type BlockDraft } from '../../composables/useSetupDraft'
import { YARD_LIMITS, yardReadout as readoutOf } from './yardValidation'
import type { YardStartMode } from '../../scenario/types'

const round2 = (n: number) => Math.round(n * 100) / 100
const speedUnit = computed(() => t(d.imperial ? 'unit.label.mih' : 'unit.label.kmh'))
/** Yard start (TT-14): pre-filled (default), warm-up or empty. */
const YARD_START_MODES: YardStartMode[] = ['prefilled', 'warmup', 'empty']

/** The uniform "all blocks" row: sets one field of every block (the per-block rows below stay editable). */
const ALL_BLOCK_FIELDS = [
  { key: 'bays', label: 'setup.yard.bays', min: 1, max: YARD_LIMITS.bays },
  { key: 'tiers', label: 'setup.yard.tiers', min: 1, max: YARD_LIMITS.tiers },
  { key: 'wtpPads', label: 'setup.yard.wtpPads', min: 1, max: YARD_LIMITS.pads },
  { key: 'transferStalls', label: 'setup.yard.stalls', min: 0, max: YARD_LIMITS.stalls },
] as const
function setAllBlocks(key: keyof BlockDraft, raw: string): void {
  const n = Number(raw)
  if (raw === '' || !Number.isFinite(n)) return
  for (const b of d.yardBlocks) b[key] = n
}

function setBlockCount(raw: string): void {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n) || n < 1 || n > YARD_LIMITS.blocks) return
  const list = d.yardBlocks.slice(0, n)
  while (list.length < n) list.push({ ...(list[list.length - 1] ?? DEFAULT_BLOCK) })
  d.yardBlocks = list
}

type AscAxis = 'gantry' | 'trolley' | 'hoistLoaded'
const yardSpeedFields = computed(() => [
  { id: 'asc-v-gantry', label: t('setup.yard.gantrySpeed', { unit: speedUnit.value }), axis: 'gantry' as AscAxis },
  { id: 'asc-v-trolley', label: t('setup.yard.trolleySpeed', { unit: speedUnit.value }), axis: 'trolley' as AscAxis },
  { id: 'asc-v-hoist', label: t('setup.yard.hoistSpeed', { unit: speedUnit.value }), axis: 'hoistLoaded' as AscAxis },
])
function setAscSpeed(axis: AscAxis, raw: string): void {
  d.ascK[axis].vMax = Number(raw) / d.speedFactor
}
const yardReadout = computed(() => readoutOf(d))
</script>

<template>
  <fieldset
    v-if="d.scenarioBlocks > 0"
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
          :value="d.yardBlocks.length"
          @change="setBlockCount(($event.target as HTMLInputElement).value)"
        >
      </label>
    </div>
    <div
      class="grid"
      data-testid="tt-yard-all-blocks"
    >
      <span class="blockname">{{ t('setup.yard.allBlocks') }}</span>
      <label
        v-for="f in ALL_BLOCK_FIELDS"
        :key="f.key"
        class="mini"
      >
        <span>{{ t(f.label) }}</span>
        <input
          type="number"
          :min="f.min"
          :max="f.max"
          step="1"
          :name="`yard-all-${f.key}`"
          :value="d.yardBlocks[0]?.[f.key]"
          @input="setAllBlocks(f.key, ($event.target as HTMLInputElement).value)"
        >
      </label>
    </div>
    <div class="blocklist">
      <div
        v-for="(b, i) in d.yardBlocks"
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
          v-model.number="d.ascsPerBlock"
          type="radio"
          name="yard-ascs"
          :value="1"
          data-testid="tt-yard-ascs-1"
        >
        {{ t('setup.yard.ascsOne') }}
      </label>
      <label class="unit-choice">
        <input
          v-model.number="d.ascsPerBlock"
          type="radio"
          name="yard-ascs"
          :value="2"
          data-testid="tt-yard-ascs-2"
        >
        {{ t('setup.yard.ascsTwo') }}
      </label>
    </div>
    <div
      class="grid"
      role="radiogroup"
      :aria-label="t('setup.yard.start')"
      data-testid="tt-yard-start"
    >
      <span class="blockname">{{ t('setup.yard.start') }}</span>
      <label
        v-for="m in YARD_START_MODES"
        :key="m"
        class="unit-choice"
      >
        <input
          v-model="d.startMode"
          type="radio"
          name="yard-start"
          :value="m"
          :disabled="m !== 'prefilled' && !d.scenarioHasLandside"
          :data-testid="`tt-yard-start-${m}`"
        >
        {{ t(`setup.yard.start.${m}`) }}
      </label>
      <label
        v-if="d.startMode === 'prefilled'"
        class="mini"
      >
        <span>{{ t('setup.yard.targetPct') }}</span>
        <input
          v-model.number="d.startTargetPct"
          type="number"
          min="0"
          max="100"
          step="1"
          name="yard-target"
          data-testid="tt-yard-target"
        >
      </label>
      <label
        v-if="d.startMode === 'warmup'"
        class="mini"
      >
        <span>{{ t('setup.yard.warmUpH') }}</span>
        <input
          v-model.number="d.startWarmUpH"
          type="number"
          min="1"
          max="720"
          step="1"
          name="yard-warmup"
          data-testid="tt-yard-warmup"
        >
      </label>
    </div>
    <p
      v-if="!d.scenarioHasLandside"
      class="hint"
    >
      {{ t('setup.yard.startNoLandside') }}
    </p>
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
          :value="round2(d.ascK[f.axis].vMax * d.speedFactor)"
          @input="setAscSpeed(f.axis, ($event.target as HTMLInputElement).value)"
        >
      </label>
      <label class="mini">
        <span>{{ t('setup.yard.lockUnlock') }}</span>
        <span class="pair">
          <input
            v-model.number="d.ascK.lockS"
            type="number"
            min="0"
            step="any"
            name="asc-lock"
            :aria-label="t('setup.yard.lockTime')"
          >
          <input
            v-model.number="d.ascK.unlockS"
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
      v-if="d.ascsPerBlock === 2"
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
</template>

<style scoped src="./setupSection.css"></style>

<style scoped>
.blocklist {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  max-height: 14rem;
  padding-right: 0.3rem;
  overflow-y: auto;
}
</style>
