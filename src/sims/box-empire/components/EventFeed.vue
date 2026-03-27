<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '../store/gameStore'

const store = useGameStore()
const recentEvents = computed(() => store.events.slice(0, 5))

function getEventColor(type: string): string {
  if (type.includes('money')) return '#2ecc71'
  if (type.includes('container')) return '#3498db'
  if (type.includes('vessel')) return '#9b59b6'
  if (type.includes('truck')) return '#e67e22'
  if (type.includes('tutorial')) return '#f1c40f'
  if (type.includes('job')) return '#95a5a6'
  return '#ecf0f1'
}
</script>

<template>
  <div class="event-feed">
    <div class="event-feed-title">
      Events
    </div>
    <TransitionGroup
      name="event"
      tag="div"
      class="event-list"
    >
      <div
        v-for="evt in recentEvents"
        :key="evt.id"
        class="event-item"
        :style="{ borderLeftColor: getEventColor(evt.type) }"
      >
        <span class="event-time">{{ Math.floor(evt.simTime) }}s</span>
        <span class="event-msg">{{ evt.message }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.event-feed {
  position: absolute;
  bottom: 12px;
  left: 12px;
  width: 320px;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 8px;
  padding: 8px;
  pointer-events: auto;
  z-index: 10;
}

.event-feed-title {
  font-family: var(--font-retro, monospace);
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 4px;
  text-transform: uppercase;
}

.event-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.event-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 3px 6px;
  border-left: 3px solid #ecf0f1;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 2px;
}

.event-time {
  font-family: var(--font-retro, monospace);
  font-size: 0.65rem;
  color: rgba(255, 255, 255, 0.5);
  min-width: 32px;
}

.event-msg {
  font-family: var(--font-retro, monospace);
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.85);
  line-height: 1.3;
}

.event-enter-active { transition: all 0.3s ease; }
.event-leave-active { transition: all 0.2s ease; }
.event-enter-from { opacity: 0; transform: translateX(-10px); }
.event-leave-to { opacity: 0; }
</style>
