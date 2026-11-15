<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../../i18n/messages'
import type { LayoutSketch } from '../../modules/scenarioPicker'

/**
 * Top-down picture of a scenario's terminal (geometry from `layoutSketch`, in metres): the sea with a vessel at
 * berth, the quay with its cranes reaching over the water, the yard blocks and the truck gate. A caption and a
 * legend with the counts say what each mark is, so the picture needs no prior knowledge.
 */
const props = defineProps<{ sketch: LayoutSketch }>()

/** Water drawn seaward of the quay edge (m): room for the vessel and the crane booms. */
const SEA_DEPTH = 120
const SHIP_BEAM = 46
const BLEED = 4000

const view = computed(() => {
  const [x, y, w, h] = props.sketch.viewBox.split(' ').map(Number) as [number, number, number, number]
  const bottom = y + h
  // the water and the land run past the plan on both sides, so they fill the picture whatever its shape
  return { x: x - BLEED, w: w + 2 * BLEED, bottom, box: `${x} ${-SEA_DEPTH} ${w} ${bottom + SEA_DEPTH}` }
})

/** A vessel alongside: about half the quay, never longer than a big container ship. */
const ship = computed(() => {
  const { x1, x2 } = props.sketch.quay
  const length = Math.min((x2 - x1) * 0.55, 330)
  const x0 = x1 + (x2 - x1 - length) * 0.3
  const y0 = -10 - SHIP_BEAM
  const bow = Math.min(34, length * 0.16)
  const hull = `M${x0 + 6} ${y0} H${x0 + length - bow} Q${x0 + length} ${y0 + SHIP_BEAM / 2} ${x0 + length - bow} ${y0 + SHIP_BEAM} H${x0 + 6} Q${x0} ${y0 + SHIP_BEAM} ${x0} ${y0 + SHIP_BEAM - 6} V${y0 + 6} Q${x0} ${y0} ${x0 + 6} ${y0} Z`
  const bays = Math.max(3, Math.floor((length - bow - 34) / 22))
  const stacks = Array.from({ length: bays }, (_, i) => ({ x: x0 + 26 + i * 22, y: y0 + 7, w: 17, h: SHIP_BEAM - 14 }))
  return { hull, stacks, house: { x: x0 + 8, y: y0 + 9, w: 12, h: SHIP_BEAM - 18 } }
})

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
        :y="-SEA_DEPTH"
        :width="view.w"
        :height="SEA_DEPTH"
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
          y1="-62"
          y2="30"
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
