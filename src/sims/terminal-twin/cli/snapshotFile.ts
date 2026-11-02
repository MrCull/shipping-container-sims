/**
 * Snapshot files that outgrow one JS string (about 512 MB, the V8 limit; a peak day at scale 0.25 past a couple
 * of sim hours does). The file is ordinary JSON, so a small snapshot still opens with `JSON.parse`; it is only
 * written and read in pieces: containers down to `LEAF_DEPTH` levels are walked, each deeper value is
 * stringified or parsed alone. Node-only (CLI and tests).
 */
import { closeSync, openSync, readSync, writeSync } from 'node:fs'

/** Containers above this depth are walked piecewise; values at it are one JSON string each (snapshot > state > table > row). */
const LEAF_DEPTH = 4
const FLUSH_CHARS = 4 * 1024 * 1024

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const skipped = (v: unknown): boolean => v === undefined || typeof v === 'function' || typeof v === 'symbol'

/** Write `value` as JSON to `file`, never holding the whole text in one string. Same meaning as `JSON.stringify`. */
export function writeJsonFile(file: string, value: unknown): void {
  const fd = openSync(file, 'w')
  let pending: string[] = []
  let pendingLen = 0
  const flush = (): void => {
    if (pendingLen === 0) return
    const buf = Buffer.from(pending.join(''), 'utf8')
    let off = 0
    while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off)
    pending = []
    pendingLen = 0
  }
  const put = (s: string): void => {
    pending.push(s)
    pendingLen += s.length
    if (pendingLen >= FLUSH_CHARS) flush()
  }
  const walk = (v: unknown, depth: number): void => {
    if (depth < LEAF_DEPTH && Array.isArray(v)) {
      put('[')
      v.forEach((item, i) => {
        if (i) put(',')
        if (skipped(item)) put('null')
        else walk(item, depth + 1)
      })
      put(']')
    } else if (depth < LEAF_DEPTH && isPlainObject(v) && typeof (v as { toJSON?: unknown }).toJSON !== 'function') {
      put('{')
      let first = true
      for (const [k, item] of Object.entries(v)) {
        if (skipped(item)) continue
        if (!first) put(',')
        first = false
        put(`${JSON.stringify(k)}:`)
        walk(item, depth + 1)
      }
      put('}')
    } else put(JSON.stringify(v) ?? 'null')
  }
  try {
    walk(value, 0)
    flush()
  } finally {
    closeSync(fd)
  }
}

/** Read a JSON file written by `writeJsonFile` (or any JSON file) without turning the whole file into one string. */
export function readJsonFile<T = unknown>(file: string, bufferBytes = 16 * 1024 * 1024): T {
  const fd = openSync(file, 'r')
  const buf = Buffer.allocUnsafe(bufferBytes)
  let pos = 0
  let len = 0
  const fill = (): boolean => {
    len = readSync(fd, buf, 0, buf.length, null)
    pos = 0
    return len > 0
  }
  const isWs = (c: number): boolean => c === 32 || c === 10 || c === 13 || c === 9
  const peek = (): number => {
    for (;;) {
      if (pos >= len && !fill()) return -1
      const c = buf[pos]
      if (!isWs(c)) return c
      pos++
    }
  }
  /** The text of the next JSON value (not parsed). */
  const capture = (): string => {
    const segments: Buffer[] = []
    const first = peek()
    if (first === -1) throw new SyntaxError(`${file}: unexpected end of file`)
    let segStart = pos
    let depth = 0
    let inStr = false
    let esc = false
    const scalar = first !== 34 && first !== 123 && first !== 91
    for (;;) {
      if (pos >= len) {
        segments.push(Buffer.from(buf.subarray(segStart, len)))
        if (!fill()) {
          segStart = 0
          break
        }
        segStart = 0
      }
      const c = buf[pos]
      if (inStr) {
        pos++
        if (esc) esc = false
        else if (c === 92) esc = true
        else if (c === 34) {
          inStr = false
          if (depth === 0) break
        }
      } else if (scalar && (c === 44 || c === 125 || c === 93 || isWs(c))) {
        break
      } else {
        pos++
        if (c === 34) inStr = true
        else if (c === 123 || c === 91) depth++
        else if (c === 125 || c === 93) {
          depth--
          if (depth === 0) break
        }
      }
    }
    if (pos > segStart) segments.push(Buffer.from(buf.subarray(segStart, pos)))
    return Buffer.concat(segments).toString('utf8')
  }
  const expect = (ch: string): void => {
    if (peek() !== ch.charCodeAt(0)) throw new SyntaxError(`${file}: expected "${ch}"`)
    pos++
  }
  const parse = (depth: number): unknown => {
    const c = peek()
    if (depth < LEAF_DEPTH && c === 123) {
      pos++
      const obj: Record<string, unknown> = {}
      if (peek() === 125) {
        pos++
        return obj
      }
      for (;;) {
        const key = JSON.parse(capture()) as string
        expect(':')
        obj[key] = parse(depth + 1)
        const n = peek()
        pos++
        if (n === 125) return obj
        if (n !== 44) throw new SyntaxError(`${file}: expected "," or "}"`)
      }
    }
    if (depth < LEAF_DEPTH && c === 91) {
      pos++
      const arr: unknown[] = []
      if (peek() === 93) {
        pos++
        return arr
      }
      for (;;) {
        arr.push(parse(depth + 1))
        const n = peek()
        pos++
        if (n === 93) return arr
        if (n !== 44) throw new SyntaxError(`${file}: expected "," or "]"`)
      }
    }
    return JSON.parse(capture())
  }
  try {
    const value = parse(0)
    if (peek() !== -1) throw new SyntaxError(`${file}: trailing data`)
    return value as T
  } finally {
    closeSync(fd)
  }
}
