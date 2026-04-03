<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import * as THREE from 'three'
import { useGameStore } from '../store/gameStore'
import { useGameThreeScene } from '../composables/useThreeScene'
import { useGameLoop } from '../composables/useGameLoop'
import { useSlotPicking } from '../composables/useSlotPicking'
import { useAudio } from '../composables/useAudio'
import {
  createOcean, animateOcean,
  createDock, createLighting, createSkybox, createSkyDome,
  createFoamParticles, animateFoam, createTerminalTruckGLB,
} from '../modules/sceneBuilder'
import { loadTruckGLBs, createTruckGLB } from '../modules/truckRenderer'
import { createShip, loadShipGLB, updateShipTilt, snapShipTilt } from '../modules/shipRenderer'
import {
  createContainerMesh,
  createSlotIndicators, removeSlotIndicators, animateSlotIndicators,
  createImportContainerMeshes, removeImportContainerMeshes, removeImportContainerMesh,
  createImportSlotIndicators, removeImportSlotIndicators, animateImportSlotIndicators,
  createRestowSlotIndicators, removeRestowSlotIndicators, animateRestowSlotIndicators,
  animateHazmatMeshes,
} from '../modules/containerRenderer'
import {
  createCrane, getDockPosition, createPlacementAnimation, createDischargeAnimation,
  animateCraneWarningLight,
} from '../modules/craneSystem'
import { createDisasterAnimation } from '../modules/disasters'
import { wouldCauseHazmatExplosion } from '../modules/physics'
import { CONTAINER, TRUCK, OUTBOUND_TRUCK } from '../modules/config'
import { createOutboundTruckQueue } from '../modules/truckRenderer'
import type { Container, CraneObject, DisasterAnimation } from '../types'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const store = useGameStore()

const { getScene, getCamera, isReady, render, setCameraForShip, applyKeyboardCamera } = useGameThreeScene(canvasRef)
const { onClick: pickSlot, attach: attachPicking } = useSlotPicking(canvasRef, getCamera, getScene)
const audio = useAudio()

// Plain variables — Three.js objects must never be wrapped in Vue reactivity
let shipGroup: THREE.Group | null = null
let craneObj: CraneObject | null = null
let ocean: THREE.Mesh | null = null
let foam: THREE.Points | null = null
let hoistMesh: THREE.Group | null = null
let activeTruckMesh: THREE.Group | null = null
let queueMeshes: THREE.Group[] = []
let truckMeshes: THREE.Group[] = []
let outboundTruckGroups: THREE.Group[] = []
let currentAnimation: ((dt: number) => boolean) | null = null
let disasterAnimation: DisasterAnimation | null = null
let pendingHoistContainer: Container | null = null
let pendingQueueContainers: Container[] | null = null
let inboundQueueAdvancing = false


interface TruckAnim {
  truck: THREE.Group
  container: THREE.Group | null
  startX: number
  endX: number
  elapsed: number
  duration: number
  departing: boolean
}
let truckAnimations: TruckAnim[] = []
let outboundTruckAnimations: TruckAnim[] = []

// Ambient truck engine loop handle
let truckEngineNode: AudioBufferSourceNode | null = null
let lastHazmatLoadAlertId: string | null = null
let lastHazmatRestowAlertId: string | null = null

// Ship shake state
const shipShake = { active: false, elapsed: 0, duration: 0.4, intensity: 0.15 }

// Sail-away animation state
const sailAway = { active: false, elapsed: 0, delay: 0.5 }

// Sail-in animation state (ship arrives from off-screen left)
const sailIn = { active: false, elapsed: 0, startX: -200, targetX: 0, duration: 4.0 }

// Timer warning sound state — track whether we've played each threshold warning
let timerWarnedAt30pct = false
let timerWarnedAt15pct = false

const { start: startLoop } = useGameLoop((deltaTime, time) => {
  // Tick the countdown timer
  const timerResult = store.tickTimer(deltaTime)
  if (timerResult === 'warn30pct' && !timerWarnedAt30pct) {
    timerWarnedAt30pct = true
    audio.playSound('clockTicking', 0.65)
  } else if (timerResult === 'warn15pct' && !timerWarnedAt15pct) {
    timerWarnedAt15pct = true
    audio.playSound('clockTicking', 1.0)
  }

  applyKeyboardCamera(deltaTime)
  animateOcean(ocean, time)
  animateFoam(foam, time)

  updateShipTilt(shipGroup, store.shipList, store.shipTrim)
  animateHazmatMeshes(shipGroup, time)
  animateHazmatMeshes(hoistMesh, time)
  for (const mesh of queueMeshes) animateHazmatMeshes(mesh, time)

  if (shipGroup) {
    animateSlotIndicators(shipGroup, time)
    animateImportSlotIndicators(shipGroup, time)
    animateRestowSlotIndicators(shipGroup, time)
  }

  if (craneObj) {
    animateCraneWarningLight(craneObj, time)
  }

  if (currentAnimation) {
    const done = currentAnimation(deltaTime)
    if (done) currentAnimation = null
  }

  if (disasterAnimation) {
    const done = disasterAnimation.update(deltaTime)
    if (done) disasterAnimation = null
  }

  if (shipShake.active && shipGroup) {
    shipShake.elapsed += deltaTime
    if (shipShake.elapsed >= shipShake.duration) {
      shipShake.active = false
      shipGroup.position.x = 0
      shipGroup.position.y = 0
    } else {
      const decay = 1 - shipShake.elapsed / shipShake.duration
      const freq = 25
      const t = shipShake.elapsed * freq
      shipGroup.position.x = Math.sin(t * 1.3) * shipShake.intensity * decay
      shipGroup.position.y = Math.sin(t) * shipShake.intensity * 0.6 * decay
    }
  }

  if (sailAway.active && shipGroup) {
    sailAway.elapsed += deltaTime
    if (sailAway.elapsed > sailAway.delay) {
      const speed = 12 + (sailAway.elapsed - sailAway.delay) * 6
      shipGroup.position.x += speed * deltaTime
    }
  }

  if (sailIn.active && shipGroup) {
    sailIn.elapsed += deltaTime
    const t = Math.min(sailIn.elapsed / sailIn.duration, 1)
    const eased = easeOutQuad(t)
    shipGroup.position.x = sailIn.startX + (sailIn.targetX - sailIn.startX) * eased
    if (t >= 1) {
      shipGroup.position.x = sailIn.targetX
      sailIn.active = false
    }
  }

  // Advance inbound trucks toward crane, departing inbound truck drives off and fades
  if (truckAnimations.length > 0) {
    const scene = getScene()
    truckAnimations = truckAnimations.filter(anim => {
      anim.elapsed += deltaTime
      const t = Math.min(anim.elapsed / anim.duration, 1)
      const eased = easeOutQuad(t)
      const x = anim.startX + (anim.endX - anim.startX) * eased
      anim.truck.position.x = x
      if (anim.container) anim.container.position.x = x + TRUCK.containerXOffset

      if (anim.departing && t >= 0.4) {
        const fadeT = (t - 0.4) / 0.6
        const opacity = Math.max(0, 1 - fadeT)
        setGroupOpacity(anim.truck, opacity)
        if (anim.container) setGroupOpacity(anim.container, opacity)
      }

      if (t >= 1) {
        if (anim.departing && scene) {
          disposeGroup(anim.truck, scene)
          if (anim.container) disposeGroup(anim.container, scene)
        } else {
          setGroupOpacity(anim.truck, 1.0)
          if (anim.container) setGroupOpacity(anim.container, 1.0)
        }
        return false
      }
      return true
    })
  }

  if (inboundQueueAdvancing && truckAnimations.length === 0) {
    inboundQueueAdvancing = false
    if (truckMeshes[0] && queueMeshes[0] && craneObj) {
      const dockPos = getDockPosition(craneObj)
      activeTruckMesh = truckMeshes.shift() ?? null
      hoistMesh = queueMeshes.shift() ?? null

      if (activeTruckMesh) {
        activeTruckMesh.position.set(dockPos.x, 0.0, dockPos.z)
        activeTruckMesh.name = 'active-load-truck'
      }

      if (hoistMesh) {
        hoistMesh.position.set(
          dockPos.x + TRUCK.containerXOffset,
          TRUCK.deckHeight + CONTAINER.size.y / 2,
          dockPos.z
        )
        hoistMesh.name = 'hoist-mesh'
      }

      pendingHoistContainer = null
    } else if (pendingHoistContainer) {
      const nextContainer = pendingHoistContainer
      pendingHoistContainer = null
      void updateHoistMesh(nextContainer)
    }

    if (pendingQueueContainers) {
      const nextQueue = pendingQueueContainers
      pendingQueueContainers = null
      void updateQueueMeshes(nextQueue)
    }
  }

  // Outbound trucks depart with loaded container, then queue advances
  if (outboundTruckAnimations.length > 0) {
    const scene = getScene()
    outboundTruckAnimations = outboundTruckAnimations.filter(anim => {
      anim.elapsed += deltaTime
      const t = Math.min(anim.elapsed / anim.duration, 1)
      const eased = easeOutQuad(t)
      const x = anim.startX + (anim.endX - anim.startX) * eased
      anim.truck.position.x = x
      if (anim.container) anim.container.position.x = x + OUTBOUND_TRUCK.containerXOffset

      if (anim.departing && t >= OUTBOUND_TRUCK.fadeStartT) {
        const fadeT = (t - OUTBOUND_TRUCK.fadeStartT) / (1 - OUTBOUND_TRUCK.fadeStartT)
        const opacity = Math.max(0, 1 - fadeT)
        setGroupOpacity(anim.truck, opacity)
        if (anim.container) setGroupOpacity(anim.container, opacity)
      }

      if (t >= 1) {
        if (anim.departing && scene) {
          disposeGroup(anim.truck, scene)
          if (anim.container) disposeGroup(anim.container, scene)
        } else {
          // Advancing truck — ensure it is fully opaque after animation completes
          setGroupOpacity(anim.truck, 1.0)
        }
        return false
      }
      return true
    })
  }

  render()
})

onMounted(async () => {
  await audio.init()
})

// Choose horn sample based on vessel preset — small feeder uses small horn
function hornSound(): string {
  return store.shipConfig?.name === 'small' ? 'shipHornSmall' : 'shipHornLarge'
}

// Single phase watcher — handles both scene rebuilds and audio/animation triggers
watch(() => store.phase, (newPhase, oldPhase) => {
  const isSceneRebuildTrigger =
    newPhase === 'briefing' &&
    (oldPhase === 'start' || oldPhase === 'disaster' || oldPhase === 'failed' || oldPhase === 'complete')


  if (isSceneRebuildTrigger) {
    // Stop all in-flight sounds from the previous level before building the new scene
    audio.stopAll()
    buildScene()
    // Start seagull ambient loop for the duration of the level
    audio.startAmbientSeagulls()
  }

  // Stop seagulls when returning to non-gameplay states
  if (newPhase === 'start' || newPhase === 'complete' || newPhase === 'failed' || newPhase === 'disaster') {
    audio.stopAmbientSeagulls()
  }

  // Briefing dismissed on a load-only level — show green slot indicators
  if (newPhase === 'selecting' && oldPhase === 'briefing') {
    if (shipGroup && store.shipConfig) {
      createSlotIndicators(
        getScene()!,
        store.grid,
        store.availableSlots,
        store.shipConfig,
        shipGroup,
        getHazmatDangerSlotIds(store.availableSlots, store.currentContainer)
      )
    }
  }

  // Discharge phase → load phase: tear down discharge indicators, set up load indicators
  if (newPhase === 'selecting' && oldPhase === 'discharge_selecting') {
    if (shipGroup && store.shipConfig) {
      removeImportSlotIndicators(shipGroup)
      removeImportContainerMeshes(shipGroup)
      createSlotIndicators(
        getScene()!,
        store.grid,
        store.availableSlots,
        store.shipConfig,
        shipGroup,
        getHazmatDangerSlotIds(store.availableSlots, store.currentContainer)
      )
      updateHoistMesh(store.currentContainer)
      updateQueueMeshes(store.nextThreeContainers)
      audio.playSound('cheer', 0.5)
    }
  }

  // Set up discharge indicators when entering discharge_selecting for the first time (from briefing)
  // or after each discharge/restow animation completes
  if (
    newPhase === 'discharge_selecting' &&
    (
      oldPhase === 'briefing' ||
      oldPhase === 'discharge_animating' ||
      oldPhase === 'restow_animating' ||
      oldPhase === 'restow_selecting'
    )
  ) {
    if (shipGroup && store.shipConfig) {
      removeImportSlotIndicators(shipGroup)
      removeRestowSlotIndicators(shipGroup)
      createImportSlotIndicators(store.grid, store.dischargeableSlots, store.shipConfig, shipGroup)
    }
  }

  // Transit container picked for restow — show cyan restow destination indicators
  if (newPhase === 'restow_selecting' && oldPhase === 'discharge_selecting') {
    if (shipGroup && store.shipConfig) {
      removeImportSlotIndicators(shipGroup)
      createRestowSlotIndicators(
        store.grid,
        store.availableRestowSlots,
        store.shipConfig,
        shipGroup,
        getHazmatDangerSlotIds(store.availableRestowSlots, store.restowContainer)
      )
    }
  }

  if (newPhase === 'complete') {
    audio.playSound('cheer', 0.8)
    setTimeout(() => audio.playSound('levelUp', 0.75), 800)
    setTimeout(() => audio.playSound(hornSound(), 0.9), 1400)
    sailAway.active = true
    sailAway.elapsed = 0
  }

  if (newPhase === 'failed') {
    // Boo sound when time runs out or level fails
    audio.playSound('boo', 0.9)
    setTimeout(() => audio.playSound(hornSound(), 0.9), 800)
    sailAway.active = true
    sailAway.elapsed = 0
  }
})

watch(() => store.availableSlots, (slots) => {
  if (!shipGroup || !store.shipConfig) return
  if (store.phase === 'selecting') {
    removeSlotIndicators(shipGroup)
    createSlotIndicators(
      getScene()!,
      store.grid,
      slots,
      store.shipConfig,
      shipGroup,
      getHazmatDangerSlotIds(slots, store.currentContainer)
    )
  }
}, { deep: true })

watch(() => store.availableRestowSlots, (slots) => {
  if (!shipGroup || !store.shipConfig) return
  if (store.phase === 'restow_selecting') {
    removeRestowSlotIndicators(shipGroup)
    createRestowSlotIndicators(
      store.grid,
      slots,
      store.shipConfig,
      shipGroup,
      getHazmatDangerSlotIds(slots, store.restowContainer)
    )
  }
}, { deep: true })

watch(() => store.currentContainer, () => {
  maybePlayHazmatLoadAlert()
  if (!shipGroup || !store.shipConfig) return
  if (store.phase === 'selecting') {
    removeSlotIndicators(shipGroup)
    createSlotIndicators(
      getScene()!,
      store.grid,
      store.availableSlots,
      store.shipConfig,
      shipGroup,
      getHazmatDangerSlotIds(store.availableSlots, store.currentContainer)
    )
  }
})

watch(() => store.restowContainer, () => {
  maybePlayHazmatRestowAlert()
  if (!shipGroup || !store.shipConfig) return
  if (store.phase === 'restow_selecting') {
    removeRestowSlotIndicators(shipGroup)
    createRestowSlotIndicators(
      store.grid,
      store.availableRestowSlots,
      store.shipConfig,
      shipGroup,
      getHazmatDangerSlotIds(store.availableRestowSlots, store.restowContainer)
    )
  }
})

watch(() => store.currentContainer, (container) => {
  void updateHoistMesh(container)
})

watch(() => store.nextThreeContainers, (containers) => {
  if (inboundQueueAdvancing) {
    pendingQueueContainers = [...containers]
    return
  }
  void updateQueueMeshes(containers)
}, { deep: true })

watch(() => store.disasterType, (type) => {
  const scene = getScene()
  if (!type || !shipGroup || !scene) return
  audio.playDisasterSequence(type)
  disasterAnimation = createDisasterAnimation(type, shipGroup, scene, () => { /* noop */ })
})

watch(() => store.lastPlacement, (placement) => {
  if (!placement) return
  if (placement.score >= 100) {
    // Perfect placement — cash register sound
    audio.playSound('caChing', 0.7)
  } else if (placement.score >= 80) {
    audio.playSound('correctDing', 0.6)
  } else if (placement.score < 30) {
    audio.playSound('negative', 0.45)
  }
})

watch(() => store.lastDischarge, (discharge) => {
  if (!discharge) return
  if (discharge.score >= 80) {
    audio.playSound('caChing', 0.6)
  } else if (discharge.score >= 50) {
    audio.playSound('correctDing', 0.5)
  } else if (discharge.score < 20) {
    audio.playSound('negative', 0.4)
  }
})

async function buildScene(): Promise<void> {
  const scene = getScene()
  if (!scene || !store.shipConfig) return
  clearScene()

  store.isLoading = true
  store.loadingMessage = 'Preparing berth…'

  createSkybox(scene)
  createSkyDome(scene)
  createLighting(scene)
  ocean = createOcean(scene)
  foam = createFoamParticles(scene)
  createDock(scene)

  // Fire off truck GLB downloads in parallel with ship model
  store.loadingMessage = 'Loading vessel manifest…'
  const truckPrewarm = loadTruckGLBs()

  // Load real GLB model for presets with glbPath, procedural for all others
  if (store.shipConfig.glbPath) {
    store.loadingMessage = 'Vessel inbound — tug assist in progress…'
    shipGroup = await loadShipGLB(scene, store.shipConfig)
  } else {
    shipGroup = createShip(scene, store.shipConfig)
  }

  // Ensure truck GLBs are cached before trucks are needed
  store.loadingMessage = 'Marshalling quayside equipment…'
  await truckPrewarm

  craneObj = createCrane(scene, store.shipConfig)

  // Snap ship to correct tilt before sail-in so it arrives already leaning correctly
  snapShipTilt(shipGroup, store.shipList, store.shipTrim)

  // Start ship off-screen and sail it in
  shipGroup.position.x = sailIn.startX
  sailIn.elapsed = 0
  sailIn.active = true

  // Single horn blast as ship arrives (sample already has 3 blasts; use vessel-appropriate sound)
  setTimeout(() => audio.playSound(hornSound(), 0.9), 1000)

  setCameraForShip(store.shipConfig)

  const isDischargeLevel = store.dischargeCount > 0
  if (isDischargeLevel) {
    // Discharge level: render pre-loaded containers — indicators added when briefing is dismissed
    createImportContainerMeshes(store.grid, store.shipConfig, shipGroup)

    // Spawn outbound truck queue on the far lane
    const dockPos = getDockPosition(craneObj!)
    const obTrucks = await createOutboundTruckQueue(
      scene,
      dockPos.x,
      dockPos.z,
      Math.min(store.dischargeCount - store.dischargedCount, 4)
    )
    outboundTruckGroups = obTrucks.map(e => e.truck)

    // Inbound queue is visible in the background during discharge
    await updateHoistMesh(store.currentContainer)
    updateQueueMeshes(store.nextThreeContainers)
  } else {
    // Load-only level — no slot indicators yet; added when briefing is dismissed
    await updateHoistMesh(store.currentContainer)
    updateQueueMeshes(store.nextThreeContainers)
  }

  attachPicking()
  startLoop()

  store.isLoading = false
  store.loadingMessage = ''

  // If the player dismissed the briefing while the ship was still loading (race condition),
  // the phase-watcher's 'briefing → selecting' branch ran with shipGroup=null and
  // skipped indicator creation. Catch up here now that the scene is fully built.
  if (store.phase === 'selecting' && store.dischargeCount === 0 && shipGroup && store.shipConfig) {
    createSlotIndicators(
      getScene()!,
      store.grid,
      store.availableSlots,
      store.shipConfig,
      shipGroup,
      getHazmatDangerSlotIds(store.availableSlots, store.currentContainer)
    )
  }
}

function getHazmatDangerSlotIds(slotIds: string[], container: Container | null): string[] {
  if (!container?.isHazmat) return []
  return slotIds.filter(slotId => {
    const slot = store.grid[slotId]
    return !!slot && wouldCauseHazmatExplosion(store.grid, slot, container)
  })
}

function maybePlayHazmatLoadAlert(): void {
  const container = store.currentContainer
  if (!container?.isHazmat) {
    lastHazmatLoadAlertId = null
    return
  }
  if (container.id === lastHazmatLoadAlertId) return
  lastHazmatLoadAlertId = container.id
  audio.playSound('hazmatAlert', 0.85)
}

function maybePlayHazmatRestowAlert(): void {
  const container = store.restowContainer
  if (!container?.isHazmat) {
    lastHazmatRestowAlertId = null
    return
  }
  if (container.id === lastHazmatRestowAlertId) return
  lastHazmatRestowAlertId = container.id
  audio.playSound('hazmatAlert', 0.85)
}

function pickImportSlot(event: MouseEvent): string | null {
  const camera = getCamera()
  const scene = getScene()
  if (!camera || !scene) return null

  const canvas = canvasRef.value
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  )
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(mouse, camera)
  const hits = raycaster.intersectObjects(scene.children, true)
  for (const hit of hits) {
    let obj: THREE.Object3D | null = hit.object
    while (obj) {
      if (obj.userData?.['isImportContainer']) return obj.userData['slotId'] as string
      obj = obj.parent
    }
  }
  return null
}

function pickSlotByUserData(event: MouseEvent, dataKey: string): string | null {
  const camera = getCamera()
  const scene = getScene()
  if (!camera || !scene) return null
  const canvas = canvasRef.value
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  )
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(mouse, camera)
  const hits = raycaster.intersectObjects(scene.children, true)
  for (const hit of hits) {
    let obj: THREE.Object3D | null = hit.object
    while (obj) {
      if (obj.userData?.[dataKey]) return obj.userData['slotId'] as string
      obj = obj.parent
    }
  }
  return null
}

function handleDischargeClick(event: MouseEvent): void {
  if (store.phase !== 'discharge_selecting') return

  const slotId = pickImportSlot(event)
  if (!slotId) return

  const result = store.pickDischargeContainer(slotId)
  if (!result) return

  const scene = getScene()!
  const cfg = store.shipConfig!
  const deckY = cfg.deckOffsetY ?? cfg.height * 0.3

  if (result.isRestow) {
    // Transit container — store already removed it from grid, phase is now restow_selecting.
    // Pull the mesh out of the ship group and keep a reference for the pending restow click.
    const containerMesh = removeImportContainerMesh(shipGroup!, slotId)
      ?? createContainerMesh(result.container)
    scene.add(containerMesh)

    const localPos = new THREE.Vector3(
      result.slot.xOffset,
      result.slot.yOffset + deckY + CONTAINER.size.y / 2,
      result.slot.zOffset
    )
    shipGroup!.localToWorld(localPos)
    containerMesh.position.copy(localPos)

    // Park the mesh at crane height so it's visually lifted while awaiting restow choice
    hoistMesh = containerMesh
    audio.playSound('containerLoad', 0.5)
    return
  }

  // Normal import discharge
  const containerMesh = removeImportContainerMesh(shipGroup!, slotId)
    ?? createContainerMesh(result.container)
  scene.add(containerMesh)

  removeImportSlotIndicators(shipGroup!)

  const localPos = new THREE.Vector3(
    result.slot.xOffset,
    result.slot.yOffset + deckY + CONTAINER.size.y / 2,
    result.slot.zOffset
  )
  shipGroup!.localToWorld(localPos)
  containerMesh.position.copy(localPos)

  const dockPos = getDockPosition(craneObj!)
  const outboundZ = dockPos.z + OUTBOUND_TRUCK.dockZOffset
  const outboundX = outboundTruckGroups[0]?.position.x ?? dockPos.x
  const outboundDockPos = new THREE.Vector3(
    outboundX + OUTBOUND_TRUCK.containerXOffset,
    TRUCK.deckHeight + CONTAINER.size.y / 2,
    outboundZ
  )

  audio.playSound('containerLoad', 0.6)

  currentAnimation = createDischargeAnimation(
    craneObj!,
    containerMesh,
    localPos,
    outboundDockPos,
    () => {
      audio.playSound('containerSet', 0.65)
      triggerOutboundTruckDepart(containerMesh)
      store.finalizeDischarge(slotId)
    }
  )
}

function handleRestowClick(event: MouseEvent): void {
  if (store.phase !== 'restow_selecting') return

  const slotId = pickSlotByUserData(event, 'isRestowSlot')
  if (!slotId) return

  const result = store.placeRestowContainer(slotId)
  if (!result) return

  const scene = getScene()!
  const cfg = store.shipConfig!
  const deckY = cfg.deckOffsetY ?? cfg.height * 0.3

  // The hoist mesh is the lifted transit container
  const containerMesh = hoistMesh ?? createContainerMesh(result.container)
  hoistMesh = null
  if (!containerMesh.parent) scene.add(containerMesh)

  removeRestowSlotIndicators(shipGroup!)

  const targetSlot = result.slot
  const targetLocalPos = new THREE.Vector3(
    targetSlot.xOffset,
    targetSlot.yOffset + deckY + CONTAINER.size.y / 2,
    targetSlot.zOffset
  )
  shipGroup!.localToWorld(targetLocalPos)

  audio.playSound('containerLoad', 0.5)

  currentAnimation = createPlacementAnimation(
    craneObj!,
    containerMesh,
    targetLocalPos,
    shipGroup!,
    () => {
      audio.playSound('containerSet', 0.6)
      // Add mesh back into import-containers group so it stays on the ship
      const importGroup = shipGroup!.getObjectByName('import-containers')
      if (importGroup && scene.getObjectById(containerMesh.id)) {
        scene.remove(containerMesh)
        containerMesh.position.set(
          targetSlot.xOffset,
          targetSlot.yOffset + deckY + CONTAINER.size.y / 2,
          targetSlot.zOffset
        )
        containerMesh.name = `import-container-${targetSlot.id}`
        importGroup.add(containerMesh)
      }
      store.finalizeRestow(slotId)
    }
  )
}

function handleRestowCancel(event: MouseEvent): void {
  if (store.phase !== 'restow_selecting') return
  event.preventDefault()

  const result = store.cancelRestowSelection()
  if (!result || !shipGroup || !store.shipConfig) return

  removeRestowSlotIndicators(shipGroup)

  const importGroup = shipGroup.getObjectByName('import-containers')
  const scene = getScene()
  if (hoistMesh && importGroup && scene) {
    const deckY = store.shipConfig.deckOffsetY ?? store.shipConfig.height * 0.3
    scene.remove(hoistMesh)
    hoistMesh.position.set(
      result.slot.xOffset,
      result.slot.yOffset + deckY + CONTAINER.size.y / 2,
      result.slot.zOffset
    )
    hoistMesh.name = `import-container-${result.slotId}`
    importGroup.add(hoistMesh)
    hoistMesh = null
  }
}

function triggerOutboundTruckDepart(containerMesh: THREE.Group): void {
  if (outboundTruckGroups.length === 0) return

  const frontTruck = outboundTruckGroups[0]
  // Trucks face negative-X, so they depart in negative-X direction
  const departX = frontTruck.position.x - OUTBOUND_TRUCK.spacing * 2

  // Snap container to truck top position (offset onto trailer bed, not the cab)
  containerMesh.position.x = frontTruck.position.x + OUTBOUND_TRUCK.containerXOffset
  containerMesh.position.z = frontTruck.position.z

  outboundTruckAnimations.push({
    truck: frontTruck,
    container: containerMesh,
    startX: frontTruck.position.x,
    endX: departX,
    elapsed: 0,
    duration: OUTBOUND_TRUCK.departDuration,
    departing: true,
  })

  // Remaining outbound trucks advance toward the crane (negative-X, filling the gap left by truck 0)
  for (let i = 1; i < outboundTruckGroups.length; i++) {
    const truck = outboundTruckGroups[i]
    setGroupOpacity(truck, 1.0)
    outboundTruckAnimations.push({
      truck,
      container: null,
      startX: truck.position.x,
      endX: truck.position.x - OUTBOUND_TRUCK.spacing,
      elapsed: 0,
      duration: 0.8,
      departing: false,
    })
  }

  outboundTruckGroups.shift()

  // Spawn a new empty truck at the back of the queue if more discharges are coming
  const remaining = store.dischargeCount - store.dischargedCount
  if (remaining > outboundTruckGroups.length) {
    const scene = getScene()
    if (scene && craneObj) {
      const dockPos = getDockPosition(craneObj)
      const lastTruck = outboundTruckGroups[outboundTruckGroups.length - 1]
      // Use the animation's endX (final destination) rather than current position,
      // which may still be mid-animation and drifts further back each discharge.
      const lastAnim = lastTruck
        ? outboundTruckAnimations.find(a => a.truck === lastTruck)
        : null
      const lastFinalX = lastAnim ? lastAnim.endX : lastTruck?.position.x
      const newX = lastFinalX !== undefined
        ? lastFinalX + OUTBOUND_TRUCK.spacing
        : dockPos.x
      createTruckGLB().then(truck => {
        // Spawn just one spacing back so it rolls in naturally.
        const spawnX = newX + OUTBOUND_TRUCK.spacing
        truck.position.set(spawnX, 0, dockPos.z + OUTBOUND_TRUCK.dockZOffset)
        truck.rotation.y = Math.PI
        scene.add(truck)
        outboundTruckGroups.push(truck)
        outboundTruckAnimations.push({
          truck,
          container: null,
          startX: spawnX,
          endX: newX,
          elapsed: 0,
          duration: 0.8,
          departing: false,
        })
      })
    }
  }
}

function handleClick(event: MouseEvent): void {
  if (store.phase === 'discharge_selecting') {
    handleDischargeClick(event)
    return
  }
  if (store.phase === 'restow_selecting') {
    handleRestowClick(event)
    return
  }
  if (store.phase !== 'selecting') return

  const slotId = pickSlot(event)
  if (!slotId) return

  const result = store.placeContainer(slotId)
  if (!result) return

  removeHoistMesh()

  const scene = getScene()!

  // Pick up from the front truck (truck #0 is at dockPos)
  const dockPos = getDockPosition(craneObj!)
  const pickupPos = new THREE.Vector3(dockPos.x + TRUCK.containerXOffset, TRUCK.deckHeight + CONTAINER.size.y + 0.1, dockPos.z)

  const containerMesh = createContainerMesh(result.container)
  containerMesh.position.copy(pickupPos)
  scene.add(containerMesh)

  const slot = store.grid[slotId]
  const cfg = store.shipConfig!
  const deckY = cfg.deckOffsetY ?? cfg.height * 0.3
  const targetPos = new THREE.Vector3(
    slot.xOffset,
    slot.yOffset + deckY + CONTAINER.size.y / 2,
    slot.zOffset
  )

  shipGroup!.localToWorld(targetPos)
  removeSlotIndicators(shipGroup!)

  audio.playSound('containerLoad', 0.7)

  // Trigger trucks to advance as the crane picks up
  triggerTruckAdvance()

  currentAnimation = createPlacementAnimation(
    craneObj!,
    containerMesh,
    targetPos,
    shipGroup!,
    () => {
      audio.playSound('containerSet', 0.75)

      const weight = result.container.weight
      shipShake.intensity = 0.08 + (weight / 30) * 0.15
      shipShake.elapsed = 0
      shipShake.active = true

      store.finalizePlacement(slotId)
    }
  )
}

async function ensureActiveTruckMesh(): Promise<void> {
  const scene = getScene()
  if (!scene || !craneObj || activeTruckMesh) return

  const dockPos = getDockPosition(craneObj)
  const truck = await createTerminalTruckGLB()
  truck.position.set(dockPos.x, 0.0, dockPos.z)
  truck.name = 'active-load-truck'
  scene.add(truck)
  activeTruckMesh = truck
}

function removeActiveTruckMesh(): void {
  const scene = getScene()
  if (!scene || !activeTruckMesh) return
  disposeGroup(activeTruckMesh, scene)
  activeTruckMesh = null
}

async function updateHoistMesh(container: Container | null): Promise<void> {
  if (!container || !craneObj) {
    removeHoistMesh()
    pendingHoistContainer = null
    removeActiveTruckMesh()
    return
  }

  if (inboundQueueAdvancing) {
    pendingHoistContainer = container
    return
  }

  const visibleContainer = hoistMesh?.userData['container'] as Container | undefined
  if (activeTruckMesh && visibleContainer?.id === container.id) {
    pendingHoistContainer = null
    return
  }

  removeHoistMesh()

  await ensureActiveTruckMesh()

  const scene = getScene()
  if (!scene) return

  // Show current container sitting on the front truck, ready to be picked up
  const dockPos = getDockPosition(craneObj)
  const mesh = createContainerMesh(container)
  mesh.position.set(dockPos.x + TRUCK.containerXOffset, TRUCK.deckHeight + CONTAINER.size.y / 2, dockPos.z)
  mesh.name = 'hoist-mesh'
  scene.add(mesh)
  hoistMesh = mesh
  pendingHoistContainer = null
}

function removeHoistMesh(): void {
  const scene = getScene()
  if (hoistMesh && scene) {
    scene.remove(hoistMesh)
    hoistMesh.traverse(child => {
      const mesh = child as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      if (mesh.material) {
        if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose())
        else mesh.material.dispose()
      }
    })
    hoistMesh = null
  }
}

async function updateQueueMeshes(containers: Container[]): Promise<void> {
  const scene = getScene()
  const disposeMeshGroup = (mesh: THREE.Group) => {
    if (scene) scene.remove(mesh)
    mesh.traverse(child => {
      const m = child as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      if (m.material) {
        if (Array.isArray(m.material)) m.material.forEach(mat => mat.dispose())
        else m.material.dispose()
      }
    })
  }
  for (const mesh of queueMeshes) disposeMeshGroup(mesh)
  for (const mesh of truckMeshes) disposeMeshGroup(mesh)
  queueMeshes = []
  truckMeshes = []
  truckAnimations = []

  if (!craneObj || !scene || !containers.length) return

  const dockPos = getDockPosition(craneObj)
  const zPos = dockPos.z

  for (let i = 0; i < containers.length; i++) {
    const container = containers[i]
    // The active load truck sits at dockPos under the crane. Visible queued trucks
    // should wait one full truck length behind it so the next container is not
    // rendered in the same pickup position.
    const xPos = dockPos.x - (i + 1) * TRUCK.spacing

    const truck = await createTerminalTruckGLB()
    truck.position.set(xPos, 0.0, zPos)
    truck.name = `queue-truck-${i}`
    scene.add(truck)
    truckMeshes.push(truck)

    const mesh = createContainerMesh(container)
    mesh.scale.setScalar(0.88)
    mesh.position.set(
      xPos + TRUCK.containerXOffset,
      TRUCK.deckHeight + CONTAINER.size.y / 2,
      zPos
    )
    mesh.name = `queue-${i}`
    scene.add(mesh)
    queueMeshes.push(mesh)
  }
}

function clearScene(): void {
  const scene = getScene()
  if (!scene) return

  // Stop ambient truck engine if running
  if (truckEngineNode) {
    try { truckEngineNode.stop() } catch { /* already stopped */ }
    truckEngineNode = null
  }

  const toRemove: THREE.Object3D[] = []
  scene.traverse(child => {
    if (child !== scene) toRemove.push(child)
  })
  for (const obj of toRemove) {
    if (obj.parent === scene) scene.remove(obj)
    const mesh = obj as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    if (mesh.material) {
      if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose())
      else mesh.material.dispose()
    }
  }
  if (disasterAnimation) {
    disasterAnimation.cleanup()
    disasterAnimation = null
  }
  currentAnimation = null
  pendingHoistContainer = null
  pendingQueueContainers = null
  inboundQueueAdvancing = false
  sailAway.active = false
  sailAway.elapsed = 0
  sailIn.active = false
  sailIn.elapsed = 0
  timerWarnedAt30pct = false
  timerWarnedAt15pct = false
  lastHazmatLoadAlertId = null
  lastHazmatRestowAlertId = null
  shipGroup = null
  craneObj = null
  ocean = null
  foam = null
  hoistMesh = null
  activeTruckMesh = null
  queueMeshes = []
  truckMeshes = []
  truckAnimations = []
  outboundTruckGroups = []
  outboundTruckAnimations = []
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

function setGroupOpacity(group: THREE.Group, opacity: number): void {
  const fullyOpaque = opacity >= 1.0
  group.traverse(child => {
    const mesh = child as THREE.Mesh
    if (!mesh.material) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const owned: THREE.Material[] = []
    for (let i = 0; i < mats.length; i++) {
      // Clone the material so we never mutate a shared cached instance
      let m = mats[i]
      if (!m.userData['owned']) {
        m = m.clone()
        m.userData['owned'] = true
        owned.push(m)
      } else {
        owned.push(m)
      }
      m.transparent = !fullyOpaque
      ;(m as THREE.MeshPhongMaterial).opacity = opacity
      if (fullyOpaque) m.needsUpdate = true
    }
    if (Array.isArray(mesh.material)) {
      mesh.material = owned as THREE.MeshPhongMaterial[]
    } else {
      mesh.material = owned[0] as THREE.MeshPhongMaterial
    }
  })
}

function disposeGroup(group: THREE.Group, scene: THREE.Scene): void {
  scene.remove(group)
  group.traverse(child => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      mats.forEach(m => m.dispose())
    }
  })
}

function triggerTruckAdvance(): void {
  if (!craneObj) return
  const scene = getScene()
  if (!scene) return
  inboundQueueAdvancing = true

  if (activeTruckMesh) {
    truckAnimations.push({
      truck: activeTruckMesh,
      container: null,
      startX: activeTruckMesh.position.x,
      endX: activeTruckMesh.position.x + TRUCK.spacing * 2,
      elapsed: 0,
      duration: 1.8,
      departing: true,
    })
    activeTruckMesh = null
  }

  truckMeshes.forEach((truck, i) => {
    // Queued trucks advance one TRUCK.spacing toward the crane with their own
    // container still on the trailer.
    const containerMesh = queueMeshes[i] ?? null
    setGroupOpacity(truck, 1.0)
    if (containerMesh) setGroupOpacity(containerMesh, 1.0)
    truckAnimations.push({
      truck,
      container: containerMesh,
      startX: truck.position.x,
      endX: truck.position.x + TRUCK.spacing,
      elapsed: 0,
      duration: 0.8,
      departing: false,
    })
  })
}

defineExpose({ buildScene, clearScene, isReady })
</script>

<template>
  <canvas
    ref="canvasRef"
    class="game-canvas"
    @click="handleClick"
    @mousedown.right.prevent="handleRestowCancel"
    @contextmenu.prevent
  />
</template>

<style scoped>
.game-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
}
</style>
