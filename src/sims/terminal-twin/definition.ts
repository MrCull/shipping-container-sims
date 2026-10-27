import type { SimDefinition } from '@/types/sim'

// Keep this file light: it is eagerly imported for the home page. Everything
// else (engine, worker, Three.js view) loads with the component.
export const definition: SimDefinition = {
  id: 'terminal-twin',
  title: 'Terminal Twin',
  tagline: 'An event-driven digital twin of an automated container terminal',
  description:
    'A TOS test bench: watch ship-to-shore cranes work a vessel in 3D, run ' +
    'reproducible seeded scenarios from real time up to ×600, and jump ahead ' +
    'with "Run to…". Built for trying terminal operating system logic.',
  icon: '🏗️',
  status: 'playable',
  order: 4,
  color: '#3b82f6',
  tags: ['Simulation', 'Digital twin', '3D'],
  component: () => import('./TerminalTwin.vue'),
}
