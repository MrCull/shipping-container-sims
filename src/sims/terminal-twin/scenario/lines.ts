/** Shipping lines: real ISO 6346 owner prefixes (owner code + "U") and default weights. */
import type { CargoConfig, ContainerSize, Weights } from './types'

/** Owner prefixes (owner code + equipment category "U") per shipping line. */
export const LINE_OWNER_PREFIX: Record<string, string> = {
  HMM: 'HDMU',
  MSC: 'MSCU',
  Maersk: 'MAEU',
  'CMA CGM': 'CMAU',
  'Hapag-Lloyd': 'HLXU',
  ONE: 'ONEU',
  Evergreen: 'EGHU',
  COSCO: 'CSNU',
  ZIM: 'ZIMU',
  'Yang Ming': 'YMLU',
}

export const SHIPPING_LINES = Object.keys(LINE_OWNER_PREFIX)

/** [A] Default line weights, weighted towards HMM (the TTI Algeciras operator's line). */
export const DEFAULT_LINE_WEIGHTS: Weights<string> = {
  HMM: 30,
  MSC: 15,
  Maersk: 12,
  'CMA CGM': 10,
  'Hapag-Lloyd': 8,
  ONE: 7,
  Evergreen: 6,
  COSCO: 6,
  ZIM: 3,
  'Yang Ming': 3,
}

/** [A] Default container size mix. */
export const DEFAULT_SIZE_MIX: Weights<ContainerSize> = { '20': 0.3, '40': 0.25, '40HC': 0.45 }

export const DEFAULT_CARGO: CargoConfig = {
  lines: DEFAULT_LINE_WEIGHTS,
  sizeMix: DEFAULT_SIZE_MIX,
  emptyShare: 0.1,
}
