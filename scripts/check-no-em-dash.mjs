// Fail when any tracked text file contains the em dash (U+2014). Binary files are skipped.
import { spawnSync } from 'node:child_process'

const EM_DASH = String.fromCharCode(0x2014)
const res = spawnSync('git', ['grep', '-I', '-n', '-F', '-e', EM_DASH], { encoding: 'utf8', maxBuffer: 1 << 28 })
if (res.status === 0) {
  console.error(`Em dash (U+2014) is not allowed in tracked text files. Use a comma, colon, full stop, brackets or "to":\n${res.stdout}`)
  process.exit(1)
}
if (res.status !== 1) {
  console.error(res.stderr || 'git grep failed')
  process.exit(res.status ?? 1)
}
