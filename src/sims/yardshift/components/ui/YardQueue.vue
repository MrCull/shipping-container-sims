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
      aria-label="Next five containers"
    >
      <li
        v-for="(item, i) in queue"
        :key="i"
        :style="{ '--chip': item.colour }"
        :class="{ empty: item.id === null, gold: item.active }"
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
    <dl class="score">
      <div>
        <dt>SCORE</dt>
        <dd data-testid="ys-score">
          {{ score }}
        </dd>
      </div>
      <div>
        <dt>COMBO</dt>
        <dd
          :key="combo"
          class="combo"
          data-testid="ys-combo"
        >
          {{ combo }}
        </dd>
      </div>
      <span
        v-if="bonus"
        class="bonus"
        data-testid="ys-bonus-window"
      >★ #{{ bonus.id }} {{ bonus.text }}</span>
    </dl>
  </div>
</template>

<style scoped>
.band {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 16px 8px;
  background: var(--ys-panel);
  color: var(--color-text);
}
.queue {
  display: flex;
  flex: 1;
  gap: 5px;
  min-width: 0;
  max-width: 420px;
  margin: 0;
  padding: 0;
  list-style: none;
}
/* Each chip has the yard containers' top-face look: a light top lip, the body colour and a dark lower rail. */
.queue li {
  position: relative;
  flex: 1;
  height: 36px;
  min-width: 0;
  border-radius: 6px;
  background: var(--chip);
  box-shadow:
    inset 0 4px 0 rgb(255 255 255 / 38%),
    inset 0 -5px 0 rgb(0 0 0 / 22%),
    0 0 0 1.5px var(--ys-yard-outline);
  color: var(--ys-yard-number-ink);
  font-weight: 900;
  font-size: 1.2rem;
  line-height: 36px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
/* Only the active bonus (next, window open) is metallic gold, its sequence colour kept as the lower rail; any other bonus keeps its colour and a small static star (art pass 3). */
.queue li.gold {
  background:
    linear-gradient(115deg, transparent 30%, rgb(255 255 255 / 45%) 42%, transparent 54%),
    linear-gradient(var(--ys-yard-gold-shine), var(--ys-yard-gold-body) 45%, var(--ys-yard-gold-deep));
  box-shadow:
    inset 0 4px 0 rgb(255 255 255 / 38%),
    inset 0 -5px 0 var(--chip),
    0 0 0 1.5px var(--ys-yard-outline);
}
.queue li.empty {
  color: var(--color-text-muted);
  box-shadow: inset 0 -5px 0 rgb(0 0 0 / 22%);
}
.star {
  position: absolute;
  top: -0.55em;
  right: -0.25em;
  color: var(--ys-gold-bright);
  font-size: 0.85rem;
  line-height: 1;
  text-shadow: 0 0 2px var(--ys-gold-deep);
}
/* The bonus countdown (story 55): a gold ring round the current chip that empties with the window. */
.ring {
  position: absolute;
  inset: -4px;
  padding: 3px;
  border-radius: 8px;
  background: conic-gradient(var(--ys-gold-bright) calc(var(--ring) * 1turn), transparent 0);
  mask:
    linear-gradient(black 0 0) content-box exclude,
    linear-gradient(black 0 0);
  pointer-events: none;
}
.score {
  position: relative;
  display: flex;
  gap: 10px;
  margin: 0 0 0 auto;
  text-align: right;
}
dt {
  font-size: 0.55rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  opacity: 0.7;
}
dd {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
dd.combo {
  color: var(--ys-gold);
  /* A new combo value pops in (re-keyed on every change); reduced motion shows it still. */
  animation: combo-pop 0.42s cubic-bezier(0.2, 0.9, 0.3, 1.5);
}
@keyframes combo-pop {
  from {
    transform: scale(1.7);
  }
  to {
    transform: scale(1);
  }
}
@media (prefers-reduced-motion: reduce) {
  dd.combo {
    animation: none;
  }
}
.bonus {
  position: absolute;
  right: 0;
  bottom: -11px;
  color: var(--ys-gold-bright);
  font-size: 0.62rem;
  font-weight: 800;
  white-space: nowrap;
}
</style>
