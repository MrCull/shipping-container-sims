/** Text for the crane plan (#288): the plan table with its conflict windows, and the plan accuracy section. */
import type { CranePlanView, PlanAccuracy } from '../engine'

const p2 = (n: number) => String(Math.floor(n)).padStart(2, '0')
/** Sim seconds as h:mm:ss. */
export const clock = (s: number): string => `${Math.floor(s / 3600)}:${p2((s % 3600) / 60)}:${p2(s % 60)}`
const pad = (s: string, w: number) => s.padEnd(w)

/** One row per package: crane, package, kind, bay, section, moves, predicted start and end (and actual when worked). */
export function formatCranePlan(view: CranePlanView, withActual: boolean): string[] {
  const lines = [`Crane plan for ${view.vesselId}: strategy ${view.strategy}, revision ${view.revision}, at ${clock(view.now)}`, '']
  const head = [pad('crane', 7), pad('package', 8), pad('kind', 14), pad('bay', 4), pad('section', 8), pad('moves', 6), pad('predicted start', 16), pad('predicted end', 14)]
  lines.push(head.join('') + (withActual ? 'actual start    actual end' : ''))
  for (const c of view.cranes)
    for (const k of c.packages) {
      const row = [
        pad(c.stsId, 7),
        pad(k.id, 8),
        pad(k.kind, 14),
        pad(String(k.bay), 4),
        pad(k.section, 8),
        pad(String(k.moves), 6),
        pad(clock(k.plannedStartS), 16),
        pad(clock(k.plannedEndS), 14),
      ].join('')
      const actual = withActual ? `${pad(k.actualStartS === null ? '-' : clock(k.actualStartS), 16)}${k.actualEndS === null ? '-' : clock(k.actualEndS)}` : ''
      lines.push(row + actual)
    }
  lines.push('', `Predicted conflict windows (cranes closer than ${view.minSpacingM} m): ${view.conflicts.length}`)
  for (const w of view.conflicts)
    lines.push(
      `  ${w.stsA} / ${w.stsB}${w.obstacle ? ' (other vessel)' : ''}  ${clock(w.fromS)} to ${clock(w.toS)}  ${Math.round(w.toS - w.fromS)} s  at ${Math.round(w.xA)} m / ${Math.round(w.xB)} m`,
    )
  return lines
}

/** The plan accuracy section of the run summary; no lines without a plan. */
export function formatPlanAccuracy(list: PlanAccuracy[]): string[] {
  if (list.length === 0) return []
  const lines = ['', 'Plan accuracy (per vessel):']
  for (const a of list)
    lines.push(
      `  ${a.vesselId}  ${a.strategy} r${a.revision}  finish predicted ${a.predictedFinishS === null ? '-' : clock(a.predictedFinishS)} actual ${a.actualFinishS === null ? 'open' : clock(a.actualFinishS)}` +
        `  conflict predicted ${a.predictedConflictS} s, rail wait actual ${a.actualRailWaitS} s` +
        `  mean start error ${a.meanStartErrorS === null ? '-' : `${a.meanStartErrorS} s`} (${a.worked}/${a.packages} packages worked)`,
    )
  return lines
}
