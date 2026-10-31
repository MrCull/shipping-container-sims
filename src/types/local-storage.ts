export interface SiteStorageGlobalSettings {
  soundMuted: boolean
  /** Master volume 0..1, shared by every sim. */
  volume: number
  godModeEnabled: boolean
}

export interface SiteStorageData {
  version: 1
  global: SiteStorageGlobalSettings
  sims: Record<string, Record<string, unknown>>
}
