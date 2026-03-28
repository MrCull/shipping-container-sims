import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { GamePhase, DisasterType, Container, Slot, ShipPreset, GameEvent, PlacementResult, StarRatingResult } from '../types'
import { generateContainerList, resetSerialCounter } from '../modules/containerFactory'
import { generateSlots, getAvailableSlots } from '../modules/shipGrid'
import { updatePhysics, checkDisasters } from '../modules/physics'
import { calculatePlacementScore, calculateDischargeScore, getStarRating, checkPerfectBalance } from '../modules/scoring'
import { getLevelConfig, getTotalSlots } from '../modules/levels'
import { generateDischargeManifest, getDischargeableSlots } from '../modules/dischargeManifest'

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

  // Discharge phase state
  const dischargeCount = ref(0)
  const dischargedCount = ref(0)
  const dischargeScore = ref(0)
  const lastDischarge = ref<PlacementResult | null>(null)

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

  const dischargeableSlots = computed<string[]>(() => {
    if (!shipConfig.value) return []
    return getDischargeableSlots(grid.value, shipConfig.value)
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

    // Discharge phase init
    dischargeCount.value = 0
    dischargedCount.value = 0
    dischargeScore.value = 0
    lastDischarge.value = null

    if (config.dischargeContainerCount && config.dischargeContainerCount > 0) {
      generateDischargeManifest(config.dischargeContainerCount, config.preset, grid.value)
      dischargeCount.value = config.dischargeContainerCount
      phase.value = 'discharge_selecting'
      addEvent('Discharge phase: unload ' + config.dischargeContainerCount + ' Import containers', 'info')
    } else {
      phase.value = 'selecting'
      addEvent('Level started: ' + config.name, 'info')
    }
  }

  function tickTimer(deltaSeconds: number): 'expired' | 'warn30pct' | 'warn15pct' | null {
    if (timerTotal.value <= 0) return null
    if (
      phase.value !== 'selecting' &&
      phase.value !== 'animating' &&
      phase.value !== 'discharge_selecting' &&
      phase.value !== 'discharge_animating'
    ) return null

    const prev = timerRemaining.value
    timerRemaining.value = Math.max(0, timerRemaining.value - deltaSeconds)

    if (timerRemaining.value <= 0 && prev > 0) {
      phase.value = 'failed'
      addEvent('Time expired! Ship is leaving.', 'danger')
      return 'expired'
    }

    const pct = timerRemaining.value / timerTotal.value
    const prevPct = prev / timerTotal.value

    // 30% remaining warning
    if (prevPct > 0.30 && pct <= 0.30) return 'warn30pct'
    // 15% remaining warning (critical — more urgent)
    if (prevPct > 0.15 && pct <= 0.15) return 'warn15pct'

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

  function pickDischargeContainer(slotId: string): { container: Container; slot: Slot } | null {
    if (phase.value !== 'discharge_selecting') return null

    const slot = grid.value[slotId]
    if (!slot || !slot.container || !slot.container.isImport) return null

    phase.value = 'discharge_animating'
    return { container: slot.container, slot }
  }

  function finalizeDischarge(slotId: string): { levelPhaseEnd?: boolean; discharge?: PlacementResult } | null {
    const slot = grid.value[slotId]
    if (!slot || !slot.container) return null

    const container = slot.container

    // Physics before removal
    const physicsBefore = updatePhysics(grid.value, shipConfig.value!)

    // Remove from grid
    slot.container = null
    grid.value[slotId] = { ...slot }

    // Physics after removal
    const physicsAfter = updatePhysics(grid.value, shipConfig.value!)
    shipList.value = physicsAfter.list
    shipTrim.value = physicsAfter.trim
    shipVCG.value = physicsAfter.vcg

    // Score the discharge pick
    const discharge = calculateDischargeScore(
      container,
      slot,
      grid.value,
      shipConfig.value!,
      physicsBefore.list,
      physicsBefore.trim,
      physicsAfter.list,
      physicsAfter.trim
    )
    dischargeScore.value += discharge.score
    score.value += discharge.score
    lastDischarge.value = discharge

    for (const reason of discharge.reasons) {
      if (reason.good) {
        addEvent(reason.text, 'success')
      } else if (reason.points < 0) {
        addEvent(reason.text, 'warning')
      }
    }

    dischargedCount.value++

    if (dischargedCount.value >= dischargeCount.value) {
      // Transition to loading phase
      addEvent('Discharge complete! Now load the vessel.', 'success')
      phase.value = 'selecting'
      return { levelPhaseEnd: true, discharge }
    }

    phase.value = 'discharge_selecting'
    return { discharge }
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
    dischargeCount, dischargedCount, dischargeScore, lastDischarge,
    currentContainer, queueContainers, nextThreeContainers,
    availableSlots, dischargeableSlots, isWarning, isCritical, progressPercent, levelConfig,
    startLevel, placeContainer, finalizePlacement,
    pickDischargeContainer, finalizeDischarge,
    addEvent, setPhase, getStarRatingResult, tickTimer,
  }
})
