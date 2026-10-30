// Fail when git tracks files that must stay local: Blender files and user-supplied reference material.
import { execFileSync } from 'node:child_process'

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
const banned = tracked.filter(
  (f) => /\.blend1?$/.test(f) || (f.startsWith('docs/reference/') && f !== 'docs/reference/README.md'),
)
if (banned.length > 0) {
  console.error(`Tracked files that must stay local (see .gitignore):\n  ${banned.join('\n  ')}`)
  process.exit(1)
}
