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
      <span class="wordmark">YARDSHIFT</span>
      <span class="title">{{ title }}</span>
    </div>
    <dl class="stats">
      <div
        v-for="(clock, key) in { shift: clocks.shift, truck: clocks.truck }"
        :key="key"
        class="clock"
        :class="{ red: clock.red, shake: clock.shake }"
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
      <div>
        <dt>LOADED</dt>
        <dd data-testid="ys-loaded">
          {{ loaded }}
        </dd>
      </div>
      <div>
        <dt>REHANDLES</dt>
        <dd data-testid="ys-rehandles">
          {{ rehandles }}
        </dd>
      </div>
    </dl>
  </header>
</template>

<style scoped>
.hud {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 12px;
  padding: 8px 16px;
  background: var(--ys-panel);
  color: var(--color-text);
}
.brand {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.wordmark {
  color: var(--ys-gold);
  font-weight: 800;
  letter-spacing: 0.12em;
  font-size: 0.95rem;
}
.title {
  font-size: 0.75rem;
  opacity: 0.8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stats {
  display: flex;
  gap: 14px;
  margin: 0;
}
.stats div {
  text-align: right;
}
dt {
  font-size: 0.6rem;
  letter-spacing: 0.08em;
  opacity: 0.7;
  white-space: nowrap;
}
dd {
  position: relative;
  margin: 0;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.clock {
  min-width: 4.4em;
}
.bar {
  display: block;
  height: 3px;
  margin-top: 2px;
  background: var(--ys-track);
  border-radius: 2px;
  overflow: hidden;
}
.bar span {
  display: block;
  height: 100%;
  margin-left: auto;
  background: var(--ys-seq-0);
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
.credit {
  position: absolute;
  right: 0;
  top: -0.2em;
  color: var(--ys-seq-0);
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
