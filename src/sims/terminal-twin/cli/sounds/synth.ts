/**
 * Terminal Twin sound synthesis (#125): the positional sound files are generated here from code, with no third party
 * and no randomness, so they are royalty-free and reproducible. Output is 16-bit mono PCM WAV under `assets/sounds/`.
 * `pnpm run tt:sounds` writes them; `pnpm run tt:sounds:check` regenerates in memory and fails on any byte of drift
 * (also a Vitest suite and a PR CI step). Add a sound: one more `SYNTHS` entry.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SOUNDS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'sounds')
export const SAMPLE_RATE = 22050

/** WAV file bytes for mono 16-bit samples in -1..1. */
export function encodeWav(samples: Float32Array, rate = SAMPLE_RATE): Uint8Array {
  const data = samples.length * 2
  const buf = Buffer.alloc(44 + data)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + data, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(data, 40)
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2)
  return new Uint8Array(buf)
}

/** A square-ish electronic tone (odd harmonics 1, 3, 5) with a short linear attack and release. */
function beep(out: Float32Array, startS: number, durS: number, hz: number, amp: number): void {
  const edge = 0.006
  const from = Math.round(startS * SAMPLE_RATE)
  const n = Math.round(durS * SAMPLE_RATE)
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE
    const env = Math.min(1, t / edge, (durS - t) / edge)
    const phase = 2 * Math.PI * hz * t
    const wave = (Math.sin(phase) + Math.sin(3 * phase) / 3 + Math.sin(5 * phase) / 5) / 1.5
    out[from + i] += amp * env * wave
  }
}

/** Gantry travel alarm: a two-tone electronic warble, then a pause, seamlessly loopable (1.2 s). */
function gantryAlarm(): Float32Array {
  const out = new Float32Array(Math.round(1.2 * SAMPLE_RATE))
  beep(out, 0, 0.25, 1100, 0.7)
  beep(out, 0.35, 0.25, 1450, 0.7)
  return out
}

/** Every generated file: name to samples. */
export const SYNTHS: Record<string, () => Float32Array> = {
  'gantry-alarm.wav': gantryAlarm,
}

export function synthesizeAll(): Map<string, Uint8Array> {
  return new Map(Object.entries(SYNTHS).map(([name, make]) => [name, encodeWav(make())]))
}

/** Problems found comparing a fresh regeneration with the files in `dir` (empty = byte-identical). */
export function checkSounds(dir: string): string[] {
  const problems: string[] = []
  for (const [name, bytes] of synthesizeAll()) {
    const file = join(dir, name)
    if (!existsSync(file)) problems.push(`${name}: missing (run pnpm run tt:sounds)`)
    else if (Buffer.compare(readFileSync(file), bytes) !== 0) problems.push(`${name}: differs from a fresh regeneration (run pnpm run tt:sounds)`)
  }
  return problems
}
