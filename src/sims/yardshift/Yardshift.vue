<script setup lang="ts">
/**
 * Yardshift root: a Vue HUD around a Three.js yard. Pointer events are forwarded to the store's `tapAt` (which runs
 * the presentation `input`); nothing here interprets them.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import YardHud from './components/ui/YardHud.vue'
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
