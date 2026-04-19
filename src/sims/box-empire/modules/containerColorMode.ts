import * as THREE from 'three'
import type { Container } from '../types'
import type { ContainerColorMode } from '@/stores/globalSettings'

// Shared flat material cache — all renderers share the same instances.
const _flatCache = new Map<string, THREE.MeshStandardMaterial>()

function getFlatMaterial(hex: string): THREE.MeshStandardMaterial {
  let mat = _flatCache.get(hex)
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.7, metalness: 0.2 })
    _flatCache.set(hex, mat)
  }
  return mat
}

export function disposeFlatMaterialCache(): void {
  for (const mat of _flatCache.values()) mat.dispose()
  _flatCache.clear()
}

/** Apply the active color mode to any container group (ContainerRenderer, TruckRenderer, EquipmentRenderer). */
export function applyColorModeToGroup(
  group: THREE.Group,
  container: Container,
  mode: ContainerColorMode,
  simTime: number,
): void {
  const targetHex = mode === 'shipping_line' ? null : computeContainerDisplayColor(container, mode, simTime)
  const prevHex = group.userData['colorHex'] as string | null | undefined
  const prevMode = group.userData['colorMode'] as ContainerColorMode | undefined
  if (targetHex === prevHex && mode === prevMode) return
  group.userData['colorHex'] = targetHex
  group.userData['colorMode'] = mode
  const bodyMesh = group.children[0] as THREE.Mesh
  if (!bodyMesh) return
  if (targetHex === null) {
    const origMats = bodyMesh.userData['bodyMaterials'] as THREE.Material[] | undefined
    if (origMats) bodyMesh.material = origMats
  } else {
    bodyMesh.material = getFlatMaterial(targetHex)
  }
}

const VESSEL_PALETTE = [
  '#e74c3c', '#2ecc71', '#3498db', '#f39c12',
  '#9b59b6', '#1abc9c', '#e67e22', '#16a085',
]

export function getVesselPaletteColor(vesselId: string): string {
  const match = vesselId.match(/(\d+)$/)
  const idx = match ? (parseInt(match[1], 10) - 1) : 0
  return VESSEL_PALETTE[idx % VESSEL_PALETTE.length]!
}

export function computeContainerDisplayColor(
  container: Container,
  mode: ContainerColorMode,
  simTime: number,
): string {
  switch (mode) {
    case 'shipping_line':
      return container.ownerColor

    case 'visit_type':
      return container.visitType === 'import' ? '#3498db' : '#e67e22'

    case 'dwell_time': {
      if (!container.arrivedAt) return '#555566'
      const secs = simTime - container.arrivedAt
      if (secs < 30)  return '#27ae60'
      if (secs < 90)  return '#f39c12'
      if (secs < 180) return '#e67e22'
      return '#e74c3c'
    }

    case 'move_status': {
      switch (container.lifecycleState) {
        case 'discharged_to_buffer': return '#3498db'
        case 'in_yard':              return '#7f8c8d'
        case 'staged_for_loading':   return '#f39c12'
        case 'returning_to_gate':    return '#2ecc71'
        case 'at_gate':              return '#95a5a6'
        default:                     return '#8e44ad'
      }
    }

    case 'export_vessel': {
      if (container.visitType !== 'export') return '#3a3a4a'
      const vesselId = container.vesselSlot?.vesselId
      if (!vesselId) return '#7f8c8d'
      return getVesselPaletteColor(vesselId)
    }

    default:
      return container.ownerColor
  }
}

export interface ColorLegendEntry { label: string; color: string }

export function getColorLegend(mode: ContainerColorMode): ColorLegendEntry[] {
  switch (mode) {
    case 'visit_type':
      return [
        { label: 'Import', color: '#3498db' },
        { label: 'Export', color: '#e67e22' },
      ]
    case 'dwell_time':
      return [
        { label: '< 30s',  color: '#27ae60' },
        { label: '30–90s', color: '#f39c12' },
        { label: '90–3m',  color: '#e67e22' },
        { label: '3m +',   color: '#e74c3c' },
        { label: 'No data', color: '#555566' },
      ]
    case 'move_status':
      return [
        { label: 'At quay',   color: '#3498db' },
        { label: 'In yard',   color: '#7f8c8d' },
        { label: 'Staged',    color: '#f39c12' },
        { label: 'On truck',  color: '#2ecc71' },
        { label: 'Other',     color: '#8e44ad' },
      ]
    case 'export_vessel':
      return VESSEL_PALETTE.slice(0, 4).map((color, i) => ({
        label: `Vessel ${i + 1}`,
        color,
      })).concat([
        { label: 'Unassigned', color: '#7f8c8d' },
        { label: 'Import',     color: '#3a3a4a' },
      ])
    default:
      return []
  }
}
