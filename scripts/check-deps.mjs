// verify prerequisite: a missing node_modules otherwise surfaces as an obscure module-resolution error.
import { existsSync } from 'node:fs'

if (!existsSync(new URL('../node_modules/.bin/eslint', import.meta.url))) {
  console.error('node_modules is missing or incomplete. Run `npm install` first, then re-run `npm run verify`.')
  process.exit(1)
}
