import type { LevelConfig } from '../types'
import { SHIP_PRESETS, SCORING, CONTAINER } from './config'

export const LEVELS: LevelConfig[] = [
  {
    id: 0,
    name: 'Level 1 - Feeder Vessel',
    description: 'A small feeder ship. Learn the basics of container loading.',
    preset: SHIP_PRESETS.small,
    hazmatRate: CONTAINER.hazmatRate,
    containerCount: 20,
    timerSeconds: 90,
    briefingPages: [
      {
        icon: '🚢',
        title: 'LOAD THE FEEDER',
        body: [
          'A small feeder vessel has berthed. Load it with the containers queued on trucks at the crane — you have 90 seconds before it departs.',
          'Click any green slot outline on the ship to place the current container. Keep heavy cargo low and centred to score well.',
        ],
        legend: [
          { color: '#00ff88', text: 'Green slots — valid placement positions. Click to load.' },
          { color: '#f44336', text: 'Heavy containers placed high or outboard lose points.' },
        ],
      },
    ],
  },
  {
    id: 1,
    name: 'Level 2 - Feeder Vessel',
    description: 'Same feeder vessel. First unload 10 import containers, then load the vessel.',
    preset: SHIP_PRESETS.small,
    hazmatRate: CONTAINER.hazmatRate,
    containerCount: 20,
    dischargeContainerCount: 10,
    timerSeconds: 210,
    briefingPages: [
      {
        icon: '🟡',
        title: 'DISCHARGE THEN LOAD',
        body: [
          'The vessel has arrived with 10 import containers for this port. Discharge them first, then load your outbound cargo.',
          'Click the gold containers on the ship to discharge them. The crane will lift each one onto a waiting truck. Once all gold containers are cleared, loading begins automatically.',
        ],
        legend: [
          { color: '#ffd700', text: 'Gold — local imports. Click to discharge.' },
          { color: '#00ff88', text: 'Green slots — appear once discharge is complete.' },
        ],
        warn: 'Discharge top-tier containers first for bonus points.',
      },
    ],
  },
  {
    id: 2,
    name: 'Level 3 - Feeder Vessel',
    description: 'Discharge local imports, restow any blocked transit cargo, then load.',
    preset: SHIP_PRESETS.small,
    hazmatRate: CONTAINER.hazmatRate * 1.5,
    containerCount: 14,
    dischargeContainerCount: 10,
    transitContainerCount: 6,
    timerSeconds: 360,
    briefingPages: [
      {
        icon: '🔄',
        title: 'DISCHARGE + RESTOW',
        body: [
          'The vessel carries gold import containers (for this port) and coloured transit containers (continuing onward). Discharge all gold containers, then load outbound cargo.',
          'If a transit container is stacked on top of a gold import, click it first — the crane lifts it and cyan slots appear. Click a cyan slot to restow it, then discharge the gold container below.',
        ],
        legend: [
          { color: '#ffd700', text: 'Gold — discharge here.' },
          { color: '#2196f3', text: 'Coloured — transit cargo, stays on board.' },
          { color: '#00ccff', text: 'Cyan slots — valid restow positions.' },
        ],
        warn: 'Restows cost points. Don\'t place transit cargo above another gold container.',
      },
    ],
  },
  {
    id: 3,
    name: 'Level 4 - Medium Carrier',
    description: 'A medium vessel with 12 bays across two cargo holds. Master stability and restow across a complex layout.',
    preset: SHIP_PRESETS['medium-carrier'],
    hazmatRate: CONTAINER.hazmatRate * 1.5,
    containerCount: 30,
    dischargeContainerCount: 12,
    transitContainerCount: 6,
    timerSeconds: 420,
    briefingPages: [
      {
        icon: '🚢',
        title: 'MEDIUM CARRIER',
        body: [
          'This vessel has two cargo holds separated by a mid-ship gap — 12 bays total. The two foremost bays sit on a raised forecastle deck, about one container height above the main holds.',
          'Discharge all gold import containers, restow any transit cargo blocking them, then load the outbound boxes. Stability is harder to maintain across a bigger grid — watch the list and trim meters closely.',
        ],
        legend: [
          { color: '#ffd700', text: 'Gold — discharge here.' },
          { color: '#2196f3', text: 'Coloured — transit, stays on board.' },
          { color: '#00ccff', text: 'Cyan — restow destinations.' },
          { color: '#00ff88', text: 'Green — load positions (after discharge).' },
        ],
        warn: 'Heavy containers belong low and on the centreline. Hazmat containers must be separated.',
      },
    ],
  },
]

export function getLevelConfig(levelId: number): LevelConfig {
  return LEVELS[levelId] ?? LEVELS[0]
}

export function getTotalSlots(preset: LevelConfig['preset']): number {
  return preset.bays * preset.rows * preset.tiers
}

export function getTargetScore(preset: LevelConfig['preset'], containerCount?: number): number {
  const count = containerCount ?? getTotalSlots(preset)
  return count * 100 * SCORING.targetScoreMultiplier
}
