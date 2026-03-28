<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '../../store/gameStore'

const store = useGameStore()

const showNextButton = computed(() => store.tutorialStep === 1 || (store.tutorialStep >= 5 && store.tutorialStep < store.totalTutorialSteps))

const showAcceptVesselButton = computed(() =>
  store.tutorialStep === 2 &&
  !!store.vesselVisits[0] &&
  store.vesselVisits[0].state === 'announced',
)

const showOpenGatehouseButton = computed(() =>
  store.tutorialStep === 4 &&
  (!store.gatehouse.exportLaneOpen || !store.gatehouse.importLaneOpen),
)

const showCloseButton = computed(() => store.tutorialStep === store.totalTutorialSteps)
</script>

<template>
  <div
    v-if="!store.tutorialCompleted && !store.tutorialOverlayDismissed && store.gamePhase === 'tutorial'"
    class="tutorial-overlay"
  >
    <div class="tutorial-bubble">
      <div class="tutorial-step-indicator">
        Step {{ store.tutorialStep }} of {{ store.totalTutorialSteps }}
      </div>
      <p class="tutorial-text">
        {{ store.currentTutorialPrompt }}
      </p>
      <div class="tutorial-actions">
        <button
          v-if="showNextButton"
          class="tutorial-btn"
          @click="store.advanceTutorialStep()"
        >
          Next →
        </button>
        <button
          v-if="showAcceptVesselButton"
          class="tutorial-btn vessel-btn"
          @click="store.acceptVessel()"
        >
          ⚓ Accept Vessel (5 Import / 5 Export)
        </button>
        <button
          v-if="showOpenGatehouseButton"
          class="tutorial-btn gate-btn"
          @click="store.openGatehouse()"
        >
          🚪 Open Gatehouse
        </button>
        <button
          v-if="showCloseButton"
          class="tutorial-btn"
          @click="store.dismissTutorialOverlay()"
        >
          Close ✕
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tutorial-overlay {
  position: fixed;
  top: 60px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  pointer-events: auto;
}

.tutorial-bubble {
  background: rgba(0, 0, 0, 0.85);
  border: 2px solid var(--color-primary, #f59e0b);
  border-radius: 12px;
  padding: 16px 24px;
  max-width: 480px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
}

.tutorial-bubble::after {
  content: '';
  position: absolute;
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-bottom: 8px solid var(--color-primary, #f59e0b);
}

.tutorial-step-indicator {
  font-family: var(--font-retro, monospace);
  font-size: 0.65rem;
  color: var(--color-primary, #f59e0b);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 6px;
}

.tutorial-text {
  font-family: var(--font-retro, monospace);
  font-size: 0.85rem;
  color: #fff;
  line-height: 1.5;
  margin: 0 0 12px 0;
}

.tutorial-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.tutorial-btn {
  padding: 6px 16px;
  border: 1px solid var(--color-primary, #f59e0b);
  border-radius: 6px;
  background: var(--color-primary, #f59e0b);
  color: #000;
  font-family: var(--font-retro, monospace);
  font-size: 0.8rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
}

.tutorial-btn:hover {
  transform: scale(1.05);
  box-shadow: 0 2px 10px rgba(245, 158, 11, 0.5);
}

.vessel-btn {
  background: #3498db;
  border-color: #3498db;
  color: #fff;
}

.vessel-btn:hover {
  box-shadow: 0 2px 10px rgba(52, 152, 219, 0.5);
}

.gate-btn {
  background: #2ecc71;
  border-color: #2ecc71;
}

.gate-btn:hover {
  box-shadow: 0 2px 10px rgba(46, 204, 113, 0.5);
}
</style>
