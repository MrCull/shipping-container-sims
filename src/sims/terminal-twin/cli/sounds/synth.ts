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

/** Deterministic pseudo-random numbers in 0..1 (mulberry32): the same seed always gives the same sound. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Adds a sine of `cycles` whole periods over the file (so a loop wraps without a click). */
function periodic(out: Float32Array, cycles: number, amp: number, phase = 0): void {
  for (let i = 0; i < out.length; i++) out[i] += amp * Math.sin(2 * Math.PI * ((cycles * i) / out.length + phase))
}

/** Scales the samples so the loudest is `peak`. */
function normalize(out: Float32Array, peak: number): Float32Array {
  let max = 0
  for (const v of out) max = Math.max(max, Math.abs(v))
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] = (out[i] / max) * peak
  return out
}

/** STS and ASC trolley and hoist: motor hum with cable whine, a wavering high tone, 1 s loop (whole cycles only). */
function motorWhine(): Float32Array {
  const out = new Float32Array(SAMPLE_RATE)
  periodic(out, 95, 0.5)
  periodic(out, 190, 0.3, 0.2)
  periodic(out, 640, 0.25, 0.1)
  periodic(out, 1310, 0.35) // cable whine
  periodic(out, 1317, 0.2, 0.4) // beats against it: the waver
  periodic(out, 2620, 0.08)
  return normalize(out, 0.5)
}

/** Reversing beeper: one 0.4 s beep per second at 1 kHz (plain, unlike the gantry warble), seamlessly loopable. */
function reverseBeeper(): Float32Array {
  const out = new Float32Array(SAMPLE_RATE)
  beep(out, 0, 0.4, 1000, 0.6)
  return out
}

/** Diesel truck idling: low firing rhythm and its harmonics, 1 s loop (28 Hz firing, a slow 4 Hz lope). */
function truckEngine(): Float32Array {
  const out = new Float32Array(SAMPLE_RATE)
  const lope = new Float32Array(SAMPLE_RATE)
  periodic(lope, 4, 0.5)
  for (const [hz, amp] of [[28, 0.7], [56, 0.55], [84, 0.35], [112, 0.25], [168, 0.12]] as const) periodic(out, hz, amp)
  for (let i = 0; i < out.length; i++) out[i] *= 0.75 + lope[i]
  return normalize(out, 0.55)
}

/** Twistlock clunk: a metallic knock, a short noise click then ringing partials that die in 0.3 s. */
function twistlock(): Float32Array {
  const out = new Float32Array(Math.round(0.4 * SAMPLE_RATE))
  const noise = rng(1129)
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE
    const click = (noise() * 2 - 1) * Math.exp(-t * 220) * 0.7
    const ring =
      Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 18) * 0.6 +
      Math.sin(2 * Math.PI * 520 * t) * Math.exp(-t * 28) * 0.4 +
      Math.sin(2 * Math.PI * 1370 * t) * Math.exp(-t * 45) * 0.25
    out[i] = (click + ring) * Math.min(1, t / 0.001, (0.4 - t) / 0.02)
  }
  return normalize(out, 0.8)
}

/** Container landing thud: a low body dropping in pitch with a dull impact, 0.6 s. */
function landingThud(): Float32Array {
  const out = new Float32Array(Math.round(0.6 * SAMPLE_RATE))
  const noise = rng(7331)
  let phase = 0
  let lp = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE
    phase += (2 * Math.PI * (38 + 70 * Math.exp(-t * 14))) / SAMPLE_RATE
    lp += 0.12 * ((noise() * 2 - 1) - lp) // dull: low-passed noise
    out[i] = (Math.sin(phase) * Math.exp(-t * 7) + lp * 2.2 * Math.exp(-t * 30)) * Math.min(1, t / 0.002, (0.6 - t) / 0.05)
  }
  return normalize(out, 0.9)
}

/** Truck air-brake hiss: a burst of high-passed noise, quick attack, long fade, 1.3 s. */
function airBrake(): Float32Array {
  const out = new Float32Array(Math.round(1.3 * SAMPLE_RATE))
  const noise = rng(4242)
  let prev = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE
    const n = noise() * 2 - 1
    const hp = n - prev // first difference: brighter, hissy
    prev = n
    const env = Math.min(1, t / 0.015) * Math.exp(-t * 3.2) * Math.min(1, (1.3 - t) / 0.1)
    out[i] = hp * env * (1 + 0.6 * Math.exp(-t * 25)) // a sharper "psst" at the start
  }
  return normalize(out, 0.6)
}

/**
 * Harbour ambience: wind and water as a sum of whole-cycle sines (it loops without a seam) under a slow swell,
 * with a few gull cries (a falling, wavering tone) at fixed times. 8 s loop, kept soft; the mixer plays it quietly.
 */
function harbourAmbience(): Float32Array {
  const len = 8 * SAMPLE_RATE
  const out = new Float32Array(len)
  const r = rng(2025)
  const bed = new Float32Array(len)
  for (let k = 0; k < 60; k++) {
    const cycles = 120 + Math.floor(r() * 880) * 8 // Hz x 8 s: 120..1160 Hz
    periodic(bed, cycles, (1 / (1 + k * 0.15)) * 0.2, r())
  }
  const swell = new Float32Array(len)
  periodic(swell, 1, 0.5)
  periodic(swell, 3, 0.2, 0.3)
  for (let i = 0; i < len; i++) out[i] = bed[i] * (0.7 + swell[i])
  normalize(out, 0.45)
  const gull = (startS: number, durS: number, hz0: number, hz1: number) => {
    const from = Math.round(startS * SAMPLE_RATE)
    const n = Math.round(durS * SAMPLE_RATE)
    let phase = 0
    for (let i = 0; i < n; i++) {
      const t = i / n
      const hz = hz0 + (hz1 - hz0) * t + 40 * Math.sin(2 * Math.PI * 9 * t * durS)
      phase += (2 * Math.PI * hz) / SAMPLE_RATE
      const env = Math.sin(Math.PI * t) ** 1.5
      out[from + i] += 0.35 * env * (Math.sin(phase) + 0.4 * Math.sin(2 * phase))
    }
  }
  gull(1.2, 0.5, 2100, 1500)
  gull(1.85, 0.35, 1900, 1400)
  gull(5.0, 0.6, 2300, 1600)
  return normalize(out, 0.6)
}

/** Every generated file: name to samples. */
export const SYNTHS: Record<string, () => Float32Array> = {
  'gantry-alarm.wav': gantryAlarm,
  'motor-whine.wav': motorWhine,
  'twistlock.wav': twistlock,
  'landing-thud.wav': landingThud,
  'reverse-beeper.wav': reverseBeeper,
  'truck-engine.wav': truckEngine,
  'air-brake.wav': airBrake,
  'harbour-ambience.wav': harbourAmbience,
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
