/**
 * Streaming 53-bit string hash (cyrb53-style) for the event-log hash. The
 * running state is two uint32s stored in SimState, so the hash survives
 * snapshot/restore and is identical in Node and browsers.
 */

export type HashState = [number, number]

export const HASH_SEED: HashState = [0xdeadbeef, 0x41c6ce57]

export function hashUpdate(state: HashState, text: string): HashState {
  let [h1, h2] = state
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  return [h1 >>> 0, h2 >>> 0]
}

export function hashDigest(state: HashState): string {
  let [h1, h2] = state
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0)
  return value.toString(16).padStart(14, '0')
}
