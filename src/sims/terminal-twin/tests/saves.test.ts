/**
 * Persistence formats (TT-17): config and snapshot saves, schema versions, migration,
 * engine-version mismatch. Seam: the pure save module plus the engine API.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createSimulation, ENGINE_VERSION } from '../engine'
import { fixtures } from '../scenario/fixtures'
import { makeConfigSave, makeSnapshotSave, migrateScenarioConfig, parseSaveFile, planLoad, SAVE_SCHEMA_VERSION, SaveFormatError } from '../persistence/saves'

const FIXTURE = 'tracer-1sts-10-boxes'
const NOW = new Date('2026-10-28T12:00:00Z')

function runHash(config = fixtures[FIXTURE], seed = config.seed): string {
  const sim = createSimulation(config, {}, { seed })
  sim.runUntil()
  return sim.eventLogHash()
}

describe('config save', () => {
  it('round-trips through JSON text and runs to the same event-log hash', () => {
    const file = makeConfigSave('My save', fixtures[FIXTURE], 42, NOW)
    expect(file.schemaVersion).toBe(SAVE_SCHEMA_VERSION)
    const plan = planLoad(parseSaveFile(JSON.stringify(file)))
    expect(plan.action).toBe('config')
    if (plan.action !== 'config') return
    expect(plan.seed).toBe(42)
    expect(runHash(plan.config, plan.seed)).toBe(runHash(fixtures[FIXTURE], 42))
  })

  it('migrates a version-1 file (locale and units outside the config) and runs it', () => {
    const text = readFileSync(new URL('./fixtures/save-v1-config.json', import.meta.url), 'utf8')
    const parsed = parseSaveFile(text)
    expect(parsed.schemaVersion).toBe(SAVE_SCHEMA_VERSION)
    const plan = planLoad(parsed)
    if (plan.action !== 'config') throw new Error('expected a config plan')
    expect(plan.config.display).toEqual({ locale: 'de-DE', units: 'imperial' })
    expect(runHash(plan.config, plan.seed)).toBe(runHash())
  })

  it('accepts a bare scenario config (what the dev API config() returns) as a legacy save', () => {
    const parsed = parseSaveFile(JSON.stringify(fixtures[FIXTURE]))
    expect(parsed.type).toBe('config')
    expect(parsed.seed).toBe(fixtures[FIXTURE].seed)
  })

  it('migrates scenario configs forward through a migration chain and rejects newer ones', () => {
    const old = { ...fixtures[FIXTURE], schemaVersion: 0 } as never
    const migrated = migrateScenarioConfig(old, { 0: (c) => ({ ...c, name: 'migrated', schemaVersion: 1 }) }, 1)
    expect(migrated.name).toBe('migrated')
    expect(() => migrateScenarioConfig({ ...fixtures[FIXTURE], schemaVersion: 99 } as never)).toThrow(SaveFormatError)
  })

  it('rejects files that are not saves', () => {
    expect(() => parseSaveFile('not json')).toThrow(SaveFormatError)
    expect(() => parseSaveFile('{"hello":1}')).toThrow(SaveFormatError)
    expect(() => parseSaveFile(JSON.stringify({ kind: 'terminal-twin-save', schemaVersion: 99 }))).toThrow(SaveFormatError)
  })
})

describe('snapshot save', () => {
  it('a snapshot loaded from file text resumes identically to an uninterrupted run', () => {
    const sim = createSimulation(fixtures[FIXTURE])
    sim.runUntil({ maxEvents: 40 })
    const file = parseSaveFile(JSON.stringify(makeSnapshotSave('Mid run', sim.snapshot(), NOW)))
    const plan = planLoad(file)
    expect(plan.action).toBe('snapshot')
    if (plan.action !== 'snapshot') return
    expect(file.simTimeS).toBe(sim.now)
    const resumed = createSimulation(plan.snapshot.config, {}, { seed: plan.snapshot.seed })
    resumed.restore(plan.snapshot)
    resumed.runUntil()
    expect(resumed.eventLogHash()).toBe(runHash())
  })

  it('a snapshot from another engine version is flagged, with its embedded config to restart from', () => {
    const sim = createSimulation(fixtures[FIXTURE])
    sim.runUntil({ maxEvents: 40 })
    const snap = { ...sim.snapshot(), engineVersion: '0.0.1' }
    const plan = planLoad(parseSaveFile(JSON.stringify(makeSnapshotSave('Old engine', snap, NOW))))
    expect(plan.action).toBe('snapshot-mismatch')
    if (plan.action !== 'snapshot-mismatch') return
    expect(plan.savedEngineVersion).toBe('0.0.1')
    expect(plan.currentEngineVersion).toBe(ENGINE_VERSION)
    expect(runHash(plan.config, plan.seed)).toBe(runHash())
  })
})
