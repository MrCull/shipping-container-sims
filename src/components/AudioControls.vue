<script setup lang="ts">
import { useAudioStore } from '@/stores/audio'
import { trackEvent } from '@/utils/analytics'

interface Props {
  placement?: 'absolute' | 'inline'
}

const props = withDefaults(defineProps<Props>(), {
  placement: 'absolute',
})

const audioStore = useAudioStore()

function handleToggleSound(): void {
  const nextMuted = !audioStore.soundMuted
  audioStore.toggleSound()
  trackEvent('audio_toggle', {
    muted: nextMuted,
    placement: props.placement,
  })
}
</script>

<template>
  <div
    class="audio-controls"
    :class="{ absolute: props.placement === 'absolute' }"
  >
    <button
      class="audio-btn"
      :class="{ muted: audioStore.soundMuted }"
      :title="audioStore.soundMuted ? 'Turn sound on' : 'Turn sound off'"
      @click="handleToggleSound"
    >
      {{ audioStore.soundMuted ? '🔇' : '🔊' }}
    </button>
  </div>
</template>

<style scoped>
.audio-controls {
  display: flex;
  gap: 0.4rem;
}

.audio-controls.absolute {
  position: absolute;
  top: 1rem;
  right: 1rem;
  z-index: 10;
}

.audio-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 8px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  color: #fff;
  font-size: 1rem;
  cursor: pointer;
  transition: all 0.15s;
}

.audio-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.6);
}

.audio-btn.muted {
  opacity: 0.6;
}

.absolute .audio-btn {
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
}

.absolute .audio-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
  background: rgba(59, 130, 246, 0.1);
}
</style>
