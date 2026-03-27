import type { FutureGameTeaser } from '@/types/future-game-teaser'

export const futureGameTeasers: FutureGameTeaser[] = [
  {
    id: 'coblox',
    title: 'Coblox',
    tagline: 'The shipping-container platform where anyone can build and play',
    description:
      'Think Roblox, but every experience is built from modular shipping containers. Join friends in player-made obstacle courses, roleplay hubs, and mini-games, or use creation tools to snap containers into worlds and publish them for the community—social, creative, and endlessly replayable.',
    icon: '🧱',
    color: '#06b6d4',
    tags: ['Platform', 'Social', 'Creator Tools'],
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
    id: 'captain-container',
    title: 'Captain Container',
    tagline: 'Steer the bridge, run the ship, deliver the boxes',
    description:
      'A maritime navigation and container-ship simulation: plot courses, handle helm and engine orders, work with charts and weather, and operate a realistic boxship—loading plans, stability, and port approaches matter as much as keeping schedule at sea.',
    icon: '⚓',
    color: '#2563eb',
    tags: ['Navigation', 'Ship Sim', 'Maritime'],
  },
]
