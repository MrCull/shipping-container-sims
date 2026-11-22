import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { acquireHeavyLock } from '../cli/heavyLock'

/** True when another process (a shell, as scripts/bg.sh is) can take the flock on `<base>.lock` right now. */
const shellCanLock = (base: string) => spawnSync('bash', ['-c', `exec 9>>"${base}.lock"; flock -n 9`]).status === 0

describe('tt:experiment heavy lock (same file and holder format as scripts/bg.sh run --heavy)', () => {
  it('is taken, names its holder, makes a second taker wait, and is released', async () => {
    const base = join(mkdtempSync(join(tmpdir(), 'tt-lock-')), 'bg-heavy')
    const lock = await acquireHeavyLock({ base, holder: 'tt:experiment out/x', env: {} })
    expect(lock.taken).toBe(true)
    expect(readFileSync(`${base}.holder`, 'utf8')).toBe('tt:experiment out/x\n')
    expect(shellCanLock(base)).toBe(false)

    const waits: string[] = []
    let secondTaken = false
    const second = acquireHeavyLock({ base, holder: 'second', env: {}, onWait: (m) => waits.push(m) }).then((l) => {
      secondTaken = true
      return l
    })
    await new Promise((r) => setTimeout(r, 300))
    expect(secondTaken).toBe(false)
    expect(waits).toEqual(['waiting for heavy lock held by tt:experiment out/x'])

    lock.release()
    const l2 = await second
    expect(l2.taken).toBe(true)
    l2.release()
    expect(shellCanLock(base)).toBe(true)
  })

  it('is skipped under BG_HEAVY_HELD=1 (already held by the enclosing bg.sh --heavy job)', async () => {
    const base = join(mkdtempSync(join(tmpdir(), 'tt-lock-')), 'bg-heavy')
    const lock = await acquireHeavyLock({ base, holder: 'x', env: { BG_HEAVY_HELD: '1' } })
    expect(lock.taken).toBe(false)
    expect(existsSync(`${base}.lock`)).toBe(false)
    lock.release()
  })
})
