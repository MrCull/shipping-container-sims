/**
 * Structured logs: every committed event becomes (at most) one JSON-lines
 * log record, filtered by per-subsystem verbosity (`asc=debug,shc=info,*=warn`).
 *
 * Each event type has a subsystem and a level. Unlisted types fall back to
 * the lower-cased first word of the type name (`AscMoveStarted` → `asc`) at
 * `info`, so new events are logged without touching this file; add an entry
 * to `EVENT_LOG_META` only to change that.
 */
import type { EngineEvent, EventSubjects, EventType } from './events'

export const LOG_LEVELS = ['off', 'error', 'warn', 'info', 'debug'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]
/** Level an event is logged at (`off` is only a verbosity setting). */
export type EventLogLevel = Exclude<LogLevel, 'off'>

export interface LogVerbosity {
  /** Level for subsystems not listed (`*=` in the spec; default `info`). */
  default: LogLevel
  subsystems: Record<string, LogLevel>
}

export interface LogRecord {
  t: number
  eventId: number
  seq: number
  subsystem: string
  level: EventLogLevel
  type: EventType
  subjects: EventSubjects
  /** Present at `debug` verbosity only. */
  causedBy?: number | null
  /** Present at `debug` verbosity only. */
  payload?: unknown
}

export interface LogOptions {
  /** Verbosity spec string (`sts=debug,*=warn`) or a parsed `LogVerbosity`. */
  verbosity?: string | LogVerbosity
  /** Receives each record that passes the filter. */
  write: (record: LogRecord) => void
}

/** Subsystem and level per event type, where the name-based default is wrong. */
export const EVENT_LOG_META: Partial<Record<EventType, { subsystem?: string; level?: EventLogLevel }>> = {
  StsMoveStarted: { level: 'debug' },
  StsWaitingForGroundPosition: { level: 'warn' },
  DecisionFailed: { level: 'warn' },
  InvariantViolated: { subsystem: 'invariants', level: 'error' },
}

export function eventSubsystem(type: string): string {
  const meta = EVENT_LOG_META[type as EventType]
  if (meta?.subsystem) return meta.subsystem
  const firstWord = /^[A-Z][a-z0-9]*/.exec(type)?.[0] ?? type
  return firstWord.toLowerCase()
}

export function eventLogLevel(type: string): EventLogLevel {
  return EVENT_LOG_META[type as EventType]?.level ?? 'info'
}

function asLevel(text: string, spec: string): LogLevel {
  if (!(LOG_LEVELS as readonly string[]).includes(text))
    throw new Error(`Bad log level "${text}" in "${spec}" (use ${LOG_LEVELS.join('|')})`)
  return text as LogLevel
}

/** Parse `asc=debug,shc=info,*=warn` (a bare level sets the default). */
export function parseLogVerbosity(spec: string): LogVerbosity {
  const result: LogVerbosity = { default: 'info', subsystems: {} }
  for (const part of spec.split(',').map((p) => p.trim()).filter(Boolean)) {
    const eq = part.indexOf('=')
    if (eq < 0) {
      result.default = asLevel(part, spec)
      continue
    }
    const name = part.slice(0, eq).trim().toLowerCase()
    const level = asLevel(part.slice(eq + 1).trim(), spec)
    if (!name) throw new Error(`Missing subsystem in "${spec}"`)
    if (name === '*') result.default = level
    else result.subsystems[name] = level
  }
  return result
}

const rank = (level: LogLevel): number => LOG_LEVELS.indexOf(level)

/** The log record for an event, or null if the verbosity filters it out. */
export function toLogRecord(event: EngineEvent, verbosity: LogVerbosity): LogRecord | null {
  const subsystem = eventSubsystem(event.type)
  const level = eventLogLevel(event.type)
  const allowed = verbosity.subsystems[subsystem] ?? verbosity.default
  if (rank(level) > rank(allowed)) return null
  const record: LogRecord = {
    t: event.t,
    eventId: event.id,
    seq: event.seq,
    subsystem,
    level,
    type: event.type,
    subjects: event.subjects,
  }
  if (allowed === 'debug') {
    record.causedBy = event.causedBy
    record.payload = event.payload
  }
  return record
}

/** Turn log options into an event listener (used by `createSimulation`). */
export function createEventLogger(options: LogOptions): (event: EngineEvent) => void {
  const verbosity =
    typeof options.verbosity === 'string'
      ? parseLogVerbosity(options.verbosity)
      : (options.verbosity ?? { default: 'info', subsystems: {} })
  return (event) => {
    const record = toLogRecord(event, verbosity)
    if (record) options.write(record)
  }
}
