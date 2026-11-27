<script setup lang="ts">
/**
 * Yardshift root: a Vue HUD around a Three.js yard. Pointer and key events are forwarded to the store (which runs
 * the presentation `input`); nothing here interprets them beyond the drag threshold.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import YardHud from './components/ui/YardHud.vue'
import YardQueue from './components/ui/YardQueue.vue'
import YardScreens from './components/modals/YardScreens.vue'
import { LEVELS } from './modules/levels'
import { unlockAllRequested } from './modules/progress'
import { undoView } from './modules/screens'
import { useYardAudio } from './composables/useYardAudio'
import { useYardScene } from './composables/useYardScene'
import { useYardshiftStore } from './store/yardshiftStore'
import type { Rect } from './types/presentation'

function rectStyle(r: Rect): Record<string, string> {
  return { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }
}

const devApiEnabled = import.meta.env.DEV || import.meta.env.MODE === 'smoke'

const store = useYardshiftStore()
store.setUnlockAll(unlockAllRequested(window.location.search, import.meta.env.DEV, import.meta.env.MODE))
// Open on the intro of the highest unlocked level.
store.loadLevel(Math.min(LEVELS.length, store.progress.unlocked), { intro: true })
const undo = computed(() => undoView(store.state))

const surface = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const view = computed(() => store.view)
const move = computed(() => store.move)
const { webglFailed } = useYardScene(canvas, view, move)
useYardAudio(store.onCue)

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

/** Play-surface coordinates (CSS px) of a pointer event, or null before layout. */
function local(e: PointerEvent): { x: number; y: number } | null {
  const box = surface.value?.getBoundingClientRect()
  return box ? { x: e.clientX - box.left, y: e.clientY - box.top } : null
}

function onPointerDown(e: PointerEvent): void {
  const p = local(e)
  if (!p) return
  surface.value?.setPointerCapture?.(e.pointerId)
  store.pointerDown(p.x, p.y)
}

function onPointerMove(e: PointerEvent): void {
  const p = local(e)
  if (p) store.pointerMove(p.x, p.y)
}

function onPointerUp(e: PointerEvent): void {
  const p = local(e)
  if (p) store.pointerUp(p.x, p.y)
}

const GAME_KEYS = /^([1-9]|[cruCRU]|Escape|Esc)$/

/** Keys go to the presentation `input` as they are; only game keys are claimed from the page. */
function onKey(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey || !GAME_KEYS.test(e.key)) return
  const el = e.target as HTMLElement | null
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
  e.preventDefault()
  store.key(e.key)
}

onMounted(async () => {
  store.setReducedMotion(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  store.setHidden(document.hidden)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('keydown', onKey)
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
  window.removeEventListener('keydown', onKey)
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
      class="incoming"
      :class="view.incoming.status"
      data-testid="ys-incoming"
      :data-status="view.incoming.status"
    >
      {{ view.incoming.text }}
    </div>
    <div
      ref="surface"
      class="surface"
      data-testid="ys-surface"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="store.pointerCancel()"
    >
      <canvas
        ref="canvas"
        class="canvas"
      />
      <div
        v-if="view.dimYard"
        class="dim"
        data-testid="ys-dim"
        :style="rectStyle(view.layout.yard)"
      />
      <span
        v-for="region in view.hitRegions.filter((r) => r.kind !== 'stack')"
        :key="region.kind"
        class="bay-label"
        :style="{ left: `${region.rect.x}px`, top: `${region.rect.y}px`, width: `${region.rect.w}px` }"
      >
        {{ region.kind === 'collection' ? '▼ COLLECTION' : '▲ RECEIPT' }}
        <small
          v-if="region.kind === 'receipt'"
          class="bay-status"
          :class="view.incoming.status"
          data-testid="ys-receipt-status"
        >{{ view.incoming.bay }}</small>
      </span>
      <div
        v-if="view.arrow === 'receipt'"
        class="arrow"
        data-testid="ys-arrow"
        :style="{ left: `${view.layout.receipt.x + view.layout.receipt.w / 2}px`, top: `${view.layout.receipt.y}px` }"
      >
        ▼
      </div>
      <p
        v-if="store.announcement"
        class="announce"
        data-testid="ys-announce"
      >
        {{ store.announcement }}
      </p>
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
    <nav
      class="controls"
      aria-label="Shift controls"
    >
      <button
        type="button"
        data-testid="ys-pause"
        @click="store.pause()"
      >
        Pause
      </button>
      <button
        type="button"
        data-testid="ys-undo"
        :disabled="!undo.enabled"
        :title="undo.reason || 'Undo the last move: −25 pts, −3s'"
        @click="store.undo()"
      >
        {{ undo.label }}
      </button>
      <small
        v-if="!undo.enabled && store.state.status === 'playing' && store.state.shiftMs <= 3000"
        class="undo-reason"
        data-testid="ys-undo-reason"
      >{{ undo.reason }}</small>
      <button
        type="button"
        class="restart"
        data-testid="ys-restart"
        @click="store.restart()"
      >
        Restart
      </button>
    </nav>
    <YardScreens />
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
.incoming {
  /* Reserved space: the band keeps its height with or without a truck, so the layout never jumps on arrival. */
  height: 26px;
  line-height: 26px;
  padding: 0 16px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  background: #26443e;
  white-space: nowrap;
  overflow: hidden;
}
.incoming.optional {
  background: #72451d;
}
.incoming.mandatory {
  background: #a83229;
}
.dim {
  position: absolute;
  pointer-events: none;
  background: rgb(8 19 29 / 45%);
}
.arrow {
  position: absolute;
  pointer-events: none;
  transform: translate(-50%, -100%);
  color: #e9483d;
  font-size: 1.8rem;
  line-height: 1;
  text-shadow: 0 2px 4px rgb(0 0 0 / 50%);
  animation: bob 0.7s ease-in-out infinite alternate;
}
@keyframes bob {
  from {
    margin-top: -7px;
  }
  to {
    margin-top: 7px;
  }
}
.announce {
  position: absolute;
  left: 50%;
  top: 8px;
  transform: translateX(-50%);
  margin: 0;
  padding: 6px 12px;
  border-radius: 6px;
  background: #72451d;
  font-size: 0.85rem;
  white-space: nowrap;
  pointer-events: none;
}
.bay-status {
  display: block;
  font-size: 0.65rem;
  opacity: 0.9;
}
.bay-status.mandatory {
  color: #ff8776;
  font-weight: 700;
}
@media (prefers-reduced-motion: reduce) {
  .arrow {
    animation: none;
  }
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
  padding: 10px 16px;
  background: #142530;
  font-size: 0.9rem;
  min-height: 1.4em;
}
.controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px calc(6px + env(safe-area-inset-bottom));
  background: #142530;
}
.controls button {
  padding: 6px 12px;
  border: 1px solid #3c5363;
  border-radius: 6px;
  background: #1d3442;
  color: #e7eef2;
  font-weight: 700;
  cursor: pointer;
}
.controls button:disabled {
  opacity: 0.45;
  cursor: default;
}
.controls .restart {
  margin-left: auto;
}
.undo-reason {
  font-size: 0.7rem;
  color: #ff8776;
}
</style>
