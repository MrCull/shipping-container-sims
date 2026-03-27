<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGameStore } from '../../store/gameStore'
import type { Job } from '../../types'

const store = useGameStore()
const collapsed = ref(false)
const expandedJobId = ref<string | null>(null)

const displayJobs = computed((): Job[] => {
  return store.jobs
    .filter(j => j.status !== 'completed' && j.status !== 'cancelled')
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 10)
})

function toggleExpand(jobId: string): void {
  expandedJobId.value = expandedJobId.value === jobId ? null : jobId
}

function statusColor(status: string): string {
  switch (status) {
    case 'pending': return '#aaaaaa'
    case 'assigned': return '#f1c40f'
    case 'in_progress': return '#2ecc71'
    case 'blocked': return '#e74c3c'
    default: return '#888888'
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case 'pending': return '⏳'
    case 'assigned': return '🔔'
    case 'in_progress': return '▶'
    case 'blocked': return '🚫'
    default: return '·'
  }
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(-6) : id
}

function locationLabel(type: string): string {
  switch (type) {
    case 'vessel_slot': return 'Vessel'
    case 'yard_slot': return 'Yard'
    case 'quay_buffer': return 'Quay'
    case 'truck': return 'Truck'
    case 'gate_buffer': return 'Gate'
    case 'equipment': return 'Equip'
    default: return type
  }
}
</script>

<template>
  <div class="job-queue-widget">
    <div
      class="widget-header"
      @click="collapsed = !collapsed"
    >
      <span class="header-title">Job Queue</span>
      <span class="header-count">{{ displayJobs.length }}</span>
      <span class="collapse-btn">{{ collapsed ? '▲' : '▼' }}</span>
    </div>

    <div
      v-if="!collapsed"
      class="job-list"
    >
      <div
        v-if="displayJobs.length === 0"
        class="empty-state"
      >
        No active jobs
      </div>

      <div
        v-for="job in displayJobs"
        :key="job.id"
        class="job-row"
        @click="toggleExpand(job.id)"
      >
        <span
          class="status-icon"
          :style="{ color: statusColor(job.status) }"
        >{{ statusIcon(job.status) }}</span>
        <span class="job-id">{{ shortId(job.id) }}</span>
        <span class="job-route">
          {{ locationLabel(job.pickupLocation.type) }} → {{ locationLabel(job.dropoffLocation.type) }}
        </span>
        <span class="job-priority">P{{ job.priority }}</span>

        <div
          v-if="expandedJobId === job.id"
          class="job-detail"
        >
          <div class="detail-row">
            <span class="detail-label">Container:</span>
            <span class="detail-value">{{ shortId(job.containerId) }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Equipment:</span>
            <span class="detail-value">{{ job.equipmentType.replace('_', ' ') }}</span>
          </div>
          <div
            v-if="job.assignedEquipmentId"
            class="detail-row"
          >
            <span class="detail-label">Assigned:</span>
            <span class="detail-value">{{ job.assignedEquipmentId }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Status:</span>
            <span
              class="detail-value"
              :style="{ color: statusColor(job.status) }"
            >{{ job.status }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.job-queue-widget {
  position: fixed;
  right: 12px;
  top: 60px;
  width: 220px;
  background: rgba(0, 0, 0, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  font-family: var(--font-retro, monospace);
  font-size: 0.7rem;
  color: #ccc;
  z-index: 15;
  user-select: none;
}

.widget-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px 8px 0 0;
}

.header-title {
  flex: 1;
  font-weight: bold;
  color: var(--color-primary, #f59e0b);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.header-count {
  background: var(--color-primary, #f59e0b);
  color: #000;
  border-radius: 10px;
  padding: 0 5px;
  font-size: 0.65rem;
  font-weight: bold;
}

.collapse-btn {
  color: #888;
  font-size: 0.6rem;
}

.job-list {
  max-height: 320px;
  overflow-y: auto;
  padding: 4px 0;
}

.empty-state {
  padding: 10px;
  text-align: center;
  color: #555;
  font-style: italic;
}

.job-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  flex-wrap: wrap;
  transition: background 0.15s;
}

.job-row:hover {
  background: rgba(255, 255, 255, 0.06);
}

.status-icon {
  font-size: 0.8rem;
  width: 14px;
  flex-shrink: 0;
}

.job-id {
  color: #888;
  font-size: 0.65rem;
  width: 38px;
  flex-shrink: 0;
  overflow: hidden;
}

.job-route {
  flex: 1;
  color: #ccc;
  font-size: 0.65rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.job-priority {
  color: #f59e0b;
  font-size: 0.6rem;
  flex-shrink: 0;
}

.job-detail {
  width: 100%;
  margin-top: 4px;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 4px;
  border-left: 2px solid var(--color-primary, #f59e0b);
}

.detail-row {
  display: flex;
  gap: 6px;
  margin-bottom: 2px;
}

.detail-label {
  color: #666;
  width: 60px;
  flex-shrink: 0;
}

.detail-value {
  color: #ccc;
}
</style>
