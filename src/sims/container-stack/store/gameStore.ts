import { defineStore } from 'pinia'
import { ref } from 'vue'
import { Vector3 } from 'three'
import type {
  CollapsePiece,
  GamePhase,
  JengaContainer,
  MoveRecord,
  TowerLayer,
} from '../types'
import { TOWER } from '../modules/config'
import {
  buildInitialTower,
  countContainersInLayer,
  getHighestOccupiedLayerIndex,
  getTopLayerIndex,
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

  function recomputePhysics(): void {
    const com = computeCenterOfMass(layers.value)
    centerOfMass.value.copy(com)
    stabilityScore.value = computeStabilityScore(layers.value, com)
  }

  function newGame(): void {
    resetContainerIdCounter()
    layers.value = buildInitialTower()
    wobble.value = createInitialWobble()
    recomputePhysics()
    score.value = 0
    moveCount.value = 0
    comboStreak.value = 0
    moves.value = []
    floatingContainer.value = null
    floatingFrom.value = null
    collapsePieces.value = []
    maxHeightLayers.value = layers.value.length
    lastScorePopup.value = 0
    phase.value = 'playing'
  }

  function beginPlay(): void {
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
      const towerPieces = spawnCollapsePieces(layers.value, 0)
      if (floating && from) {
        const orient = layers.value[from.layerIndex]?.orientation ?? 'alongX'
        const pos = slotWorldPosition(from.layerIndex, from.slotIndex, layers.value)
        towerPieces.unshift(collapsePieceFromContainer(floating, orient, pos))
      }
      phase.value = 'collapsing'
      collapsePieces.value = towerPieces
      floatingContainer.value = null
      floatingFrom.value = null
      return true
    }

    removalWasCritical.value = critical
    stabilityAtRemovalStart.value = stabBefore
    phase.value = 'removing'
    moveStartedAt.value = performance.now()
    jitterAccumulator.value = 0
    return true
  }

  function recordDragJitter(deltaPixels: number): void {
    jitterAccumulator.value += Math.abs(deltaPixels)
  }

  function finishSlideAndEnterPlacing(): void {
    if (phase.value !== 'removing') return
    injectCriticalRemovalImpulse(
      wobble.value,
      stabilityAtRemovalStart.value,
      removalWasCritical.value
    )
    injectJitterImpulse(wobble.value, jitterAccumulator.value)
    phase.value = 'placing'
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

  function validPlacementSlotIndex(): number | null {
    const top = getTopLayerIndex(layers.value)
    const topLayer = layers.value[top]
    if (!topLayer) return null
    for (let s = 0; s < topLayer.slots.length; s++) {
      if (topLayer.slots[s] === null) return s
    }
    return null
  }

  function placeOnTop(): boolean {
    if (phase.value !== 'placing' || !floatingContainer.value) return false
    const c = floatingContainer.value
    const slotIdx = validPlacementSlotIndex()

    let targetLayerIndex: number
    let targetSlot: number

    if (slotIdx !== null) {
      targetLayerIndex = getTopLayerIndex(layers.value)
      targetSlot = slotIdx
    } else {
      const orient = layers.value.length % 2 === 0 ? 'alongX' : 'alongZ'
      const newLayer: TowerLayer = {
        index: layers.value.length,
        orientation: orient,
        slots: [null, null, null],
      }
      layers.value.push(newLayer)
      targetLayerIndex = newLayer.index
      targetSlot = 0
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
      phase.value = 'collapsing'
      collapsePieces.value = spawnCollapsePieces(layers.value, 0)
      floatingContainer.value = null
      floatingFrom.value = null
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
    phase.value = 'playing'
    return true
  }

  function tickPhysics(dt: number): 'ok' | 'collapsed' {
    if (phase.value === 'collapsing' || phase.value === 'gameOver' || phase.value === 'start') {
      return 'ok'
    }
    if (
      phase.value === 'playing' &&
      layers.value.length > 0 &&
      !isStructurallySound(layers.value)
    ) {
      phase.value = 'collapsing'
      collapsePieces.value = spawnCollapsePieces(layers.value, 0)
      return 'collapsed'
    }
    const { collapsed } = updateWobble(wobble.value, stabilityScore.value, dt)
    if (collapsed) {
      phase.value = 'collapsing'
      collapsePieces.value = spawnCollapsePieces(layers.value, 0)
      return 'collapsed'
    }
    return 'ok'
  }

  function finishCollapse(): void {
    wobble.value = createInitialWobble()
    phase.value = 'gameOver'
  }

  function restartToStart(): void {
    phase.value = 'start'
    layers.value = []
    floatingContainer.value = null
    collapsePieces.value = []
    lastScorePopup.value = 0
    wobble.value = createInitialWobble()
  }

  function setPaused(p: boolean): void {
    if (p && phase.value === 'playing') phase.value = 'paused'
    else if (!p && phase.value === 'paused') phase.value = 'playing'
  }

  return {
    phase,
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
    setPaused,
    recomputePhysics,
  }
})
