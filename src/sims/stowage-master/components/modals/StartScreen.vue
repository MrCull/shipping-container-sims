<script setup lang="ts">
import { useGameStore } from '../../store/gameStore'
import { LEVELS, getTotalSlots } from '../../modules/levels'
import type { ShipPreset, LevelConfig } from '../../types'

const store = useGameStore()
const levels = LEVELS

function startLevel(level: number) {
  store.startLevel(level)
}

function getSlots(preset: ShipPreset): number {
  return getTotalSlots(preset)
}

function formatTimer(level: LevelConfig): string {
  if (!level.timerSeconds) return ''
  const m = Math.floor(level.timerSeconds / 60)
  const s = level.timerSeconds % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}
</script>

<template>
  <div
    v-if="store.phase === 'start'"
    class="modal-overlay"
  >
    <div class="modal-content start-screen">
      <h1 class="game-title">
        STOWAGE MASTER
      </h1>
      <p class="subtitle">
        Container Ship Loading Puzzle
      </p>
      <div class="level-select">
        <button
          v-for="(level, i) in levels"
          :key="i"
          class="level-btn"
          @click="startLevel(i)"
        >
          <div class="level-name">
            {{ level.name }}
          </div>
          <div class="level-desc">
            {{ level.description }}
          </div>
          <div class="level-meta">
            <span class="level-slots">{{ getSlots(level.preset) }} slots</span>
            <span
              v-if="level.timerSeconds"
              class="level-timer"
            >⏱ {{ formatTimer(level) }}</span>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.85);
  z-index: 100;
}
.modal-content {
  text-align: center;
  max-width: 500px;
  padding: 40px;
}
.game-title {
  font-size: 48px;
  font-weight: bold;
  color: #ffcc00;
  letter-spacing: 4px;
  margin-bottom: 8px;
  text-shadow: 0 0 20px rgba(255, 204, 0, 0.3);
}
.subtitle {
  font-size: 16px;
  color: #888;
  margin-bottom: 40px;
}
.level-select {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.level-btn {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  padding: 16px 20px;
  cursor: pointer;
  text-align: left;
  color: #eee;
  transition: all 0.2s;
}
.level-btn:hover {
  background: rgba(255, 204, 0, 0.1);
  border-color: #ffcc00;
  transform: translateX(4px);
}
.level-name {
  font-size: 16px;
  font-weight: bold;
  color: #ffcc00;
  margin-bottom: 4px;
}
.level-desc {
  font-size: 12px;
  color: #aaa;
}
.level-meta {
  display: flex;
  gap: 12px;
  margin-top: 4px;
}
.level-slots {
  font-size: 11px;
  color: #666;
}
.level-timer {
  font-size: 11px;
  color: #ffaa00;
}
</style>
