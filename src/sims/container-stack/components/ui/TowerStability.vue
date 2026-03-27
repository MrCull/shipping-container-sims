<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useContainerStackStore } from '../../store/gameStore'

const store = useContainerStackStore()
const { stabilityScore, wobble, phase } = storeToRefs(store)

const pct = computed(() => Math.round(stabilityScore.value * 100))
const barColor = computed(() => {
  const s = stabilityScore.value
  if (s > 0.65) return '#22c55e'
  if (s > 0.35) return '#eab308'
  return '#ef4444'
})

const wobblePct = computed(() => Math.min(100, (Math.abs(wobble.value.angle) / wobble.value.maxAngle) * 100))
</script>

<template>
  <div
    v-if="phase !== 'start'"
    class="stability"
  >
    <div class="head">
      <span class="title">Stability</span>
      <span
        class="pct"
        :style="{ color: barColor }"
      >{{ pct }}%</span>
    </div>
    <div class="track">
      <div
        class="fill"
        :style="{ width: pct + '%', background: barColor }"
      />
    </div>
    <div class="wobble-row">
      <span class="sub">Wobble</span>
      <div class="track thin">
        <div
          class="fill danger"
          :style="{ width: wobblePct + '%' }"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.stability {
  min-width: 200px;
  padding: 0.65rem 1rem;
  background: rgba(15, 17, 23, 0.82);
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: 8px;
  font-family: var(--font-retro, ui-monospace, monospace);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 0.35rem;
}
.title {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-muted, #9ca3af);
}
.pct {
  font-size: 1rem;
  font-weight: 800;
}
.track {
  height: 8px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  overflow: hidden;
}
.track.thin {
  height: 4px;
  flex: 1;
}
.fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.2s ease, background 0.25s ease;
}
.fill.danger {
  background: linear-gradient(90deg, #f97316, #ef4444);
}
.wobble-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.45rem;
}
.sub {
  font-size: 0.6rem;
  text-transform: uppercase;
  color: #6b7280;
  width: 3.2rem;
  flex-shrink: 0;
}
</style>
