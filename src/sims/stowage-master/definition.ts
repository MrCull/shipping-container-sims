import type { SimDefinition } from '@/types/sim'
import { getStowageMasterProgressSummary } from './modules/progressStorage'

export const definition: SimDefinition = {
  id: 'stowage-master',
  title: 'Stowage Master',
  tagline: 'Tetris meets real-world container logistics',
  description:
    'Plan and optimise the stowage of shipping containers on a vessel. ' +
    'Balance weight distribution, cargo class restrictions, and port rotation ' +
    'to become the ultimate stowage planner.',
  icon: '🚢',
  status: 'playable',
  order: 1,
  color: '#3b82f6',
  tags: ['3D', 'Puzzle', 'Logistics'],
  progressSummary: getStowageMasterProgressSummary,
  component: () => import('./StowageMaster.vue'),
}
