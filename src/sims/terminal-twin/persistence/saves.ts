/**
 * Save formats (TT-17), pure TypeScript (no browser APIs).
 *
 * A save is one JSON document, stored in IndexedDB and exchanged as a file:
 *
 * - `type: 'config'`: the SI scenario config as run (layout, equipment, kinematics, vessels,
 *   landside, decisions and latency, end conditions, start date/time, display locale and units)
 *   plus the seed. Small; re-running it reproduces the run.
 * - `type: 'snapshot'`: the engine's full `SimSnapshot` (containers, equipment, motion segments,
 *   event queue, reservations, KPI state, RNG, event log). It embeds its config and seed.
 *
 * Every save has `schemaVersion` (the save format). Older formats migrate forward in
 * `parseSaveFile`. The scenario config inside has its own `schemaVersion`, migrated by
 * `migrateScenarioConfig`. A snapshot also names the engine version that wrote it:
 * `planLoad` reports a mismatch so the UI can warn and offer a restart from its config.
 */
import { checkSnapshotCompat, ENGINE_VERSION, type SimSnapshot } from '../engine'
import type { MessageKey, MessageParams } from '../i18n/messages'
import { scenarioDisplayName } from '../modules/scenarioPicker'
import { SCENARIO_SCHEMA_VERSION, type DisplaySettings, type ScenarioConfig } from '../scenario/types'

/** Bump when the save envelope changes; add a step to `SAVE_MIGRATIONS`. */
export const SAVE_SCHEMA_VERSION = 2
export const SAVE_KIND = 'terminal-twin-save'

export type SaveType = 'config' | 'snapshot'

export interface SaveFile {
  kind: typeof SAVE_KIND
  schemaVersion: number
  type: SaveType
  name: string
  /** ISO date-time the save was made. */
  savedAt: string
  /** The scenario config (for a snapshot: the one it embeds). */
  config: ScenarioConfig
  seed: number
  /** Snapshots only. */
  snapshot?: SimSnapshot
  /** Snapshots only: sim time (s) the snapshot was taken at. */
  simTimeS?: number
  /** Snapshots only: the engine version that wrote it. */
  engineVersion?: string
}

/** A file that is not a usable save; `key` and `params` are catalogue entries for the UI. */
export class SaveFormatError extends Error {
  constructor(
    readonly key: MessageKey,
    readonly params?: MessageParams,
  ) {
    super(`${key}${params ? ` ${JSON.stringify(params)}` : ''}`)
    this.name = 'SaveFormatError'
  }
}

type Json = Record<string, unknown>

/** Save-format migrations: key N upgrades a version-N document to N+1. */
const SAVE_MIGRATIONS: Record<number, (doc: Json) => Json> = {
  // v1 kept locale and units beside the config; v2 stores them in `config.display`.
  1: (doc) => {
    const { locale, units, ...rest } = doc
    const config = { ...(rest.config as Json) }
    if (typeof locale === 'string' && (units === 'metric' || units === 'imperial')) config.display = { locale, units } satisfies DisplaySettings
    return { ...rest, config, schemaVersion: 2 }
  },
}

/** Scenario-config migrations: key N upgrades a version-N config to N+1. None yet (version 1 is the first). */
export const CONFIG_MIGRATIONS: Record<number, (config: ScenarioConfig) => ScenarioConfig> = {}

/** Bring a scenario config up to `target`; throws for a config from a newer app. */
export function migrateScenarioConfig(
  config: ScenarioConfig,
  migrations: Record<number, (config: ScenarioConfig) => ScenarioConfig> = CONFIG_MIGRATIONS,
  target: number = SCENARIO_SCHEMA_VERSION,
): ScenarioConfig {
  let current = config
  let version = Number(current.schemaVersion)
  if (!Number.isInteger(version)) throw new SaveFormatError('saves.error.notASave')
  if (version > target) throw new SaveFormatError('saves.error.configNewer', { version, supported: target })
  while (version < target) {
    const step = migrations[version]
    if (!step) throw new SaveFormatError('saves.error.configUnsupported', { version })
    current = step(current)
    version = Number(current.schemaVersion)
  }
  return current
}

const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

function looksLikeConfig(v: Json): boolean {
  return typeof v.schemaVersion === 'number' && isObject(v.quay) && Array.isArray(v.sts) && Array.isArray(v.vessels)
}

/** Parse and migrate a save file's text. Accepts a bare scenario config or a bare engine snapshot as legacy saves. */
export function parseSaveFile(text: string): SaveFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new SaveFormatError('saves.error.notJson')
  }
  if (!isObject(raw)) throw new SaveFormatError('saves.error.notASave')
  let doc: Json
  if (raw.kind === SAVE_KIND) {
    doc = raw
  } else if (raw.kind === 'terminal-twin-snapshot' && isObject(raw.config)) {
    doc = wrapSnapshot(raw as unknown as SimSnapshot)
  } else if (looksLikeConfig(raw)) {
    const config = raw as unknown as ScenarioConfig
    doc = { kind: SAVE_KIND, schemaVersion: SAVE_SCHEMA_VERSION, type: 'config', name: scenarioDisplayName(config.name), savedAt: new Date(0).toISOString(), config, seed: config.seed }
  } else {
    throw new SaveFormatError('saves.error.notASave')
  }
  let version = Number(doc.schemaVersion)
  if (!Number.isInteger(version) || version < 1) throw new SaveFormatError('saves.error.notASave')
  if (version > SAVE_SCHEMA_VERSION) throw new SaveFormatError('saves.error.saveNewer', { version, supported: SAVE_SCHEMA_VERSION })
  while (version < SAVE_SCHEMA_VERSION) {
    doc = SAVE_MIGRATIONS[version](doc)
    version = Number(doc.schemaVersion)
  }
  if ((doc.type !== 'config' && doc.type !== 'snapshot') || typeof doc.name !== 'string' || !isObject(doc.config) || typeof doc.seed !== 'number')
    throw new SaveFormatError('saves.error.notASave')
  if (doc.type === 'snapshot' && !(isObject(doc.snapshot) && doc.snapshot.kind === 'terminal-twin-snapshot')) throw new SaveFormatError('saves.error.notASave')
  const config = migrateScenarioConfig(doc.config as unknown as ScenarioConfig)
  return { ...doc, config } as unknown as SaveFile
}

function wrapSnapshot(snapshot: SimSnapshot): Json {
  return {
    kind: SAVE_KIND,
    schemaVersion: SAVE_SCHEMA_VERSION,
    type: 'snapshot',
    name: scenarioDisplayName(snapshot.config.name),
    savedAt: new Date(0).toISOString(),
    config: snapshot.config,
    seed: snapshot.seed,
    snapshot,
    simTimeS: snapshot.state.now,
    engineVersion: snapshot.engineVersion,
  }
}

export function makeConfigSave(name: string, config: ScenarioConfig, seed: number, now: Date = new Date()): SaveFile {
  return { kind: SAVE_KIND, schemaVersion: SAVE_SCHEMA_VERSION, type: 'config', name, savedAt: now.toISOString(), config: structuredCloneJson(config), seed }
}

export function makeSnapshotSave(name: string, snapshot: SimSnapshot, now: Date = new Date()): SaveFile {
  return { ...(wrapSnapshot(snapshot) as unknown as SaveFile), name, savedAt: now.toISOString() }
}

function structuredCloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/** What loading a save means. */
export type LoadPlan =
  | { action: 'config'; config: ScenarioConfig; seed: number }
  | { action: 'snapshot'; snapshot: SimSnapshot }
  /** The snapshot comes from another engine (or snapshot schema) version: warn, and offer to restart from its config. */
  | { action: 'snapshot-mismatch'; savedEngineVersion: string; currentEngineVersion: string; config: ScenarioConfig; seed: number }

export function planLoad(file: SaveFile): LoadPlan {
  if (file.type === 'config' || !file.snapshot) return { action: 'config', config: file.config, seed: file.seed }
  const snap = file.snapshot
  if (!checkSnapshotCompat(snap).ok)
    return { action: 'snapshot-mismatch', savedEngineVersion: snap.engineVersion, currentEngineVersion: ENGINE_VERSION, config: file.config, seed: file.seed }
  return { action: 'snapshot', snapshot: snap }
}

/** A save without its payload: what the saves list shows. */
export interface SaveMeta {
  id: string
  type: SaveType
  name: string
  savedAt: string
  simTimeS?: number
  engineVersion?: string
  schemaVersion: number
}

export function metaOf(id: string, file: SaveFile): SaveMeta {
  return { id, type: file.type, name: file.name, savedAt: file.savedAt, simTimeS: file.simTimeS, engineVersion: file.engineVersion, schemaVersion: file.schemaVersion }
}

/** Lower-case ASCII words joined by hyphens, for file names. */
function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** File name for an exported save. */
export function saveFileName(file: SaveFile): string {
  return `${slugify(file.name) || 'save'}.tt-${file.type}.json`
}

/**
 * Save name used when the name field is blank (#156): the scenario's plain name and seed, plus the elapsed sim
 * time for a snapshot. `scenario` is the technical id; it is not shown.
 */
export function defaultSaveName(scenario: string, seed: number, elapsed?: string): string {
  const base = `${scenarioDisplayName(scenario)} / seed ${seed}`
  return elapsed === undefined ? base : `${base} / ${elapsed}`
}

/** Download file name of a KPI report or event log (#156): the slugified plain scenario name, the seed and the suffix. */
export function exportFileName(scenario: string, seed: number, suffix: string): string {
  return `${slugify(scenarioDisplayName(scenario)) || 'run'}-seed${seed}-${suffix}`
}
