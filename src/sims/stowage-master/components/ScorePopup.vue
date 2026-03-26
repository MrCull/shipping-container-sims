<script setup lang="ts">
import { ref, watch } from 'vue'
import { useGameStore } from '../store/gameStore'
import type { PlacementReason } from '../types'

const store = useGameStore()
const visible = ref(false)
const lastScore = ref(0)
const lastReasons = ref<PlacementReason[]>([])
const popupClass = ref('')
let hideTimer: ReturnType<typeof setTimeout> | null = null

watch(() => store.lastPlacement, (placement) => {
  if (!placement) return
  lastScore.value = placement.score
  lastReasons.value = placement.reasons.slice(0, 3)
  popupClass.value = placement.score >= 80 ? 'great' : placement.score >= 50 ? 'ok' : 'poor'
  visible.value = true

  if (hideTimer !== null) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => { visible.value = false }, 2500)
})
</script>

<template>
  <Transition name="fade">
    <div
      v-if="visible"
      class="score-popup"
      :class="popupClass"
    >
      <div class="popup-score">
        +{{ lastScore }}
      </div>
      <div
        v-for="(reason, i) in lastReasons"
        :key="i"
        class="popup-reason"
        :class="{ good: reason.good }"
      >
        {{ reason.text }}
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.score-popup {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  z-index: 20;
  pointer-events: none;
}
.popup-score {
  font-size: 48px;
  font-weight: bold;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8);
}
.great .popup-score { color: #00ff88; }
.ok .popup-score { color: #ffaa00; }
.poor .popup-score { color: #ff4444; }
.popup-reason {
  font-size: 14px;
  color: #ffaa00;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
}
.popup-reason.good { color: #00ff88; }
.fade-enter-active { transition: opacity 0.3s ease; }
.fade-leave-active { transition: opacity 0.8s ease; }
.fade-enter-from,
.fade-leave-to { opacity: 0; }
</style>
