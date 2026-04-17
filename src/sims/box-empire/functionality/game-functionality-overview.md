# Game Functionality Overview

Box Empire is a container terminal operations game where the player manages a small, worn-down terminal and learns the basics of moving containers between ships, trucks, the quay, and the yard.

The current playable experience is a tutorial scenario. A small feeder vessel brings 5 import containers and expects 5 export containers to be loaded before it leaves.

## Player Goal

The player must complete one full vessel visit:

- Accept the announced vessel.
- Discharge import containers from the vessel.
- Move import containers into yard storage.
- Open the gatehouse so export delivery trucks and import pickup trucks can enter.
- Store arriving export containers in the yard.
- Load import containers onto pickup trucks and send them out through the out-gate.
- Stage export containers at the quay.
- Load export containers onto the vessel.
- Complete the vessel departure.

## Core Flow

The operation starts with a vessel announcement. The player accepts the vessel call, brings the ship to berth, starts the mobile harbor crane, and later starts the reach stacker.

The mobile harbor crane handles ship-side work. It unloads imports from the vessel to the import quay buffer and later loads exports from the export quay buffer onto the vessel.

The reach stacker handles terminal-side moves. It moves containers between trucks, the yard, and quay buffers.

Trucks handle the gate and landside movement. Export trucks deliver containers into the terminal. Import pickup trucks collect import containers and leave through the out-gate.

The tutorial is complete when all 5 imports have left the terminal, all 5 exports have been loaded onto the vessel, and the vessel has departed.

## Current Scenario Size

- Import containers: 5
- Export containers: 5
- Vessel: Tiny Feeder
- Yard: 10 bays, 1 row, up to 3 containers high
- Equipment: 1 reach stacker and 1 mobile harbor crane

## Player Feedback

The player receives feedback through money changes, sound effects, event messages, floating money indicators, selected object panels, and narrator guidance.

