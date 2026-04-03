<script setup lang="ts">
import { useGameStore } from '../../store/gameStore'
import { LEVELS, getTotalSlots } from '../../modules/levels'
import type { LevelConfig } from '../../types'

const store = useGameStore()

function startLevel(level: number) {
  store.startLevel(level)
}

function formatTimer(level: LevelConfig): string {
  if (!level.timerSeconds) return ''
  const mins = Math.ceil(level.timerSeconds / 60)
  return mins === 1 ? '1min' : `${mins}mins`
}

function loadCount(level: LevelConfig): number {
  return level.containerCount ?? 0
}

function dischargeCount(level: LevelConfig): number {
  return level.dischargeContainerCount ?? 0
}

function onboardCount(level: LevelConfig): number {
  return level.transitContainerCount ?? 0
}

const vesselGroups = [
  {
    label: 'Tiny Vessel',
    icon: '🛥️',
    levels: LEVELS.slice(0, 5),
  },
  {
    label: 'Medium Vessel',
    icon: '🚢',
    levels: LEVELS.slice(5, 10),
  },
]
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

      <div class="vessel-columns">
        <div
          v-for="group in vesselGroups"
          :key="group.label"
          class="vessel-column"
        >
          <div class="column-header">
            <span class="column-icon">{{ group.icon }}</span>
            <span class="column-label">{{ group.label }}</span>
          </div>

          <button
            v-for="level in group.levels"
            :key="level.id"
            class="level-btn"
            @click="startLevel(level.id)"
          >
            <div class="level-name">
              {{ level.name }}
            </div>
            <div class="level-desc">
              {{ level.description }}
            </div>
            <div class="level-meta">
              <span class="meta-item meta-item--slots">{{ getTotalSlots(level.preset) }} slots</span>
              <span class="meta-sep">•</span>
              <span class="meta-item">
                <span class="meta-label">Load</span>
                <span class="meta-value meta-value--load">{{ loadCount(level) }}</span>
              </span>
              <span class="meta-item">
                <span class="meta-label">Disch</span>
                <span class="meta-value meta-value--discharge">{{ dischargeCount(level) }}</span>
              </span>
              <span class="meta-item">
                <span class="meta-label">On board</span>
                <span class="meta-value meta-value--onboard">{{ onboardCount(level) }}</span>
              </span>
              <span class="meta-sep">•</span>
              <span
                v-if="level.timerSeconds"
                class="meta-item meta-item--timer"
              >{{ formatTimer(level) }}</span>
            </div>
          </button>
        </div>
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
  background: rgba(0, 0, 0, 0.88);
  z-index: 100;
}

.modal-content {
  text-align: center;
  width: min(1040px, 96vw);
  padding: 36px 32px;
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
  margin-bottom: 36px;
}

.vessel-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
  align-items: start;
}

.vessel-column {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.column-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 0 12px;
  border-bottom: 1px solid rgba(255, 204, 0, 0.25);
  margin-bottom: 4px;
}

.column-icon {
  font-size: 22px;
}

.column-label {
  font-size: 14px;
  font-weight: bold;
  color: #ffcc00;
  letter-spacing: 1.5px;
  text-transform: uppercase;
}

.level-btn {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  padding: 13px 15px 12px;
  cursor: pointer;
  text-align: left;
  color: #eee;
  transition: all 0.2s;
  width: 100%;
}

.level-btn:hover {
  background: rgba(255, 204, 0, 0.1);
  border-color: #ffcc00;
  transform: translateX(3px);
}

.level-name {
  font-size: 14px;
  font-weight: bold;
  color: #ffcc00;
  margin-bottom: 5px;
}

.level-desc {
  font-size: 11px;
  color: #aaa;
  line-height: 1.35;
  min-height: 30px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.level-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.meta-item {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  letter-spacing: 0.15px;
  color: #8f96a3;
}

.meta-item--slots {
  color: #7f8793;
}

.meta-label {
  color: #7f8793;
  margin-right: 4px;
}

.meta-value {
  font-weight: bold;
}

.meta-value--load {
  color: #00ff88;
}

.meta-value--discharge {
  color: #ffd166;
}

.meta-value--onboard {
  color: #5cc8ff;
}

.meta-item--timer {
  color: #ffaa00;
  font-weight: bold;
}

.meta-sep {
  color: rgba(255, 255, 255, 0.18);
  font-size: 9px;
}

@media (max-width: 800px) {
  .vessel-columns {
    grid-template-columns: 1fr;
  }
}
</style>
