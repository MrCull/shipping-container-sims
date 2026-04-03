<script setup lang="ts">
import { useGlobalSettingsStore } from '@/stores/globalSettings'

const globalSettings = useGlobalSettingsStore()
</script>

<template>
  <button
    v-if="globalSettings.godModeEnabled"
    class="god-btn"
    :class="{ active: globalSettings.godModeEnabled }"
    :title="globalSettings.godModeEnabled ? 'Disable god mode' : 'Enable god mode'"
    @click="globalSettings.toggleGodMode()"
  >
    ⚡
  </button>
</template>

<style scoped>
.god-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.72);
  font-size: 1rem;
  cursor: pointer;
  transition: all 0.15s;
}

.god-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.6);
  color: #fff;
}

.god-btn.active {
  border-color: rgba(255, 196, 0, 0.9);
  background: rgba(255, 196, 0, 0.18);
  color: #ffd54a;
  box-shadow: 0 0 10px rgba(255, 196, 0, 0.18);
}
</style>
