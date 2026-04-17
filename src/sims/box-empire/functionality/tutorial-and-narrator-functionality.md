# Tutorial and Narrator Functionality

The tutorial teaches Box Empire through a guided vessel visit. It combines on-screen prompts, narrator dialogue, camera guidance, and action buttons that move the player through the first operation.

## Tutorial Start

The player starts from the Box Empire start screen. Starting the tutorial creates the terminal setup, the vessel visit, the import and export containers, and the available equipment.

At the beginning of the tutorial, the terminal is not fully active. The player is guided to bring systems online in sequence.

## Guided Steps

The tutorial currently covers these milestones:

- Welcome the player as the new terminal manager.
- Announce the Tiny Feeder vessel.
- Ask the player to accept the vessel call.
- Bring the vessel to berth.
- Ask the player to wake up the mobile harbor crane.
- Ask the player to speed up time.
- Discharge the first import container to the quay.
- Ask the player to start the reach stacker.
- Move imports into the yard.
- Ask the player to open the gatehouse.
- Let trucks enter, deliver exports, and collect imports.
- Pay the player for the first import gate-out.
- Move exports to the quay and load them onto the vessel.
- Complete the tutorial after all required cargo has moved and the vessel departs.

## Narrator Behavior

The narrator presents short dialogue groups tied to major milestones. Some narrator beats advance automatically after their audio finishes. Others wait for the player to press a button.

Narrator action buttons currently include:

- Accept Vessel Call
- Wake Up the Crane
- Speed up x3
- Start Reach Stacker
- Open Gatehouse

These actions perform the same business actions the player would otherwise need to take manually.

## Camera Guidance

Narrator moments can guide the camera toward important areas, such as the vessel approach, berth, crane, quay, yard, gatehouse, out-gate, and export loading area.

## Completion

The tutorial completes only after:

- All import containers have departed through the gate.
- All export containers have been loaded on the vessel.
- The vessel has departed.

When this happens, the player sees a completion screen with operational results.

