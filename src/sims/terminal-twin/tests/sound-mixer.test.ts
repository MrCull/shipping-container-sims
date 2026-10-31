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
    const voices = mixSources(cam, [sts('A', 30, 'gantrying'), sts('B', 30, 'idle'), { ...sts('C', 30), machine: 'asc' as const, motion: 'working' }])
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
