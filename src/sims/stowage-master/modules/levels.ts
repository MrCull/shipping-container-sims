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
        title: 'VESSEL ARRIVAL',
        body: [
          'A small feeder vessel has berthed at your terminal. Your job is to load it with the containers waiting on the dock — quickly and safely.',
          'You have 90 seconds. The ship leaves when the timer runs out, whether you\'re done or not.',
        ],
      },
      {
        icon: '📦',
        title: 'HOW TO LOAD',
        body: [
          'Containers are queued on trucks at the crane. The next container to load is shown on the front truck.',
          'Green slot outlines show where you can place it. Click any green slot to lift the container and stow it on the ship.',
        ],
        steps: [
          'Click a green slot on the ship to place the current container.',
          'The crane picks it up from the truck and lowers it into position.',
          'The next container rolls forward automatically.',
        ],
      },
      {
        icon: '⚖️',
        title: 'STOWAGE TIPS',
        body: [
          'How you stow matters — poor placement costs points.',
        ],
        legend: [
          { color: '#f44336', text: 'Heavy containers placed too high — bad for stability.' },
          { color: '#ffeb3b', text: 'Heavy containers on the outer rows — risk of listing.' },
          { color: '#ff9800', text: 'Placing cargo when the ship is already listing.' },
        ],
        warn: 'Keep heavy boxes low and centred. Watch the ship\'s list and trim meters on the left.',
      },
    ],
  },
  {
    id: 1,
    name: 'Level 2 - Feeder Vessel',
    description: 'Same feeder vessel. First unload 10 Import containers, then load the vessel.',
    preset: SHIP_PRESETS.small,
    hazmatRate: CONTAINER.hazmatRate,
    containerCount: 20,
    dischargeContainerCount: 10,
    timerSeconds: 210,
    briefingPages: [
      {
        icon: '🚢',
        title: 'PORT CALL',
        body: [
          'The feeder vessel has arrived mid-voyage. It is carrying cargo for this port that must be offloaded before any new cargo can be loaded.',
          'You have 3 minutes 30 seconds to complete both phases.',
        ],
      },
      {
        icon: '🟡',
        title: 'PHASE 1 — DISCHARGE',
        body: [
          'The vessel is pre-loaded with import containers destined for this port. You must discharge all of them before loading begins.',
        ],
        legend: [
          { color: '#ffd700', text: 'Gold containers — discharged HERE. Click them to unload.' },
        ],
        steps: [
          'Click any gold (highlighted) container on the ship.',
          'The crane lifts it and lowers it onto a waiting truck.',
          'The truck drives away. Repeat until all imports are cleared.',
        ],
        warn: 'Discharge from the top of each stack first — that earns more points.',
      },
      {
        icon: '📦',
        title: 'PHASE 2 — LOAD',
        body: [
          'Once all import containers are discharged, the loading phase begins automatically.',
          'Load the waiting containers onto the now-empty ship slots, just like Level 1.',
        ],
        warn: 'Keep heavy cargo low and centred to avoid stability penalties.',
      },
    ],
  },
  {
    id: 2,
    name: 'Level 3 - Feeder Vessel',
    description: 'Vessel arrives with local imports AND transit cargo. Discharge locals, restow any transit blocking them, then load.',
    preset: SHIP_PRESETS.small,
    hazmatRate: CONTAINER.hazmatRate * 1.5,
    containerCount: 14,
    dischargeContainerCount: 10,
    transitContainerCount: 6,
    timerSeconds: 360,
    briefingPages: [
      {
        icon: '🚢',
        title: 'COMPLEX PORT CALL',
        body: [
          'This vessel is on a multi-port voyage. It carries two types of pre-loaded cargo — some for this port, and some continuing onward.',
          'You have 6 minutes to discharge, restow, and load.',
        ],
      },
      {
        icon: '🟡',
        title: 'PHASE 1 — DISCHARGE',
        body: [
          'Gold import containers must be discharged at this port. Click them to unload.',
        ],
        legend: [
          { color: '#ffd700', text: 'Gold — local imports. Must be discharged here.' },
          { color: '#2196f3', text: 'Coloured — transit cargo. Stays on the vessel.' },
        ],
        warn: 'Do not click transit containers during normal discharge — they are not yours to unload.',
      },
      {
        icon: '🔄',
        title: 'RESTOW — WHEN BLOCKED',
        body: [
          'If a transit container is stacked on top of a gold import, it is blocking discharge. You must move it out of the way first — this is called a restow.',
        ],
        steps: [
          'Click the blocking transit container — the crane lifts it off the ship.',
          'Cyan slots appear showing safe places to put it.',
          'Click a cyan slot to place the transit container there.',
          'The gold import below is now accessible — continue discharge.',
        ],
        warn: 'Restows cost points. Avoid placing transit cargo above another gold import — that creates a new blockage.',
      },
      {
        icon: '📦',
        title: 'PHASE 2 — LOAD',
        body: [
          'Once all imports are discharged, load the waiting containers into the freed slots.',
          'Transit containers already on board count toward the ship\'s stability — factor them into your loading plan.',
        ],
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
