import type { SimDefinition } from '@/types/sim'

export const definition: SimDefinition = {
  id: 'box-empire',
  title: 'Box Empire',
  tagline: 'Build your shipping empire from a single container',
  description:
    'Start with one rusty container and grow a global logistics empire. ' +
    'Buy routes, upgrade ports, manage fleets, and outsmart rival ' +
    'shipping companies in this strategic tycoon sim.',
  icon: '📦',
  status: 'playable',
  color: '#f59e0b',
  tags: ['Tycoon', 'Strategy', 'Economy'],
  component: () => import('./BoxEmpire.vue'),
}
