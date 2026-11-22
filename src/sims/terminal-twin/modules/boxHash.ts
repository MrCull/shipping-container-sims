/**
 * Stable per-box hashing (#360): render-only choices (leasing livery, tone, wear) that must look the same every frame
 * and every reload hash the box id, never an array index or a frame count. A salt keeps the choices independent.
 */

/** FNV-1a 32-bit hash of `salt:id` (of `id` alone without a salt), as an unsigned integer. */
export function boxHash(id: string, salt?: string): number {
  const text = salt === undefined ? id : `${salt}:${id}`
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** The box's hash as a uniform number in [0, 1). FNV-1a's bits mix poorly on short, similar ids, so it is finalised first. */
export function boxUnit(id: string, salt?: string): number {
  let h = boxHash(id, salt)
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
