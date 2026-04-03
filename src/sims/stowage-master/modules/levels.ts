import type { LevelConfig } from '../types'
import { SHIP_PRESETS, SCORING, CONTAINER } from './config'

export const LEVELS: LevelConfig[] = [
  {
    id: 0,
    name: 'Level 1',
    description: 'Discharge a small batch of imports from the tiny vessel.',
    preset: SHIP_PRESETS.small,
    hazmatRate: 0,
    completionMode: 'discharge-only',
    scoreContainerCount: 10,
    dischargeContainerCount: 10,
    timerSeconds: 120,
    briefingPages: [
      {
        icon: '🟡',
        title: 'DISCHARGE ONLY',
        body: [
          'A tiny feeder has berthed with 10 import containers for this port. Clear them off the ship and send her on her way.',
          'Click the gold containers on top of each stack to discharge them. There is no loading phase in this level.',
        ],
        legend: [
          { color: '#ffd700', text: 'Gold - local imports. Click to discharge.' },
        ],
        warn: 'Work from the top of each stack downward to keep the crane moving.',
      },
    ],
  },
  {
    id: 1,
    name: 'Level 2',
    description: 'Load 15 outbound containers onto the tiny vessel.',
    preset: SHIP_PRESETS.small,
    hazmatRate: CONTAINER.hazmatRate,
    containerCount: 15,
    scoreContainerCount: 15,
    timerSeconds: 120,
    briefingPages: [
      {
        icon: '🚢',
        title: 'LOAD THE FEEDER',
        body: [
          'The tiny feeder is empty and waiting for 15 outbound containers.',
          'Click any green slot outline on the ship to place the current container. Keep heavy cargo low and centered to score well.',
        ],
        legend: [
          { color: '#00ff88', text: 'Green slots - valid placement positions. Click to load.' },
          { color: '#f44336', text: 'Heavy containers placed high or outboard lose points.' },
        ],
      },
    ],
  },
  {
    id: 2,
    name: 'Level 3',
    description: 'Discharge 18 imports, then reload 18 outbound containers.',
    preset: SHIP_PRESETS.small,
    hazmatRate: CONTAINER.hazmatRate,
    containerCount: 18,
    scoreContainerCount: 36,
    dischargeContainerCount: 18,
    timerSeconds: 240,
    briefingPages: [
      {
        icon: '🟡',
        title: 'DISCHARGE THEN LOAD',
        body: [
          'The tiny feeder arrives full of 18 local imports. Discharge every gold container first, then refill the ship with 18 outbound boxes.',
          'Once the last gold import is cleared, green load slots will appear automatically.',
        ],
        legend: [
          { color: '#ffd700', text: 'Gold - local imports. Click to discharge.' },
          { color: '#00ff88', text: 'Green slots - load positions after discharge.' },
        ],
        warn: 'Clear the top tier first to avoid wasting moves on buried cargo.',
      },
    ],
  },
  {
    id: 3,
    name: 'Level 4',
    description: 'Imports sit high in the stacks while grouped transit cargo stays on board.',
    preset: SHIP_PRESETS.small,
    hazmatRate: CONTAINER.hazmatRate,
    containerCount: 12,
    scoreContainerCount: 24,
    dischargeContainerCount: 12,
    transitContainerCount: 4,
    importPlacement: 'upper-tiers',
    transitGrouping: 'grouped-by-pod',
    timerSeconds: 240,
    briefingPages: [
      {
        icon: '🔄',
        title: 'TOPSIDE DISCHARGE',
        body: [
          'This tiny vessel carries 12 gold import containers high in the stacks, with 4 transit containers already grouped below by destination. Clear the imports, then load 12 outbound boxes.',
          'The imports are not buried under transit cargo in this level, so the challenge is sequencing discharge efficiently before you start loading.',
        ],
        legend: [
          { color: '#ffd700', text: 'Gold - discharge cargo for this port.' },
          { color: '#2196f3', text: 'Colored - transit cargo, grouped by POD and staying on board.' },
          { color: '#00ff88', text: 'Green - load positions after discharge.' },
        ],
        warn: 'Because imports sit on top of the stacks, your early discharge order matters more than restows here.',
      },
    ],
  },
  {
    id: 4,
    name: 'Level 5',
    description: 'Discharge imports, restow transit cargo, then load the tiny vessel.',
    preset: SHIP_PRESETS.small,
    hazmatRate: CONTAINER.hazmatRate * 1.5,
    containerCount: 14,
    scoreContainerCount: 24,
    dischargeContainerCount: 10,
    transitContainerCount: 6,
    timerSeconds: 360,
    briefingPages: [
      {
        icon: '🔄',
        title: 'DISCHARGE + RESTOW',
        body: [
          'The vessel carries gold import containers for this port and colored transit containers continuing onward. Discharge all gold containers, then load outbound cargo.',
          'If a transit container is stacked on top of a gold import, click it first. The crane will lift it, reveal cyan restow slots, and let you move it aside before discharging the import below.',
        ],
        legend: [
          { color: '#ffd700', text: 'Gold - discharge here.' },
          { color: '#2196f3', text: 'Colored - transit cargo, stays on board.' },
          { color: '#00ccff', text: 'Cyan slots - valid restow positions.' },
        ],
        warn: 'Restows cost points. Do not place transit cargo above another gold container.',
      },
    ],
  },
  {
    id: 5,
    name: 'Level 6',
    description: 'Learn the two-hold medium carrier and its wider layout.',
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
          'This vessel has two cargo holds separated by a mid-ship gap - 12 bays total. The two foremost bays sit on a raised forecastle deck, about one container height above the main holds.',
          'Discharge all gold import containers, restow any transit cargo blocking them, then load the outbound boxes. Stability is harder to maintain across a bigger grid - watch the list and trim meters closely.',
        ],
        legend: [
          { color: '#ffd700', text: 'Gold - discharge here.' },
          { color: '#2196f3', text: 'Colored - transit, stays on board.' },
          { color: '#00ccff', text: 'Cyan - restow destinations.' },
          { color: '#00ff88', text: 'Green - load positions after discharge.' },
        ],
        warn: 'Heavy containers belong low and on the centerline. Hazmat containers must be separated.',
      },
    ],
  },
  {
    id: 6,
    name: 'Level 7',
    description: 'Busy medium-vessel call with mixed imports, transit, and loading.',
    preset: SHIP_PRESETS['medium-carrier'],
    hazmatRate: CONTAINER.hazmatRate * 2.0,
    containerCount: 64,
    dischargeContainerCount: 28,
    transitContainerCount: 18,
    timerSeconds: 720,
    placementSpread: 0.65,
    briefingPages: [
      {
        icon: '⚠️',
        title: 'BUSY PORT CALL',
        body: [
          'The medium carrier has arrived with 28 gold imports scattered across all tiers and rows, 18 transit boxes mixed in throughout, and 64 outbound containers queued on the quay.',
          'Gold boxes can be in any tier. Clear the top of each stack before you can reach the ones below. Watch list and trim as big chunks of cargo shift.',
        ],
        legend: [
          { color: '#ffd700', text: 'Gold - discharge here, potentially at any tier.' },
          { color: '#2196f3', text: 'Colored - transit, stays on board.' },
          { color: '#00ccff', text: 'Cyan - restow destinations.' },
          { color: '#00ff88', text: 'Green - load positions after discharge.' },
        ],
        warn: 'Hazmat rate is higher on this port call. Never place two hazmat boxes in adjacent slots.',
      },
    ],
  },
  {
    id: 7,
    name: 'Level 8',
    description: 'Maximum-capacity medium-vessel run under heavy restow pressure.',
    preset: SHIP_PRESETS['medium-carrier'],
    hazmatRate: CONTAINER.hazmatRate * 2.5,
    containerCount: 80,
    dischargeContainerCount: 56,
    transitContainerCount: 36,
    timerSeconds: 900,
    placementSpread: 1.0,
    briefingPages: [
      {
        icon: '💀',
        title: 'MAXIMUM LOAD',
        body: [
          'The carrier is nearly full - 56 gold imports are buried under 36 transit boxes spread across every bay, row, and tier. Discharge everything, then load 80 outbound containers in 15 minutes.',
          'With stacks reaching the top tier and gold boxes at every level, planning your discharge sequence is everything. One wrong move can lock out entire bays.',
        ],
        legend: [
          { color: '#ffd700', text: 'Gold - discharge here, any tier and any row.' },
          { color: '#2196f3', text: 'Colored - transit, stays on board.' },
          { color: '#00ccff', text: 'Cyan - restow destinations.' },
          { color: '#00ff88', text: 'Green - load positions after discharge.' },
        ],
        warn: 'One in four containers is hazmat. A single bad restow can cascade into a major delay.',
      },
    ],
  },
  {
    id: 8,
    name: 'Level 9',
    description: 'Maximum-capacity medium-vessel run under heavy restow pressure.',
    preset: SHIP_PRESETS['medium-carrier'],
    hazmatRate: CONTAINER.hazmatRate * 2.5,
    containerCount: 80,
    dischargeContainerCount: 56,
    transitContainerCount: 36,
    timerSeconds: 900,
    placementSpread: 1.0,
    briefingPages: [
      {
        icon: '💀',
        title: 'MAXIMUM LOAD',
        body: [
          'The carrier is nearly full - 56 gold imports are buried under 36 transit boxes spread across every bay, row, and tier. Discharge everything, then load 80 outbound containers in 15 minutes.',
          'This level intentionally mirrors Level 8 for now while the later medium-vessel progression is being redesigned.',
        ],
        legend: [
          { color: '#ffd700', text: 'Gold - discharge here, any tier and any row.' },
          { color: '#2196f3', text: 'Colored - transit, stays on board.' },
          { color: '#00ccff', text: 'Cyan - restow destinations.' },
          { color: '#00ff88', text: 'Green - load positions after discharge.' },
        ],
        warn: 'Treat this as another full-capacity medium-vessel run until the later levels are redesigned.',
      },
    ],
  },
  {
    id: 9,
    name: 'Level 10',
    description: 'Maximum-capacity medium-vessel run under heavy restow pressure.',
    preset: SHIP_PRESETS['medium-carrier'],
    hazmatRate: CONTAINER.hazmatRate * 2.5,
    containerCount: 80,
    dischargeContainerCount: 56,
    transitContainerCount: 36,
    timerSeconds: 900,
    placementSpread: 1.0,
    briefingPages: [
      {
        icon: '💀',
        title: 'MAXIMUM LOAD',
        body: [
          'The carrier is nearly full - 56 gold imports are buried under 36 transit boxes spread across every bay, row, and tier. Discharge everything, then load 80 outbound containers in 15 minutes.',
          'This level intentionally mirrors Level 8 for now while the later medium-vessel progression is being redesigned.',
        ],
        legend: [
          { color: '#ffd700', text: 'Gold - discharge here, any tier and any row.' },
          { color: '#2196f3', text: 'Colored - transit, stays on board.' },
          { color: '#00ccff', text: 'Cyan - restow destinations.' },
          { color: '#00ff88', text: 'Green - load positions after discharge.' },
        ],
        warn: 'Treat this as another full-capacity medium-vessel run until the later levels are redesigned.',
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
