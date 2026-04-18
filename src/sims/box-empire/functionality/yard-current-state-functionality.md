# Yard Current State Functionality

The yard is the terminal storage area. It holds containers between vessel, truck, and quay moves.

## Yard Capacity

The current tutorial yard contains:

- 10 bays
- 1 row
- Maximum 3 tiers per bay

This gives the yard a maximum current storage capacity of 30 containers.

## Stored Containers

Each yard slot can contain one container or be empty. A stored container is known by its bay, row, and tier.

The yard tracks which containers are currently stored and which slots are empty.

## Stack Height

Containers stack from the bottom tier upward. A bay cannot receive more containers once it reaches the 3-high limit.

## Import and Export Grouping

When possible, the yard groups import containers with imports and export containers with exports. It prefers not to mix traffic types in the same bay unless necessary.

## Reserved Destinations

When a container move has already been planned to a yard slot, that slot is treated as reserved. Other containers should not be allocated to the same slot while the first move is still active.

## Blocked Containers

A container under another container cannot be picked directly. Work that needs a buried container is blocked until the top container is moved.

If an import pickup needs a buried container, the sim can create a shuffle move to relocate the top container to another available yard slot.

## Known Incoming Moves

The yard accounts for containers that are not yet stored but are already moving toward storage. These include:

- Export containers coming from trucks.
- Import containers coming from the quay.
- Shuffle containers moving between yard slots.

## Known Outbound Moves

The yard also accounts for containers already planned to leave storage. These include:

- Import containers assigned to pickup trucks.
- Export containers assigned to move to the export quay buffer.
- Containers being shuffled to unblock another container.

## Occupancy

Yard occupancy is based on the number of filled slots compared with the total number of slots.

