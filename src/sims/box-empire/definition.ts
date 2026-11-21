import type { SimDefinition } from '@/types/sim'
import boxEmpireLogo from './assets/logo.svg?url'
import cardImage from './assets/home-cover.jpg?url'

export const definition: SimDefinition = {
  id: 'box-empire',
  title: 'Box Empire',
  tagline: 'Inherit a rusty old terminal and turn it into a real port',
  description:
    'The family container terminal is yours now, and it has seen better days. ' +
    'Bring trucks through the gate, stack boxes in the yard, work ships at the quay, ' +
    'and turn the old place into a busy port in this terminal tycoon sim.',
  icon: '🚢',
  logoSrc: boxEmpireLogo,
  status: 'playable',
  order: 3,
  color: '#f59e0b',
  cardImage,
  tags: ['Tycoon', 'Strategy', 'Economy'],
  component: () => import('./BoxEmpire.vue'),
}
