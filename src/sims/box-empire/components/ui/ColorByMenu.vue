<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGlobalSettingsStore } from '@/stores/globalSettings'
import type { ContainerColorMode } from '@/stores/globalSettings'
import { getColorLegend } from '../../modules/containerColorMode'

const settings = useGlobalSettingsStore()
const collapsed = ref(true)

const OPTIONS: { value: ContainerColorMode; label: string }[] = [
  { value: 'shipping_line', label: 'Shipping Line' },
  { value: 'visit_type',    label: 'Import / Export' },
  { value: 'dwell_time',    label: 'Dwell Time' },
  { value: 'move_status',   label: 'Move Status' },
  { value: 'export_vessel', label: 'Export Vessel' },
]

const legend = computed(() => getColorLegend(settings.containerColorMode))
</script>

<template>
  <div class="color-by-menu">
    <button
      class="header-btn"
      @click="collapsed = !collapsed"
    >
      <span class="icon">&#9632;</span>
      Color By
      <span class="chevron">{{ collapsed ? '▸' : '▾' }}</span>
    </button>

    <div
      v-if="!collapsed"
      class="panel"
    >
      <label
        v-for="opt in OPTIONS"
        :key="opt.value"
        class="option-row"
      >
        <input
          type="radio"
          :value="opt.value"
          :checked="settings.containerColorMode === opt.value"
          @change="settings.setContainerColorMode(opt.value)"
        >
        <span>{{ opt.label }}</span>
      </label>

      <div
        v-if="legend.length > 0"
        class="legend"
      >
        <div
          v-for="entry in legend"
          :key="entry.label"
          class="legend-row"
        >
          <span
            class="swatch"
            :style="{ background: entry.color }"
          />
          <span class="legend-label">{{ entry.label }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.color-by-menu {
  position: absolute;
  top: 280px;
  left: 18px;
  z-index: 20;
  pointer-events: auto;
  user-select: none;
}

.header-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  background: rgba(0, 0, 0, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.7);
  font-family: var(--font-retro, monospace);
  font-size: 0.6rem;
  padding: 5px 8px;
  cursor: pointer;
  width: 100%;
  text-align: left;
}

.header-btn:hover {
  background: rgba(0, 0, 0, 0.85);
  color: #fff;
}

.icon {
  font-size: 0.5rem;
  color: #6cb7ff;
}

.chevron {
  margin-left: auto;
  font-size: 0.55rem;
}

.panel {
  margin-top: 2px;
  background: rgba(0, 0, 0, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 130px;
}

.option-row {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-family: var(--font-retro, monospace);
  font-size: 0.58rem;
  color: rgba(255, 255, 255, 0.75);
}

.option-row:hover {
  color: #fff;
}

.option-row input[type="radio"] {
  accent-color: #6cb7ff;
  cursor: pointer;
  margin: 0;
}

.legend {
  margin-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding-top: 5px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.legend-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}

.legend-label {
  font-family: var(--font-retro, monospace);
  font-size: 0.55rem;
  color: rgba(255, 255, 255, 0.6);
}
</style>
