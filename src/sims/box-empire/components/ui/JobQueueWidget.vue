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
    case 'pending': return '·'
    case 'assigned': return '⟳'
    case 'in_progress': return '▶'
    case 'blocked': return '✕'
    default: return '·'
  }
}

// Convert a canonical location ID to a human-readable short label
// Location IDs use formats:
//   yard: "yard-a-01-01-02"  → "yard-a B01 R01 T02"
//   vessel: "vessel-1-01-01-03" → "V1 B01 R01 T03"
//   quay: "quay-discharge" | "quay-load" → "QD" | "QL"
//   truck: "truck-3" → "Truck3"
//   gate: "gate-export" → "Gate"
//   equipment: "rs-1" → "rs-1"
function locLabel(locType: string, locId: string): string {
  switch (locType) {
    case 'yard_slot': {
      // "yard-a-01-01-02" → parse last 3 segments
      const parts = locId.split('-')
      if (parts.length >= 5) {
        const bay = parseInt(parts[parts.length - 3])
        const row = parseInt(parts[parts.length - 2])
        const tier = parseInt(parts[parts.length - 1])
        const blockParts = parts.slice(0, parts.length - 3).join('-')
        return `${blockParts} B${String(bay).padStart(2, '0')}R${String(row).padStart(2, '0')}T${tier}`
      }
      return locId
    }
    case 'vessel_slot': {
      // "vessel-1-01-01-03" → "V1 Bay01 T03"
      const parts = locId.split('-')
      if (parts.length >= 5) {
        const tier = parseInt(parts[parts.length - 1])
        const bay = parseInt(parts[parts.length - 3])
        const vesselNum = parts[1] ?? '?'
        return `V${vesselNum} Bay${String(bay).padStart(2, '0')} T${tier}`
      }
      return locId
    }
    case 'quay_buffer':
      if (locId.includes('discharge') || locId === 'quay-discharge') return 'Quay-Import'
      if (locId.includes('load') || locId === 'quay-load') return 'Quay-Export'
      return 'Quay'
    case 'truck':
      return locId.replace('truck-', 'Truck ')
    case 'gate_buffer':
      return 'Gate'
    case 'equipment':
      return locId
    default:
      return locId
  }
}

// Last N chars of container ID for display
function shortContainer(id: string): string {
  return id.slice(-6)
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

      <!-- Column headers -->
      <div
        v-if="displayJobs.length > 0"
        class="col-header-row"
      >
        <span class="col-status" />
        <span class="col-priority">P</span>
        <span class="col-container">Cntr</span>
        <span class="col-type">Equip</span>
        <span class="col-route">From → To</span>
      </div>

      <div
        v-for="job in displayJobs"
        :key="job.id"
        class="job-row"
        @click="toggleExpand(job.id)"
      >
        <span
          class="col-status"
          :style="{ color: statusColor(job.status) }"
          :title="job.status"
        >{{ statusIcon(job.status) }}</span>
        <span
          class="col-priority"
          :style="{ color: job.priority >= 12 ? '#f59e0b' : '#aaa' }"
        >{{ job.priority }}</span>
        <span
          class="col-container"
          :title="job.containerId"
        >{{ shortContainer(job.containerId) }}</span>
        <span class="col-type">{{ job.equipmentType === 'reach_stacker' ? 'RS' : 'MHC' }}</span>
        <span class="col-route">
          {{ locLabel(job.pickupLocation.type, job.pickupLocation.id) }}
          <span class="arrow">→</span>
          {{ locLabel(job.dropoffLocation.type, job.dropoffLocation.id) }}
        </span>

        <!-- Expanded detail -->
        <div
          v-if="expandedJobId === job.id"
          class="job-detail"
        >
          <div class="detail-row">
            <span class="detail-label">Job</span>
            <span class="detail-value">{{ job.id }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Status</span>
            <span
              class="detail-value"
              :style="{ color: statusColor(job.status) }"
            >{{ job.status }}</span>
          </div>
          <div
            v-if="job.assignedEquipmentId"
            class="detail-row"
          >
            <span class="detail-label">Equip</span>
            <span class="detail-value">{{ job.assignedEquipmentId }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">From</span>
            <span class="detail-value">{{ job.pickupLocation.id }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">To</span>
            <span class="detail-value">{{ job.dropoffLocation.id }}</span>
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
  top: 55px;
  width: 320px;
  background: rgba(0, 0, 0, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  font-family: var(--font-retro, monospace);
  font-size: 0.68rem;
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
  font-size: 0.62rem;
}

.header-count {
  background: var(--color-primary, #f59e0b);
  color: #000;
  border-radius: 10px;
  padding: 0 5px;
  font-size: 0.6rem;
  font-weight: bold;
  min-width: 16px;
  text-align: center;
}

.collapse-btn {
  color: #666;
  font-size: 0.55rem;
}

.job-list {
  max-height: 360px;
  overflow-y: auto;
  padding: 2px 0;
}

.empty-state {
  padding: 10px;
  text-align: center;
  color: #555;
  font-style: italic;
  font-size: 0.62rem;
}

.col-header-row {
  display: grid;
  grid-template-columns: 14px 22px 50px 32px 1fr;
  gap: 4px;
  padding: 3px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 0.58rem;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.job-row {
  display: grid;
  grid-template-columns: 14px 22px 50px 32px 1fr;
  gap: 4px;
  align-items: center;
  padding: 4px 8px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  flex-wrap: wrap;
  transition: background 0.12s;
}

.job-row:hover {
  background: rgba(255, 255, 255, 0.06);
}

.col-status {
  font-size: 0.75rem;
  text-align: center;
  line-height: 1;
}

.col-priority {
  font-size: 0.65rem;
  text-align: right;
  font-weight: bold;
  padding-right: 2px;
}

.col-container {
  font-size: 0.6rem;
  color: #99aacc;
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col-type {
  font-size: 0.6rem;
  color: #888;
  text-align: center;
}

.col-route {
  font-size: 0.6rem;
  color: #ccc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  grid-column: 1 / -1;
  padding-left: 16px;
  margin-top: -2px;
}

.arrow {
  color: #555;
  margin: 0 2px;
}

.job-detail {
  grid-column: 1 / -1;
  margin-top: 4px;
  padding: 5px 8px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 4px;
  border-left: 2px solid var(--color-primary, #f59e0b);
}

.detail-row {
  display: flex;
  gap: 6px;
  margin-bottom: 2px;
}

.detail-label {
  color: #555;
  min-width: 40px;
  flex-shrink: 0;
  font-size: 0.58rem;
  text-transform: uppercase;
}

.detail-value {
  color: #ccc;
  font-size: 0.6rem;
  word-break: break-all;
}
</style>
