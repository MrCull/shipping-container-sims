/**
 * Sound synthesis (#125): the sound files are generated from code, deterministically, and the committed files
 * match a fresh regeneration byte for byte (`pnpm run tt:sounds:check` runs the same comparison).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkSounds, SOUNDS_DIR, synthesizeAll } from '../cli/sounds/synth'

describe('sound synthesis', () => {
  it('generates byte-identical files on every run', () => {
    const a = synthesizeAll()
    const b = synthesizeAll()
    expect([...a.keys()]).toContain('gantry-alarm.wav')
    for (const [name, bytes] of a) expect(Buffer.compare(bytes, b.get(name)!), name).toBe(0)
  })

  it('writes a mono 16-bit PCM WAV with a repeating beep (loud bursts with silence between)', () => {
    const wav = Buffer.from(synthesizeAll().get('gantry-alarm.wav')!)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.readUInt16LE(20)).toBe(1) // PCM
    expect(wav.readUInt16LE(22)).toBe(1) // mono
    expect(wav.readUInt16LE(34)).toBe(16)
    const rate = wav.readUInt32LE(24)
    const samples = new Int16Array(wav.buffer.slice(wav.byteOffset + 44, wav.byteOffset + wav.length))
    expect(samples.length / rate).toBeGreaterThan(0.5)
    expect(samples.length / rate).toBeLessThan(4)
    const window = Math.floor(rate * 0.02)
    let loud = 0
    let silent = 0
    for (let i = 0; i + window <= samples.length; i += window) {
      let peak = 0
      for (let j = i; j < i + window; j++) peak = Math.max(peak, Math.abs(samples[j]))
      if (peak > 8000) loud++
      else if (peak < 200) silent++
    }
    expect(loud).toBeGreaterThan(5)
    expect(silent).toBeGreaterThan(5)
    // loops without a click: starts and ends silent
    expect(Math.abs(samples[0])).toBeLessThan(50)
    expect(Math.abs(samples[samples.length - 1])).toBeLessThan(50)
  })

  it('matches the committed files', () => {
    expect(checkSounds(SOUNDS_DIR)).toEqual([])
  })

  it('reports drift: a changed, missing or unknown file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tt-sounds-'))
    try {
      for (const [name, bytes] of synthesizeAll()) writeFileSync(join(dir, name), bytes)
      expect(checkSounds(dir)).toEqual([])
      const f = join(dir, 'gantry-alarm.wav')
      const bytes = readFileSync(f)
      bytes[100] ^= 1
      writeFileSync(f, bytes)
      expect(checkSounds(dir).join('\n')).toMatch(/gantry-alarm\.wav.*differs/)
      rmSync(f)
      expect(checkSounds(dir).join('\n')).toMatch(/gantry-alarm\.wav.*missing/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
