// Regenerates save-v1-config.json: a version-1 save (locale and units outside the config).
import { readFileSync, writeFileSync } from 'node:fs'
const f = JSON.parse(readFileSync(new URL('../../scenario/fixtures/tracer-1sts-10-boxes.json', import.meta.url), 'utf8'))
const out = {
  kind: 'terminal-twin-save',
  schemaVersion: 1,
  type: 'config',
  name: 'Old tracer save',
  savedAt: '2026-01-05T10:00:00.000Z',
  seed: f.seed,
  locale: 'de-DE',
  units: 'imperial',
  config: f,
}
writeFileSync(new URL('./save-v1-config.json', import.meta.url), JSON.stringify(out, null, 2))
