import type { ShipPreset } from '../types'

export const SHIP_PRESETS: Record<string, ShipPreset> = {
  small: {
    name: 'small',
    bays: 6,
    rows: 5,
    tiers: 6,
    length: 40,
    width: 12,
    height: 4,
    emptyWeight: 800,
    emptyVCG: 4.0,
    maxStackWeight: 120,
  },
  medium: {
    name: 'medium',
    bays: 8,
    rows: 7,
    tiers: 6,
    length: 54,
    width: 16,
    height: 5,
    emptyWeight: 1500,
    emptyVCG: 5.0,
    maxStackWeight: 150,
  },
  large: {
    name: 'large',
    bays: 10,
    rows: 9,
    tiers: 8,
    length: 68,
    width: 22,
    height: 6,
    emptyWeight: 3000,
    emptyVCG: 6.0,
    maxStackWeight: 200,
  },
}

export const PHYSICS = {
  listMultiplier: 1.5,
  trimMultiplier: 1.0,
  listWarning: 8,
  listCritical: 12,
  listDisaster: 15,
  trimWarning: 6,
  trimCritical: 9,
  trimDisaster: 12,
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
  podWrongOrderDeduction: -25,
  perfectBalanceBonus: 200,
  perfectBalanceThreshold: 2,
  targetScoreMultiplier: 0.75,
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
  size: { x: 2.4, y: 2.6, z: 2.4 },
  gap: 0.15,
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

export const WEIGHT_COLORS: Record<string, { three: number; hex: string }> = {
  light: { three: 0x4caf50, hex: '#4caf50' },
  medium: { three: 0xffeb3b, hex: '#ffeb3b' },
  heavy: { three: 0xf44336, hex: '#f44336' },
}
