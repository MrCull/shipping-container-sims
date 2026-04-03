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
    hazmatRate: 0,
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
    hazmatRate: 0,
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
    hazmatRate: 0,
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
    hazmatRate: 0.07,
    containerCount: 14,
    scoreContainerCount: 19,
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
      {
        icon: '☢',
        title: 'HAZMAT WARNING',
        soundCue: 'hazmatAlert',
        body: [
          'Hazardous containers appear from this level onward. They pay better, but one careless placement can trigger an explosion.',
          'Keep hazmat boxes separated from other hazmat in nearby bays, rows, and tiers. When the next container is hazardous, dangerous destination squares will glow red.',
          'Hazmat alerts will sound when a hazardous load is next in the queue or when you lift a hazardous transit box for restow.',
        ],
        legend: [
          { color: '#ff6a3d', text: 'Hazmat containers flash subtly and earn a premium when handled safely.' },
          { color: '#ff5555', text: 'Red destination squares mean that placing the hazmat box there will explode the ship.' },
        ],
        warn: 'Hazmat pays more, but unsafe placement ends the level immediately.',
      },
    ],
  },
  {
    id: 5,
    name: 'Level 6',
    description: 'Discharge imports from the medium feeder while grouped transit cargo stays on board.',
    preset: SHIP_PRESETS['medium-carrier'],
    hazmatRate: CONTAINER.hazmatRate * 1.5,
    completionMode: 'discharge-only',
    scoreContainerCount: 12,
    dischargeContainerCount: 12,
    transitContainerCount: 6,
    transitGrouping: 'grouped-by-pod',
    timerSeconds: 360,
    briefingPages: [
      {
        icon: '🟡',
        title: 'MEDIUM FEEDER DISCHARGE',
        body: [
          'The medium feeder arrives with 12 import containers for this port and 6 transit boxes continuing onward. The transit cargo is mostly grouped by POD bay to reflect a cleaner feeder stow.',
          'Discharge the gold imports and restow only when needed. There is no loading phase in this level.',
        ],
        legend: [
          { color: '#ffd700', text: 'Gold - discharge here.' },
          { color: '#2196f3', text: 'Colored - transit cargo grouped by POD, stays on board.' },
          { color: '#00ccff', text: 'Cyan - restow destinations.' },
        ],
        warn: 'Work from the top of each stack and avoid unnecessary restows.',
      },
    ],
  },
  {
    id: 6,
    name: 'Level 7',
    description: 'Load outbound containers onto a medium feeder that already carries grouped onward cargo.',
    preset: SHIP_PRESETS['medium-carrier'],
    hazmatRate: CONTAINER.hazmatRate * 1.5,
    containerCount: 24,
    scoreContainerCount: 24,
    transitContainerCount: 30,
    transitGrouping: 'grouped-by-pod',
    timerSeconds: 420,
    briefingPages: [
      {
        icon: '🚢',
        title: 'MEDIUM FEEDER LOAD',
        body: [
          'The medium feeder arrives with 30 onward containers already on board, spread roughly across the future ports but mostly grouped by POD bay.',
          'There is no discharge work on this call. Load 24 more outbound containers around that existing cargo and keep the ship stable across both holds.',
        ],
        legend: [
          { color: '#2196f3', text: 'Colored - onward cargo already on board, mostly grouped by POD bay.' },
          { color: '#00ff88', text: 'Green - valid loading positions.' },
          { color: '#f44336', text: 'Heavy cargo placed high or too far outboard loses points.' },
        ],
        warn: 'A wide vessel can still capsize if you build one side too fast.',
      },
    ],
  },
  {
    id: 7,
    name: 'Level 8',
    description: 'Run the original medium feeder port call with discharge, grouped transit, and loading.',
    preset: SHIP_PRESETS['medium-carrier'],
    hazmatRate: CONTAINER.hazmatRate * 1.75,
    containerCount: 30,
    scoreContainerCount: 42,
    dischargeContainerCount: 12,
    transitContainerCount: 30,
    transitGrouping: 'grouped-by-pod',
    timerSeconds: 420,
    briefingPages: [
      {
        icon: '🔄',
        title: 'MEDIUM FEEDER PORT CALL',
        body: [
          'This feeder call has 12 imports to discharge, 30 transit containers already on board, and 30 outbound boxes waiting on the quay.',
          'Almost every onboard container now sits in the same bay as others for its POD, including the imports for this port, with only a small amount of deliberate mixing.',
        ],
        legend: [
          { color: '#ffd700', text: 'Gold - discharge here.' },
          { color: '#2196f3', text: 'Colored - grouped transit cargo staying on board.' },
          { color: '#00ccff', text: 'Cyan - restow destinations.' },
          { color: '#00ff88', text: 'Green - valid loading positions.' },
        ],
        warn: 'Plan discharge and loading together so you do not trap your best slots too early.',
      },
    ],
  },
  {
    id: 8,
    name: 'Level 9',
    description: 'Double the medium feeder workload across discharge, transit, and loading.',
    preset: SHIP_PRESETS['medium-carrier'],
    hazmatRate: CONTAINER.hazmatRate * 2.0,
    containerCount: 60,
    scoreContainerCount: 84,
    dischargeContainerCount: 24,
    transitContainerCount: 60,
    transitGrouping: 'grouped-by-pod',
    timerSeconds: 720,
    placementSpread: 0.6,
    briefingPages: [
      {
        icon: '⚠️',
        title: 'DOUBLE FEEDER CALL',
        body: [
          'The medium feeder now has 24 imports to discharge, 60 transit containers already on board, and 60 outbound boxes to load.',
          'The onward cargo is split roughly across the future ports but still strongly bay-grouped by POD, so you read the stow by bay rather than by random mix.',
        ],
        legend: [
          { color: '#ffd700', text: 'Gold - local imports to discharge.' },
          { color: '#2196f3', text: 'Colored - grouped transit cargo for later ports.' },
          { color: '#00ccff', text: 'Cyan - valid restow destinations.' },
          { color: '#00ff88', text: 'Green - valid loading positions.' },
        ],
        warn: 'Keep both holds working. If you overload one end of the ship, trim will punish you quickly.',
      },
    ],
  },
  {
    id: 9,
    name: 'Level 10',
    description: 'A full-pressure feeder call with heavy onboard transit and limited final free space.',
    preset: SHIP_PRESETS['medium-carrier'],
    hazmatRate: CONTAINER.hazmatRate * 2.25,
    containerCount: 72,
    scoreContainerCount: 120,
    dischargeContainerCount: 48,
    transitContainerCount: 120,
    transitGrouping: 'grouped-by-pod',
    timerSeconds: 900,
    placementSpread: 1.0,
    briefingPages: [
      {
        icon: '💀',
        title: 'FULL FEEDER PRESSURE',
        body: [
          'This call arrives with 48 imports for this port and 120 onward containers already on board, leaving limited final space for the 72 outbound boxes still waiting on the quay.',
          'Almost all onboard cargo is bay-grouped by POD with only a small amount of mixing, so the challenge is working inside a tight, realistic feeder stow rather than a random pile.',
        ],
        legend: [
          { color: '#ffd700', text: 'Gold - local imports to discharge.' },
          { color: '#2196f3', text: 'Colored - grouped transit cargo staying on board.' },
          { color: '#00ccff', text: 'Cyan - restow destinations.' },
          { color: '#00ff88', text: 'Green - valid loading positions.' },
        ],
        warn: 'Use the whole ship. If too much weight lands in one hold or on one side, recovery gets expensive fast.',
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
