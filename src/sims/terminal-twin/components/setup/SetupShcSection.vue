<script setup lang="ts">
import { useSetupDraft } from '../../composables/useSetupDraft'
import { computed } from 'vue'
import type { AxisProfile } from '../../engine'
import { t } from '../../i18n/messages'

const d = useSetupDraft()
import { MAX_SHC, shcReadout } from './shcValidation'

const round2 = (n: number) => Math.round(n * 100) / 100
const speedUnit = computed(() => t(d.imperial ? 'unit.label.mih' : 'unit.label.kmh'))
const accelUnit = computed(() => t(d.imperial ? 'unit.label.fts2' : 'unit.label.ms2'))
type ProfileKey = 'driveEmpty' | 'driveLoaded'
const shcFields = computed(() => [
  { id: 'shc-v-empty', label: t('setup.shc.emptySpeed', { unit: speedUnit.value }), profile: 'driveEmpty' as ProfileKey, key: 'vMax' as keyof AxisProfile, factor: d.speedFactor },
  { id: 'shc-v-loaded', label: t('setup.shc.loadedSpeed', { unit: speedUnit.value }), profile: 'driveLoaded' as ProfileKey, key: 'vMax' as keyof AxisProfile, factor: d.speedFactor },
  { id: 'shc-accel', label: t('setup.shc.accel', { unit: accelUnit.value }), profile: 'driveEmpty' as ProfileKey, key: 'accel' as keyof AxisProfile, factor: d.accelFactor },
  { id: 'shc-decel', label: t('setup.shc.decel', { unit: accelUnit.value }), profile: 'driveEmpty' as ProfileKey, key: 'decel' as keyof AxisProfile, factor: d.accelFactor },
])
function setProfile(profile: ProfileKey, key: keyof AxisProfile, factor: number, raw: string): void {
  d.shcK[profile][key] = Number(raw) / factor
}
const nominalTrip = computed(() => shcReadout(d))
</script>

<template>
  <fieldset
    v-if="d.scenarioShcs > 0"
    class="field"
  >
    <legend>{{ t('setup.shc.title') }}</legend>
    <div class="grid">
      <label class="mini">
        <span>{{ t('setup.shc.count') }}</span>
        <input
          v-model.number="d.shcCount"
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
          :value="round2(d.shcK[f.profile][f.key] * f.factor)"
          @input="setProfile(f.profile, f.key, f.factor, ($event.target as HTMLInputElement).value)"
        >
      </label>
      <label class="mini">
        <span>{{ t('setup.shc.lockUnlock') }}</span>
        <span class="pair">
          <input
            v-model.number="d.shcK.lockS"
            type="number"
            min="0"
            step="any"
            name="shc-lock"
            :aria-label="t('setup.shc.lockTime')"
          >
          <input
            v-model.number="d.shcK.unlockS"
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
</template>

<style scoped src="./setupSection.css"></style>
