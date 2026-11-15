<script setup lang="ts">
/** Outline icon set of the Terminal Twin skin (24x24 grid, 1.8 stroke, currentColor); decorative unless the parent labels it. */
type IconExtra =
  | 'target' | 'ship' | 'grid' | 'sliders' | 'arrow' | 'help' | 'save' | 'chart' | 'reset' | 'plus' | 'step' | 'skip'
  | 'sun' | 'up' | 'down' | 'list' | 'info' | 'eye' | 'gauge' | 'download' | 'upload' | 'trash' | 'clock' | 'logo' | 'moon'

defineProps<{ name: 'close' | 'prev' | 'next' | 'play' | 'pause' | 'check' | 'alert' | 'warn' | 'refresh' | 'layers' | IconExtra }>()

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
  target: 'M12 3v3M12 18v3M3 12h3M18 12h3M12 12m-6 0a6 6 0 1012 0a6 6 0 10-12 0M12 12m-1.5 0a1.5 1.5 0 103 0a1.5 1.5 0 10-3 0',
  ship: 'M3.5 16.5l1.8 3.5h13.4l1.8-3.5zM5.5 16.5v-5h13v5M8.5 11.5v-4h7v4M12 7.5v-3',
  grid: 'M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 7m-2 0a2 2 0 104 0a2 2 0 10-4 0M9 17m-2 0a2 2 0 104 0a2 2 0 10-4 0',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  help: 'M12 12m-8.5 0a8.5 8.5 0 1017 0a8.5 8.5 0 10-17 0M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.2M12 16.8v.1',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  chart: 'M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6',
  reset: 'M5 12a7 7 0 102.1-5M5 4.5V8h3.5',
  plus: 'M12 5v14M5 12h14',
  step: 'M7 5.5v13l8-6.5zM17.5 6v12',
  skip: 'M5 5.5v13l7-6.5zM12 5.5v13l7-6.5z',
  sun: 'M12 12m-3.5 0a3.5 3.5 0 107 0a3.5 3.5 0 10-7 0M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18',
  up: 'M6 14.5l6-6 6 6',
  down: 'M6 9.5l6 6 6-6',
  list: 'M8.5 6.5H20M8.5 12H20M8.5 17.5H20M4.5 6.5v.1M4.5 12v.1M4.5 17.5v.1',
  info: 'M12 12m-8.5 0a8.5 8.5 0 1017 0a8.5 8.5 0 10-17 0M12 11v5.5M12 7.8v.1',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 12m-2.6 0a2.6 2.6 0 105.2 0a2.6 2.6 0 10-5.2 0',
  gauge: 'M4.5 17a8.5 8.5 0 1115 0M12 13.5l4-4.5M12 13.5m-1 0a1 1 0 102 0a1 1 0 10-2 0',
  download: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14',
  upload: 'M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19.5h14',
  trash: 'M5 7h14M9.5 7V4.5h5V7M7 7l.8 12.5h8.4L17 7',
  clock: 'M12 12m-8.5 0a8.5 8.5 0 1017 0a8.5 8.5 0 10-17 0M12 7.5V12l3 2',
  moon: 'M19.5 14.2A8 8 0 019.8 4.5a8 8 0 109.7 9.7z',
  logo: 'M4 19.5h16M6.5 19.5V9.5M6.5 9.5L18.5 6M6.5 6v3.5M18.5 6v4.5M16.5 10.5h4v3h-4zM3.5 13h6v3.5h-6z',
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
