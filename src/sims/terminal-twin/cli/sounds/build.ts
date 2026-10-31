/** `pnpm run tt:sounds` writes the synthesized sound files; `pnpm run tt:sounds:check` fails when the committed files drift. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkSounds, SOUNDS_DIR, synthesizeAll } from './synth'

if (process.argv.includes('--check')) {
  const problems = checkSounds(SOUNDS_DIR)
  for (const p of problems) console.error(p)
  console.log(problems.length === 0 ? 'Sounds are up to date.' : `${problems.length} sound file(s) out of date.`)
  process.exitCode = problems.length === 0 ? 0 : 1
} else {
  mkdirSync(SOUNDS_DIR, { recursive: true })
  for (const [name, bytes] of synthesizeAll()) {
    writeFileSync(join(SOUNDS_DIR, name), bytes)
    console.log(`wrote ${name} (${bytes.length} bytes)`)
  }
}
