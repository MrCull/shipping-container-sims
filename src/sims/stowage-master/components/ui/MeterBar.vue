<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  label: string
  value: number
  max: number
  warning: number
  critical: number
  unit?: string
  absolute?: boolean
}>()

const absValue = computed(() => (props.absolute !== false) ? Math.abs(props.value) : props.value)

const fillPercent = computed(() => Math.min((absValue.value / props.max) * 100, 100))

const fillColor = computed(() => {
  if (absValue.value >= props.critical) return '#ff4444'
  if (absValue.value >= props.warning) return '#ffaa00'
  return '#00ff88'
})

const fillStyle = computed(() => ({
  width: fillPercent.value + '%',
  backgroundColor: fillColor.value,
}))

const displayValue = computed(() => {
  const v = (props.absolute !== false) ? absValue.value : props.value
  return v.toFixed(1) + (props.unit ?? '')
})
</script>

<template>
  <div class="meter-bar">
    <div class="meter-label">
      {{ label }}
    </div>
    <div class="meter-track">
      <div
        class="meter-fill"
        :style="fillStyle"
      />
      <div class="meter-value">
        {{ displayValue }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.meter-bar {
  margin-bottom: 6px;
}
.meter-label {
  font-size: 11px;
  color: #aaa;
  margin-bottom: 2px;
}
.meter-track {
  position: relative;
  height: 16px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  overflow: hidden;
}
.meter-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease, background-color 0.3s ease;
}
.meter-value {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: bold;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}
</style>
