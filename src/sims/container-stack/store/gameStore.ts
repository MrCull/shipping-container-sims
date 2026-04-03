import { defineStore } from 'pinia'
import { ref } from 'vue'
import { Vector3 } from 'three'
import type {
  CollapsePiece,
  GamePhase,
  JengaContainer,
  LevelFailReason,
  LayerOrientation,
  MoveRecord,
  TowerLayer,
} from '../types'
import { BLOCK, PHYSICS, TOWER } from '../modules/config'
import {
  getLevelTimeLimitSec,
  getMoveTimeLimitSec,
  MOVES_PER_LEVEL,
} from '../modules/levelConfig'
import {
  buildInitialTower,
  countContainersInLayer,
  getHighestOccupiedLayerIndex,
  getTopLayerIndex,
  getTowerTopY,
  isLayerComplete,
  resetContainerIdCounter,
  slotWorldPosition,
} from '../modules/towerBuilder'
import {
  collapsePieceFromContainer,
  computeCenterOfMass,
  computeStabilityScore,
  createInitialWobble,
  injectCriticalRemovalImpulse,
  injectDragFrameWobble,
  injectJitterImpulse,
  isRemovalCritical,
  isStructurallySound,
  spawnCollapsePieces,
  updateWobble,
} from '../modules/physics'
import { computeMoveScore, nextComboStreak } from '../modules/scoring'

const WobbleSpikeThreshold = 0.12

export const useContainerStackStore = defineStore('container-stack-game', () => {
  const phase = ref<GamePhase>('start')
  const hasStartedGame = ref(false)
  const layers = ref<TowerLayer[]>([])
  const centerOfMass = ref(new Vector3())
  const stabilityScore = ref(1)
  const wobble = ref(createInitialWobble())
  const score = ref(0)
  const moveCount = ref(0)
  const comboStreak = ref(0)
  const moves = ref<MoveRecord[]>([])
  const floatingContainer = ref<JengaContainer | null>(null)
  const floatingFrom = ref<{ layerIndex: number; slotIndex: number } | null>(null)
  const lastScorePopup = ref(0)
  const maxHeightLayers = ref<number>(TOWER.startLayers)
  const collapsePieces = ref<CollapsePiece[]>([])
  const moveStartedAt = ref(0)
  const jitterAccumulator = ref(0)
  const removalWasCritical = ref(false)
  const stabilityAtRemovalStart = ref(1)
  const placingSlotOptions = ref<number[]>([])
  let collapseIdPrefix = `${Date.now()}-`

  const currentLevel = ref(1)
  const movesInLevel = ref(0)
  const levelTimeRemainingSec = ref(0)
  const moveTimeRemainingSec = ref(0)
  const levelFailReason = ref<LevelFailReason>(null)

  function refillMoveTimer(): void {
    moveTimeRemainingSec.value = getMoveTimeLimitSec(currentLevel.value)
  }

  function resetTowerState(): void {
    resetContainerIdCounter()
    layers.value = buildInitialTower()
    wobble.value = createInitialWobble()
    recomputePhysics()
    maxHeightLayers.value = layers.value.length
  }

  /** Start current level from a fresh tower (same score unless full restart). */
  function startLevelInternal(): void {
    collapsePieces.value = []
    floatingContainer.value = null
    floatingFrom.value = null
    placingSlotOptions.value = []
    movesInLevel.value = 0
    levelTimeRemainingSec.value = getLevelTimeLimitSec(currentLevel.value)
    refillMoveTimer()
    levelFailReason.value = null
    resetTowerState()
    phase.value = 'playing'
  }

  function failLevelTimer(reason: 'timeoutMove' | 'timeoutLevel'): void {
    if (
      (phase.value === 'removing' || phase.value === 'placing') &&
      floatingFrom.value &&
      floatingContainer.value
    ) {
      const { layerIndex, slotIndex } = floatingFrom.value
      const L = layers.value[layerIndex]
      const c = floatingContainer.value
      if (L) {
        L.slots[slotIndex] = { ...c, layerIndex, slotIndex }
      }
    }
    floatingContainer.value = null
    floatingFrom.value = null
    placingSlotOptions.value = []
    levelFailReason.value = reason
    phase.value = 'levelFailed'
    recomputePhysics()
  }

  function tickLevelTimers(dt: number): void {
    if (
      dt <= 0 ||
      phase.value === 'start' ||
      phase.value === 'paused' ||
      phase.value === 'collapsing' ||
      phase.value === 'gameOver' ||
      phase.value === 'levelComplete' ||
      phase.value === 'levelFailed'
    ) {
      return
    }
    levelTimeRemainingSec.value = Math.max(0, levelTimeRemainingSec.value - dt)
    moveTimeRemainingSec.value = Math.max(0, moveTimeRemainingSec.value - dt)
    if (levelTimeRemainingSec.value <= 0) {
      failLevelTimer('timeoutLevel')
      return
    }
    if (moveTimeRemainingSec.value <= 0) {
      failLevelTimer('timeoutMove')
    }
  }

  function completeLevelIfNeeded(): void {
    if (movesInLevel.value >= MOVES_PER_LEVEL) {
      phase.value = 'levelComplete'
    }
  }

  function continueToNextLevel(): void {
    currentLevel.value++
    startLevelInternal()
  }

  function retryCurrentLevel(): void {
    collapsePieces.value = []
    floatingContainer.value = null
    floatingFrom.value = null
    placingSlotOptions.value = []
    movesInLevel.value = 0
    levelTimeRemainingSec.value = getLevelTimeLimitSec(currentLevel.value)
    refillMoveTimer()
    levelFailReason.value = null
    resetTowerState()
    phase.value = 'playing'
  }

  function beginCollapseFromTower(extraFloating?: {
    container: JengaContainer
    orient: LayerOrientation
    position: Vector3
  }): void {
    const prefix = `${collapseIdPrefix}-`
    const towerPieces = spawnCollapsePieces(layers.value, prefix)
    if (extraFloating) {
      towerPieces.unshift(
        collapsePieceFromContainer(
          `${prefix}floating`,
          extraFloating.container,
          extraFloating.orient,
          extraFloating.position
        )
      )
    }
    phase.value = 'collapsing'
    collapsePieces.value = towerPieces
    floatingContainer.value = null
    floatingFrom.value = null
    placingSlotOptions.value = []
  }

  function recomputePhysics(): void {
    const com = computeCenterOfMass(layers.value)
    centerOfMass.value.copy(com)
    stabilityScore.value = computeStabilityScore(layers.value, com)
  }

  function newGame(): void {
    collapseIdPrefix = `${Date.now()}`
    collapsePieces.value = []
    score.value = 0
    moveCount.value = 0
    comboStreak.value = 0
    moves.value = []
    lastScorePopup.value = 0
    currentLevel.value = 1
    startLevelInternal()
  }

  function beginPlay(): void {
    hasStartedGame.value = true
    newGame()
  }

  function canRemoveFromSlot(layerIndex: number, slotIndex: number): boolean {
    if (phase.value !== 'playing') return false
    const L = layers.value[layerIndex]
    if (!L) return false
    const c = L.slots[slotIndex]
    if (!c) return false

    const topOccupied = getHighestOccupiedLayerIndex(layers.value)
    if (topOccupied < 0) return false

    if (layerIndex === topOccupied && !isLayerComplete(L)) {
      return false
    }

    if (layerIndex > topOccupied) return false

    const count = countContainersInLayer(L)
    if (layerIndex < topOccupied && count < 2) return false

    return true
  }

  function startRemoval(layerIndex: number, slotIndex: number): boolean {
    if (!canRemoveFromSlot(layerIndex, slotIndex)) return false
    const L = layers.value[layerIndex]!
    const c = L.slots[slotIndex]!
    const stabBefore = stabilityScore.value
    const critical = isRemovalCritical(layers.value, layerIndex, slotIndex, stabBefore)

    floatingFrom.value = { layerIndex, slotIndex }
    floatingContainer.value = { ...c, layerIndex, slotIndex }
    L.slots[slotIndex] = null

    recomputePhysics()
    if (!isStructurallySound(layers.value)) {
      const floating = floatingContainer.value
      const from = floatingFrom.value
      if (floating && from) {
        const orient = layers.value[from.layerIndex]?.orientation ?? 'alongX'
        const pos = slotWorldPosition(from.layerIndex, from.slotIndex, layers.value)
        beginCollapseFromTower({ container: floating, orient, position: pos })
      } else {
        beginCollapseFromTower()
      }
      return true
    }

    removalWasCritical.value = critical
    stabilityAtRemovalStart.value = stabBefore
    phase.value = 'removing'
    refillMoveTimer()
    moveStartedAt.value = performance.now()
    jitterAccumulator.value = 0
    return true
  }

  function recordDragJitter(deltaPixels: number): void {
    const d = Math.abs(deltaPixels)
    jitterAccumulator.value += d
    if (phase.value === 'removing') {
      injectDragFrameWobble(wobble.value, d, stabilityScore.value)
    }
  }

  function finishSlideAndEnterPlacing(): void {
    if (phase.value !== 'removing') return
    injectCriticalRemovalImpulse(
      wobble.value,
      stabilityAtRemovalStart.value,
      removalWasCritical.value
    )
    injectJitterImpulse(wobble.value, jitterAccumulator.value)
    placingSlotOptions.value = computePlacingSlotOptions()
    refillMoveTimer()
    phase.value = 'placing'
  }

  function computePlacingSlotOptions(): number[] {
    const top = getTopLayerIndex(layers.value)
    const topLayer = layers.value[top]
    if (!topLayer) return [0, 1, 2]
    const opts: number[] = []
    for (let s = 0; s < topLayer.slots.length; s++) {
      if (topLayer.slots[s] === null) opts.push(s)
    }
    if (opts.length > 0) return opts
    return [0, 1, 2]
  }

  function cancelRemoval(): void {
    if (phase.value !== 'removing' || !floatingFrom.value || !floatingContainer.value) return
    const { layerIndex, slotIndex } = floatingFrom.value
    const L = layers.value[layerIndex]
    const c = floatingContainer.value
    if (L) {
      L.slots[slotIndex] = { ...c, layerIndex, slotIndex }
    }
    floatingContainer.value = null
    floatingFrom.value = null
    recomputePhysics()
    phase.value = 'playing'
  }

  function placeOnTop(slotIndex: number): boolean {
    if (phase.value !== 'placing' || !floatingContainer.value) return false
    const c = floatingContainer.value
    if (!placingSlotOptions.value.includes(slotIndex)) return false

    let targetLayerIndex: number
    let targetSlot: number

    const topIdx = getTopLayerIndex(layers.value)
    const topLayer = layers.value[topIdx]
    const openOnTop = topLayer?.slots[slotIndex] === null

    if (openOnTop) {
      targetLayerIndex = topIdx
      targetSlot = slotIndex
    } else {
      const orient = layers.value.length % 2 === 0 ? 'alongX' : 'alongZ'
      const newLayer: TowerLayer = {
        index: layers.value.length,
        orientation: orient,
        slots: [null, null, null],
      }
      layers.value.push(newLayer)
      targetLayerIndex = newLayer.index
      targetSlot = slotIndex
    }

    const placed: JengaContainer = {
      ...c,
      layerIndex: targetLayerIndex,
      slotIndex: targetSlot,
    }
    const TL = layers.value[targetLayerIndex]!
    TL.slots[targetSlot] = placed

    recomputePhysics()
    if (!isStructurallySound(layers.value)) {
      beginCollapseFromTower()
      return true
    }

    const duration = (performance.now() - moveStartedAt.value) / 1000
    const wobbleSpike = Math.abs(wobble.value.angle) > WobbleSpikeThreshold
    comboStreak.value = nextComboStreak(comboStreak.value, wobbleSpike)

    const startLayers = TOWER.startLayers
    const result = computeMoveScore({
      moveDurationSec: duration,
      jitterIntegral: jitterAccumulator.value,
      comboStreak: comboStreak.value,
      layerCountAfterPlace: layers.value.length,
      startLayerCount: startLayers,
    })

    score.value += result.points
    lastScorePopup.value = result.points
    moveCount.value++
    moves.value.push({
      containerId: placed.id,
      atMs: performance.now(),
      scoreDelta: result.points,
    })

    if (layers.value.length > maxHeightLayers.value) {
      maxHeightLayers.value = layers.value.length
    }

    floatingContainer.value = null
    floatingFrom.value = null
    placingSlotOptions.value = []
    movesInLevel.value++

    refillMoveTimer()
    phase.value = 'playing'
    completeLevelIfNeeded()
    return true
  }

  function tickPhysics(dt: number): 'ok' | 'collapsed' {
    if (
      phase.value === 'collapsing' ||
      phase.value === 'gameOver' ||
      phase.value === 'start' ||
      phase.value === 'paused' ||
      phase.value === 'levelComplete' ||
      phase.value === 'levelFailed'
    ) {
      return 'ok'
    }
    tickLevelTimers(dt)
    if (
      phase.value === 'playing' &&
      layers.value.length > 0 &&
      !isStructurallySound(layers.value)
    ) {
      beginCollapseFromTower()
      return 'collapsed'
    }
    const { collapsed } = updateWobble(wobble.value, stabilityScore.value, dt)
    if (collapsed) {
      if (phase.value === 'removing') {
        const floating = floatingContainer.value
        const from = floatingFrom.value
        if (floating && from) {
          const orient = layers.value[from.layerIndex]?.orientation ?? 'alongX'
          const pos = slotWorldPosition(from.layerIndex, from.slotIndex, layers.value)
          beginCollapseFromTower({ container: floating, orient, position: pos })
        } else {
          beginCollapseFromTower()
        }
      } else if (phase.value === 'placing' && floatingContainer.value) {
        const floating = floatingContainer.value
        const top = getTopLayerIndex(layers.value)
        const orient = layers.value[top]?.orientation ?? 'alongX'
        const pos = new Vector3(0, getTowerTopY(layers.value) + BLOCK.height * 0.95, 0)
        beginCollapseFromTower({ container: floating, orient, position: pos })
      } else {
        beginCollapseFromTower()
      }
      return 'collapsed'
    }
    if (
      phase.value === 'removing' &&
      stabilityScore.value < PHYSICS.shakyCollapseStabilityThreshold &&
      jitterAccumulator.value > PHYSICS.shakyCollapseJitterThreshold
    ) {
      const floating = floatingContainer.value
      const from = floatingFrom.value
      if (floating && from) {
        const orient = layers.value[from.layerIndex]?.orientation ?? 'alongX'
        const pos = slotWorldPosition(from.layerIndex, from.slotIndex, layers.value)
        beginCollapseFromTower({ container: floating, orient, position: pos })
      } else {
        beginCollapseFromTower()
      }
      return 'collapsed'
    }
    return 'ok'
  }

  function finishCollapse(): void {
    wobble.value = createInitialWobble()
    phase.value = 'gameOver'
  }

  function restartToStart(): void {
    collapseIdPrefix = `${Date.now()}`
    phase.value = 'start'
    hasStartedGame.value = false
    layers.value = []
    floatingContainer.value = null
    floatingFrom.value = null
    collapsePieces.value = []
    placingSlotOptions.value = []
    score.value = 0
    moveCount.value = 0
    comboStreak.value = 0
    moves.value = []
    lastScorePopup.value = 0
    maxHeightLayers.value = TOWER.startLayers
    currentLevel.value = 1
    movesInLevel.value = 0
    levelTimeRemainingSec.value = 0
    moveTimeRemainingSec.value = 0
    levelFailReason.value = null
    jitterAccumulator.value = 0
    removalWasCritical.value = false
    stabilityAtRemovalStart.value = 1
    wobble.value = createInitialWobble()
  }

  function setPaused(p: boolean): void {
    if (p && phase.value === 'playing') phase.value = 'paused'
    else if (!p && phase.value === 'paused') phase.value = 'playing'
  }

  return {
    phase,
    hasStartedGame,
    layers,
    centerOfMass,
    stabilityScore,
    wobble,
    score,
    moveCount,
    comboStreak,
    moves,
    floatingContainer,
    floatingFrom,
    lastScorePopup,
    maxHeightLayers,
    collapsePieces,
    placingSlotOptions,
    currentLevel,
    movesInLevel,
    levelTimeRemainingSec,
    moveTimeRemainingSec,
    levelFailReason,
    beginPlay,
    newGame,
    canRemoveFromSlot,
    startRemoval,
    recordDragJitter,
    finishSlideAndEnterPlacing,
    cancelRemoval,
    placeOnTop,
    tickPhysics,
    finishCollapse,
    restartToStart,
    continueToNextLevel,
    retryCurrentLevel,
    setPaused,
    recomputePhysics,
  }
})
