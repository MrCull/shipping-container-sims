import { closeSync, openSync, readSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
import type { EngineEvent } from '../engine'

/** Reads a JSON-lines event log in chunks: a full-size peak-day log as one string is past V8's string limit. */
export function readEventLines(file: string, chunkBytes = 1 << 24): EngineEvent[] {
  const events: EngineEvent[] = []
  const decoder = new StringDecoder('utf8')
  const buffer = Buffer.alloc(chunkBytes)
  const fd = openSync(file, 'r')
  let rest = ''
  try {
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null)
      const lines = (rest + (read > 0 ? decoder.write(buffer.subarray(0, read)) : decoder.end())).split('\n')
      rest = read > 0 ? (lines.pop() ?? '') : ''
      for (const line of lines) if (line.trim()) events.push(JSON.parse(line) as EngineEvent)
      if (read === 0) break
    }
  } finally {
    closeSync(fd)
  }
  return events
}
