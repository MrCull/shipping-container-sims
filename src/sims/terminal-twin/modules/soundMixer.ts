/**
 * Sound mixer (#125, spec #116): the pure core of positional sound. Each frame it maps the camera position and the
 * active sound sources (a machine's position and motion state) to voices with gains: distance attenuation, at most
 * `MAX_VOICES` voices (the loudest, ties by id), none for sources whose motion does not call for the sound.
 * It owns no audio and no state; `positionalSound.ts` plays the voices through Web Audio.
 */

export type SoundKind =
  | 'gantryAlarm'
  | 'motorWhine'
  | 'twistlock'
  | 'landingThud'
  | 'reverseBeeper'
  | 'truckEngine'
  | 'airBrake'
  | 'harbourAmbience'
/**
 * What a machine is doing, as far as sound goes. `gantrying` = travelling along its rails, `working` = trolley or
 * hoist moving; `locking`, `unlocking`, `landing` and `braking` are short one-shot moments; `driving`/`reversing`
 * are vehicles under way.
 */
export type MotionState = 'idle' | 'working' | 'gantrying' | 'driving' | 'reversing' | 'locking' | 'unlocking' | 'landing' | 'braking'
/** `harbour` is the scene's own ambience source: not a machine, not positional. */
export type MachineKind = 'sts' | 'asc' | 'shc' | 'truck' | 'harbour'

export interface SoundSource {
  /** Machine id (unique per scene). */
  id: string
  machine: MachineKind
  /** World position of the sound's origin (m). */
  x: number
  y: number
  z: number
  motion: MotionState
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Voice {
  /** Stable identity (`<sound>:<source id>`): a voice with the same key in two frames is the same voice. */
  key: string
  sound: SoundKind
  sourceId: string
  /** 0..1 before the master gain. */
  gain: number
}

export interface SoundProfile {
  /** Motion states in which the machine makes this sound, by machine kind. */
  when: Partial<Record<MachineKind, readonly MotionState[]>>
  /** Full level inside this distance (m). */
  refDistanceM: number
  /** Silent from this distance on (m). */
  maxDistanceM: number
  /** Level at the reference distance. */
  level: number
  /** Loops while its state lasts (true) or plays once from its start (false). */
  loop: boolean
  /** False = the same level everywhere (ambience), never cut by the voice cap. */
  positional?: false
}

export const SOUND_PROFILES: Record<SoundKind, SoundProfile> = {
  gantryAlarm: { when: { sts: ['gantrying'], asc: ['gantrying'] }, refDistanceM: 40, maxDistanceM: 500, level: 0.6, loop: true },
  motorWhine: { when: { sts: ['working'], asc: ['working'] }, refDistanceM: 25, maxDistanceM: 220, level: 0.35, loop: true },
  twistlock: { when: { sts: ['locking', 'unlocking'], asc: ['locking', 'unlocking'], shc: ['locking', 'unlocking'] }, refDistanceM: 15, maxDistanceM: 160, level: 0.7, loop: false },
  landingThud: { when: { sts: ['landing'], asc: ['landing'], shc: ['landing'] }, refDistanceM: 20, maxDistanceM: 220, level: 0.8, loop: false },
  reverseBeeper: { when: { shc: ['reversing'], truck: ['reversing'] }, refDistanceM: 12, maxDistanceM: 130, level: 0.5, loop: true },
  truckEngine: { when: { truck: ['idle', 'driving'] }, refDistanceM: 8, maxDistanceM: 80, level: 0.3, loop: true },
  airBrake: { when: { truck: ['braking'] }, refDistanceM: 8, maxDistanceM: 90, level: 0.5, loop: false },
  harbourAmbience: { when: { harbour: ['idle'] }, refDistanceM: 0, maxDistanceM: Infinity, level: 0.12, loop: true, positional: false },
}

/** Voices playing at once, at most. */
export const MAX_VOICES = 12
/** Quieter than this is not worth a voice. */
const MIN_GAIN = 0.01

/** Level at `distanceM`: inverse distance beyond the reference, faded to zero at the maximum so voices end cleanly. */
export function attenuate(profile: SoundProfile, distanceM: number): number {
  if (distanceM >= profile.maxDistanceM) return 0
  if (distanceM <= profile.refDistanceM) return profile.level
  const span = profile.maxDistanceM - profile.refDistanceM
  const fade = 1 - ((distanceM - profile.refDistanceM) / span) ** 2
  return profile.level * (profile.refDistanceM / distanceM) * fade
}

export function mixSources(camera: Vec3, sources: readonly SoundSource[], opts: { maxVoices?: number } = {}): Voice[] {
  const voices: Voice[] = []
  const ambient: Voice[] = []
  for (const s of sources) {
    for (const sound of SOUND_KINDS) {
      const profile = SOUND_PROFILES[sound]
      if (!profile.when[s.machine]?.includes(s.motion)) continue
      if (profile.positional === false) {
        ambient.push({ key: `${sound}:${s.id}`, sound, sourceId: s.id, gain: profile.level })
        continue
      }
      const gain = attenuate(profile, Math.hypot(s.x - camera.x, s.y - camera.y, s.z - camera.z))
      if (gain >= MIN_GAIN) voices.push({ key: `${sound}:${s.id}`, sound, sourceId: s.id, gain })
    }
  }
  const cap = opts.maxVoices ?? MAX_VOICES
  const kept = ambient.slice(0, cap) // ambience is never crowded out by machines
  return [...voices.sort(byLoudness).slice(0, cap - kept.length), ...kept].sort(byLoudness)
}

const SOUND_KINDS = Object.keys(SOUND_PROFILES) as SoundKind[]
const byLoudness = (a: Voice, b: Voice) => b.gain - a.gain || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

export interface VoiceDiff {
  start: Voice[]
  stop: Voice[]
  update: Voice[]
}

/** What the playback layer must do to go from last frame's voices to this frame's. */
export function diffVoices(prev: readonly Voice[], next: readonly Voice[]): VoiceDiff {
  const before = new Set(prev.map((v) => v.key))
  const after = new Set(next.map((v) => v.key))
  return {
    start: next.filter((v) => !before.has(v.key)),
    stop: prev.filter((v) => !after.has(v.key)),
    update: next.filter((v) => before.has(v.key)),
  }
}
