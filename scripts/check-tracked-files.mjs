// Fail when git tracks files that must stay local: Blender files.
// Reference photos under docs/reference/ are committed on purpose (owner decision, copyright waived).
import { execFileSync } from 'node:child_process'

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
const banned = tracked.filter((f) => /\.blend1?$/.test(f))
if (banned.length > 0) {
  console.error(`Tracked files that must stay local (see .gitignore):\n  ${banned.join('\n  ')}`)
  process.exit(1)
}
