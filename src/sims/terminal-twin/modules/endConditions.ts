/**
 * The setup dialog's end-condition fields (N vessels, sim duration in hours,
 * total moves) and how they become `ScenarioConfig.endConditions`. The first
 * condition met ends the run; vessels default to all scheduled.
 */
import type { MessageKey } from '../i18n/messages'
import type { EndConditions } from '../scenario/types'

export interface EndFields {
  vessels: string
  hours: string
  moves: string
}

export type EndFieldsResult = { ok: true; value: EndConditions } | { ok: false; error: MessageKey }

export function endFieldsOf(ec: EndConditions): EndFields {
  return {
    vessels: ec.vesselsCompleted === undefined ? '' : String(ec.vesselsCompleted),
    hours: ec.simDurationS === undefined ? '' : String(ec.simDurationS / 3600),
    moves: ec.moves === undefined ? '' : String(ec.moves),
  }
}

/** A blank field is "not set" (null); anything else must be a finite number. */
function parse(value: string | number | null | undefined): number | null | undefined {
  // number inputs bound with v-model hand back numbers (or null when cleared)
  const text = String(value ?? '').trim()
  if (text === '') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : undefined
}

export function endConditionsFromFields(fields: EndFields, vesselCount: number): EndFieldsResult {
  const out: EndConditions = {}
  const vessels = parse(fields.vessels)
  if (vessels === undefined || (vessels !== null && (!Number.isInteger(vessels) || vessels < 1 || vessels > vesselCount)))
    return { ok: false, error: 'setup.end.errorVessels' }
  if (vessels !== null) out.vesselsCompleted = vessels
  else if (vesselCount > 0) out.vesselsCompleted = vesselCount
  const hours = parse(fields.hours)
  if (hours === undefined || (hours !== null && hours <= 0)) return { ok: false, error: 'setup.end.errorHours' }
  if (hours !== null) out.simDurationS = Math.round(hours * 3600)
  const moves = parse(fields.moves)
  if (moves === undefined || (moves !== null && (!Number.isInteger(moves) || moves < 1))) return { ok: false, error: 'setup.end.errorMoves' }
  if (moves !== null) out.moves = moves
  return { ok: true, value: out }
}
