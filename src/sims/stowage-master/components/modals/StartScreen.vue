<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useGameStore } from '../../store/gameStore'
import { LEVELS, getTotalSlots } from '../../modules/levels'
import type { LevelBestRecord, LevelConfig } from '../../types'

const store = useGameStore()
let godBuffer = ''

interface MenuLevel {
  id: number
  name: string
  description: string
  preset: LevelConfig['preset']
  timerSeconds: number
  containerCount?: number
  dischargeContainerCount?: number
  transitContainerCount?: number
  hazmatRate: number
  comingSoon?: boolean
}

function startLevel(level: MenuLevel) {
  if (level.comingSoon || !store.isLevelUnlocked(level.id)) return
  store.startLevel(level.id)
}

function formatTimer(level: MenuLevel): string {
  if (!level.timerSeconds) return ''
  const mins = Math.ceil(level.timerSeconds / 60)
  return mins === 1 ? '1min' : `${mins}mins`
}

function loadCount(level: MenuLevel): number {
  return level.containerCount ?? 0
}

function dischargeCount(level: MenuLevel): number {
  return level.dischargeContainerCount ?? 0
}

function onboardCount(level: MenuLevel): number {
  return level.transitContainerCount ?? 0
}

function hasHazmat(level: MenuLevel): boolean {
  return level.hazmatRate > 0
}

function getBest(levelId: number): LevelBestRecord | null {
  return store.getLevelBest(levelId)
}

function formatBestTime(seconds: number | null): string {
  if (seconds == null) return '--'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return mins > 0 ? `${mins}m ${secs.toString().padStart(2, '0')}s` : `${secs}s`
}

function isLocked(level: MenuLevel): boolean {
  return !!level.comingSoon || !store.isLevelUnlocked(level.id)
}

function lockLabel(level: MenuLevel): string {
  return level.comingSoon ? 'Coming Soon' : 'Locked'
}

function lockTooltip(level: MenuLevel): string {
  return level.comingSoon
    ? 'This vessel tier is coming soon.'
    : 'You must complete the previous level first.'
}

function handleKeydown(event: KeyboardEvent): void {
  if (store.phase !== 'start') return
  if (event.ctrlKey || event.metaKey || event.altKey) return

  const key = event.key.toLowerCase()
  if (!/^[a-z]$/.test(key)) {
    godBuffer = ''
    return
  }

  godBuffer = (godBuffer + key).slice(-3)
  if (godBuffer === 'god') {
    store.toggleGodMode()
    godBuffer = ''
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})

const megaLevels: MenuLevel[] = Array.from({ length: 5 }, (_, index) => ({
  id: 10 + index,
  name: `Level ${11 + index}`,
  description: 'Large-vessel operations coming soon.',
  preset: LEVELS[LEVELS.length - 1].preset,
  timerSeconds: 0,
  containerCount: 0,
  dischargeContainerCount: 0,
  transitContainerCount: 0,
  hazmatRate: 0,
  comingSoon: true,
}))

const vesselMenuGroups: Array<{ label: string; icon: string; levels: MenuLevel[] }> = [
  {
    label: 'Tiny Vessel',
    icon: '🚢',
    levels: LEVELS.slice(0, 5),
  },
  {
    label: 'Medium Feeder Vessel',
    icon: '🚢',
    levels: LEVELS.slice(5, 10),
  },
  {
    label: 'Mega Vessel',
    icon: '🛳️',
    levels: megaLevels,
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
      <p
        v-if="store.isGodMode"
        class="god-mode-note"
      >
        God mode enabled
      </p>

      <div class="vessel-columns">
        <div
          v-for="group in vesselMenuGroups"
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
            :class="{ 'level-btn--locked': isLocked(level), 'level-btn--coming-soon': level.comingSoon }"
            :aria-disabled="isLocked(level)"
            @click="startLevel(level)"
          >
            <div
              v-if="getBest(level.id) && !level.comingSoon"
              class="level-best"
            >
              <span class="best-label">Best</span>
              <span class="best-score">${{ getBest(level.id)?.bestScore.toLocaleString() }}</span>
              <span class="best-sep">•</span>
              <span class="best-time">{{ formatBestTime(getBest(level.id)?.bestTimeSeconds ?? null) }}</span>
            </div>
            <div
              v-if="isLocked(level)"
              class="level-lock"
            >
              {{ lockLabel(level) }}
            </div>
            <div
              v-if="isLocked(level)"
              class="level-tooltip"
            >
              {{ lockTooltip(level) }}
            </div>
            <div class="level-name">
              {{ level.name }}
            </div>
            <div class="level-desc">
              {{ level.description }}
            </div>
            <div class="level-meta">
              <span
                v-if="level.timerSeconds"
                class="meta-item meta-item--timer"
              >{{ formatTimer(level) }}</span>
              <span class="meta-sep">|</span>
              <span class="meta-item meta-item--slots">{{ getTotalSlots(level.preset) }} slots</span>
              <span class="meta-sep">|</span>
              <span class="meta-item">
                <span class="meta-label">Load</span>
                <span class="meta-value meta-value--load">{{ loadCount(level) }}</span>
              </span>
              <span class="meta-sep">|</span>
              <span class="meta-item">
                <span class="meta-label">Disch</span>
                <span class="meta-value meta-value--discharge">{{ dischargeCount(level) }}</span>
              </span>
              <span
                v-if="onboardCount(level) > 0"
                class="meta-sep"
              >|</span>
              <span
                v-if="onboardCount(level) > 0"
                class="meta-item"
              >
                <span class="meta-label">On board</span>
                <span class="meta-value meta-value--onboard">{{ onboardCount(level) }}</span>
              </span>
              <span
                v-if="hasHazmat(level)"
                class="meta-sep"
              >|</span>
              <span
                v-if="hasHazmat(level)"
                class="meta-item meta-item--hazmat"
                title="Hazardous containers appear in this level"
              >☢ Haz</span>
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
  width: min(1260px, 98vw);
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
  margin-bottom: 10px;
}

.god-mode-note {
  font-size: 12px;
  color: #ffcc00;
  letter-spacing: 1px;
  text-transform: uppercase;
  margin-bottom: 22px;
}

.vessel-columns {
  display: grid;
  grid-template-columns: repeat(3, minmax(320px, 1fr));
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

.level-btn {
  position: relative;
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

.level-btn--locked {
  opacity: 0.5;
  cursor: not-allowed;
}

.level-btn--locked:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.22);
  transform: none;
}

.level-btn--coming-soon {
  background: rgba(255, 255, 255, 0.035);
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

.level-best {
  position: absolute;
  top: 13px;
  right: 15px;
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 10px;
  color: #8f96a3;
}

.level-lock {
  position: absolute;
  top: 13px;
  right: 15px;
  font-size: 10px;
  color: #b9c1ce;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.level-tooltip {
  position: absolute;
  top: -34px;
  right: 0;
  max-width: 230px;
  padding: 6px 9px;
  border-radius: 6px;
  background: rgba(12, 16, 24, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: #d6dde7;
  font-size: 10px;
  line-height: 1.3;
  opacity: 0;
  pointer-events: none;
  transform: translateY(4px);
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.level-btn--locked:hover .level-tooltip {
  opacity: 1;
  transform: translateY(0);
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

.meta-item--hazmat {
  color: #ff6a3d;
  font-weight: bold;
}

.meta-sep {
  color: rgba(255, 255, 255, 0.18);
  font-size: 9px;
}

.best-label {
  color: #728094;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.best-score {
  color: #7df0b3;
  font-weight: bold;
}

.best-time {
  color: #ffcb6b;
  font-weight: bold;
}

.best-sep {
  color: rgba(255, 255, 255, 0.18);
}

@media (max-width: 800px) {
  .vessel-columns {
    grid-template-columns: 1fr;
  }
}
</style>
