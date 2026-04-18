<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{
  done: []
}>()

const step = ref(1)

function next(): void {
  if (step.value < 2) {
    step.value++
  } else {
    emit('done')
  }
}
</script>

<template>
  <div
    class="onboard-overlay"
    @click.self="next"
  >
    <div class="onboard-dialog">
      <template v-if="step === 1">
        <div class="onboard-icon">
          🖱️
        </div>
        <h3 class="onboard-title">
          Click to Control Equipment
        </h3>
        <p class="onboard-body">
          Click on any piece of equipment — a Reach Stacker, Mobile Harbor Crane, or Gatehouse — to open its settings panel.
          From there you can enable or disable it, change which side it serves, and set vessel permissions for cranes.
        </p>
      </template>

      <template v-else>
        <div class="onboard-icon">
          🏗️
        </div>
        <h3 class="onboard-title">
          Spawn New Equipment
        </h3>
        <p class="onboard-body">
          Use the buttons in the top-right bar to add more equipment to your terminal:
        </p>
        <ul class="onboard-list">
          <li>
            <span class="onboard-badge rs">RS</span> Add a Reach Stacker to the yard
          </li>
          <li>
            <span class="onboard-badge mhc">MHC</span> Add a Mobile Harbor Crane to the berth
          </li>
          <li>
            <span class="onboard-badge vessel">⛴</span> Spawn an incoming vessel
          </li>
        </ul>
        <p class="onboard-hint">
          There are no objectives — experiment freely!
        </p>
      </template>

      <button
        class="onboard-btn"
        @click="next"
      >
        {{ step === 1 ? 'Next →' : 'Got it — Start!' }}
      </button>
      <div class="onboard-dots">
        <span :class="['dot', { active: step === 1 }]" />
        <span :class="['dot', { active: step === 2 }]" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.onboard-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.75);
  z-index: 150;
}

.onboard-dialog {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border: 2px solid #3498db;
  border-radius: 14px;
  padding: 32px 36px;
  max-width: 400px;
  width: 90%;
  text-align: center;
  animation: pop-in 0.3s ease-out;
}

@keyframes pop-in {
  0% { transform: scale(0.88); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

.onboard-icon {
  font-size: 2.6rem;
  margin-bottom: 10px;
}

.onboard-title {
  font-family: var(--font-retro, monospace);
  font-size: 1rem;
  color: #5dade2;
  margin: 0 0 12px 0;
}

.onboard-body {
  font-family: var(--font-retro, monospace);
  font-size: 0.76rem;
  color: rgba(255, 255, 255, 0.75);
  line-height: 1.65;
  margin: 0 0 16px 0;
  text-align: left;
}

.onboard-list {
  list-style: none;
  padding: 0;
  margin: 0 0 14px 0;
  text-align: left;
}

.onboard-list li {
  font-family: var(--font-retro, monospace);
  font-size: 0.74rem;
  color: rgba(255, 255, 255, 0.7);
  padding: 4px 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.onboard-badge {
  display: inline-block;
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 0.68rem;
  font-weight: bold;
  font-family: var(--font-retro, monospace);
  flex-shrink: 0;
}

.onboard-badge.rs {
  background: rgba(52, 152, 219, 0.25);
  border: 1px solid #3498db;
  color: #5dade2;
}

.onboard-badge.mhc {
  background: rgba(46, 204, 113, 0.2);
  border: 1px solid #2ecc71;
  color: #2ecc71;
}

.onboard-badge.vessel {
  background: rgba(241, 196, 15, 0.2);
  border: 1px solid #f1c40f;
  color: #f1c40f;
}

.onboard-hint {
  font-family: var(--font-retro, monospace);
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.45);
  margin: 0 0 18px 0;
  font-style: italic;
}

.onboard-btn {
  padding: 9px 28px;
  border: 2px solid #3498db;
  border-radius: 8px;
  background: #3498db;
  color: #0a1628;
  font-family: var(--font-retro, monospace);
  font-size: 0.85rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.15s;
  margin-bottom: 14px;
}

.onboard-btn:hover {
  background: #5dade2;
  border-color: #5dade2;
}

.onboard-dots {
  display: flex;
  justify-content: center;
  gap: 6px;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  transition: background 0.2s;
}

.dot.active {
  background: #3498db;
}
</style>
