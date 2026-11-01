<script setup lang="ts">
import { t } from '../../i18n/messages'
import type { LayoutSketch } from '../../modules/scenarioPicker'

/** Top-down sketch of a scenario's quay, cranes, yard blocks and gate (geometry from `layoutSketch`). */
defineProps<{ sketch: LayoutSketch }>()
</script>

<template>
  <svg
    class="sketch"
    :viewBox="sketch.viewBox"
    preserveAspectRatio="xMidYMid meet"
    role="img"
    :aria-label="t('setup.sketch')"
  >
    <rect
      class="sea"
      :x="sketch.sea.x"
      :y="sketch.sea.y"
      :width="sketch.sea.w"
      :height="sketch.sea.h"
    />
    <line
      class="quay"
      :x1="sketch.quay.x1"
      :x2="sketch.quay.x2"
      y1="0"
      y2="0"
    />
    <rect
      v-for="(x, i) in sketch.sts"
      :key="`s${i}`"
      class="sts"
      :x="x - 9"
      y="-6"
      width="18"
      height="12"
    />
    <rect
      v-for="(b, i) in sketch.blocks"
      :key="`b${i}`"
      class="block"
      :x="b.x"
      :y="b.y"
      :width="b.w"
      :height="b.h"
    />
    <rect
      v-if="sketch.gate"
      class="gate"
      :x="sketch.gate.x"
      :y="sketch.gate.y"
      :width="sketch.gate.w"
      :height="sketch.gate.h"
    />
  </svg>
</template>

<style scoped>
.sketch {
  width: 100%;
  height: 7rem;
  background: var(--tt-surface-sunken);
  border: 1px solid var(--tt-border);
  border-radius: var(--tt-radius-sm);
}

.sea {
  fill: var(--tt-accent-soft);
}

.quay {
  stroke: var(--tt-text-muted);
  stroke-width: 4;
}

.sts {
  fill: var(--tt-accent);
}

.block {
  fill: var(--tt-text-muted);
  opacity: 0.55;
}

.gate {
  fill: var(--tt-plan-gate);
}
</style>
