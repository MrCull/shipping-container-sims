/**
 * Layout derivation (TT-15): from the counts (quay length, STS, blocks) to
 * positions, in the TTI functional order: quay edge, STS rail, apron lanes and
 * WTP pads, yard blocks across the quay, transfer stalls, roads and gate. Pure.
 * Fixtures keep their hand-placed layouts; presets and the setup dialog derive.
 */
import { BLOCK_PITCH_M } from './builder'
import { BLOCK_FRONTAGE_M } from './limits'
import type { ScenarioConfig, StsConfig } from './types'

/** Block centres along the quay (m): evenly spaced, centred on the quay, at most `BLOCK_PITCH_M` apart. */
export function deriveBlockXs(quayLengthM: number, count: number): number[] {
  if (count <= 0) return []
  const pitch = Math.max(BLOCK_FRONTAGE_M, Math.min(BLOCK_PITCH_M, quayLengthM / count))
  const r1 = (n: number) => Math.round(n * 10) / 10
  return Array.from({ length: count }, (_, i) => r1(quayLengthM / 2 + (i - (count - 1) / 2) * pitch))
}

/** `STS101`… when the first crane is numbered from 101 (TTI), else `STS01`…. */
export function stsIdFor(first: string | undefined, index: number): string {
  const m = /^STS(\d+)$/.exec(first ?? '')
  if (m && Number(m[1]) >= 100) return `STS${Number(m[1]) + index}`
  return `STS${String(index + 1).padStart(2, '0')}`
}

/** STS cranes spread evenly along the quay in rail order, keeping the first crane's numbering and ground positions. */
export function deriveSts(config: ScenarioConfig, count: number, lengthM: number): StsConfig[] {
  const groundPositions = config.sts[0]?.groundPositions ?? 3
  const pitch = lengthM / count
  return Array.from({ length: count }, (_, i) => ({
    id: stsIdFor(config.sts[0]?.id, i),
    gantryX: Math.round((i + 0.5) * pitch * 10) / 10,
    groundPositions,
  }))
}

/** Re-derive the block positions from the quay length and the block count (a new config). */
export function relayoutBlocks(config: ScenarioConfig): ScenarioConfig {
  const next: ScenarioConfig = JSON.parse(JSON.stringify(config))
  const blocks = next.yard?.blocks
  if (!blocks) return next
  const xs = deriveBlockXs(next.quay.lengthM, blocks.length)
  blocks.forEach((b, i) => (b.x = xs[i]))
  return next
}
