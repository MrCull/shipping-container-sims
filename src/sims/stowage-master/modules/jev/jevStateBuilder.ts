// Builds the Jev `state` object from a plain game snapshot. Pure — no store access, no Vue.
// The controller (plan 04's `useJevController`) is responsible for building `JevGameSnapshot`
// from `useGameStore()` and calling `buildJevState()`.
//
// See .ai/plans/stowage-master/02-jev-state-and-questions.md §2.1, §2.3, §2.7.

import type { Container, LevelCompletionMode, PortDefinition, ShipPreset, Slot } from '../../types'
import type { JevMoveKind } from '../../types/jev'
import { JevError } from '../../types/jev'
import { JEV_CONFIG } from './jevConfig'
import { getListLevel, getTrimLevel } from '../physics'
import { PHYSICS } from '../config'
import { buildRulesBlock } from './jevRules'

/** Snapshot the controller must build from `useGameStore()` before calling `buildJevState()`. */
export interface JevGameSnapshot {
  kind: JevMoveKind
  level: { id: number; name: string; completionMode: LevelCompletionMode }
  preset: ShipPreset
  /** Deep-cloned plain grid (e.g. via `structuredClone(toRaw(store.grid))`) so mutation can't race it. */
  grid: Record<string, Slot>
  ports: PortDefinition[]
  physics: { list: number; trim: number; vcg: number }
  score: number
  targetScore: number
  perfectScore: number
  moveCount: number
  containersTotal: number
  currentContainerIndex: number
  dischargeCount: number
  dischargedCount: number
  timer: { total: number; remaining: number }
  currentContainer: Container | null
  restowContainer: Container | null
  restowFromSlotId: string | null
  /** `containers.slice(currentContainerIndex + 1)` — load phase only, but always safe to pass. */
  upcoming: Container[]
  /** `availableSlots` | `dischargeableSlots` | `availableRestowSlots`, matching `kind`. */
  legalSlotIds: string[]
  /** `store.events` messages, newest first, max 5. */
  recentEvents: string[]
}

export interface BuildJevStateResult {
  state: Record<string, unknown>
  estimatedTokens: number
  degradeSteps: string[]
}

const TOKEN_CHARS_PER_TOKEN = 3.5
const UPCOMING_DEFAULT_LIMIT = 12
const UPCOMING_DEGRADED_LIMIT = 6

export function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / TOKEN_CHARS_PER_TOKEN)
}

function containerFact(c: Container): Record<string, unknown> {
  return {
    id: c.id,
    weight_t: round1(c.weight),
    category: c.weightCategory,
    port: c.port,
    port_order: c.portOrder,
    hazmat: c.isHazmat,
  }
}

function containerStatus(container: Container): 'import' | 'transit' | 'onboard' {
  if (container.isImport) return 'import'
  if (container.isTransit) return 'transit'
  return 'onboard'
}

function buildVesselBlock(preset: ShipPreset, grid: Record<string, Slot>): Record<string, unknown> {
  const bayXm: Record<string, number> = {}
  const rowZm: Record<string, number> = {}
  const bayBaseYm: Record<string, number> = {}
  const bayNumbers = new Set<number>()
  const rowNumbers = new Set<number>()
  const tierNumbers = new Set<number>()

  for (const slot of Object.values(grid)) {
    bayNumbers.add(slot.bay)
    rowNumbers.add(slot.row)
    tierNumbers.add(slot.tier)
    const bayKey = String(slot.bay).padStart(2, '0')
    const rowKey = String(slot.row).padStart(2, '0')
    if (!(bayKey in bayXm)) bayXm[bayKey] = round1(slot.xOffset)
    if (!(rowKey in rowZm)) rowZm[rowKey] = round1(slot.zOffset)
    if (slot.tierIndex === 0 && !(bayKey in bayBaseYm)) bayBaseYm[bayKey] = round1(slot.yOffset)
  }

  const referenceBay = bayNumbers.size > 0 ? Math.min(...bayNumbers) : 1
  const referenceBayKey = String(referenceBay).padStart(2, '0')
  const referenceBase = bayBaseYm[referenceBayKey] ?? 0
  const tierYm: Record<string, number> = {}
  for (const slot of Object.values(grid)) {
    if (slot.bay !== referenceBay) continue
    tierYm[String(slot.tier).padStart(2, '0')] = round1(slot.yOffset - referenceBase)
  }

  const vessel: Record<string, unknown> = {
    preset: preset.name,
    bays: [...bayNumbers].sort((a, b) => a - b),
    rows: [...rowNumbers].sort((a, b) => a - b),
    tiers: [...tierNumbers].sort((a, b) => a - b),
    max_stack_weight_t: preset.maxStackWeight,
    empty_weight_t: preset.emptyWeight,
    bay_x_m: bayXm,
    row_z_m: rowZm,
    tier_y_m: tierYm,
  }
  if (preset.bayYBaseOffsets) {
    vessel.bay_base_y_m = bayBaseYm
  }
  return vessel
}

function listSide(list: number): 'starboard-heavy' | 'port-heavy' | 'even' {
  if (list > 0.01) return 'starboard-heavy'
  if (list < -0.01) return 'port-heavy'
  return 'even'
}

function trimEnd(trim: number): 'bow-heavy' | 'stern-heavy' | 'even' {
  if (trim > 0.01) return 'bow-heavy'
  if (trim < -0.01) return 'stern-heavy'
  return 'even'
}

function buildStabilityBlock(physics: { list: number; trim: number; vcg: number }): Record<string, unknown> {
  return {
    list_deg: round2(physics.list),
    list_side: listSide(physics.list),
    list_status: getListLevel(physics.list),
    trim_deg: round2(physics.trim),
    trim_end: trimEnd(physics.trim),
    trim_status: getTrimLevel(physics.trim),
    vcg_m: round2(physics.vcg),
    thresholds: {
      list: { warning: PHYSICS.listWarning, critical: PHYSICS.listCritical, disaster: PHYSICS.listDisaster },
      trim: { warning: PHYSICS.trimWarning, critical: PHYSICS.trimCritical, disaster: PHYSICS.trimDisaster },
    },
  }
}

function buildLevelBlock(snapshot: JevGameSnapshot): Record<string, unknown> {
  return {
    id: snapshot.level.id,
    name: snapshot.level.name,
    phase: snapshot.kind,
    completion_mode: snapshot.level.completionMode,
    score: snapshot.score,
    target_score: snapshot.targetScore,
    perfect_score: snapshot.perfectScore,
    moves_made: snapshot.moveCount,
    containers_left_to_load: Math.max(0, snapshot.containersTotal - snapshot.currentContainerIndex),
    imports_left_to_discharge: Math.max(0, snapshot.dischargeCount - snapshot.dischargedCount),
    timer_seconds_remaining: snapshot.timer.total > 0 ? Math.round(snapshot.timer.remaining) : 0,
  }
}

function buildMoveBlock(snapshot: JevGameSnapshot): Record<string, unknown> {
  if (snapshot.kind === 'load') {
    return {
      kind: 'load',
      container: snapshot.currentContainer ? containerFact(snapshot.currentContainer) : null,
    }
  }
  if (snapshot.kind === 'discharge') {
    return {
      kind: 'discharge',
      imports_remaining: Math.max(0, snapshot.dischargeCount - snapshot.dischargedCount),
      note: 'Choose which top-of-stack container to lift next.',
    }
  }
  return {
    kind: 'restow',
    container: snapshot.restowContainer ? containerFact(snapshot.restowContainer) : null,
    lifted_from: snapshot.restowFromSlotId,
  }
}

function buildUpcomingLoadList(upcoming: Container[], limit: number): Record<string, unknown> {
  const next = upcoming.slice(0, limit).map(containerFact)
  const byPort: Record<string, number> = {}
  let heavy = 0
  let medium = 0
  let light = 0
  let hazmat = 0
  for (const c of upcoming) {
    byPort[c.port] = (byPort[c.port] ?? 0) + 1
    if (c.weightCategory === 'heavy') heavy++
    else if (c.weightCategory === 'medium') medium++
    else light++
    if (c.isHazmat) hazmat++
  }
  return {
    next,
    remaining_summary: { count: upcoming.length, by_port: byPort, heavy, medium, light, hazmat },
  }
}

function compactContainerLine(slot: Slot, container: Container): string {
  const tierLabel = `T${String(slot.tier).padStart(2, '0')}`
  const hazLabel = container.isHazmat ? ' HAZ' : ''
  return `${tierLabel} ${round1(container.weight)}t ${container.port}#${container.portOrder}${hazLabel} ${containerStatus(container)}`
}

function buildBayPlan(grid: Record<string, Slot>, compact: boolean): Record<string, unknown> {
  const bays = [...new Set(Object.values(grid).map(s => s.bay))].sort((a, b) => a - b)
  const rows = [...new Set(Object.values(grid).map(s => s.row))].sort((a, b) => a - b)
  const bayPlan: Record<string, unknown> = {}

  for (const bay of bays) {
    for (const row of rows) {
      const key = `${String(bay).padStart(2, '0')}-${String(row).padStart(2, '0')}`
      const stackSlots = Object.values(grid)
        .filter(s => s.bay === bay && s.row === row)
        .sort((a, b) => a.tier - b.tier)

      let weight = 0
      const entries: Array<Record<string, unknown>> = []
      const compactEntries: string[] = []

      for (const slot of stackSlots) {
        if (!slot.container) continue
        weight += slot.container.weight
        if (compact) {
          compactEntries.push(compactContainerLine(slot, slot.container))
        } else {
          entries.push({
            tier: slot.tier,
            id: slot.container.id,
            t: round1(slot.container.weight),
            cat: slot.container.weightCategory,
            port: slot.container.port,
            port_order: slot.container.portOrder,
            hazmat: slot.container.isHazmat,
            status: containerStatus(slot.container),
          })
        }
      }

      bayPlan[key] = {
        stack_weight_t: round1(weight),
        containers: compact ? compactEntries : entries,
      }
    }
  }

  return bayPlan
}

function buildHazmatPositions(grid: Record<string, Slot>): string[] {
  return Object.values(grid)
    .filter(s => s.container?.isHazmat)
    .map(s => s.id)
    .sort()
}

interface DegradeOptions {
  upcomingLimit: number
  includeRecentEvents: boolean
  compactBayPlan: boolean
}

function buildState(snapshot: JevGameSnapshot, opts: DegradeOptions): Record<string, unknown> {
  const state: Record<string, unknown> = {
    schema: JEV_CONFIG.stateSchemaVersion,
    rules: buildRulesBlock(snapshot.preset),
    level: buildLevelBlock(snapshot),
    vessel: buildVesselBlock(snapshot.preset, snapshot.grid),
    stability: buildStabilityBlock(snapshot.physics),
    port_rotation: [...snapshot.ports]
      .sort((a, b) => a.order - b.order)
      .map(p => ({ order: p.order, port: p.name })),
    move: buildMoveBlock(snapshot),
    bay_plan: buildBayPlan(snapshot.grid, opts.compactBayPlan),
    hazmat_positions: buildHazmatPositions(snapshot.grid),
  }

  if (snapshot.kind === 'load') {
    state.upcoming_load_list = buildUpcomingLoadList(snapshot.upcoming, opts.upcomingLimit)
  }

  if (opts.includeRecentEvents) {
    state.recent_events = snapshot.recentEvents
  }

  return state
}

/**
 * Builds the Jev `state` object for one move, enforcing the token budget in
 * `JEV_CONFIG.maxStateTokensEstimate` by degrading in the order specified in plan 02 §2.7:
 * trim `upcoming_load_list.next` to 6, drop `recent_events`, then compact the bay plan.
 * Throws a `JevError('bad_request', ...)` locally (no API call) if it is still too big.
 */
export function buildJevState(snapshot: JevGameSnapshot, options: { mode?: 'raw' } = {}): BuildJevStateResult {
  const mode = options.mode ?? 'raw'
  if (mode !== 'raw') {
    // See plan 02 §2.9 — "assisted" mode is documented but not built.
    throw new Error(`buildJevState: mode "${mode}" is not implemented`)
  }

  const degradeSteps: string[] = []
  const opts: DegradeOptions = {
    upcomingLimit: UPCOMING_DEFAULT_LIMIT,
    includeRecentEvents: true,
    compactBayPlan: false,
  }

  let state = buildState(snapshot, opts)
  let estimatedTokens = estimateTokens(state)

  if (estimatedTokens > JEV_CONFIG.maxStateTokensEstimate && snapshot.kind === 'load') {
    opts.upcomingLimit = UPCOMING_DEGRADED_LIMIT
    degradeSteps.push('trimmed upcoming_load_list.next to 6')
    state = buildState(snapshot, opts)
    estimatedTokens = estimateTokens(state)
  }

  if (estimatedTokens > JEV_CONFIG.maxStateTokensEstimate) {
    opts.includeRecentEvents = false
    degradeSteps.push('dropped recent_events')
    state = buildState(snapshot, opts)
    estimatedTokens = estimateTokens(state)
  }

  if (estimatedTokens > JEV_CONFIG.maxStateTokensEstimate) {
    opts.compactBayPlan = true
    degradeSteps.push('compacted bay_plan containers into strings')
    state = buildState(snapshot, opts)
    estimatedTokens = estimateTokens(state)
  }

  if (estimatedTokens > JEV_CONFIG.maxStateTokensEstimate) {
    throw new JevError(
      'bad_request',
      `Jev state is too large even after degrading (~${estimatedTokens} estimated tokens, budget ${JEV_CONFIG.maxStateTokensEstimate}). Steps applied: ${degradeSteps.join('; ') || 'none'}.`,
    )
  }

  return { state, estimatedTokens, degradeSteps }
}
