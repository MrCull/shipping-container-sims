export interface SiteStorageGlobalSettings {
  soundMuted: boolean
  /** Master volume 0..1, shared by every sim. */
  volume: number
  /** Background music level 0..1, relative to the master volume. */
  musicVolume: number
  /** Sound-effects level 0..1 (effects, ambience, voice), relative to the master volume. */
  sfxVolume: number
  godModeEnabled: boolean
}

export interface SiteStorageData {
  version: 1
  global: SiteStorageGlobalSettings
  sims: Record<string, Record<string, unknown>>
}
