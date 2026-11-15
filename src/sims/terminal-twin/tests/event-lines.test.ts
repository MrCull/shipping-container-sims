import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readEventLines } from '../cli/eventLines'

describe('readEventLines (tt:sts input)', () => {
  it('reads a JSON-lines log in chunks of any size to the same events, multi-byte text and blank lines included', () => {
    const events = Array.from({ length: 200 }, (_, id) => ({ id, t: id * 1.5, type: 'Note', payload: { text: `quay 0–${id} m, café` } }))
    const file = join(mkdtempSync(join(tmpdir(), 'tt-lines-')), 'events.jsonl')
    writeFileSync(file, `${events.map((e) => JSON.stringify(e)).join('\n')}\n\n`)
    // 7 bytes: chunk edges fall inside lines and inside the three-byte en dash
    for (const chunkBytes of [7, 1024, 1 << 24]) expect(readEventLines(file, chunkBytes)).toEqual(events)
  })

  it('reads a last line with no newline, and an empty file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tt-lines-'))
    writeFileSync(join(dir, 'a.jsonl'), '{"id":1}\n{"id":2}')
    expect(readEventLines(join(dir, 'a.jsonl'), 5)).toEqual([{ id: 1 }, { id: 2 }])
    writeFileSync(join(dir, 'b.jsonl'), '')
    expect(readEventLines(join(dir, 'b.jsonl'))).toEqual([])
  })
})
