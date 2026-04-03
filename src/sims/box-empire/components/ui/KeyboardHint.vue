<script setup lang="ts">
import { ref } from 'vue'

const visible = ref(true)
</script>

<template>
  <Transition name="hint-fade">
    <div
      v-if="visible"
      class="keyboard-hint"
    >
      <button
        class="close-btn"
        @click="visible = false"
      >
        ✕
      </button>
      <div class="hint-title">
        CAMERA CONTROLS
      </div>
      <div class="hint-grid">
        <div class="key-row">
          <kbd>W</kbd><kbd>↑</kbd><span class="hint-label">Forward</span>
        </div>
        <div class="key-row">
          <kbd>S</kbd><kbd>↓</kbd><span class="hint-label">Back</span>
        </div>
        <div class="key-row">
          <kbd>A</kbd><kbd>←</kbd><span class="hint-label">Left</span>
        </div>
        <div class="key-row">
          <kbd>D</kbd><kbd>→</kbd><span class="hint-label">Right</span>
        </div>
        <div class="key-row">
          <kbd>=</kbd><span class="hint-label">Zoom in</span>
        </div>
        <div class="key-row">
          <kbd>-</kbd><span class="hint-label">Zoom out</span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.keyboard-hint {
  position: absolute;
  bottom: 18px;
  right: 18px;
  z-index: 20;
  background: rgba(0, 0, 0, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  padding: 10px 14px 12px;
  backdrop-filter: blur(6px);
  min-width: 160px;
  pointer-events: all;
}

.hint-title {
  font-size: 9px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: #888;
  margin-bottom: 8px;
  padding-right: 18px;
}

.close-btn {
  position: absolute;
  top: 7px;
  right: 8px;
  background: none;
  border: none;
  color: #666;
  font-size: 11px;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
  transition: color 0.15s;
}
.close-btn:hover {
  color: #ccc;
}

.hint-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.key-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 5px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-bottom: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  font-size: 11px;
  font-family: inherit;
  color: #ddd;
  line-height: 1;
}

.hint-label {
  font-size: 11px;
  color: #aaa;
  margin-left: 2px;
}

.hint-fade-enter-active,
.hint-fade-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.hint-fade-enter-from,
.hint-fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
