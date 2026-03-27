import type { SimDefinition } from '@/types/sim'

export const definition: SimDefinition = {
  id: 'container-stack',
  title: 'Contenga',
  tagline: 'How high can you stack before the tower falls?',
  description:
    'Contenga is a 3D Jenga-style game with shipping containers. Slide blocks out, stack them on top, ' +
    'and keep the tower balanced — poor support under the stack will bring it down.',
  icon: '🏗️',
  status: 'playable',
  order: 2,
  color: '#ef4444',
  tags: ['3D', 'Physics', 'Puzzle'],
  component: () => import('./ContainerStack.vue'),
}
