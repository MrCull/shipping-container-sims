<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '../../store/gameStore'

const store = useGameStore()

const stats = computed(() => ({
  totalRevenue: store.money,
  importProcessed: store.containers.filter(c => c.visitType === 'import' && c.lifecycleState === 'departed').length,
  exportLoaded: store.containers.filter(c => c.visitType === 'export' && c.lifecycleState === 'loaded_on_vessel').length,
  timeTaken: Math.floor(store.simTime),
}))

const emit = defineEmits<{
  restart: []
  continueCareer: []
  sandbox: []
}>()
</script>

<template>
  <div class="complete-screen">
    <div class="complete-modal">
      <div class="confetti">
        🎉
      </div>
      <h1 class="complete-title">
        Tutorial Complete!
      </h1>
      <p class="complete-subtitle">
        You've mastered the basics of terminal operations!
      </p>
      <p class="next-level-hint">
        Ready for what comes after the lesson? Continue to the next chapter — your own terminal story.
      </p>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">
            ${{ stats.totalRevenue }}
          </div>
          <div class="stat-label">
            Total Revenue
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-value">
            {{ stats.importProcessed }}
          </div>
          <div class="stat-label">
            Imports Processed
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-value">
            {{ stats.exportLoaded }}
          </div>
          <div class="stat-label">
            Exports Loaded
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-value">
            {{ stats.timeTaken }}s
          </div>
          <div class="stat-label">
            Time Taken
          </div>
        </div>
      </div>

      <div class="star-rating">
        ⭐⭐⭐
      </div>

      <div class="complete-actions">
        <button
          type="button"
          class="next-level-btn"
          @click="emit('continueCareer')"
        >
          Next: Full Game Mode — Build Your First Terminal
        </button>
        <button
          type="button"
          class="sandbox-btn"
          @click="emit('sandbox')"
        >
          Continue in Sandbox Mode
        </button>
        <button
          type="button"
          class="restart-btn"
          @click="emit('restart')"
        >
          🔄 Play tutorial again
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.complete-screen {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.85);
  z-index: 100;
}

.complete-modal {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border: 2px solid #f1c40f;
  border-radius: 16px;
  padding: 40px 48px;
  max-width: 500px;
  text-align: center;
  box-shadow: 0 8px 40px rgba(241, 196, 15, 0.2);
  animation: modal-pop 0.4s ease-out;
}

@keyframes modal-pop {
  0% { transform: scale(0.8); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

.confetti {
  font-size: 4rem;
  margin-bottom: 8px;
}

.complete-title {
  font-family: var(--font-retro, monospace);
  font-size: 1.8rem;
  color: #f1c40f;
  margin: 0 0 8px 0;
  text-shadow: 0 2px 10px rgba(241, 196, 15, 0.3);
}

.complete-subtitle {
  font-family: var(--font-retro, monospace);
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.7);
  margin: 0 0 10px 0;
}

.next-level-hint {
  font-family: var(--font-retro, monospace);
  font-size: 0.78rem;
  color: rgba(255, 255, 255, 0.65);
  margin: 0 0 20px 0;
  line-height: 1.5;
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 20px;
}

.stat-card {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 12px;
}

.stat-value {
  font-family: var(--font-retro, monospace);
  font-size: 1.3rem;
  color: #2ecc71;
  font-weight: bold;
}

.stat-label {
  font-family: var(--font-retro, monospace);
  font-size: 0.65rem;
  color: rgba(255, 255, 255, 0.5);
  text-transform: uppercase;
  margin-top: 4px;
}

.star-rating {
  font-size: 2rem;
  margin-bottom: 20px;
}

.complete-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: stretch;
}

.next-level-btn {
  padding: 12px 24px;
  border: 2px solid #2ecc71;
  border-radius: 8px;
  background: #2ecc71;
  color: #0a1628;
  font-family: var(--font-retro, monospace);
  font-size: 0.88rem;
  font-weight: bold;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.next-level-btn:hover {
  transform: scale(1.02);
  box-shadow: 0 4px 22px rgba(46, 204, 113, 0.45);
}

.sandbox-btn {
  padding: 10px 28px;
  border: 2px solid #3498db;
  border-radius: 8px;
  background: transparent;
  color: #3498db;
  font-family: var(--font-retro, monospace);
  font-size: 0.85rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
}

.sandbox-btn:hover {
  background: rgba(52, 152, 219, 0.15);
  border-color: #5dade2;
  color: #5dade2;
}

.restart-btn {
  padding: 10px 28px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.9);
  font-family: var(--font-retro, monospace);
  font-size: 0.85rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
}

.restart-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.55);
}
</style>
