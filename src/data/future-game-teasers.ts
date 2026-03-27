import type { FutureGameTeaser } from '@/types/future-game-teaser'

export const futureGameTeasers: FutureGameTeaser[] = [
  {
    id: 'coblox',
    title: 'Coblox',
    tagline: 'Snap, build, and play together in container worlds',
    description:
      'A multiplayer sandbox where you construct ports, chaotic vertical cities, and custom mini-games by snapping modular shipping containers together. Physics, progression, and player-made experiences meet industrial port culture.',
    icon: '🧱',
    color: '#06b6d4',
    tags: ['Sandbox', 'Multiplayer', 'UGC'],
  },
  {
    id: 'container-craft',
    title: 'ContainerCraft',
    tagline: 'Survive in a world made of stacked boxes',
    description:
      'Salvage, dismantle, and repurpose containers instead of mining terrain. Manage decay, weather, and structural integrity while expanding a gritty, dockside base—loot containers, NPCs, and instability included.',
    icon: '⚒️',
    color: '#c2410c',
    tags: ['Survival', 'Crafting', 'Exploration'],
  },
  {
    id: 'container-ship-captain',
    title: 'Container Ship Captain',
    tagline: 'Command the voyage and the bottom line',
    description:
      'Plan routes, load for space and weight, run crew and upgrades, and weather storms, inspections, and emergencies. A management sim focused on realistic maritime trade and logistics risk.',
    icon: '⚓',
    color: '#2563eb',
    tags: ['Simulation', 'Management', 'Logistics'],
  },
]
