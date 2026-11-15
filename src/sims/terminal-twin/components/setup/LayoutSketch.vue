<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../../i18n/messages'
import { BLEED_M, BOOM_LAND_M, BOOM_SEA_M, SEA_DEPTH_M, shipAtQuay } from '../../modules/planPicture'
import type { LayoutSketch } from '../../modules/scenarioPicker'

/**
 * Top-down picture of a scenario's terminal (geometry from `layoutSketch`, in metres): the sea with a vessel at
 * berth, the quay with its cranes reaching over the water, the yard blocks and the truck gate. A caption and a
 * legend with the counts say what each mark is, so the picture needs no prior knowledge.
 */
const props = defineProps<{ sketch: LayoutSketch }>()

const view = computed(() => {
  const [x, y, w, h] = props.sketch.viewBox.split(' ').map(Number) as [number, number, number, number]
  const bottom = y + h
  return { x: x - BLEED_M, w: w + 2 * BLEED_M, bottom, box: `${x} ${-SEA_DEPTH_M} ${w} ${bottom + SEA_DEPTH_M}` }
})

const ship = computed(() => shipAtQuay(props.sketch.quay.x1, props.sketch.quay.x2))

/** The gate is a few metres deep: drawn at least this tall so it can be seen. */
const gate = computed(() => {
  const g = props.sketch.gate
  if (!g) return null
  const h = Math.max(g.h, 18)
  return { x: g.x, y: g.y - (h - g.h) / 2, w: g.w, h, roadX: g.x + g.w / 2, roadY: g.y + g.h }
})
</script>

<template>
  <figure class="layout-sketch">
    <figcaption class="caption">
      {{ t('setup.sketch.caption') }}
    </figcaption>
    <svg
      class="sketch"
      :viewBox="view.box"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      :aria-label="t('setup.sketch')"
    >
      <rect
        class="water"
        :x="view.x"
        :y="-SEA_DEPTH_M"
        :width="view.w"
        :height="SEA_DEPTH_M"
      />
      <rect
        class="land"
        :x="view.x"
        y="0"
        :width="view.w"
        :height="view.bottom"
      />
      <path
        class="ship"
        :d="ship.hull"
      />
      <rect
        v-for="(s, i) in ship.stacks"
        :key="`c${i}`"
        class="ship-box"
        :x="s.x"
        :y="s.y"
        :width="s.w"
        :height="s.h"
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
      <line
        class="quay"
        :x1="sketch.quay.x1"
        :x2="sketch.quay.x2"
        y1="0"
        y2="0"
      />
      <g
        v-for="(x, i) in sketch.sts"
        :key="`s${i}`"
        class="sts"
      >
        <line
          :x1="x"
          :x2="x"
          :y1="-BOOM_SEA_M"
          :y2="BOOM_LAND_M"
        />
        <rect
          :x="x - 11"
          y="4"
          width="22"
          height="20"
          rx="3"
        />
      </g>
      <rect
        v-for="(b, i) in sketch.blocks"
        :key="`b${i}`"
        class="block"
        :x="b.x"
        :y="b.y"
        :width="b.w"
        :height="b.h"
        rx="4"
      />
      <template v-if="gate">
        <line
          class="road"
          :x1="gate.roadX"
          :x2="gate.roadX"
          :y1="gate.roadY"
          :y2="view.bottom"
        />
        <rect
          class="gate"
          :x="gate.x"
          :y="gate.y"
          :width="gate.w"
          :height="gate.h"
          rx="3"
        />
      </template>
    </svg>
    <ul class="legend">
      <li><span class="key ship-key" />{{ t('setup.sketch.ship') }}</li>
      <li data-testid="tt-sketch-sts">
        <span class="key sts-key" />{{ t('setup.sketch.sts', { n: sketch.sts.length }) }}
      </li>
      <li data-testid="tt-sketch-blocks">
        <span class="key block-key" />{{ t('setup.sketch.blocks', { n: sketch.blocks.length }) }}
      </li>
      <li v-if="gate">
        <span class="key gate-key" />{{ t('setup.sketch.gate') }}
      </li>
    </ul>
  </figure>
</template>

<style scoped>
.layout-sketch {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  margin: 0;
  padding: 0.85rem 0.9rem 0.8rem;
  background: var(--tt-surface-sunken);
  border: 1px solid var(--tt-border);
  border-radius: var(--tt-radius-sm);
}

.caption {
  color: var(--tt-text-faint);
  font-size: var(--tt-text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.sketch {
  display: block;
  width: 100%;
  height: 12rem;
  border-radius: 6px;
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

.quay {
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

.block {
  fill: var(--tt-plan-block);
}

.road {
  stroke: var(--tt-plan-line);
  stroke-width: 5;
  stroke-dasharray: 8 7;
}

.gate {
  fill: var(--tt-plan-gate);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 1.1rem;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--tt-text-muted);
  font-size: var(--tt-text-sm);
}

.legend li {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.key {
  flex: none;
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 3px;
}

.ship-key {
  background: var(--tt-plan-ship);
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
</style>
