/**
 * Event feed model (TT-18): filtering, display-time cut-off, burst summaries
 * and the row cap that keep the feed cheap at high speed.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { fixtures } from '../scenario/fixtures'
import { buildFeedRows, FEED_SUMMARY_MIN_SPEED, eventMatchesFilter, shouldSummarise, type FeedRow } from '../modules/eventFeed'
import { summarizeEvent, type EventSummary } from '../worker/protocol'

const sim = createSimulation(fixtures['shc-1sts-2shc-1wtp'])
sim.runUntil()
const events: EventSummary[] = sim.eventLog().map(summarizeEvent)

const asEvents = (rows: FeedRow[]) => rows.flatMap((r) => (r.kind === 'event' ? [r.event] : []))

describe('eventMatchesFilter', () => {
  it('empty text matches everything; text matches type or any subject id, case-insensitively', () => {
    expect(events.every((e) => eventMatchesFilter(e, ''))).toBe(true)
    const shc = events.filter((e) => eventMatchesFilter(e, 'shc01'))
    expect(shc.length).toBeGreaterThan(0)
    for (const e of shc) {
      expect(`${e.type} ${(e.subjects.equipment ?? []).join(' ')} ${(e.subjects.containers ?? []).join(' ')}`.toLowerCase()).toContain('shc01')
    }
    expect(events.filter((e) => eventMatchesFilter(e, 'stspicked')).every((e) => e.type === 'StsPicked')).toBe(true)
  })

  it('several space-separated terms must all match', () => {
    const both = events.filter((e) => eventMatchesFilter(e, 'Shc SHC01'))
    expect(both.length).toBeGreaterThan(0)
    expect(both.every((e) => e.subjects.equipment?.includes('SHC01'))).toBe(true)
  })
})

describe('buildFeedRows', () => {
  it('shows only events up to the display time', () => {
    const t = events[Math.floor(events.length / 2)].t
    const rows = buildFeedRows(events, { text: '', displayTime: t, summarise: false, maxRows: 1000 })
    const shown = asEvents(rows)
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.every((e) => e.t <= t)).toBe(true)
    expect(shown.length).toBe(events.filter((e) => e.t <= t).length)
  })

  it('keeps only the newest rows when over the cap', () => {
    const rows = buildFeedRows(events, { text: '', displayTime: Infinity, summarise: false, maxRows: 10 })
    expect(rows).toHaveLength(10)
    expect(asEvents(rows).at(-1)!.id).toBe(events.at(-1)!.id)
  })

  it('summarises runs of the same event type into one burst row, preserving the count', () => {
    const burst = (n: number, type: EventSummary['type'], t0: number, id0: number): EventSummary[] =>
      Array.from({ length: n }, (_, i) => ({ id: id0 + i, seq: id0 + i, t: t0 + i, type, causedBy: null, subjects: {} }))
    const list = [...burst(1, 'StsPicked', 0, 1), ...burst(5, 'ShcMoved' as EventSummary['type'], 1, 2), ...burst(2, 'StsPicked', 6, 7)]
    const rows = buildFeedRows(list, { text: '', displayTime: Infinity, summarise: true, maxRows: 100 })
    expect(rows.map((r) => r.kind)).toEqual(['event', 'burst', 'event', 'event'])
    const b = rows[1]
    expect(b.kind === 'burst' && { count: b.count, first: b.firstId, last: b.lastId, t0: b.t0, t1: b.t1 }).toEqual({ count: 5, first: 2, last: 6, t0: 1, t1: 5 })
  })

  it('without summarising, every event is its own row', () => {
    const rows = buildFeedRows(events, { text: '', displayTime: Infinity, summarise: false, maxRows: 100000 })
    expect(rows).toHaveLength(events.length)
  })
})

describe('shouldSummarise', () => {
  it('summarises from the high-speed threshold upwards', () => {
    expect(shouldSummarise(FEED_SUMMARY_MIN_SPEED)).toBe(true)
    expect(shouldSummarise(600)).toBe(true)
    expect(shouldSummarise(10)).toBe(false)
  })
})
