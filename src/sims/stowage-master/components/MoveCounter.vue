<script setup lang="ts">
import { useGameStore } from '../store/gameStore'

const store = useGameStore()
</script>

<template>
  <div
    v-if="store.phase !== 'start'"
    class="move-counter"
  >
    <span class="count">{{ store.moveCount }}</span>
    <span class="separator">/</span>
    <span class="total">{{ store.containers.length }}</span>
    <span class="label">containers</span>
  </div>
</template>

<style scoped>
.move-counter {
  position: absolute;
  top: 44px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: baseline;
  gap: 4px;
  padding: 6px 20px;
  background: rgba(0, 0, 0, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 20px;
  z-index: 10;
  pointer-events: none;
  backdrop-filter: blur(4px);
  white-space: nowrap;
}
.count {
  font-size: 22px;
  font-weight: bold;
  color: #00ff88;
}
.separator {
  font-size: 18px;
  color: #888;
}
.total {
  font-size: 22px;
  font-weight: bold;
  color: #fff;
}
.label {
  font-size: 12px;
  color: #aaa;
  margin-left: 4px;
  text-transform: uppercase;
  letter-spacing: 1px;
}
</style>
