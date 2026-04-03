import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { GamePhase, DisasterType, Container, Slot, ShipPreset, GameEvent, PlacementResult, StarRatingResult, LevelBestRecord } from '../types'
import { generateContainerList, resetSerialCounter } from '../modules/containerFactory'
import { generateSlots, getAvailableSlots } from '../modules/shipGrid'
import { updatePhysics, checkDisasters } from '../modules/physics'
import { calculatePlacementScore, calculateDischargeScore, calculateRestowScore, getStarRating, checkPerfectBalance } from '../modules/scoring'
import { getLevelConfig, getTotalSlots } from '../modules/levels'
import { generateDischargeManifest, getDischargeableSlots, getRestowSlots } from '../modules/dischargeManifest'
import { SCORING } from '../modules/config'

let eventIdCounter = 0
const STORAGE_KEY = 'stowage-master-level-bests'
const PROGRESS_STORAGE_KEY = 'stowage-master-progress'

interface StoredProgress {
  completedLevelIds: number[]
  godMode: boolean
}

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
  const elapsedSeconds = ref(0)
  const levelBests = ref<Record<number, LevelBestRecord>>(loadLevelBests())
  const completedLevelIds = ref<number[]>(loadProgress().completedLevelIds)
  const isGodMode = ref(loadProgress().godMode)

  // Scene loading state — shown while 3D assets are downloading
  const isLoading = ref(false)
  const loadingMessage = ref('')

  // Discharge phase state
  const dischargeCount = ref(0)
  const dischargedCount = ref(0)
  const dischargeScore = ref(0)
  const lastDischarge = ref<PlacementResult | null>(null)

  // Restow state — transit container currently lifted and awaiting placement
  const restowContainer = ref<Container | null>(null)
  const restowFromSlotId = ref<string | null>(null)
  const restowSlots = ref<string[]>([])

  // Whether this level has transit containers that may need restowing (drives briefing UI)
  const hasTransitContainers = ref(false)

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

  const availableRestowSlots = computed<string[]>(() => restowSlots.value)

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
  const highestCompletedLevel = computed(() => {
    if (completedLevelIds.value.length === 0) return -1
    return Math.max(...completedLevelIds.value)
  })

  function loadProgress(): StoredProgress {
    if (typeof localStorage === 'undefined') return { completedLevelIds: [], godMode: false }
    try {
      const raw = localStorage.getItem(PROGRESS_STORAGE_KEY)
      if (!raw) return { completedLevelIds: [], godMode: false }
      const parsed = JSON.parse(raw) as Partial<StoredProgress>
      return {
        completedLevelIds: Array.isArray(parsed.completedLevelIds)
          ? parsed.completedLevelIds.filter((id): id is number => typeof id === 'number')
          : [],
        godMode: parsed.godMode === true,
      }
    } catch {
      return { completedLevelIds: [], godMode: false }
    }
  }

  function persistProgress(): void {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify({
      completedLevelIds: completedLevelIds.value,
      godMode: isGodMode.value,
    }))
  }

  function isLevelUnlocked(levelId: number): boolean {
    if (isGodMode.value) return true
    if (levelId <= 0) return true
    const previousLevelId = levelId - 1
    return completedLevelIds.value.includes(previousLevelId) || !!levelBests.value[previousLevelId]
  }

  function markLevelCompleted(levelId: number): void {
    if (completedLevelIds.value.includes(levelId)) return
    completedLevelIds.value = [...completedLevelIds.value, levelId].sort((a, b) => a - b)
    persistProgress()
  }

  function toggleGodMode(): boolean {
    isGodMode.value = !isGodMode.value
    persistProgress()
    return isGodMode.value
  }

  function loadLevelBests(): Record<number, LevelBestRecord> {
    if (typeof localStorage === 'undefined') return {}
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return {}
      return JSON.parse(raw) as Record<number, LevelBestRecord>
    } catch {
      return {}
    }
  }

  function persistLevelBests(): void {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(levelBests.value))
  }

  function getElapsedSeconds(): number {
    return Math.max(0, Math.round(elapsedSeconds.value))
  }

  function recordLevelBest(): void {
    const levelId = currentLevel.value
    const completionSeconds = getElapsedSeconds()
    const previous = levelBests.value[levelId]
    const next: LevelBestRecord = {
      bestScore: previous ? Math.max(previous.bestScore, score.value) : score.value,
      bestTimeSeconds: previous?.bestTimeSeconds == null
        ? completionSeconds
        : Math.min(previous.bestTimeSeconds, completionSeconds),
    }
    levelBests.value = {
      ...levelBests.value,
      [levelId]: next,
    }
    persistLevelBests()
  }

  function countHazmatPremiumContainers(): number {
    let count = containers.value.filter(container => container.isHazmat).length
    for (const slot of Object.values(grid.value)) {
      if (slot.container?.isHazmat) count++
    }
    return count
  }

  function recalculateScoreTargets(baseScoreContainerCount: number): void {
    const hazmatPremiumScore = countHazmatPremiumContainers() * SCORING.hazmatSafeBonus
    perfectScore.value = baseScoreContainerCount * 100 + hazmatPremiumScore
    targetScore.value = Math.round(perfectScore.value * 0.70)
  }

  function startLevel(level: number): void {
    if (!isLevelUnlocked(level)) return
    currentLevel.value = level
    const config = getLevelConfig(level)
    shipConfig.value = config.preset
    totalSlots.value = getTotalSlots(config.preset)
    const outboundContainerCount = config.containerCount ?? 0
    const scoreContainerCount = config.scoreContainerCount ?? config.containerCount ?? totalSlots.value

    const slots = generateSlots(config.preset)
    grid.value = JSON.parse(JSON.stringify(slots)) as Record<string, Slot>

    resetSerialCounter()
    containers.value = generateContainerList(outboundContainerCount, config.hazmatRate)
    recalculateScoreTargets(scoreContainerCount)
    currentContainerIndex.value = 0

    score.value = 0
    moveCount.value = 0
    const initialPhysics = updatePhysics(grid.value, config.preset)
    shipList.value = initialPhysics.list
    shipTrim.value = initialPhysics.trim
    shipVCG.value = initialPhysics.vcg
    events.value = []
    disasterType.value = null
    lastPlacement.value = null

    timerTotal.value = config.timerSeconds ?? 0
    timerRemaining.value = config.timerSeconds ?? 0
    elapsedSeconds.value = 0

    // Discharge phase init
    dischargeCount.value = 0
    dischargedCount.value = 0
    dischargeScore.value = 0
    lastDischarge.value = null

    // Restow state reset
    restowContainer.value = null
    restowFromSlotId.value = null
    restowSlots.value = []
    hasTransitContainers.value = false

    if (config.dischargeContainerCount && config.dischargeContainerCount > 0) {
      const transitCount = config.transitContainerCount ?? 0
      generateDischargeManifest(
        config.dischargeContainerCount,
        config.preset,
        grid.value,
        transitCount,
        config.hazmatRate,
        config.placementSpread ?? 0,
        config.importPlacement ?? 'default',
        config.transitGrouping ?? 'random',
      )
      recalculateScoreTargets(scoreContainerCount)
      dischargeCount.value = config.dischargeContainerCount
      hasTransitContainers.value = transitCount > 0

      // Recalculate from the pre-loaded grid so tilt is correct when the ship sails in
      const loadedPhysics = updatePhysics(grid.value, config.preset)
      shipList.value = loadedPhysics.list
      shipTrim.value = loadedPhysics.trim
      shipVCG.value = loadedPhysics.vcg
    } else {
      // phase set by confirmBriefing after briefing is dismissed
    }
    // Always show briefing first — confirmBriefing() will advance to the real phase
    phase.value = 'briefing'
  }

  function tickTimer(deltaSeconds: number): 'expired' | 'warn30pct' | 'warn15pct' | null {
    if (
      phase.value !== 'selecting' &&
      phase.value !== 'animating' &&
      phase.value !== 'discharge_selecting' &&
      phase.value !== 'discharge_animating' &&
      phase.value !== 'restow_selecting' &&
      phase.value !== 'restow_animating'
    ) return null

    elapsedSeconds.value += deltaSeconds
    if (timerTotal.value <= 0) return null

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

  function pickDischargeContainer(slotId: string): { container: Container; slot: Slot; isRestow?: boolean } | null {
    if (phase.value !== 'discharge_selecting') return null

    const slot = grid.value[slotId]
    if (!slot || !slot.container) return null

    if (slot.container.isTransit) {
      // Transit container blocking an import — initiate restow
      restowContainer.value = { ...slot.container, isBeingRestowed: true }
      restowFromSlotId.value = slotId
      restowSlots.value = getRestowSlots(grid.value, shipConfig.value!, slotId)

      // Remove from grid immediately so indicators update
      slot.container = null
      grid.value[slotId] = { ...slot }

      phase.value = 'restow_selecting'
      addEvent('Transit container lifted — select a new position', 'info')
      return { container: restowContainer.value, slot, isRestow: true }
    }

    if (!slot.container.isImport) return null

    phase.value = 'discharge_animating'
    return { container: slot.container, slot }
  }

  function placeRestowContainer(slotId: string): { container: Container; slot: Slot } | null {
    if (phase.value !== 'restow_selecting') return null
    if (!restowContainer.value) return null

    const slot = grid.value[slotId]
    if (!slot || slot.container) return null
    if (!restowSlots.value.includes(slotId)) return null

    phase.value = 'restow_animating'
    return { container: restowContainer.value, slot }
  }

  function cancelRestowSelection(): { container: Container; slot: Slot; slotId: string } | null {
    if (phase.value !== 'restow_selecting') return null
    if (!restowContainer.value || !restowFromSlotId.value) return null

    const slotId = restowFromSlotId.value
    const slot = grid.value[slotId]
    if (!slot) return null

    const container = { ...restowContainer.value, isBeingRestowed: false }
    slot.container = container
    grid.value[slotId] = { ...slot }

    restowContainer.value = null
    restowFromSlotId.value = null
    restowSlots.value = []
    phase.value = 'discharge_selecting'
    addEvent('Restow cancelled - container returned to its original slot', 'info')

    return { container, slot, slotId }
  }

  function finalizeRestow(slotId: string): { restow?: PlacementResult } | null {
    if (!restowContainer.value || !shipConfig.value) return null

    const slot = grid.value[slotId]
    if (!slot) return null

    // Place the transit container in the new slot
    const container = { ...restowContainer.value, isBeingRestowed: false }
    slot.container = container
    grid.value[slotId] = { ...slot }

    // Update physics
    const physicsAfter = updatePhysics(grid.value, shipConfig.value)
    shipList.value = physicsAfter.list
    shipTrim.value = physicsAfter.trim
    shipVCG.value = physicsAfter.vcg

    const restow = calculateRestowScore(container, slot, grid.value, shipConfig.value)
    score.value += restow.score
    lastDischarge.value = restow

    for (const reason of restow.reasons) {
      if (reason.good) addEvent(reason.text, 'success')
      else if (reason.points < 0) addEvent(reason.text, 'warning')
    }

    // Clear restow state
    restowContainer.value = null
    restowFromSlotId.value = null
    restowSlots.value = []

    phase.value = 'discharge_selecting'
    return { restow }
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
      if (levelConfig.value.completionMode === 'discharge-only') {
        phase.value = 'complete'
        recordLevelBest()
        markLevelCompleted(currentLevel.value)
        addEvent('Discharge complete! Vessel cleared and ready to sail.', 'success')
        return { levelPhaseEnd: true, discharge }
      }

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
        recordLevelBest()
        markLevelCompleted(currentLevel.value)
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

  /** Called when the player dismisses the level briefing — advances to the real first phase. */
  function confirmBriefing(): void {
    if (dischargeCount.value > 0) {
      phase.value = 'discharge_selecting'
      addEvent('Discharge phase: unload ' + dischargeCount.value + ' import containers', 'info')
    } else {
      phase.value = 'selecting'
      addEvent('Level started: ' + levelConfig.value.name, 'info')
    }
  }

  function getStarRatingResult(): StarRatingResult {
    return getStarRating(score.value, perfectScore.value)
  }

  function getLevelBest(levelId: number): LevelBestRecord | null {
    return levelBests.value[levelId] ?? null
  }

  return {
    phase, currentLevel, score, moveCount, containers,
    currentContainerIndex, grid, shipConfig, shipList,
    shipTrim, shipVCG, events, disasterType, lastPlacement,
    perfectScore, targetScore, totalSlots,
    timerTotal, timerRemaining, elapsedSeconds, levelBests,
    completedLevelIds, isGodMode, highestCompletedLevel,
    isLoading, loadingMessage,
    dischargeCount, dischargedCount, dischargeScore, lastDischarge,
    currentContainer, queueContainers, nextThreeContainers,
    availableSlots, dischargeableSlots, isWarning, isCritical, progressPercent, levelConfig,
    startLevel, placeContainer, finalizePlacement,
    pickDischargeContainer, finalizeDischarge,
    placeRestowContainer, finalizeRestow, cancelRestowSelection,
    restowContainer, restowFromSlotId, availableRestowSlots,
    hasTransitContainers, confirmBriefing,
    addEvent, setPhase, getStarRatingResult, getLevelBest, isLevelUnlocked, toggleGodMode, tickTimer,
  }
})
