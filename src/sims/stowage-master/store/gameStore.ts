import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { GamePhase, DisasterType, Container, Slot, ShipPreset, GameEvent, PlacementResult, StarRatingResult } from '../types'
import { generateContainerList, resetSerialCounter } from '../modules/containerFactory'
import { generateSlots, getAvailableSlots } from '../modules/shipGrid'
import { updatePhysics, checkDisasters } from '../modules/physics'
import { calculatePlacementScore, getStarRating, checkPerfectBalance } from '../modules/scoring'
import { getLevelConfig, getTargetScore, getTotalSlots } from '../modules/levels'

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
  const targetScore = ref(0)
  const totalSlots = ref(0)

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
    targetScore.value = getTargetScore(config.preset)

    const slots = generateSlots(config.preset)
    grid.value = JSON.parse(JSON.stringify(slots)) as Record<string, Slot>

    resetSerialCounter()
    containers.value = generateContainerList(totalSlots.value, config.hazmatRate)
    currentContainerIndex.value = 0

    score.value = 0
    moveCount.value = 0
    shipList.value = 0
    shipTrim.value = 0
    shipVCG.value = config.preset.emptyVCG
    events.value = []
    disasterType.value = null
    lastPlacement.value = null
    phase.value = 'selecting'

    addEvent('Level started: ' + config.name, 'info')
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
    score.value += placement.score
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
        score.value += balanceBonus
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
      { message, type, time: Date.now() },
      ...events.value,
    ].slice(0, 5)
  }

  function setPhase(newPhase: GamePhase): void {
    phase.value = newPhase
  }

  function getStarRatingResult(): StarRatingResult {
    return getStarRating(score.value, targetScore.value)
  }

  return {
    phase, currentLevel, score, moveCount, containers,
    currentContainerIndex, grid, shipConfig, shipList,
    shipTrim, shipVCG, events, disasterType, lastPlacement,
    targetScore, totalSlots,
    currentContainer, queueContainers, nextThreeContainers,
    availableSlots, isWarning, isCritical, progressPercent, levelConfig,
    startLevel, placeContainer, finalizePlacement,
    addEvent, setPhase, getStarRatingResult,
  }
})
