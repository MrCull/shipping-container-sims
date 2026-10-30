/**
 * Reefer containers (R19). A box is a reefer when a hash of its container id falls below the cargo mix's
 * `reeferShare`: no RNG stream is consumed, so adding reefers to a scenario never moves any other random draw, and a
 * share of 0 (the default) changes nothing. Only full boxes are reefers.
 */
import type { CargoConfig } from './types'

/** FNV-1a of the id, scaled to [0, 1). */
function hash01(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 4294967296
}

/** True when the box `id` is a reefer under this cargo mix. */
export function isReefer(cargo: Pick<CargoConfig, 'reeferShare'>, id: string, full: boolean): boolean {
  const share = cargo.reeferShare ?? 0
  return share > 0 && full && hash01(id) < share
}
