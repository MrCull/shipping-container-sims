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
      <p class="coming-soon">
        🚢 The full game is coming soon — with more vessels, equipment, and real-time economics!
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

      <button
        class="restart-btn"
        @click="emit('restart')"
      >
        🔄 Play Again
      </button>
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

.coming-soon {
  font-family: var(--font-retro, monospace);
  font-size: 0.78rem;
  color: #f1c40f;
  margin: 0 0 20px 0;
  background: rgba(241, 196, 15, 0.08);
  border: 1px solid rgba(241, 196, 15, 0.25);
  border-radius: 8px;
  padding: 8px 14px;
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

.restart-btn {
  padding: 10px 28px;
  border: 2px solid var(--color-primary, #f59e0b);
  border-radius: 8px;
  background: var(--color-primary, #f59e0b);
  color: #000;
  font-family: var(--font-retro, monospace);
  font-size: 0.9rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
}

.restart-btn:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 20px rgba(245, 158, 11, 0.5);
}
</style>
