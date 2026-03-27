export const BLOCK = {
  width: 2.44,
  height: 2.59,
  length: 6.06,
  gap: 0.05,
} as const

export const TOWER = {
  startLayers: 10,
  slotsPerLayer: 3,
} as const

export const CONTAINER_COLORS = [
  '#0b5394',
  '#1e7b34',
  '#1a237e',
  '#e65100',
  '#c62828',
  '#f9a825',
  '#546e7a',
  '#00838f',
] as const

export const PHYSICS = {
  baseStability: 1,
  comPenaltyScale: 0.22,
  heightPenaltyScale: 0.08,
  incompleteLayerPenalty: 0.06,
  fullLayerOverIncompleteExtra: 0.12,
  wobbleSpringK: 42,
  wobbleBaseDamping: 2.4,
  wobbleDampingStabilityFactor: 3.5,
  jitterToImpulseScale: 0.85,
  criticalRemovalImpulseScale: 2.2,
  maxAngle: 0.42,
  collapseGravity: 18,
  collapseAngularScatter: 4,
} as const

export const SCORING = {
  basePerMove: 100,
  speedMinMult: 1,
  speedMaxMult: 2,
  fastMoveSeconds: 2.5,
  steadinessMinMult: 1,
  steadinessMaxMult: 1.5,
  jitterRefForSteadiness: 800,
  comboTiers: [1, 1.2, 1.5, 2] as const,
  comboDecayWobble: 0.35,
  heightBonusPerLayer: 15,
} as const

export const CAMERA = {
  minDistance: 14,
  maxDistance: 120,
  maxPolarAngle: Math.PI / 2.05,
  idleOrbitSpeed: 0.08,
  shakeIntensity: 0.35,
  targetLerp: 0.06,
} as const

export const INTERACTION = {
  slideDuration: 0.55,
  ghostHeightAboveTop: BLOCK.height * 1.2,
  placementSnapTolerance: BLOCK.width * 0.35,
  minDragPxToExtract: 28,
  slideOutDistance: BLOCK.length * 0.55,
} as const
