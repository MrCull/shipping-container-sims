import type { SimDefinition } from '@/types/sim'
import boxEmpireLogo from './assets/logo.svg?url'

export const definition: SimDefinition = {
  id: 'box-empire',
  title: 'Box Empire',
  tagline: 'Build your shipping empire from a single container',
  description:
    'Start with one rusty container and grow a global logistics empire. ' +
    'Buy routes, upgrade ports, manage fleets, and outsmart rival ' +
    'shipping companies in this strategic tycoon sim.',
  icon: '🚢',
  logoSrc: boxEmpireLogo,
  status: 'playable',
  order: 3,
  color: '#f59e0b',
  tags: ['Tycoon', 'Strategy', 'Economy'],
  component: () => import('./BoxEmpire.vue'),
}
