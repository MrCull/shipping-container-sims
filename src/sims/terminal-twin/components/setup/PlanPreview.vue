<script setup lang="ts">
import { computed } from 'vue'
import { planOf } from '../../modules/planModel'
import { t } from '../../i18n/messages'
import type { ScenarioConfig } from '../../scenario/types'

/** Live 2D plan of the scenario as edited (quay, STS rail, yard blocks, stalls, gate). Scene metres: X along the quay, Z landside. */
const props = defineProps<{ config: ScenarioConfig | null }>()

const plan = computed(() => {
  if (!props.config) return null
  try {
    return planOf(props.config)
  } catch {
    return null
  }
})

/** Pixels per metre are implied by the viewBox; 1 unit = 1 m. */
const view = computed(() => {
  const b = plan.value?.bounds
  if (!b) return '0 0 100 100'
  const pad = 20
  return `${b.x0 - pad} ${b.z0 - pad} ${b.x1 - b.x0 + 2 * pad} ${b.z1 - b.z0 + 2 * pad}`
})

const rect = (r: { x0: number; x1: number; z0: number; z1: number }) => ({ x: r.x0, y: r.z0, width: r.x1 - r.x0, height: r.z1 - r.z0 })
</script>

<template>
  <figure
    class="plan"
    data-testid="tt-plan-preview"
  >
    <svg
      v-if="plan"
      :viewBox="view"
      role="img"
      :aria-label="t('setup.plan.title')"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect
        class="sea"
        v-bind="rect({ x0: plan.bounds.x0 - 20, x1: plan.bounds.x1 + 20, z0: plan.quay.z0, z1: 0 })"
      />
      <line
        class="quay-edge"
        :x1="plan.quay.x0"
        :x2="plan.quay.x1"
        y1="0"
        y2="0"
        data-testid="tt-plan-quay"
      />
      <g
        v-for="s in plan.sts"
        :key="s.id"
        class="sts"
        :data-testid="`tt-plan-sts-${s.id}`"
      >
        <rect
          :x="s.x - 9"
          y="-6"
          width="18"
          height="12"
        />
      </g>
      <g
        v-for="b in plan.blocks"
        :key="b.id"
        :data-testid="`tt-plan-block-${b.id}`"
        :data-x="b.x"
      >
        <rect
          class="stacks"
          v-bind="rect(b.stacks)"
        />
        <rect
          class="pads"
          v-bind="rect(b.pads)"
        />
      </g>
      <circle
        v-for="s in plan.stalls"
        :key="s.id"
        class="stall"
        :cx="s.x"
        :cy="s.z"
        r="1.4"
      />
      <g
        v-if="plan.gate"
        data-testid="tt-plan-gate"
      >
        <rect
          class="roads"
          v-bind="rect(plan.gate.roads)"
        />
        <rect
          class="gate"
          v-bind="rect(plan.gate.lanes)"
        />
      </g>
    </svg>
    <p
      v-else
      class="hint"
    >
      {{ t('setup.plan.unavailable') }}
    </p>
    <figcaption class="legend">
      <span class="key sea-key" />{{ t('setup.plan.sea') }}
      <span class="key sts-key" />{{ t('setup.plan.sts') }}
      <span class="key block-key" />{{ t('setup.plan.blocks') }}
      <span class="key gate-key" />{{ t('setup.plan.gate') }}
    </figcaption>
  </figure>
</template>

<style scoped>
.plan {
  margin: 0;
}

svg {
  display: block;
  width: 100%;
  height: 12rem;
  background: var(--tt-bg);
  border: 1px solid var(--tt-border);
  border-radius: 6px;
}

.sea {
  fill: var(--tt-plan-quay);
}

.quay-edge {
  stroke: var(--tt-border-strong);
  stroke-width: 3;
}

.sts rect {
  fill: var(--tt-plan-sts);
}

.stacks {
  fill: var(--tt-plan-block);
  opacity: 0.85;
}

.pads {
  fill: var(--tt-plan-pad);
}

.stall {
  fill: var(--tt-plan-lane);
}

.roads {
  fill: none;
  stroke: var(--tt-plan-line);
  stroke-width: 1.5;
}

.gate {
  fill: var(--tt-plan-gate);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.9rem;
  align-items: center;
  margin-top: 0.3rem;
  font-size: 0.72rem;
  color: var(--tt-text-muted);
}

.key {
  display: inline-block;
  width: 0.7rem;
  height: 0.7rem;
  margin-right: 0.3rem;
  border-radius: 2px;
  vertical-align: middle;
}

.sea-key {
  background: var(--tt-plan-quay);
}

.sts-key {
  background: var(--tt-plan-sts);
}

.block-key {
  background: var(--tt-plan-block);
}

.gate-key {
  background: var(--tt-plan-gate);
}

.hint {
  font-size: 0.8rem;
  color: var(--tt-text-muted);
}
</style>
