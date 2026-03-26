<script setup lang="ts">
import { useGameStore } from '../store/gameStore'

const store = useGameStore()
</script>

<template>
  <div
    v-if="store.phase !== 'start'"
    class="move-counter"
  >
    {{ store.moveCount }} / {{ store.containers.length }} containers
  </div>
</template>

<style scoped>
.move-counter {
  position: absolute;
  bottom: 12px;
  right: 12px;
  font-size: 13px;
  padding: 6px 14px;
  background: rgba(0, 0, 0, 0.7);
  border-radius: 4px;
  z-index: 10;
  pointer-events: none;
  color: #aaa;
}
</style>
