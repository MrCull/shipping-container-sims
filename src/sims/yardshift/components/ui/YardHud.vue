<script setup lang="ts">
import type { ClocksView } from '../../types/presentation'

defineProps<{
  title: string
  loaded: string
  rehandles: string
  clocks: ClocksView
  /** Bumped on every +1 s time credit; replays the "+1s" float. */
  creditPulse: number
}>()
</script>

<template>
  <header class="hud">
    <div class="brand">
      <span class="wordmark">YARD<em>SHIFT</em></span>
      <span class="title">{{ title }}</span>
    </div>
    <dl class="stats">
      <div
        v-for="(clock, key) in { shift: clocks.shift, truck: clocks.truck }"
        :key="key"
        class="clock"
        :class="[key, { red: clock.red, shake: clock.shake }]"
        :data-testid="`ys-clock-${key}`"
      >
        <dt>{{ clock.label }}</dt>
        <dd>
          {{ clock.text }}
          <span
            v-if="key === 'truck' && creditPulse > 0"
            :key="creditPulse"
            class="credit"
            data-testid="ys-credit"
          >+1s</span>
        </dd>
        <span class="bar"><span :style="{ width: `${clock.fraction * 100}%` }" /></span>
      </div>
      <div class="loaded">
        <dt>LOADED</dt>
        <dd data-testid="ys-loaded">
          {{ loaded }}
        </dd>
        <span class="sub"><span data-testid="ys-rehandles">{{ rehandles }}</span> REHANDLES</span>
      </div>
    </dl>
  </header>
</template>

<style scoped>
.hud {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 16px 6px;
  background: var(--ys-panel);
  color: var(--color-text);
}
@media (min-width: 620px) {
  .hud {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}
.brand {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}
.wordmark {
  font-style: italic;
  font-weight: 900;
  font-size: 1.35rem;
  letter-spacing: -0.02em;
  line-height: 1;
  color: var(--color-text);
}
.wordmark em {
  color: var(--ys-gold);
}
.title {
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  opacity: 0.75;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin: 0;
}
@media (min-width: 620px) {
  .stats {
    width: 380px;
  }
}
dt {
  font-size: 0.6rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  opacity: 0.7;
  white-space: nowrap;
}
dd {
  position: relative;
  margin: 0;
  font-size: 1.7rem;
  font-weight: 800;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.bar {
  display: block;
  height: 5px;
  margin-top: 3px;
  background: var(--ys-track);
  border-radius: 3px;
  overflow: hidden;
}
.bar span {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--ys-seq-2);
}
.clock.truck .bar span {
  background: var(--ys-gold);
}
.clock.red dd {
  color: var(--ys-red-light);
}
.clock.red .bar span {
  background: var(--ys-red-light);
}
.clock.shake dd {
  animation: shake 0.25s linear infinite;
}
.sub {
  display: block;
  margin-top: 1px;
  font-size: 0.6rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  opacity: 0.75;
  white-space: nowrap;
}
.credit {
  position: absolute;
  right: 0;
  top: -0.2em;
  color: var(--ys-seq-2);
  font-size: 0.75rem;
  animation: float-up 0.9s ease-out forwards;
  pointer-events: none;
}
@keyframes shake {
  0%,
  100% {
    transform: translateX(0);
  }
  25% {
    transform: translateX(-2px);
  }
  75% {
    transform: translateX(2px);
  }
}
@keyframes float-up {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(-14px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .clock.shake dd {
    animation: none;
    text-decoration: underline;
  }
  .credit {
    animation: none;
    opacity: 0;
  }
}
</style>
