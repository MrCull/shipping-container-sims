import { defineStore } from 'pinia'
import { ref } from 'vue'
import { loadSiteStorage, updateSiteStorage } from '@/utils/localStorage'

export type ContainerColorMode = 'shipping_line' | 'visit_type' | 'dwell_time' | 'move_status' | 'export_vessel'

export const useGlobalSettingsStore = defineStore('global-settings', () => {
  const persistedStorage = loadSiteStorage()
  const godModeEnabled = ref(persistedStorage.global.godModeEnabled)
  const containerColorMode = ref<ContainerColorMode>('shipping_line')

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

  function setContainerColorMode(mode: ContainerColorMode): void {
    containerColorMode.value = mode
  }

  return {
    godModeEnabled,
    setGodModeEnabled,
    toggleGodMode,
    containerColorMode,
    setContainerColorMode,
  }
})
