<script setup lang="ts">
import { computed } from 'vue'
import { planOf } from '../../modules/planModel'
import { BLEED_M, BOOM_LAND_M, BOOM_SEA_M, SEA_DEPTH_M, shipAtQuay } from '../../modules/planPicture'
import { t } from '../../i18n/messages'
import type { ScenarioConfig } from '../../scenario/types'

/**
 * Live top-down plan of the scenario as edited: the sea with an illustrative vessel at the quay, the quay cranes
 * reaching over it, the yard blocks with their transfer pads and stalls, and the truck gate. The legend carries the
 * counts. Scene metres: X along the quay, Z landside.
 */
const props = defineProps<{ config: ScenarioConfig | null }>()

const plan = computed(() => {
  if (!props.config) return null
  try {
    return planOf(props.config)
  } catch {
    return null
  }
})

/** Pixels per metre are implied by the viewBox; 1 unit = 1 m. The water above the quay edge is part of the picture. */
const view = computed(() => {
  const b = plan.value?.bounds
  if (!b) return '0 0 100 100'
  const pad = 20
  return `${b.x0 - pad} ${-SEA_DEPTH_M} ${b.x1 - b.x0 + 2 * pad} ${b.z1 + pad + SEA_DEPTH_M}`
})

const ship = computed(() => (plan.value ? shipAtQuay(plan.value.quay.x0, plan.value.quay.x1) : null))

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
        class="water"
        :x="plan.bounds.x0 - BLEED_M"
        :y="-SEA_DEPTH_M"
        :width="plan.bounds.x1 - plan.bounds.x0 + 2 * BLEED_M"
        :height="SEA_DEPTH_M"
      />
      <rect
        class="land"
        :x="plan.bounds.x0 - BLEED_M"
        y="0"
        :width="plan.bounds.x1 - plan.bounds.x0 + 2 * BLEED_M"
        :height="plan.bounds.z1 + 40"
      />
      <template v-if="ship">
        <path
          class="ship"
          :d="ship.hull"
        />
        <rect
          v-for="(c, i) in ship.stacks"
          :key="`c${i}`"
          class="ship-box"
          :x="c.x"
          :y="c.y"
          :width="c.w"
          :height="c.h"
          rx="2"
        />
        <rect
          class="ship-house"
          :x="ship.house.x"
          :y="ship.house.y"
          :width="ship.house.w"
          :height="ship.house.h"
          rx="2"
        />
      </template>
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
        <line
          :x1="s.x"
          :x2="s.x"
          :y1="-BOOM_SEA_M"
          :y2="BOOM_LAND_M"
        />
        <rect
          :x="s.x - 11"
          y="4"
          width="22"
          height="20"
          rx="3"
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
          rx="3"
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
    <figcaption
      v-if="plan"
      class="legend"
    >
      <span><span class="key ship-key" />{{ t('setup.sketch.ship') }}</span>
      <span><span class="key sts-key" />{{ t('setup.sketch.sts', { n: plan.sts.length }) }}</span>
      <span><span class="key block-key" />{{ t('setup.sketch.blocks', { n: plan.blocks.length }) }}</span>
      <span><span class="key pad-key" />{{ t('setup.plan.pads') }}</span>
      <span v-if="plan.gate"><span class="key gate-key" />{{ t('setup.sketch.gate') }}</span>
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
  height: 17rem;
  background: var(--tt-surface-sunken);
  border: 1px solid var(--tt-border);
  border-radius: var(--tt-radius-sm);
}

.water {
  fill: var(--tt-plan-water);
}

.land {
  fill: var(--tt-plan-land);
}

.ship {
  fill: var(--tt-plan-ship);
}

.ship-box {
  fill: var(--tt-plan-pad);
}

.ship-house {
  fill: var(--tt-plan-land);
}

.quay-edge {
  stroke: var(--tt-plan-line);
  stroke-width: 5;
}

.sts line {
  stroke: var(--tt-plan-sts);
  stroke-width: 6;
  stroke-linecap: round;
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
  gap: 0.25rem 1.1rem;
  align-items: center;
  margin-top: 0.6rem;
  font-size: var(--tt-text-sm);
  color: var(--tt-text-muted);
}

.key {
  display: inline-block;
  width: 0.75rem;
  height: 0.75rem;
  margin-right: 0.45rem;
  border-radius: 3px;
  vertical-align: middle;
}

.ship-key {
  background: var(--tt-plan-ship);
}

.pad-key {
  background: var(--tt-plan-pad);
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
