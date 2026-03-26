<script setup lang="ts">
import { useGameStore } from '../store/gameStore'

const store = useGameStore()
</script>

<template>
  <div
    v-if="store.phase !== 'start' && store.events.length"
    class="event-feed"
  >
    <TransitionGroup name="event">
      <div
        v-for="event in store.events.slice(0, 3)"
        :key="event.time"
        class="event-item"
        :class="event.type"
      >
        {{ event.message }}
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.event-feed {
  position: absolute;
  bottom: 12px;
  left: 12px;
  max-height: 80px;
  overflow: hidden;
  z-index: 10;
  pointer-events: none;
}
.event-item {
  font-size: 12px;
  padding: 4px 10px;
  margin-bottom: 2px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(2px);
}
.event-item.info { color: #88ccff; }
.event-item.success { color: #00ff88; }
.event-item.warning { color: #ffaa00; }
.event-item.danger { color: #ff4444; font-weight: bold; }
.event-enter-active { transition: all 0.3s ease; }
.event-leave-active { transition: all 0.3s ease; }
.event-enter-from { opacity: 0; transform: translateY(10px); }
.event-leave-to { opacity: 0; }
</style>
