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
  /** Fraction of a block’s footprint that must rest on the layer below (sampled grid). */
  structuralMinSupportFraction: 0.4,
  structuralSampleGrid: 7,
  /** Softer blend so UI stability stays high when support is good (was ^1.25, too harsh). */
  structuralStabilityExponent: 0.42,
  wobbleSpringK: 42,
  wobbleBaseDamping: 2.4,
  wobbleDampingStabilityFactor: 3.5,
  jitterToImpulseScale: 0.85,
  /** Angular impulse per pixel while dragging; scales up mainly when stability is low */
  dragWobblePerPixel: 0.00055,
  /** If stability is below this while dragging, very shaky hands can topple the tower */
  shakyCollapseStabilityThreshold: 0.22,
  /** Cumulative drag jitter (px) needed with low stability to force-collapse */
  shakyCollapseJitterThreshold: 420,
  criticalRemovalImpulseScale: 2.2,
  /** Lean past this (rad) triggers collapse — higher = harder to tip */
  maxAngle: 0.55,
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
  minPolarAngle: 0.35,
  idleOrbitSpeed: 0.08,
  /** Radians per second for keyboard orbit */
  keyOrbitSpeed: 1.15,
  keyZoomSpeed: 22,
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
