# Terminal Layout and Operational Areas

The Box Empire tutorial terminal is a compact container terminal with a berth, quay, yard, truck gates, and equipment work areas.

## Berth

The berth is where the vessel arrives, works cargo, and departs. The Tiny Feeder docks beside the quay before cargo operations begin.

## Quay Buffers

The quay has two working buffer areas:

- Import quay buffer: where the mobile harbor crane places containers discharged from the vessel.
- Export quay buffer: where the reach stacker stages export containers before the crane loads them onto the vessel.

The two buffers keep discharge and loading work separate.

## Yard

The yard is the storage area for import and export containers. The current tutorial yard has:

- 10 bays
- 1 row
- Maximum stack height of 3 containers

The yard can hold both import and export containers, but the allocation rules try to keep similar traffic types together.

## In-Gate

All trucks enter through the in-gate. Export delivery trucks and import pickup trucks both queue outside this gate before entering.

The in-gate is controlled by lane settings at the gatehouse.

## Out-Gate

Trucks leave through the out-gate after their terminal visit is complete.

Import pickup trucks earn money for the player when they complete gate-out with an import container.

Export delivery trucks also depart through the out-gate after the reach stacker has removed their container.

## Yard Truck Stands

There are separate yard stand areas for:

- Export delivery trucks waiting to have their container removed.
- Import pickup trucks waiting to receive an import container.

This keeps import pickup and export delivery activity from occupying the same truck position.

## Equipment Areas

The reach stacker works between the yard, truck stands, and quay buffers.

The mobile harbor crane stays at the quay and works between the vessel and quay buffers.

