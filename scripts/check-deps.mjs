// verify prerequisites: a missing node_modules surfaces as an obscure module-resolution error, and
// unresolved merge conflict markers in files no linter reads (Markdown, YAML) would otherwise be committed.
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

if (!existsSync(new URL('../node_modules/.bin/eslint', import.meta.url))) {
  console.error('node_modules is missing or incomplete. Run `ppnpm install` first, then re-run `ppnpm run verify`.')
  process.exit(1)
}

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean)
const marker = /^(<{7}|>{7})( |$)/m
const dirty = []
for (const f of files) {
  if (!/\.(md|ts|vue|js|mjs|json|ya?ml|css|html)$/.test(f) || !existsSync(f)) continue
  let text
  try {
    text = execFileSync('cat', [f], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch {
    continue
  }
  if (marker.test(text)) dirty.push(f)
}
if (dirty.length > 0) {
  console.error(`Unresolved merge conflict markers in:\n  ${dirty.join('\n  ')}\nResolve them, then re-run \`ppnpm run verify\`.`)
  process.exit(1)
}
