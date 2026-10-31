// Fail when git tracks files that must stay local: Blender files and user-supplied reference material.
import { execFileSync } from 'node:child_process'

// Text files that list or explain the reference material are allowed; the photos are not.
const ALLOWED = new Set(['docs/reference/README.md', 'docs/reference/tti-algeciras/PHOTOS.md'])
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
const banned = tracked.filter(
  (f) => /\.blend1?$/.test(f) || (f.startsWith('docs/reference/') && !ALLOWED.has(f)),
)
if (banned.length > 0) {
  console.error(`Tracked files that must stay local (see .gitignore):\n  ${banned.join('\n  ')}`)
  process.exit(1)
}
