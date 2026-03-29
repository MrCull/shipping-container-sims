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
  const m = Math.floor(level.timerSeconds / 60)
  const s = level.timerSeconds % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

const megaCarrierStubs = [
  {
    level: 7,
    description: 'Load 120 containers across 24 bays while managing strict weight limits.',
    slots: '384 slots',
    timer: '15m',
  },
  {
    level: 8,
    description: 'Discharge 80 imports buried under transit cargo across a fully laden vessel.',
    slots: '384 slots',
    timer: '20m',
  },
  {
    level: 9,
    description: 'Maximum chaos — full discharge, restow, and reload of a mega carrier under time pressure.',
    slots: '384 slots',
    timer: '25m',
  },
]

const vesselGroups = [
  {
    label: 'Tiny Vessel',
    icon: '🛥️',
    levels: LEVELS.slice(0, 3),
    comingSoon: false,
  },
  {
    label: 'Feeder Vessel',
    icon: '🚢',
    levels: LEVELS.slice(3, 6),
    comingSoon: false,
  },
  {
    label: 'Mega Carrier',
    icon: '🛳️',
    levels: [],
    comingSoon: true,
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
          :class="{ 'coming-soon-column': group.comingSoon }"
        >
          <div class="column-header">
            <span class="column-icon">{{ group.icon }}</span>
            <span class="column-label">{{ group.label }}</span>
          </div>

          <template v-if="!group.comingSoon">
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
                <span class="level-slots">{{ getTotalSlots(level.preset) }} slots</span>
                <span
                  v-if="level.timerSeconds"
                  class="level-timer"
                >⏱ {{ formatTimer(level) }}</span>
              </div>
            </button>
          </template>

          <template v-else>
            <div
              v-for="stub in megaCarrierStubs"
              :key="stub.level"
              class="level-btn level-btn--disabled"
            >
              <div class="level-name coming-soon-name">
                Level {{ stub.level }}
              </div>
              <div class="level-desc coming-soon-desc">
                {{ stub.description }}
              </div>
              <div class="level-meta">
                <span class="level-slots coming-soon-meta">{{ stub.slots }} slots</span>
                <span class="level-timer coming-soon-meta">⏱ {{ stub.timer }}</span>
              </div>
            </div>
          </template>
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
  width: min(960px, 96vw);
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
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
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

.coming-soon-column .column-header {
  border-bottom-color: rgba(255, 255, 255, 0.1);
}

.coming-soon-column .column-label {
  color: #888;
}

.level-btn {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  padding: 14px 16px;
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

.level-btn--disabled {
  cursor: not-allowed;
  opacity: 0.6;
  pointer-events: none;
}

.level-name {
  font-size: 14px;
  font-weight: bold;
  color: #ffcc00;
  margin-bottom: 4px;
}

.coming-soon-name {
  color: #999;
}

.level-desc {
  font-size: 11px;
  color: #aaa;
  line-height: 1.4;
}

.level-meta {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}

.level-slots {
  font-size: 10px;
  color: #666;
}

.level-timer {
  font-size: 10px;
  color: #ffaa00;
}

.coming-soon-desc {
  color: #777;
}

.coming-soon-meta {
  color: #666;
}
</style>
