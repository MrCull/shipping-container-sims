// ---------------------------------------------------------------------------
// Box Empire — Narrator dialog script
//
// Each group maps to a tutorial milestone. The store enqueues a group by ID
// when the corresponding milestone fires. Groups play sequentially; individual
// beats within a group advance via Next →, action buttons, or autoAdvance.
//
// NarratorBeat.actions — well-known action keys dispatched by NarratorDialog.vue:
//   acceptVessel       — accept the announced vessel call
//   enableCrane        — enable the MHC (mhc-1) and start discharging
//   enableReachStacker — enable the reach stacker (rs-1)
//   openGatehouse      — open both import and export lanes
//   setSpeed3x         — set game speed to 3×
//   setSpeed5x         — set game speed to 5×
//
// Trigger map (which store event enqueues which group):
//   initTutorial()                           → 'intro', 'vessel-announcement'
//   vessel state → 'arrived'                 → 'vessel-docked'
//   dispatchNarratorAction('enableCrane')    → 'crane-enabled'
//   tutorialStep 3 → 4 (first on quay)       → 'first-on-quay'
//   first import reaches lifecycleState in_yard → 'imports-in-yard'
//   first import reaches returning_to_gate   → 'trucks-rolling'
//   first export reaches loaded_on_vessel    → 'outro'
// ---------------------------------------------------------------------------

import type { NarratorBeat } from '../types'

export interface NarratorGroup {
  id: string
  beats: NarratorBeat[]
}

export const NARRATOR_GROUPS: NarratorGroup[] = [
  // ---- Group 1: Intro (fires on game start) --------------------------------
  {
    id: 'intro',
    beats: [
      {
        audioFile: '01_01_vx_narrator_intro_welcome_manager.mp3',
        lines: [
          'Hey there…',
          'Welcome to Box Empire…',
          "Guess that makes you the new manager of this tired old terminal.",
        ],
        autoAdvance: true,
      },
      {
        audioFile: '01_02_vx_narrator_intro_old_terminal_state.mp3',
        lines: [
          "I've been running this place for years…",
          "and I'll be honest with you… never quite managed to make it work.",
          'Ships got scarce… money got tighter… and well… you can see the state of it.',
        ],
        autoAdvance: true,
      },
      {
        audioFile: '01_03_vx_narrator_intro_family_inheritance.mp3',
        lines: [
          "But you… you're family.",
          'And that still means something.',
          "This land, these cranes, this whole operation… it's yours now.",
          'I reckon you might just turn this rust bucket into something worth a damn.',
        ],
        autoAdvance: true,
      },
    ],
  },

  // ---- Group 2: Vessel announcement (fires right after intro) --------------
  {
    id: 'vessel-announcement',
    beats: [
      {
        audioFile: '02_01_vx_narrator_event_vessel_announcement.mp3',
        lines: [
          "Well I'll be…",
          "Looks like we've got a vessel announcement.",
          "Haven't seen one of those in a long while…",
          "Maybe today's the day this place finally earns a few dollars.",
        ],
        autoAdvance: true,   // flows straight into the vessel details beat
      },
      {
        audioFile: '02_02_vx_narrator_event_feeder_vessel_details.mp3',
        lines: [
          "She's a small feeder vessel… nothing fancy.",
          'Five import containers to unload…',
          "and she'll be expecting five exports in return.",
          "Go ahead… accept the vessel call.",
        ],
        actions: [
          {
            label: '⚓ Accept Vessel Call',
            action: 'acceptVessel',
            advancesOnClick: true,
          },
        ],
      },
    ],
  },

  // ---- Group 2b: Vessel docked (fires when vessel → 'arrived') -------------
  {
    id: 'vessel-docked',
    beats: [
      {
        audioFile: '02_03_vx_narrator_event_vessel_docked.mp3',
        lines: [
          'There she is… docked and ready.',
          "Now, let's wake up that quay crane…",
          'get those containers moving off the ship.',
        ],
        actions: [
          {
            label: '🏗️ Wake Up the Crane',
            action: 'enableCrane',
            advancesOnClick: true,
          },
        ],
      },
    ],
  },

  // ---- Group 3a: Speed up (fires immediately when crane is enabled) ---------
  {
    id: 'crane-enabled',
    beats: [
      {
        audioFile: '03_01_vx_narrator_gameplay_speed_up_time.mp3',
        lines: [
          "Things don't always move fast around here…",
          'Go ahead and speed things up a little.',
        ],
        actions: [
          {
            label: '▶▶ Speed up ×3',
            action: 'setSpeed3x',
            advancesOnClick: true,
          },
        ],
      },
    ],
  },

  // ---- Group 3b: First container on quay (fires at tutorialStep 3 → 4) ----
  {
    id: 'first-on-quay',
    beats: [
      {
        audioFile: '03_02_vx_narrator_gameplay_first_container_quay.mp3',
        lines: [
          "Alright… first container's on the quay.",
          'Now bring that reach stacker online…',
          'we need those import boxes moved into the yard.',
        ],
        actions: [
          {
            label: '🚜 Start Reach Stacker',
            action: 'enableReachStacker',
            advancesOnClick: true,
          },
        ],
      },
    ],
  },

  // ---- Group 3c: Imports in yard (fires when first import reaches in_yard) -
  {
    id: 'imports-in-yard',
    beats: [
      {
        audioFile: '03_03_vx_narrator_gameplay_imports_in_storage.mp3',
        lines: [
          "Good… now we've got import containers in storage.",
          "Let's open up the gatehouse.",
          "Trucks'll start rolling in… picking up imports…",
          'And some other trucks will come in and start dropping off the exports.',
        ],
        actions: [
          {
            label: '🚪 Open Gatehouse',
            action: 'openGatehouse',
            advancesOnClick: true,
          },
        ],
      },
    ],
  },

  // ---- Group 4: Trucks rolling (fires when first import is on a truck) -----
  {
    id: 'trucks-rolling',
    beats: [
      {
        audioFile: '04_01_vx_narrator_gameplay_import_loaded_truck.mp3',
        lines: [
          'There… see that?',
          'Reach stacker just loaded an import onto a truck.',
          "Once it clears the outgate… that's money in your pocket.",
        ],
      },
      {
        audioFile: '04_02_vx_narrator_progress_first_100_dollars.mp3',
        lines: [
          "And there it is… your first hundred dollars.",
          "Not much… but it's a start.",
          'Every empire begins with something small.',
        ],
      },
    ],
  },

  // ---- Group 4b: Export to quay (fires when first export reaches staged_for_loading) ---
  {
    id: 'export-to-quay',
    beats: [
      {
        audioFile: '04_03_vx_narrator_gameplay_export_to_quay.mp3',
        lines: [
          'Look sharp…',
          "That reach stacker's already moved an export container to the quay.",
          "Once the crane loads it onto the vessel… you'll get paid again.",
        ],
      },
    ],
  },

  // ---- Group 5: Outro (fires when first export is loaded onto vessel) ------
  {
    id: 'outro',
    beats: [
      {
        audioFile: '05_01_vx_narrator_progress_150_dollars.mp3',
        lines: [
          'There you go… another hundred fifty.',
          "You're starting to get the rhythm now.",
        ],
      },
      {
        audioFile: '05_02_vx_narrator_feedback_player_progress_good.mp3',
        lines: [
          'Heh… not bad. Not bad at all.',
          "You're picking this up quicker than I ever did.",
        ],
      },
      {
        audioFile: '05_03_vx_narrator_outro_final_handover.mp3',
        lines: [
          "Well… I won't be around much longer…",
          "but I've got a feeling about you.",
          "This place… it's got a future now.",
          "Don't let it slip through your fingers...",
        ],
      },
    ],
  },
]

export function getNarratorGroup(id: string): NarratorGroup | undefined {
  return NARRATOR_GROUPS.find(g => g.id === id)
}
