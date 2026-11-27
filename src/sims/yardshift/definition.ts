import type { SimDefinition } from '@/types/sim'
import cardImage from './assets/cover.png?url'

export const definition: SimDefinition = {
  id: 'yardshift',
  title: 'Yardshift',
  tagline: 'Dig out the next container before the truck leaves.',
  description:
    'Yardshift is a fast container yard puzzle: collect containers in number order, rehandle the ones in the way, ' +
    'and clear the yard before the shift ends.',
  icon: '🚛',
  status: 'playable',
  order: 5,
  color: '#54ddb0',
  cardImage,
  tags: ['Puzzle', 'Arcade', 'Phone'],
  component: () => import('./Yardshift.vue'),
}
