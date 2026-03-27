import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { GamePhase, DisasterType, Container, Slot, ShipPreset, GameEvent, PlacementResult, StarRatingResult } from '../types'
import { generateContainerList, resetSerialCounter } from '../modules/containerFactory'
import { generateSlots, getAvailableSlots } from '../modules/shipGrid'
import { updatePhysics, checkDisasters } from '../modules/physics'
import { calculatePlacementScore, getStarRating, checkPerfectBalance } from '../modules/scoring'
import { getLevelConfig, getTotalSlots } from '../modules/levels'

let eventIdCounter = 0

export const useGameStore = defineStore('stowage-master-game', () => {
  const phase = ref<GamePhase>('start')
  const currentLevel = ref(0)
  const score = ref(0)
  const moveCount = ref(0)
  const containers = ref<Container[]>([])
  const currentContainerIndex = ref(0)
  const grid = ref<Record<string, Slot>>({})
  const shipConfig = ref<ShipPreset | null>(null)
  const shipList = ref(0)
  const shipTrim = ref(0)
  const shipVCG = ref(0)
  const events = ref<GameEvent[]>([])
  const disasterType = ref<DisasterType | null>(null)
  const lastPlacement = ref<PlacementResult | null>(null)
  const perfectScore = ref(0)   // containerCount × 100 — theoretical maximum
  const targetScore = ref(0)    // pass threshold = perfectScore × 0.70
  const totalSlots = ref(0)
  const timerTotal = ref(0)     // total seconds for the level (0 = no timer)
  const timerRemaining = ref(0) // seconds remaining

  const currentContainer = computed<Container | null>(() => {
    return containers.value[currentContainerIndex.value] ?? null
  })

  const queueContainers = computed<Container[]>(() => {
    const start = currentContainerIndex.value + 1
    return containers.value.slice(start, start + 6)
  })

  const nextThreeContainers = computed<Container[]>(() => {
    const start = currentContainerIndex.value + 1
    return containers.value.slice(start, start + 3)
  })

  const availableSlots = computed<string[]>(() => {
    if (!shipConfig.value) return []
    return getAvailableSlots(grid.value, shipConfig.value)
  })

  const isWarning = computed<boolean>(() => {
    return Math.abs(shipList.value) >= 8 || Math.abs(shipTrim.value) >= 6
  })

  const isCritical = computed<boolean>(() => {
    return Math.abs(shipList.value) >= 12 || Math.abs(shipTrim.value) >= 9
  })

  const progressPercent = computed<number>(() => {
    if (containers.value.length === 0) return 0
    return moveCount.value / containers.value.length
  })

  const levelConfig = computed(() => getLevelConfig(currentLevel.value))

  function startLevel(level: number): void {
    currentLevel.value = level
    const config = getLevelConfig(level)
    shipConfig.value = config.preset
    totalSlots.value = getTotalSlots(config.preset)
    const containerCount = config.containerCount ?? totalSlots.value
    perfectScore.value = containerCount * 100
    targetScore.value = Math.round(perfectScore.value * 0.70)

    const slots = generateSlots(config.preset)
    grid.value = JSON.parse(JSON.stringify(slots)) as Record<string, Slot>

    resetSerialCounter()
    containers.value = generateContainerList(containerCount, config.hazmatRate)
    currentContainerIndex.value = 0

    score.value = 0
    moveCount.value = 0
    shipList.value = 0
    shipTrim.value = 0
    shipVCG.value = config.preset.emptyVCG
    events.value = []
    disasterType.value = null
    lastPlacement.value = null

    timerTotal.value = config.timerSeconds ?? 0
    timerRemaining.value = config.timerSeconds ?? 0

    phase.value = 'selecting'

    addEvent('Level started: ' + config.name, 'info')
  }

  function tickTimer(deltaSeconds: number): 'expired' | 'warning' | null {
    if (timerTotal.value <= 0) return null
    if (phase.value !== 'selecting' && phase.value !== 'animating') return null

    const prev = timerRemaining.value
    timerRemaining.value = Math.max(0, timerRemaining.value - deltaSeconds)

    if (timerRemaining.value <= 0 && prev > 0) {
      // Timer just expired
      phase.value = 'failed'
      addEvent('Time expired! Ship is leaving.', 'danger')
      return 'expired'
    }

    // Warning zone crossing (30s and 10s)
    if ((prev > 30 && timerRemaining.value <= 30) || (prev > 10 && timerRemaining.value <= 10)) {
      return 'warning'
    }

    return null
  }

  function placeContainer(slotId: string): { container: Container; slot: Slot } | null {
    if (phase.value !== 'selecting') return null
    if (!currentContainer.value) return null

    const slot = grid.value[slotId]
    if (!slot || slot.container) return null

    phase.value = 'animating'
    return { container: currentContainer.value, slot }
  }

  function finalizePlacement(slotId: string): { disaster?: DisasterType; levelEnd?: boolean; placement?: PlacementResult } | null {
    const container = currentContainer.value
    const slot = grid.value[slotId]
    if (!container || !slot) return null

    slot.container = container
    grid.value[slotId] = { ...slot }

    const physics = updatePhysics(grid.value, shipConfig.value!)
    shipList.value = physics.list
    shipTrim.value = physics.trim
    shipVCG.value = physics.vcg

    const disaster = checkDisasters(
      physics.list, physics.trim, physics.vcg,
      grid.value, shipConfig.value!, slot, container
    )

    if (disaster) {
      disasterType.value = disaster
      phase.value = 'disaster'
      addEvent(`DISASTER: ${disaster.toUpperCase()}!`, 'danger')
      return { disaster }
    }

    const placement = calculatePlacementScore(
      container, slot, grid.value, shipConfig.value!,
      physics.list, physics.trim
    )
    score.value = Math.min(score.value + placement.score, perfectScore.value)
    moveCount.value++
    lastPlacement.value = placement

    for (const reason of placement.reasons) {
      if (reason.good) {
        addEvent(reason.text, 'success')
      } else if (reason.points < 0) {
        addEvent(reason.text, 'warning')
      }
    }

    currentContainerIndex.value++

    if (currentContainerIndex.value >= containers.value.length) {
      const balanceBonus = checkPerfectBalance(physics.list, physics.trim)
      if (balanceBonus > 0) {
        score.value = Math.min(score.value + balanceBonus, perfectScore.value)
        addEvent(`Perfect balance bonus: +${balanceBonus}`, 'success')
      }

      if (score.value >= targetScore.value) {
        phase.value = 'complete'
        addEvent('Level complete!', 'success')
      } else {
        phase.value = 'failed'
        addEvent('Level failed - score too low', 'danger')
      }
      return { levelEnd: true }
    }

    phase.value = 'selecting'
    return { placement }
  }

  function addEvent(message: string, type: GameEvent['type'] = 'info'): void {
    events.value = [
      { message, type, time: ++eventIdCounter },
      ...events.value,
    ].slice(0, 5)
  }

  function setPhase(newPhase: GamePhase): void {
    phase.value = newPhase
  }

  function getStarRatingResult(): StarRatingResult {
    return getStarRating(score.value, perfectScore.value)
  }

  return {
    phase, currentLevel, score, moveCount, containers,
    currentContainerIndex, grid, shipConfig, shipList,
    shipTrim, shipVCG, events, disasterType, lastPlacement,
    perfectScore, targetScore, totalSlots,
    timerTotal, timerRemaining,
    currentContainer, queueContainers, nextThreeContainers,
    availableSlots, isWarning, isCritical, progressPercent, levelConfig,
    startLevel, placeContainer, finalizePlacement,
    addEvent, setPhase, getStarRatingResult, tickTimer,
  }
})
