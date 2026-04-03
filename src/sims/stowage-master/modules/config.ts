import type { ShipPreset } from '../types'

export const SHIP_PRESETS: Record<string, ShipPreset> = {
  small: {
    name: 'small',
    bays: 3,
    rows: 3,
    tiers: 4,
    length: 40,
    width: 12,
    height: 4,
    emptyWeight: 800,
    emptyVCG: 4.0,
    // The engine room and accommodation block sit aft, adding a modest stern-down
    // trim moment without making the whole lightship act like aft ballast.
    emptyTrimMoment: -260,
    maxStackWeight: 120,
    // 3 bays: cellX = 18.8/3 = 6.27m > container length 5.9m — no bay overlap.
    // cargoXOffsetFraction=0.095 centres the 3-bay grid between fwd mast and aft
    // superstructure (cargo zone midpoint ~3.8m bow-ward of midship).
    cargoLengthFraction: 0.47,
    cargoXOffsetFraction: 0.095,
    // 3 rows: cellZ = 12*0.60/3 = 2.40m. Container width 2.55m → 0.15m overlap (imperceptible).
    // Outer row centres at ±2.40m, container edges at ±3.68m — within visual hull ±3.76m.
    cargoWidthFraction: 0.60,
    sternBlockedBays: 0,
    // GLB model fields
    glbPath: 'small-feeder',
    deckOffsetY: 1.5,   // raised with glbYOffset so containers stay on deck
    glbYOffset: 3.3,    // small raise above original 3.0 — hull waterline visible above ocean
  },
  medium: {
    name: 'medium',
    bays: 6,
    rows: 5,
    tiers: 5,
    length: 54,
    width: 16,
    height: 5,
    emptyWeight: 1500,
    emptyVCG: 5.0,
    maxStackWeight: 150,
    cargoLengthFraction: 0.56,
    cargoXOffsetFraction: 0.04,
    cargoWidthFraction: 0.72,
    sternBlockedBays: 0,
  },
  'medium-carrier': {
    name: 'medium-carrier',
    // 12 active bays: two groups of 6 separated by a mid-ship gap.
    // Bays 10–11 (foremost two) sit on a raised forecastle ~1 container-height higher.
    bays: 12,
    rows: 4,
    tiers: 4,
    // Nominal game-space length (before glbScaleMultiplier shrinks the visual model)
    length: 90,
    width: 22,
    height: 7,
    emptyWeight: 2500,
    emptyVCG: 6.0,
    maxStackWeight: 170,
    // cargoLengthFraction / cargoXOffsetFraction are unused when bayXOffsets is set,
    // but kept as reasonable fallbacks.
    cargoLengthFraction: 0.82,
    cargoXOffsetFraction: 0.08,
    cargoWidthFraction: 0.62,
    sternBlockedBays: 0,
    glbPath: 'medium-carrier',
    glbScaleMultiplier: 1.431,
    glbRotationY: 0,
    deckOffsetY: 5.0,
    glbYOffset: -8,
    physicsMultiplier: 0.45,
    glbZOffset: 6,
    // Explicit X positions for each bay (game units, bow = +X).
    // Two groups of 6 with a ~9-unit gap (≈1.5 container lengths) between groups.
    // Spacing within each group: 6.3 units (≈container length + gap).
    bayXOffsets: [
      // Stern group (bays 0–5) — shifted back ½ container length (−3.05)
      -34.55, -28.25, -21.95, -15.65, -9.35, -3.05,
      // Bow group (bays 6–11) — shifted forward ½ container length (+3.05)
      12.50, 18.80, 25.10, 31.40, 37.70, 44.00,
    ],
    bayYBaseOffsets: [
      1.86, 1.86, 1.86, 1.86, 1.86, 1.86,  // stern 6 — prev 1.33 + 0.53 (2/10 container height)
      2.12, 2.12, 2.12, 2.12,               // mid bow 4 — 8/10 container height
      4.07, 4.07,                            // forecastle pair — minus 1/3 container height
    ],
  },
  large: {
    name: 'large',
    bays: 8,
    rows: 7,
    tiers: 6,
    length: 68,
    width: 22,
    height: 6,
    emptyWeight: 3000,
    emptyVCG: 6.0,
    maxStackWeight: 200,
    cargoLengthFraction: 0.56,
    cargoXOffsetFraction: 0.04,
    cargoWidthFraction: 0.72,
    sternBlockedBays: 0,
  },
}

export const PHYSICS = {
  listMultiplier: 2.5,
  trimMultiplier: 2.5,
  listWarning: 5,
  listCritical: 8,
  listDisaster: 12,
  trimWarning: 4,
  trimCritical: 7,
  trimDisaster: 10,
  vcgWarning: 6.0,
  vcgDanger: 8.0,
} as const

export const SCORING = {
  heavyHighDeduction: -35,
  heavyHighWeightThreshold: 20,
  outboardDeduction: -25,
  outboardWeightThreshold: 15,
  imbalanceDeduction: -35,
  hazmatDeduction: -50,
  hazmatSafeBonus: 25,
  podWrongOrderDeduction: -25,
  perfectBalanceBonus: 50,
  perfectBalanceThreshold: 2,
  targetScoreMultiplier: 0.60,
} as const

export const STAR_THRESHOLDS = [
  { stars: 0, title: 'Absolute Maritime Disaster', minPercent: 0 },
  { stars: 1, title: 'Landlubber', minPercent: 0.2 },
  { stars: 2, title: 'Deck Hand', minPercent: 0.4 },
  { stars: 3, title: 'Solid Stevedore', minPercent: 0.6 },
  { stars: 4, title: 'Harbor Master', minPercent: 0.8 },
  { stars: 5, title: 'Perfect Planner', minPercent: 0.95 },
] as const

export const CONTAINER = {
  lightMin: 4,
  lightMax: 10,
  mediumMin: 11,
  mediumMax: 20,
  heavyMin: 21,
  heavyMax: 30,
  hazmatRate: 0.1,
  // Logical slot footprint (used for physics/offset calculations)
  size: { x: 2.55, y: 2.65, z: 6.1 },
  gap: 0.18,
} as const

export const PORTS = [
  { name: 'Rotterdam', color: 0x2196f3, hex: '#2196f3', order: 0 },
  { name: 'Singapore', color: 0x4caf50, hex: '#4caf50', order: 1 },
  { name: 'Shanghai', color: 0xf44336, hex: '#f44336', order: 2 },
  { name: 'Hamburg', color: 0xff9800, hex: '#ff9800', order: 3 },
  { name: 'Busan', color: 0x9c27b0, hex: '#9c27b0', order: 4 },
] as const

export const CRANE = {
  animationSpeed: 1.0,
  towerHeight: 20,
  boomOverhang: 10,
  cableCount: 4,
  spreaderWidth: 2.6,
  dockOffset: 8,
} as const

export const FX = {
  enableScreams: true,
  explosionVolume: 0.9,
  splashVolume: 0.7,
  cameraShakeIntensity: 1.0,
} as const

export const HAZMAT = {
  minBaySeparation: 2,
  minRowSeparation: 1,
  minTierSeparation: 2,
} as const

export const TRUCK = {
  /** Height of trailer deck above ground (game meters). */
  deckHeight: 1.75,
  /** Uniform scale applied to trailer GLB to reach ~14 m length. */
  trailerScale: 1.1227,
  /**
   * Target height for the cab in game meters.
   * Uniform scale is derived from this: scale = cabTargetHeight / glbHeight.
   * Uniform scale preserves the model's proportions and never squashes regardless of rotation.
   */
  cabTargetHeight: 4.9,
  /** rotation.y for the cab. If direction is wrong try adding/subtracting Math.PI. */
  cabRotationY: Math.PI / 4,
  /** Cab group X offset relative to the trailer centre. */
  cabXOffset: 3.5,
  /** X offset applied to the container mesh relative to the truck group origin. */
  containerXOffset: -5,
  /** Spacing between truck group origins along X. */
  spacing: 22,
} as const

export const OUTBOUND_TRUCK = {
  /**
   * Z offset from crane dock position.
   * Crane dockZ is already negative (land side). A negative offset pushes outbound
   * trucks further into the land side — the far lane away from the ship.
   */
  dockZOffset: -14,
  /** Spacing between outbound truck group origins along X. */
  spacing: 22,
  /** Duration (seconds) for a loaded outbound truck to drive away and fade. */
  departDuration: 1.8,
  /** Normalised t at which fade-out begins (0–1). */
  fadeStartT: 0.4,
  /**
   * X offset applied to the dropped container relative to the outbound truck group origin.
   * Outbound trucks face Math.PI (negative-X), so the trailer bed is in the positive-X
   * direction from the group centre. Half a container length back from centre positions
   * the box on the trailer rather than over the cab.
   */
  containerXOffset: 5,
} as const

export const WEIGHT_COLORS: Record<string, { three: number; hex: string }> = {
  light: { three: 0x4caf50, hex: '#4caf50' },
  medium: { three: 0xffeb3b, hex: '#ffeb3b' },
  heavy: { three: 0xf44336, hex: '#f44336' },
}
