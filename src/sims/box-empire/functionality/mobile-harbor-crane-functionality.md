# Mobile Harbor Crane Functionality

The mobile harbor crane is the ship-side handling machine. It works between the vessel and the quay buffers.

## Current Role

The mobile harbor crane handles:

- Import discharge from vessel to import quay buffer.
- Export loading from export quay buffer to vessel.

It does not move around the terminal. Its work is centered at the quay.

## Availability

The crane can be turned on or off by the player.

When it is off, it does not accept vessel handling work. When it is on, it can receive suitable jobs if idle.

## Crane Modes

The player can choose the crane mode:

- Discharge: vessel-to-quay work only.
- Load: quay-to-vessel work only.
- Both: discharge and load work.

These modes determine which jobs the crane can accept.

## Work Cycle

For each move, the crane:

- Reaches toward the pickup position.
- Lifts the container.
- Moves it across to the drop-off position.
- Lowers and places the container.
- Becomes available for another job.

The current full crane cycle is 45 seconds.

## Import Discharge Cost

Each completed import discharge from vessel to quay costs $20 unless god mode is active.

## Export Loading Revenue

Each export container loaded onto the vessel earns $150.

