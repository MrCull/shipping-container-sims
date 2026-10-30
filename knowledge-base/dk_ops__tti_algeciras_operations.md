---
title: TTI Algeciras Operations (research notes)
category: ops
topic: tti_algeciras_operations
filename: dk_ops__tti_algeciras_operations.md
version: 1.0
status: draft
last_updated: 2026-10-30
priority: P1
sources:
  - Spec #82 (Terminal Twin realism and usability pass), research section
  - Terminal Twin guide and topic docs (hatch covers TT-R09, SHC states TT-R11, truck appointments, holding positions and turnaround TT-R15/16/18)
  - Public knowledge of fully automated container terminals (PEMA and port-technology material); no TTI-specific primary source was reachable
---

## Summary

How the **TTI Algeciras** terminal (automated, ASC yard blocks perpendicular to the quay, shuttle-carrier horizontal transport) works day to day, for four topics: vessel hatch cover handling, ASC yard stacking and location naming, SHC dispatching/parking/pre-positioning, and external road truck operations. It backs the "TTI Algeciras" presets and the realism pass of spec #82.

**Provenance.** The original research text came from a grilling session and is not in the repo. This file is rebuilt from the spec, the sim's own docs and code, and general public knowledge of automated terminals. Every figure is tagged:

- **[G]** general industry knowledge, typical for automated terminals, not TTI-specific.
- **[S]** a value the sim ships (code or spec); it is configuration, not a measurement of TTI.
- **[U]** unverified TTI-specific claim or figure. Treat as configurable. Do not hard-code it in the engine: site numbers belong in scenario/preset config.

The engine stays generic. Nothing below is a rule of the engine unless the Sim deviations section or a topic doc says so.

---

## 1. Vessel hatch cover handling

- **Why it matters.** Many container ships have lift-away hatch covers between the hold and the deck stacks. Deck boxes stand on the covers. Hold boxes cannot be reached until the covers over them are off. [G] Modern gearless-quay operations lift covers with the STS crane (often with a special hatch-cover spreader or a handling frame). [G]
- **Order within a 40 ft bay.** Discharge deck boxes, release lashings, lift the covers into a laydown on the quay, work the hold (discharge then load), put the covers back, secure, load the deck. A cover is only lifted once no box stands on it and its cleats are released. [G] The sim follows this order (`hatch-remove`, `hatch-replace` work packages).
- **Panels per hatch.** Number of panels across the beam grows with ship size (roughly 1 for small feeders up to 4 for ULCV). [G] Sim: feeder 2, feedermax 2, panamax 2, neo-panamax 3, ULCV 4, because a panel has to fit the quay laydown bay. [S]
- **Panel size and weight.** About 13.5 m long, 12 to 32 t. [S] Real covers range widely. [G]
- **Laydown.** Removed covers are stacked on the quay between the quay crane legs or in a lane beside the crane. Stack height is limited. Sim: nearest laydown bay with room, one hatch per bay, stack limit 3, kept clear of SHC lanes. [S]
- **Times.** Lashing release about 5 min after the last deck box over a cover is gone [S]; securing about 3 min after replacement [S]; one hatch move about 4 min [S]. TTI-specific durations, whether lashers or the ship's crew do it, and whether the STS or a separate device lifts covers at TTI: [U], configurable (`ScenarioConfig.hatch`).
- **Effect on KPIs.** Hatch moves are STS time but not productive moves, so they lower gross moves per hour and lengthen turnaround. Planners often quote crane productivity with covers excluded; check which a source means. [G]
- **Interaction with dispatch.** Quay-side box readiness is delayed by hatch work. Pre-dispatch of SHCs (slice D) accounts for hatch time.

## 2. ASC yard stacking and location naming

- **Layout.** Blocks perpendicular to the quay, each served by 1 to 2 ASCs on a rail, with a waterside transfer end (WTP pads, SHC interchange) and a landside transfer end (truck stalls). [G] This is how the sim lays blocks out. [S]
- **Block size.** 8 rows across the ASC span (fixed by the 25.4 m span in the sim), bays of 20 ft along the block, tier limit configurable (commonly 5 to 6 high). [S] TTI block counts, lengths and tier limit: [U], configurable by preset.
- **Two ASCs per block.** Waterside crane prefers WTP work, landside crane prefers truck work; the cranes cannot pass each other, so a crane steps aside when the other needs the rail. [G] [S]
- **Stacking policy.** Boxes are grouped to cut rehandles: by vessel/port of discharge for exports, by size (20 and 40 ft not mixed in a stack), empties and reefers apart. [G] Heavier boxes lower is a common rule, but weight stacking is out of scope for the sim. [G] TTI's actual allocation rules: [U].
- **Rehandles.** A box buried under another needs the blockers moved first. Loading in vessel sequence from a well-planned block avoids most; pre-marshalling and pre-retrieval during idle time cut the rest. [G]
- **Location naming.** Two notations coexist:
  - **Maritime location notation.** Bay, row, tier written as in a vessel bay plan (ISO 9711: bay, row, tier numbers, odd bays for 20 ft, even for 40 ft). Yard locations in many TOSs read as block + bay + row + tier. [G] TTI's exact format: [U].
  - **Internal slot ids.** The sim names a yard slot `<block>:<bay>-<row>-<tier>` and counts 20 ft bays one by one. This id stays; maritime notation is display only (see Sim deviations).
- **Exports to vessel.** The load sequence reads boxes from the yard in the bay plan's order; ASCs retrieve ahead and set them on a WTP pad for an SHC. [G]

## 3. SHC dispatching, parking and pre-positioning

- **Role.** Shuttle carriers (SHCs) move one box between the quay (STS ground positions) and the block's waterside transfer pad. Unlike a straddle carrier they set the box down and drive clear. The quay crane and the ASC both put boxes down independently of carrier availability whenever a position is free. [G] [S]
- **Dispatch.** Pull dispatch from a pool of released jobs; a chained strategy lets a carrier take its next job straight after a delivery without returning to parking, and pairs a discharge delivery with a nearby load pickup (dual cycling). [G] TTI's actual dispatch logic and weights: [U]. Sim built-ins: `oldest-job`, `nearest-job`, plus `chained-nearest`, `paired-dual-cycle` (slice D).
- **Pre-positioning.** A carrier is sent before the box is ready, so that travel time is hidden. Rule of thumb: send when predicted ready time minus carrier travel time is less than a margin. [G] Margin and lead time: [U], configurable per scenario.
- **Queue areas.** Early carriers wait in a queue area near each STS and near each block's WTP pads, not on a ground position or pad. Capacity and place: [U], configurable.
- **Parking.** Idle carriers park in spots off the apron. [S] TTI parking layout and count: [U].
- **Operational states.** The sim shows seven: parked, moving to collect, queuing to collect, collecting, moving to deliver, queuing to deliver, delivering (a view over the engine statuses). [S]
- **Driving.** Corner speeds, right-angle turns and one-way lanes limit carrier speed; real speeds are about 5 to 7 m/s unladen and a little less laden [G]. Sim defaults are configuration. [S]

## 4. External road truck operations

- **Flow.** Truck arrives at the gate, is identified and checked at a kiosk, is directed to a yard block, drives to the transfer position at the block's landside end, is served by a crane (drop an export, pick an import, or both in a dual transaction), and leaves. [G]
- **Appointments.** Terminals commonly run a truck appointment system of time windows with a capacity per window; trucks outside their window may be delayed or refused. [G] Sim: default window 30 min; capacity is the minimum of gate lanes x window / processing time, transfer stalls x window / stall service time and an optional cap; demand above the cap is rejected. [S] TTI's window length, cap and penalties: [U].
- **Gate.** Inbound lanes with kiosks (processing time each), outbound lanes and an out-of-gauge lane. Identification uses ANPR in many terminals; TTI's identification and kiosk times: [U].
- **Holding.** When stalls are busy, trucks wait at a holding position or in a queue area outside rather than blocking the gate lanes. Number of holding positions, overflow policy: [U], configurable (`landside.holding`).
- **Transfer.** At TTI the interchange is served by a crane at the block end (the sim's stall model) [S]; whether TTI uses ASCs at the landside end of every block or a separate interchange area served by carriers: [U].
- **Turnaround.** Gate-in to gate-out, often 30 to 60 min in busy conventional terminals [G]; the sim reports turnaround, gate wait, internal drive time and road use. A TTI target: [U].
- **Peak day.** The "TTI Algeciras: peak day" preset uses three times the truck traffic with five ships berthing within 40 minutes, a 75% full yard and all 8 STS working. This is a stress scenario, not a measured day. [S]

---

## Sim deviations

Deliberate differences between the sim and the terminal described above:

1. **Trucks are served by ASCs at the landside transfer stalls (LSTP)**, not at a separate interchange area served by SHCs. SHC-served interchange is out of scope.
2. **Internal slot ids are kept.** Maritime notation is display only; no migration of ids.
3. **No structural 40-on-20 exception on board.** The sim never stows a 40 on a 20 (`stowage.order`); real stowage allows it where the structure permits.
4. **No ANPR and no early/late arrival handling.** Trucks arrive in time within their window (or are delayed or rejected by the window cap); identification is a fixed kiosk time.
5. **Reefers arrive in a later ticket.** No reefer racks, plugs or monitoring yet.
6. **Hatch panels per class and times are sim configuration** (see section 1), and the 3D view does not draw the panels yet (#92).
7. **Out of scope:** dangerous goods segregation, weight stacking, rail, the "8 big blocks" scenario.
