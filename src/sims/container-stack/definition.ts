import type { SimDefinition } from '@/types/sim'

export const definition: SimDefinition = {
  id: 'container-stack',
  title: 'Container Stack',
  tagline: 'How high can you stack before the tower falls?',
  description:
    'A 3D Jenga-style game with shipping containers. Slide blocks out, stack them on top, ' +
    'and keep the tower balanced as stability and wobble react to every move.',
  icon: '🏗️',
  status: 'playable',
  color: '#ef4444',
  tags: ['3D', 'Physics', 'Puzzle'],
  component: () => import('./ContainerStack.vue'),
}
