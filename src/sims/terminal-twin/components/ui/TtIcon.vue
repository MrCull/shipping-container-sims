<script setup lang="ts">
/** Outline icon set of the Terminal Twin skin (24x24 grid, 1.8 stroke, currentColor); decorative unless the parent labels it. */
defineProps<{ name: 'close' | 'prev' | 'next' | 'play' | 'pause' | 'check' | 'alert' | 'warn' | 'refresh' | 'layers' }>()

const PATHS: Record<string, string> = {
  close: 'M6 6l12 12M18 6L6 18',
  prev: 'M14.5 6l-6 6 6 6',
  next: 'M9.5 6l6 6-6 6',
  play: 'M8 5.5v13l10-6.5z',
  pause: 'M9 6v12M15 6v12',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 3.5l9.5 16.5h-19zM12 10v4.5M12 17.2v.1',
  warn: 'M12 3.5l9.5 16.5h-19zM12 10v4.5M12 17.2v.1',
  refresh: 'M19 12a7 7 0 11-2.1-5M19 4.5V8h-3.5',
  layers: 'M12 4l8.5 4.5L12 13 3.5 8.5zM3.5 12.5L12 17l8.5-4.5M3.5 16L12 20.5 20.5 16',
}
</script>

<template>
  <svg
    class="tt-icon"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <path :d="PATHS[name]" />
  </svg>
</template>
