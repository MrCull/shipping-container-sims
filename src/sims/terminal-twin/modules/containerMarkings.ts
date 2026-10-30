/**
 * Container markings (#119): a pure description of what is printed on each face of one box, drawn from that box's
 * data. No three.js, no canvas: `containerTextures.ts` paints it, tests read it.
 *
 *   - Door end: owner prefix, serial, check digit, ISO size-type code, the weight plate (MAX GROSS / TARE / NET /
 *     CU.CAP in kg and lbs), a CSC plate, a SUPER HEAVY triangle when heavy-rated, a bolt seal on the right-hand
 *     door handle when laden.
 *   - Sides and roof: the box number, and the line name as text in the line's colour (no logo artwork).
 *   - Wear: rust streaks, dents and faded paint, seeded from the box id so a box always looks the same.
 *
 * Plate values come from the ISO type. Tare is the same table the box properties use (`tareKgOf`), so a plate and
 * the box's stored tare never disagree. The 45G1 row is the one on the reference photo (Triton 45G1: 32,500 kg
 * max gross, 3,700 kg tare, 76.4 m3); the rest are typical [A] values.
 */
import atlas from '../assets/models/containers/livery-atlas.json'
import { iso6346CheckDigit } from '../scenario/iso6346'
import { isoTypeOf, tareKgOf } from '../scenario/containerProps'
import type { ContainerSize } from '../scenario/types'

const KG_TO_LBS = 2.20462
const M3_TO_CUFT = 35.3147
/** Plates print lbs and cu ft rounded to the nearest 10. */
const round10 = (n: number): number => Math.round(n / 10) * 10

export interface WeightPlate {
  maxGrossKg: number
  maxGrossLbs: number
  tareKg: number
  tareLbs: number
  /** Payload: max gross minus tare. */
  netKg: number
  netLbs: number
  cuCapM3: number
  cuCapCuFt: number
}

/** [A] Max gross (kg) and cubic capacity (m3) by ISO size-type code and body (G = general, R = reefer). */
const SPEC: Record<string, { maxGrossKg: number; cuCapM3: number }> = {
  '22G1': { maxGrossKg: 30480, cuCapM3: 33.2 },
  '42G1': { maxGrossKg: 30480, cuCapM3: 67.7 },
  '45G1': { maxGrossKg: 32500, cuCapM3: 76.4 },
  '22R1': { maxGrossKg: 30480, cuCapM3: 28.3 },
  '42R1': { maxGrossKg: 34000, cuCapM3: 59.3 },
  '45R1': { maxGrossKg: 34000, cuCapM3: 67.3 },
}

const SIZE_OF_CODE: Record<string, ContainerSize> = { '22': '20', '42': '40', '45': '40HC' }
const FALLBACK_ISO: Record<ContainerSize, string> = { '20': '22G1', '40': '42G1', '40HC': '45G1' }

/** The plate of an ISO type; an unknown code uses the general-purpose box of its size prefix (else a 40 ft). */
export function plateFor(isoType: string): WeightPlate {
  const known = SPEC[isoType] ? isoType : (FALLBACK_ISO[SIZE_OF_CODE[isoType.slice(0, 2)] ?? '40'] ?? '42G1')
  const spec = SPEC[known]
  const size = SIZE_OF_CODE[known.slice(0, 2)]
  const tareKg = tareKgOf(size, known[2] === 'R')
  const netKg = spec.maxGrossKg - tareKg
  return {
    maxGrossKg: spec.maxGrossKg,
    maxGrossLbs: round10(spec.maxGrossKg * KG_TO_LBS),
    tareKg,
    tareLbs: round10(tareKg * KG_TO_LBS),
    netKg,
    netLbs: round10(netKg * KG_TO_LBS),
    cuCapM3: spec.cuCapM3,
    cuCapCuFt: round10(spec.cuCapM3 * M3_TO_CUFT),
  }
}

export interface MarkingsInput {
  /** ISO 6346 id, e.g. CSQU3054383. */
  id: string
  size: ContainerSize
  line: string
  /** ISO size-type code, e.g. 45G1; absent = the general-purpose type of the size. */
  isoType?: string
  laden: boolean
  /** Heavy weight class: gets the SUPER HEAVY triangle. */
  heavy?: boolean
}

export interface DoorMarkings {
  ownerPrefix: string
  serial: string
  checkDigit: number
  isoType: string
  plate: WeightPlate
  superHeavy: boolean
  cscPlate: boolean
  /** A bolt seal on the right-hand door handle (as seen from behind the box): laden boxes only. */
  boltSeal: boolean
}

export interface SideMarkings {
  /** "CSQU 305438 3" */
  boxNumber: string
  lineName: string
  /** The colour the line prints its name in (the livery's text colour). */
  lineColour: string
}

export interface RoofMarkings {
  boxNumber: string
}

export interface RustStreak {
  /** 0..1 along the face. */
  x: number
  /** Width and length as fractions of the face. */
  w: number
  len: number
  alpha: number
}

export interface Dent {
  x: number
  y: number
  /** Radius as a fraction of the face height. */
  r: number
}

export interface Wear {
  /** Faded paint, 0 (fresh) to 1 (chalky). */
  fade: number
  rustStreaks: RustStreak[]
  dents: Dent[]
  /** Seed for the texture's own speckle, so painting a box twice gives the same pixels. */
  seed: number
}

export interface ContainerMarkings {
  door: DoorMarkings
  side: SideMarkings
  roof: RoofMarkings
  wear: Wear
}

function hash32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32: small, fast, deterministic. */
function stream(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Wear of one box: a function of its id alone. */
export function wearFor(id: string): Wear {
  const seed = hash32(`wear:${id}`)
  const rng = stream(seed)
  const fade = Math.round(rng() * rng() * 100) / 100 // most boxes are fairly fresh, a few chalky
  const rustStreaks: RustStreak[] = Array.from({ length: Math.floor(rng() * 7) }, () => ({
    x: round2(rng()),
    w: round2(0.01 + rng() * 0.03),
    len: round2(0.1 + rng() * 0.5),
    alpha: round2(0.15 + rng() * 0.4),
  }))
  const dents: Dent[] = Array.from({ length: Math.floor(rng() * 5) }, () => ({ x: round2(rng()), y: round2(rng()), r: round2(0.03 + rng() * 0.07) }))
  return { fade, rustStreaks, dents, seed }
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** Everything printed on one box. */
export function describeMarkings(input: MarkingsInput): ContainerMarkings {
  const first10 = input.id.slice(0, 10)
  const ownerPrefix = first10.slice(0, 4)
  const serial = first10.slice(4, 10)
  const checkDigit = iso6346CheckDigit(first10)
  const isoType = input.isoType && SPEC[input.isoType] ? input.isoType : isoTypeOf(input.size, false)
  const number = `${ownerPrefix} ${serial} ${checkDigit}`
  const livery = atlas.liveries.find((l) => l.line === input.line) ?? atlas.liveries[atlas.genericIndex]
  return {
    door: {
      ownerPrefix,
      serial,
      checkDigit,
      isoType,
      plate: plateFor(isoType),
      superHeavy: input.heavy === true,
      cscPlate: true,
      boltSeal: input.laden,
    },
    side: { boxNumber: number, lineName: livery.line ?? input.line, lineColour: livery.text },
    roof: { boxNumber: number },
    wear: wearFor(input.id),
  }
}
