/**
 * Prints the headless scene's `sceneState()` as JSON (#331): `tsx cli/headlessSceneCli.ts <fixture> [eventType] [startDateTime]` loads the
 * fixture with its own seed, runs until the first event of that type and updates one frame. The parity smoke spec
 * (`tests/browser/headless-parity.smoke.ts`) calls it, since Playwright's loader cannot import the scene's module graph.
 */
import type { EventType } from '../engine'
import { headlessScene } from './headlessScene'

const [name, eventType, startDateTime] = process.argv.slice(2)
if (!name) {
  console.error('usage: tsx cli/headlessSceneCli.ts <fixture-or-preset> [eventType] [startDateTime]')
  process.exit(2)
}
const scene = await headlessScene(name, { startDateTime })
if (eventType) await scene.runUntil({ eventType: eventType as EventType })
process.stdout.write(JSON.stringify(scene.sceneState()))
scene.dispose()
