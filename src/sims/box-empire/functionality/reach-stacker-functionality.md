# Reach Stacker Functionality

The reach stacker is the main yard handling machine. It moves containers between trucks, yard slots, and quay buffers.

## Current Role

The reach stacker handles:

- Export delivery truck to yard.
- Import quay buffer to yard.
- Yard to import pickup truck.
- Yard to export quay buffer.
- Yard-to-yard shuffle moves when a buried container must be unblocked.

## Availability

The reach stacker can be turned on or off by the player.

When it is off, it does not accept work. When it is on, it can receive suitable jobs if it is idle.

## Service Areas

The reach stacker has two service permissions:

- Landside service: truck-to-yard and yard-to-truck work.
- Waterside service: quay-to-yard and yard-to-quay work.

The player can enable or disable these service areas while the reach stacker itself remains available.

## Work Cycle

For each job, the reach stacker:

- Travels empty to the pickup area.
- Picks the container.
- Travels loaded to the drop-off area.
- Places the container.
- Returns to idle and becomes available for another job.

The current pick time is 8 seconds and the current place time is 8 seconds.

## Travel Speed

The reach stacker travels faster when empty than when carrying a container.

Current speeds:

- Empty: 5 meters per second
- Loaded: 4 meters per second

## Blocked Yard Work

If the reach stacker is asked to pick a container that is buried under another container, that work is blocked until the container becomes accessible.

## Operating Cost

A completed reach stacker move costs $10 unless god mode is active.

