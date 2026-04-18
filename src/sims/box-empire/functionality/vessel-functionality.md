# Vessel Functionality

The vessel is the sea-side customer in the current Box Empire tutorial.

## Vessel Visit

The tutorial vessel is Tiny Feeder. It arrives with 5 import containers and expects 5 export containers to be loaded before it departs.

The player must accept the vessel call before the vessel moves from announcement into arrival.

## Vessel Journey

The vessel can be:

- Announced
- Arriving
- Arrived at berth
- Discharging
- Loading
- Departing
- Departed

The vessel arrives from outside the terminal area, docks at the berth, waits while cargo is handled, and departs after all export loading is complete.

## Import Discharge

The mobile harbor crane discharges import containers from the vessel to the import quay buffer.

Only one import discharge target is used at a time. The next import discharge waits if the import quay buffer is already occupied.

## Export Loading

After export containers are staged at the export quay buffer, the mobile harbor crane loads them onto the vessel.

Each export container loaded onto the vessel earns $150.

## Departure

The vessel departs after all expected export containers are loaded. The departure is part of tutorial completion.

The vessel horn plays when arrival or departure begins.

