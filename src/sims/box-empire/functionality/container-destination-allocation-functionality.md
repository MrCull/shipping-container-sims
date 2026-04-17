# Container Destination Allocation Functionality

Container destination allocation decides where a container should go next during the terminal operation.

## Import Containers

Import containers begin on the vessel. The current flow allocates them through these destinations:

- Vessel to import quay buffer.
- Import quay buffer to a yard slot.
- Yard slot to an import pickup truck.
- Import pickup truck to the out-gate.
- Out-gate to departed.

The import quay buffer is used as the handover point between vessel crane work and reach stacker work.

## Export Containers

Export containers begin on delivery trucks. The current flow allocates them through these destinations:

- Export truck to yard slot.
- Yard slot to export quay buffer.
- Export quay buffer to vessel slot.

The export quay buffer is used as the handover point between reach stacker work and vessel crane work.

## Yard Slot Allocation

When a container needs a yard slot, the yard tries to:

- Put it in a bay that already contains the same traffic type.
- Use an empty bay if no same-type bay has space.
- Avoid mixing imports and exports when possible.
- Use any available valid slot if no better choice exists.

Reserved future slots are treated as unavailable so two active moves do not target the same destination.

## Vessel Slot Allocation

The vessel starts with import containers already assigned to its deck positions.

Imports are discharged from the highest numbered bay down toward the lowest numbered bay.

Exports are loaded into the first available vessel bay.

## Truck Allocation

Export trucks are assigned to export containers waiting to enter the terminal.

Import pickup trucks are assigned to import containers that are in the yard, ready for pickup, and not already assigned to another active pickup.

