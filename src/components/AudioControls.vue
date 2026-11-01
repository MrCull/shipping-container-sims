<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useAudioStore } from '@/stores/audio'
import { trackEvent } from '@/utils/analytics'
import { isSilent, speakerIcon, speakerLabel } from '@/utils/audioControl'

interface Props {
  placement?: 'absolute' | 'inline'
}

const props = withDefaults(defineProps<Props>(), {
  placement: 'absolute',
})

const audioStore = useAudioStore()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const popover = ref<HTMLElement | null>(null)
/** The popover is teleported to <body> (a sim's top bar may clip it) and placed under the button. */
const popoverStyle = ref<Record<string, string>>({})

const volumePercent = computed(() => Math.round(audioStore.volume * 100))
const effectivelySilent = computed(() => isSilent(audioStore.soundMuted, audioStore.volume))
const icon = computed(() => speakerIcon(audioStore.soundMuted, audioStore.volume))
const label = computed(() => speakerLabel(audioStore.soundMuted))

function place(): void {
  const rect = root.value?.getBoundingClientRect()
  if (!rect) return
  popoverStyle.value = {
    top: `${Math.round(rect.bottom + 6)}px`,
    right: `${Math.max(8, Math.round(window.innerWidth - rect.right))}px`,
  }
}

function onDocumentPointerDown(event: Event): void {
  const target = event.target as Node
  if (root.value?.contains(target) || popover.value?.contains(target)) return
  close()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
}

function close(): void {
  open.value = false
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', place)
}

async function togglePopover(): Promise<void> {
  if (open.value) {
    close()
    return
  }
  place()
  open.value = true
  await nextTick()
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', place)
}

function handleToggleMute(): void {
  const nextMuted = !audioStore.soundMuted
  audioStore.toggleSound()
  trackEvent('audio_toggle', {
    muted: nextMuted,
    placement: props.placement,
  })
}

function handleVolume(event: Event): void {
  audioStore.moveVolumeSlider(Number((event.target as HTMLInputElement).value) / 100)
}

onBeforeUnmount(close)
</script>

<template>
  <div
    ref="root"
    class="audio-controls"
    :class="{ absolute: props.placement === 'absolute' }"
  >
    <button
      class="audio-btn"
      :class="{ muted: effectivelySilent }"
      :title="label"
      :aria-pressed="audioStore.soundMuted"
      aria-label="Mute"
      data-testid="audio-button"
      @click="handleToggleMute"
    >
      {{ icon }}
    </button>
    <button
      class="audio-btn audio-menu-btn"
      title="Volume"
      aria-haspopup="true"
      :aria-expanded="open"
      aria-label="Volume"
      data-testid="audio-menu-button"
      @click="togglePopover"
    >
      ▾
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="popover"
        class="audio-popover"
        :style="popoverStyle"
        role="dialog"
        aria-label="Volume"
        data-testid="audio-popover"
      >
        <input
          class="audio-slider"
          type="range"
          min="0"
          max="100"
          step="1"
          :value="volumePercent"
          aria-label="Volume"
          data-testid="audio-volume"
          @input="handleVolume"
        >
        <span
          class="audio-percent"
          data-testid="audio-volume-label"
        >{{ volumePercent }}%</span>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.audio-controls {
  display: flex;
  gap: 0.2rem;
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

.audio-menu-btn {
  padding: 4px 5px;
  font-size: 0.7rem;
}

.absolute .audio-menu-btn {
  width: 1.4rem;
}

.audio-popover {
  position: fixed;
  z-index: 10000;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.6rem 0.75rem;
  /* The popover sits in <body>: a sim themes it through the --audio-popover-* variables (Terminal Twin's skin.css). */
  background: var(--audio-popover-bg, var(--color-bg-card));
  -webkit-backdrop-filter: var(--audio-popover-blur, none);
  backdrop-filter: var(--audio-popover-blur, none);
  border: 1px solid var(--audio-popover-border, var(--color-border));
  border-radius: 6px;
  box-shadow: var(--audio-popover-shadow, 0 6px 20px rgba(0, 0, 0, 0.5));
  color: var(--audio-popover-text, var(--color-text));
  font-family: var(--audio-popover-font, inherit);
  font-size: 0.8rem;
}

.audio-slider {
  width: 8rem;
  accent-color: var(--audio-popover-accent, var(--color-primary));
}

.audio-percent {
  min-width: 2.6ch;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
