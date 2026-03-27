<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useContainerStackStore } from '../../store/gameStore'

const store = useContainerStackStore()
const { phase } = storeToRefs(store)

const text = computed(() => {
  switch (phase.value) {
    case 'playing':
      return 'Mouse: click a block, drag away to slide it out. Camera: WASD or arrow keys orbit, + / − zoom. Complete the top row before lower layers; unsupported overhangs collapse the stack.'
    case 'removing':
      return 'Keep dragging smoothly — shaky moves rock the stack. Release when the block is far enough out.'
    case 'placing':
      return 'Click a green slot on the tower top to place the container. Smooth pulls are safer — shaky drags wobble the stack, and a rickety tower can fall before you finish the pull.'
    case 'collapsing':
      return '…'
    default:
      return ''
  }
})
</script>

<template>
  <div
    v-if="text && phase !== 'start' && phase !== 'gameOver' && phase !== 'paused'"
    class="instructions"
  >
    {{ text }}
  </div>
</template>

<style scoped>
.instructions {
  max-width: min(420px, 92vw);
  padding: 0.55rem 0.85rem;
  font-size: 0.78rem;
  line-height: 1.35;
  color: #d1d5db;
  background: rgba(13, 17, 23, 0.75);
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  pointer-events: none;
}
</style>
