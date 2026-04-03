import { defineStore } from 'pinia'
import { ref } from 'vue'
import { loadSiteStorage, updateSiteStorage } from '@/utils/localStorage'

export const useGlobalSettingsStore = defineStore('global-settings', () => {
  const persistedStorage = loadSiteStorage()
  const godModeEnabled = ref(persistedStorage.global.godModeEnabled)

  function persistGodMode(): void {
    updateSiteStorage(storage => ({
      ...storage,
      global: {
        ...storage.global,
        godModeEnabled: godModeEnabled.value,
      },
    }))
  }

  function setGodModeEnabled(value: boolean): void {
    godModeEnabled.value = value
    persistGodMode()
  }

  function toggleGodMode(): boolean {
    setGodModeEnabled(!godModeEnabled.value)
    return godModeEnabled.value
  }

  return {
    godModeEnabled,
    setGodModeEnabled,
    toggleGodMode,
  }
})
