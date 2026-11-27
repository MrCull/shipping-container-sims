<script setup lang="ts">
import type { QueueItem } from '../../types/presentation'

defineProps<{
  queue: QueueItem[]
  score: string
  combo: string
  /** The open bonus window, or null. */
  bonus: { id: number; text: string; fraction: number } | null
}>()
</script>

<template>
  <div class="band">
    <ol
      class="queue"
      data-testid="ys-queue"
      aria-label="Next six containers"
    >
      <li
        v-for="(item, i) in queue"
        :key="i"
        :style="{ background: item.colour }"
        :class="{ empty: item.id === null }"
      >
        {{ item.label }}
        <span
          v-if="i === 0 && bonus"
          class="ring"
          data-testid="ys-bonus-ring"
          :style="{ '--ring': bonus.fraction }"
        />
        <span
          v-if="item.bonus"
          class="star"
          aria-label="bonus"
        >★</span>
      </li>
    </ol>
    <span
      v-if="bonus"
      class="bonus"
      data-testid="ys-bonus-window"
    >★ #{{ bonus.id }} {{ bonus.text }}</span>
    <dl class="score">
      <div>
        <dt>SCORE</dt>
        <dd data-testid="ys-score">
          {{ score }}
        </dd>
      </div>
      <div>
        <dt>COMBO</dt>
        <dd data-testid="ys-combo">
          {{ combo }}
        </dd>
      </div>
    </dl>
  </div>
</template>

<style scoped>
.band {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 16px 6px;
  background: var(--ys-panel);
  color: var(--color-text);
}
.queue {
  display: flex;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.queue li {
  position: relative;
  min-width: 1.9em;
  padding: 2px 0;
  border-radius: 4px;
  color: var(--ys-ink);
  font-weight: 800;
  font-size: 0.8rem;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.queue li.empty {
  color: var(--color-text-muted);
}
.star {
  position: absolute;
  top: -0.55em;
  right: -0.3em;
  color: var(--ys-gold-bright);
  font-size: 0.7rem;
  text-shadow: 0 0 2px var(--ys-gold-deep);
}
/* The bonus countdown (story 55): a gold ring round the current chip that empties with the window. */
.ring {
  position: absolute;
  inset: -3px;
  padding: 2px;
  border-radius: 6px;
  background: conic-gradient(var(--ys-gold-bright) calc(var(--ring) * 1turn), transparent 0);
  mask:
    linear-gradient(black 0 0) content-box exclude,
    linear-gradient(black 0 0);
  pointer-events: none;
}
.bonus {
  color: var(--ys-gold-bright);
  font-size: 0.75rem;
  font-weight: 700;
  white-space: nowrap;
}
.score {
  display: flex;
  gap: 12px;
  margin: 0 0 0 auto;
  text-align: right;
}
dt {
  font-size: 0.6rem;
  letter-spacing: 0.08em;
  opacity: 0.7;
}
dd {
  margin: 0;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
</style>
