import { onMounted, onUnmounted } from 'vue'
import { useGlobalSettingsStore } from '@/stores/globalSettings'

export function useGodModeHotkey(): void {
  const globalSettings = useGlobalSettingsStore()
  let godBuffer = ''

  function onKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return

    const target = event.target
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return
    }

    const key = event.key.toLowerCase()
    if (!/^[a-z]$/.test(key)) {
      godBuffer = ''
      return
    }

    godBuffer = (godBuffer + key).slice(-3)
    if (godBuffer === 'god') {
      globalSettings.toggleGodMode()
      godBuffer = ''
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeydown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown)
  })
}
