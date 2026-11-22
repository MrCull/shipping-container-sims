/**
 * The machine-wide heavy lock of `scripts/bg.sh run --heavy` and `scripts/proof-runner.sh`, taken from Node: a flock on
 * `<git common dir>/bg-heavy.lock`, its holder named in `bg-heavy.holder`. Node has no flock call, so a `flock` child
 * locks a descriptor this process passes it: the lock belongs to the shared open file description and stays held
 * after the child exits, until `release()` closes the descriptor (or this process dies, which frees it too).
 */
import { execFileSync, spawn } from 'node:child_process'
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs'

export interface HeavyLock {
  /** False when the lock was skipped (`BG_HEAVY_HELD=1`) or no `flock` exists on this machine. */
  taken: boolean
  release(): void
}

export interface HeavyLockOptions {
  /** Lock path without extension (default `<git common dir>/bg-heavy`). */
  base?: string
  /** Holder line, as bg.sh writes `log <file>` and proof-runner `proof-runner <dir>`. */
  holder: string
  env?: NodeJS.ProcessEnv
  /** Called once when another job holds the lock and this one waits. */
  onWait?: (message: string) => void
}

export function heavyLockBase(): string | null {
  try {
    const dir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return dir ? `${dir}/bg-heavy` : null
  } catch {
    return null
  }
}

function flockChild(fd: number, nonBlocking: boolean): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn('flock', [...(nonBlocking ? ['-n'] : []), '3'], { stdio: ['ignore', 'ignore', 'ignore', fd] })
    child.on('error', () => resolve(null))
    child.on('exit', (code) => resolve(code))
  })
}

const NOT_TAKEN: HeavyLock = { taken: false, release: () => {} }

export async function acquireHeavyLock(options: HeavyLockOptions): Promise<HeavyLock> {
  const env = options.env ?? process.env
  // Under scripts/bg.sh run --heavy the enclosing job already holds the lock: taking it again would wait forever.
  if (env.BG_HEAVY_HELD === '1') return NOT_TAKEN
  const base = options.base ?? heavyLockBase()
  if (!base) return NOT_TAKEN
  const fd = openSync(`${base}.lock`, 'a')
  const code = await flockChild(fd, true)
  if (code === null) {
    closeSync(fd)
    return NOT_TAKEN // no flock binary (Git Bash on Windows): run unlocked
  }
  if (code !== 0) {
    let current = 'unknown'
    try {
      current = readFileSync(`${base}.holder`, 'utf8').trim() || 'unknown'
    } catch {
      /* no holder file */
    }
    options.onWait?.(`waiting for heavy lock held by ${current}`)
    await flockChild(fd, false)
  }
  writeFileSync(`${base}.holder`, `${options.holder}\n`)
  let open = true
  return {
    taken: true,
    release() {
      if (open) closeSync(fd)
      open = false
    },
  }
}
