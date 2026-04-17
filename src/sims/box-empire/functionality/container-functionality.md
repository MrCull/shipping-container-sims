# Container Functionality

Containers are the main cargo units in Box Empire. Every job, truck visit, vessel move, yard decision, and revenue event is centered on a container.

## Container Direction

Each container is either an import or an export.

Import containers start on the vessel. They are discharged, stored in the yard, loaded onto pickup trucks, and leave through the gate.

Export containers start on delivery trucks. They are stored in the yard, staged at the quay, loaded onto the vessel, and leave by sea.

## Container Details

Containers currently have:

- A container identifier
- Direction: import or export
- Size: 20ft
- Weight
- Shipping line
- Owner color
- Current status
- Current location
- Yard slot when stored in the yard
- Vessel slot when on the vessel
- Arrival time
- Revenue earned against that container

## Current Statuses

A container can move through these player-facing statuses:

- On vessel
- Discharged to quay buffer
- In yard
- Staged for loading
- Loaded on vessel
- At gate
- Returning to gate
- Departed

## Visibility

Containers on the vessel are not shown as separate yard-style boxes until they are discharged or loaded. Their movement is represented as part of the vessel and crane operation.

Containers carried by trucks or equipment are shown moving with the carrier.

## Revenue Tracking

Revenue is tracked against containers when the container completes a paying event:

- Import container gate-out earns revenue.
- Export container loaded on the vessel earns revenue.

