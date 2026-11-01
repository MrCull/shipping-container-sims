/** Display text of a colour mode's legend keys (#130): catalogue messages for the fixed values, the raw value for lines, ports and ISO types. */
import { t, type MessageKey } from '../i18n/messages'
import type { ColourBy } from './colourBy'

const GENERIC = new Set(['other', 'unknown', 'rob', 'none'])

export function colourKeyLabel(mode: ColourBy, key: string): string {
  if (GENERIC.has(key)) return t(`colourBy.key.${key}` as MessageKey)
  switch (mode) {
    case 'weight':
      return t(`inspector.weightClass.${key}` as MessageKey)
    case 'transit':
      return t(`inspector.transitStatus.${key}` as MessageKey)
    case 'dwell':
      return t(`colourBy.dwell.${key}` as MessageKey)
    case 'length':
      return t(`colourBy.length.${key}` as MessageKey)
    case 'departure':
      return t(`colourBy.departure.${key}` as MessageKey)
    case 'special':
    case 'flow':
    case 'call':
      return t(`colourBy.key.${key}` as MessageKey)
    default:
      return key
  }
}
