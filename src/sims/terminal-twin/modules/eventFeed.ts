/**
 * Event feed model (TT-18): turns the capped buffer of recent events into the
 * rows the left panel shows. Pure TS. The panel rebuilds rows a few times per
 * second (not per frame), only shows events up to the displayed sim time
 * (the engine runs ahead of the display while playing), and at high speed
 * collapses runs of the same event type into one burst row so a fast run
 * stays readable and cheap.
 */
import type { EventType } from '../engine'
import type { EventSummary } from '../worker/protocol'

/** Newest events kept for the feed (memory cap). */
export const FEED_BUFFER_CAP = 1000
/** Rows drawn at most. */
export const FEED_MAX_ROWS = 150
/** From this playback speed (×) bursts are summarised. */
export const FEED_SUMMARY_MIN_SPEED = 60
/** A run of this many same-type events (or more) becomes a burst row. */
export const FEED_BURST_MIN_RUN = 3
/** How often the panel refreshes (ms). */
export const FEED_REFRESH_MS = 250

export interface FeedOptions {
  /** Space-separated terms; each must occur in the event type or a subject id. */
  text: string
  /** Events after this sim time are not shown yet. */
  displayTime: number
  summarise: boolean
  maxRows: number
}

export type FeedRow =
  | { kind: 'event'; event: EventSummary }
  | { kind: 'burst'; type: EventType; count: number; firstId: number; lastId: number; t0: number; t1: number }

export function shouldSummarise(speed: number): boolean {
  return speed >= FEED_SUMMARY_MIN_SPEED
}

/** Whether the event type or any subject id contains every term of `text` (case-insensitive). */
export function eventMatchesFilter(event: EventSummary, text: string): boolean {
  const terms = text.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const s = event.subjects
  const haystack = [event.type, ...(s.containers ?? []), ...(s.equipment ?? []), ...(s.vessels ?? []), ...(s.jobs ?? [])].join(' ').toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

export function buildFeedRows(events: readonly EventSummary[], options: FeedOptions): FeedRow[] {
  const rows: FeedRow[] = []
  // Newest rows matter: walk backwards, stop at the cap, then reverse.
  const picked: EventSummary[] = []
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.t > options.displayTime || !eventMatchesFilter(e, options.text)) continue
    picked.push(e)
    // Bursts shrink the row count, so over-collect a little before summarising.
    if (!options.summarise && picked.length >= options.maxRows) break
    if (options.summarise && picked.length >= options.maxRows * 20) break
  }
  picked.reverse()
  if (!options.summarise) {
    for (const event of picked) rows.push({ kind: 'event', event })
  } else {
    let i = 0
    while (i < picked.length) {
      let j = i
      while (j + 1 < picked.length && picked[j + 1].type === picked[i].type) j++
      const run = j - i + 1
      if (run >= FEED_BURST_MIN_RUN) {
        rows.push({ kind: 'burst', type: picked[i].type, count: run, firstId: picked[i].id, lastId: picked[j].id, t0: picked[i].t, t1: picked[j].t })
      } else {
        for (let k = i; k <= j; k++) rows.push({ kind: 'event', event: picked[k] })
      }
      i = j + 1
    }
  }
  return rows.length > options.maxRows ? rows.slice(rows.length - options.maxRows) : rows
}
