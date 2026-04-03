export interface SiteStorageGlobalSettings {
  soundMuted: boolean
  godModeEnabled: boolean
}

export interface SiteStorageData {
  version: 1
  global: SiteStorageGlobalSettings
  sims: Record<string, Record<string, unknown>>
}
