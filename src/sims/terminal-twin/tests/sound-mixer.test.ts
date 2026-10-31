/**
 * Sound mixer (#125): pure mapping from the camera and the active sound sources to voices with gains.
 * Attenuation with distance, the voice cap and its ordering, and the gantry alarm only for gantrying machines.
 */
import { describe, expect, it } from 'vitest'
import { diffVoices, MAX_VOICES, mixSources, SOUND_PROFILES, type SoundSource } from '../modules/soundMixer'

const cam = { x: 0, y: 10, z: 0 }
const sts = (id: string, x: number, motion: SoundSource['motion'] = 'gantrying'): SoundSource => ({ id, machine: 'sts', x, y: 10, z: 0, motion })

describe('sound mixer', () => {
  it('gets louder as the camera approaches and fades to nothing far away', () => {
    const gains = [20, 60, 120, 250, 400].map((d) => mixSources(cam, [sts('A', d)])[0]?.gain ?? 0)
    for (let i = 1; i < gains.length; i++) expect(gains[i]).toBeLessThan(gains[i - 1])
    expect(gains[0]).toBeGreaterThan(0.2)
    expect(mixSources(cam, [sts('A', SOUND_PROFILES.gantryAlarm.maxDistanceM + 1)])).toEqual([])
  })

  it('uses the full 3D distance', () => {
    const near = mixSources(cam, [{ ...sts('A', 0), y: 30, z: 40 }])[0]
    const same = mixSources(cam, [sts('A', 44.72)])[0] // sqrt(20^2 + 40^2)
    expect(near.gain).toBeCloseTo(same.gain, 2)
  })

  it('sounds the gantry alarm only for sources that are gantrying', () => {
    const voices = mixSources(cam, [sts('A', 30, 'gantrying'), sts('B', 30, 'idle'), { ...sts('C', 30), machine: 'asc' as const, motion: 'working' }]).filter((v) => v.sound === 'gantryAlarm')
    expect(voices.map((v) => v.sourceId)).toEqual(['A'])
    expect(voices[0]).toMatchObject({ sound: 'gantryAlarm', key: 'gantryAlarm:A' })
    expect(mixSources(cam, [sts('B', 30, 'idle')])).toEqual([])
  })

  it('keeps the loudest voices up to the cap, loudest first, ties by id', () => {
    const sources = Array.from({ length: 20 }, (_, i) => sts(`S${String(i).padStart(2, '0')}`, 30 + i * 10))
    const voices = mixSources(cam, [...sources].reverse())
    expect(MAX_VOICES).toBe(12)
    expect(voices).toHaveLength(12)
    expect(voices.map((v) => v.sourceId)).toEqual(sources.slice(0, 12).map((s) => s.id))
    for (let i = 1; i < voices.length; i++) expect(voices[i].gain).toBeLessThanOrEqual(voices[i - 1].gain)
    expect(mixSources(cam, sources, { maxVoices: 3 })).toHaveLength(3)
    const tie = mixSources(cam, [sts('b', 50), sts('a', -50)])
    expect(tie.map((v) => v.sourceId)).toEqual(['a', 'b'])
  })

  it('diffs voice sets: start the new, stop the gone, retune the kept', () => {
    const a = mixSources(cam, [sts('A', 30), sts('B', 60)])
    const b = mixSources(cam, [sts('B', 40), sts('C', 50)])
    const d = diffVoices(a, b)
    expect(d.start.map((v) => v.sourceId)).toEqual(['C'])
    expect(d.stop.map((v) => v.sourceId)).toEqual(['A'])
    expect(d.update.map((v) => v.sourceId)).toEqual(['B'])
    expect(diffVoices([], []).start).toEqual([])
  })
})

const src = (id: string, machine: SoundSource['machine'], motion: SoundSource['motion'], x = 10): SoundSource => ({ id, machine, x, y: 10, z: 0, motion })
const soundsOf = (sources: SoundSource[]) => mixSources(cam, sources).map((v) => v.sound)

describe('sound mixer: the rest of the terminal (#129)', () => {
  it('maps each source state to its voice', () => {
    expect(soundsOf([src('S', 'sts', 'working')])).toEqual(['motorWhine'])
    expect(soundsOf([src('A', 'asc', 'working')])).toEqual(['motorWhine'])
    expect(soundsOf([src('S', 'sts', 'locking')])).toEqual(['twistlock'])
    expect(soundsOf([src('H', 'shc', 'unlocking')])).toEqual(['twistlock'])
    expect(soundsOf([src('A', 'asc', 'landing')])).toEqual(['landingThud'])
    expect(soundsOf([src('H', 'shc', 'reversing')])).toEqual(['reverseBeeper'])
    expect(soundsOf([src('T', 'truck', 'reversing')])).toEqual(['reverseBeeper'])
    expect(soundsOf([src('T', 'truck', 'idle')])).toEqual(['truckEngine'])
    expect(soundsOf([src('T', 'truck', 'driving')])).toEqual(['truckEngine'])
    expect(soundsOf([src('T', 'truck', 'braking')])).toEqual(['airBrake'])
  })

  it('keeps machines silent in states that make no sound', () => {
    expect(soundsOf([src('S', 'sts', 'idle'), src('A', 'asc', 'idle'), src('H', 'shc', 'idle'), src('H2', 'shc', 'driving')])).toEqual([])
    expect(soundsOf([src('T', 'truck', 'working')])).toEqual([])
  })

  it('makes distinct, distance-appropriate sounds: a close beeper is audible, a far one is not', () => {
    expect(soundsOf([src('H', 'shc', 'reversing', 30)])).toEqual(['reverseBeeper'])
    expect(soundsOf([src('H', 'shc', 'reversing', SOUND_PROFILES.reverseBeeper.maxDistanceM + 1)])).toEqual([])
    expect(SOUND_PROFILES.truckEngine.maxDistanceM).toBeLessThan(SOUND_PROFILES.gantryAlarm.maxDistanceM)
    expect(SOUND_PROFILES.reverseBeeper.maxDistanceM).toBeLessThan(SOUND_PROFILES.gantryAlarm.maxDistanceM)
  })

  it('plays one-shots once (no loop) and the rest looped', () => {
    for (const s of ['twistlock', 'landingThud', 'airBrake'] as const) expect(SOUND_PROFILES[s].loop, s).toBe(false)
    for (const s of ['gantryAlarm', 'motorWhine', 'reverseBeeper', 'truckEngine', 'harbourAmbience'] as const) expect(SOUND_PROFILES[s].loop, s).toBe(true)
  })

  it('plays the harbour ambience everywhere, faintly, whatever the camera does', () => {
    const harbour = src('harbour', 'harbour', 'idle', 99999)
    for (const camera of [cam, { x: 5000, y: 300, z: -4000 }]) {
      const v = mixSources(camera, [harbour])
      expect(v).toHaveLength(1)
      expect(v[0]).toMatchObject({ sound: 'harbourAmbience', key: 'harbourAmbience:harbour' })
      expect(v[0].gain).toBeLessThanOrEqual(0.15)
      expect(v[0].gain).toBeGreaterThan(0.02)
    }
    const others = (Object.keys(SOUND_PROFILES) as (keyof typeof SOUND_PROFILES)[]).filter((k) => k !== 'harbourAmbience').map((k) => SOUND_PROFILES[k].level)
    expect(SOUND_PROFILES.harbourAmbience.level).toBeLessThan(Math.min(...others) / 2)
  })

  it('caps a busy scene at 12 voices and still keeps the ambience', () => {
    const busy: SoundSource[] = [src('harbour', 'harbour', 'idle')]
    const motions = ['working', 'gantrying', 'locking', 'landing'] as const
    for (let i = 0; i < 10; i++) for (const m of motions) busy.push(src(`S${i}`, 'sts', m, 12 + i))
    for (let i = 0; i < 30; i++) busy.push(src(`T${i}`, 'truck', i % 2 ? 'reversing' : 'idle', 5 + i))
    const voices = mixSources(cam, busy)
    expect(voices).toHaveLength(MAX_VOICES)
    expect(voices.some((v) => v.sound === 'harbourAmbience')).toBe(true)
    for (let i = 1; i < voices.length; i++) expect(voices[i].gain).toBeLessThanOrEqual(voices[i - 1].gain)
    expect(new Set(voices.map((v) => v.key)).size).toBe(MAX_VOICES)
  })
})
