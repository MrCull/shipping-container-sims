<script setup lang="ts">
/**
 * Yardshift root: a Vue HUD around a Three.js yard. Pointer events are forwarded to the store's `tapAt` (which runs
 * the presentation `input`); nothing here interprets them.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import YardHud from './components/ui/YardHud.vue'
import YardQueue from './components/ui/YardQueue.vue'
import { useYardScene } from './composables/useYardScene'
import { useYardshiftStore } from './store/yardshiftStore'

const devApiEnabled = import.meta.env.DEV || import.meta.env.MODE === 'smoke'

const store = useYardshiftStore()
store.loadLevel(1)

const surface = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const view = computed(() => store.view)
const move = computed(() => store.move)
const { webglFailed } = useYardScene(canvas, view, move)

let observer: ResizeObserver | null = null
let uninstallDevApi: (() => void) | null = null
let unmounted = false
let raf = 0

/** The frame loop: the store advances the crane move and the clocks (each step capped at 100 ms). */
function loop(now: number): void {
  store.frame(now)
  raf = requestAnimationFrame(loop)
}

function onVisibility(): void {
  store.setHidden(document.hidden)
}

function measure(): void {
  const el = surface.value
  if (el) store.setViewport(el.clientWidth, el.clientHeight)
}

function onPointerUp(e: PointerEvent): void {
  const box = surface.value?.getBoundingClientRect()
  if (!box) return
  store.tapAt(e.clientX - box.left, e.clientY - box.top)
}

onMounted(async () => {
  store.setReducedMotion(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  store.setHidden(document.hidden)
  document.addEventListener('visibilitychange', onVisibility)
  raf = requestAnimationFrame(loop)
  measure()
  observer = new ResizeObserver(measure)
  if (surface.value) observer.observe(surface.value)
  if (devApiEnabled) {
    const { installDevApi } = await import('./dev/devApi')
    if (!unmounted) uninstallDevApi = installDevApi(store, () => surface.value)
  }
})

onBeforeUnmount(() => {
  unmounted = true
  cancelAnimationFrame(raf)
  document.removeEventListener('visibilitychange', onVisibility)
  observer?.disconnect()
  uninstallDevApi?.()
})
</script>

<template>
  <div class="yardshift">
    <YardHud
      :title="view.hud.title"
      :loaded="view.hud.loaded"
      :rehandles="view.hud.rehandles"
      :clocks="view.clocks"
      :credit-pulse="store.creditPulse"
    />
    <YardQueue
      :queue="view.queue"
      :score="view.hud.score"
      :combo="view.hud.combo"
      :bonus="view.bonus"
    />
    <div
      ref="surface"
      class="surface"
      data-testid="ys-surface"
      @pointerup="onPointerUp"
    >
      <canvas
        ref="canvas"
        class="canvas"
      />
      <span
        v-for="region in view.hitRegions.filter((r) => r.kind !== 'stack')"
        :key="region.kind"
        class="bay-label"
        :style="{ left: `${region.rect.x}px`, top: `${region.rect.y}px`, width: `${region.rect.w}px` }"
      >
        {{ region.kind === 'collection' ? '▼ COLLECTION' : '▲ RECEIPT' }}
      </span>
      <div
        v-if="store.bonusPulse > 0"
        :key="store.bonusPulse"
        class="burst"
        data-testid="ys-bonus-burst"
        :style="{
          left: `${view.layout.collection.x + view.layout.collection.w / 2}px`,
          top: `${view.layout.collection.y}px`,
        }"
      >
        <span class="ring" />
        <span class="float">+250 · +5s</span>
      </div>
      <p
        v-if="webglFailed"
        class="fallback"
      >
        3D view unavailable on this device.
      </p>
    </div>
    <footer
      class="hint"
      data-testid="ys-hint"
    >
      {{ store.message || view.hint }}
    </footer>
    <div
      v-if="view.failed"
      class="complete"
      data-testid="ys-failed"
    >
      <h2>SHIFT OVER</h2>
      <p>{{ view.failed }}</p>
      <button
        type="button"
        class="again"
        @click="store.restart()"
      >
        Retry shift
      </button>
    </div>
    <div
      v-if="view.complete"
      class="complete"
      data-testid="ys-complete"
    >
      <h2>YARD CLEARED</h2>
      <p>{{ view.hud.rehandles }} rehandles</p>
      <button
        type="button"
        class="again"
        @click="store.restart()"
      >
        Play again
      </button>
    </div>
  </div>
</template>

<style scoped>
.yardshift {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
  background: #101c27;
  color: #e7eef2;
  user-select: none;
}
.surface {
  position: relative;
  flex: 1;
  min-height: 0;
  touch-action: none;
}
.canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.bay-label {
  position: absolute;
  pointer-events: none;
  text-align: center;
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  opacity: 0.75;
}
.burst {
  position: absolute;
  pointer-events: none;
  transform: translateX(-50%);
}
.burst .ring {
  position: absolute;
  left: -30px;
  top: -10px;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: radial-gradient(circle, #fff2bd 0%, #f7cb66 40%, rgb(211 155 49 / 0%) 70%);
  animation: burst 0.7s ease-out forwards;
}
.burst .float {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  color: #ffc85c;
  font-weight: 800;
  text-shadow: 0 1px 2px #0d1b24;
  animation: rise 1.2s ease-out forwards;
}
@keyframes burst {
  from {
    opacity: 1;
    transform: scale(0.3);
  }
  to {
    opacity: 0;
    transform: scale(2);
  }
}
@keyframes rise {
  from {
    opacity: 1;
    margin-top: 0;
  }
  to {
    opacity: 0;
    margin-top: -40px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .burst .ring {
    animation: none;
    opacity: 0;
  }
  .burst .float {
    animation: fade 1.2s step-end forwards;
  }
  @keyframes fade {
    to {
      opacity: 0;
    }
  }
}
.fallback {
  position: absolute;
  inset: 40% 0 auto;
  text-align: center;
}
.hint {
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  background: #142530;
  font-size: 0.9rem;
  min-height: 1.4em;
}
.complete {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgb(8 19 29 / 78%);
}
.complete h2 {
  color: #ffc85c;
  letter-spacing: 0.1em;
  margin: 0;
}
.again {
  padding: 10px 20px;
  border: 0;
  border-radius: 8px;
  background: #ffcb60;
  color: #142530;
  font-weight: 700;
  cursor: pointer;
}
</style>
