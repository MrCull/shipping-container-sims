---
title: TTI Algeciras STS Cranes (appearance, dimensions, gantry and boom behaviour)
category: equipment
topic: tti_algeciras_sts_cranes
filename: dk_equipment__tti_algeciras_sts_cranes.md
version: 1.0
status: draft
last_updated: 2026-11-21
priority: P1
sources:
  - TTI Algeciras official site (equipment, company, crane heightening project pages)
  - Europa Sur, Diario del Puerto, Cadena de Suministro press photography (see image index)
  - BCT Poland STS technical specifications (2024 and earlier procurement), used only as external timing examples
  - Quay crane scheduling literature (non-crossing and safety clearance constraints)
  - Attached modelling reference "TTI Algeciras STS Crane Line: Visual and Operational Modelling Reference" (21 Nov 2026)
---

## Summary

Modelling reference for a believable line of **ZPMC ship-to-shore (STS) cranes styled on TTI Algeciras, Spain**: what they look like, the published dimensions, which axes move, when a boom is raised, how cranes on shared rails block each other, and which numbers are configurable assumptions.

This is a **modelling brief, not a crane operating or safety manual**. It extends the generic [dk_equipment__quay_cranes_sts.md](dk_equipment__quay_cranes_sts.md) with TTI-specific facts and photos. For the terminal's yard and truck operations see [dk_ops__tti_algeciras_operations.md](dk_ops__tti_algeciras_operations.md).

**Provenance tags** (same idea as the ops file):

- **[V]** verified TTI-specific fact from TTI's own published material.
- **[R]** reference value from another terminal or an academic source. A sensible default, not a TTI measurement.
- **[A]** modelling assumption. Configurable. Do not hard-code it in an engine.
- **[U]** not established for TTI. Parameterise, never state as fact.

Photos are stored in `knowledge-base/images/tti-algeciras-sts/` (index in the last section).

---

## 1. Verified fleet and dimensions

- **Location:** TTI Algeciras, Isla Verde Exterior, Port of Algeciras. [V]
- **Fleet:** eight ZPMC-built STS cranes, **five Malaccamax** and **three Super Post-Panamax**. [V]
- **Numbering:** 101 to 103 are the Super Post-Panamax class. 104 to 108 are the five cranes structurally raised and extended in a programme begun in 2021 (Malaccamax class). Numbering is inferred from the upgrade chronology. [V]/[A]
- **Quay lines:** two, about **850 m East** and **550 m North**. Whether all eight cranes can travel along one continuous rail, or round the berth corner, is **[U]**. Model rail segments explicitly and do not assume one straight line.

| Property | Super Post-Panamax | Malaccamax |
|---|---:|---:|
| Count | 3 | 5 |
| Crane numbers | 101 to 103 | 104 to 108 |
| Rail gauge (waterside to landside rail) | 30.48 m | 30.48 m |
| Published height above rail | 43 m | 52 m |
| Published outreach | 65 m | 68 m |
| Container rows covered | up to 24 | up to 25 |
| Rated single lift | 50 t | 50 t |
| Rated twin lift | 65 t | 65 t |

[V] for every row.

**Dimension cautions**

- "Height above rail" and "outreach" are **performance reference dimensions**, not mesh bounds. A boom raised near vertical stands well above the quoted height. Outreach is conventionally measured from the **waterside rail**, not from the boom hinge.
- Use 30.48 m as the rail gauge. Do not use 52 m as the total crane height.
- Crane body length along the quay, minimum safe separation between neighbours, stowed boom angle and spacing of legs are all **[U]**. Derive from geometry or take from site data.

### Permanent heightening is not boom raising

In 2021 to 2023 five entire crane structures were made permanently **9 m taller** and their booms received **3 m extensions**. Photos with red jacking towers, cut leg sections or mobile cranes (images D01 to D03) show **construction works**. Never draw them in an operational crane line, and never mix them into the routine boom-up animation. Normal boom raising rotates the hinged shipward boom; the portal legs never change height. Crane 108 was moved along the terminal and 101 to 107 shifted during the first heightening, an exceptional relocation with marine operations interrupted, not a per-bay delay.

---

## 2. What it looks like (build instructions)

- **Portal:** massive four-legged portal on two parallel quay rails, with enough clearance underneath for terminal traffic. Square and rectangular blue box columns, cross beams and diagonal bracing forming open triangles and rectangles. Avoid a solid rectangle. See A02, B01, B02.
- **Waterside boom:** long, slender, roughly horizontal when working, reinforced by angled stays and an upper frame, with a walkway and railings along the top. See A01, A04, A05.
- **Backreach:** continues landward above the quay and **stays fixed**. It does not rise with the hinged boom.
- **A-frame and backstays:** tall upper frame that braces the boom and carries the boom-hoist ropes. The silhouette is full of diagonals.
- **Machinery house:** large **white rectangular housing** near the upper gantry carrying the blue circular logo and "TTI ALGECIRAS". See B01.
- **Branding:** bold white "TTI ALGECIRAS" with the circular logo along the boom side plate (A01, A04). Large white crane numbers (101 to 108) and a ZPMC plate on the lower structure (B01).
- **Trolley and hoist:** trolley runs under the working beam, vertical ropes descend to a rectangular spreader, empty or carrying one or more boxes (A06).
- **Details:** service stairs and ladders on a leg, platforms, handrails, cable reels, wheel bogies at the leg bases, small lights, occasional yellow or orange safety kit. Sizeable but sparse: workers and vehicles must look tiny next to a leg.

**Colour and finish**

- Body: dark to vivid cobalt or royal blue. Match photos rather than a paint code. [A]
- Secondary: white logos and housings, dark steel and black mechanicals, grey ropes.
- Maintained, not rusty. Clean straight edges in sunlight.

**Silhouettes**

- **Boom down:** boom points out over the vessel, roughly horizontal.
- **Boom up:** near-upright shipward boom with stays and pulleys climbing above the gantry. Visually about **75 to 85 degrees**, exact angle a configurable placeholder. [A]
- **Never rotate the whole crane** to fake a boom lift.
- Vary boom state and position along the line, keep proportions, colour and framing consistent, and show the **43 m vs 52 m** size difference.

**Visual checklist**

1. Shipward hinged boom pivots about its hinge. The four legs, sills and landward backreach do not move vertically.
2. Whole crane (wheels and body) translates parallel to the quay edge, never into the water or across the rail gauge.
3. Spreader hangs from the trolley and moves vertically. During normal raising the trolley is parked, not stuck halfway along the boom.
4. Crane labels never swap order.
5. Trolley travel across the ship's beam (rows) is distinct from gantry travel along the ship (bays).

---

## 3. Coordinate system and components

Recommended axes:

- `X` along the quay and the vessel's length.
- `Y` perpendicular to the quay, positive towards the water.
- `Z` height above rail level.
- Waterside and landside rails are straight lines parallel to `X`, **30.48 m** apart in `Y`. Only `gantryX` changes during gantry travel.
- Boom points to `+Y`. Raising rotates about a local axis parallel to `X`. `boomAngleDeg = 0` is working (horizontal); positive raises. Stowed angle is a placeholder (about 80). [A]

Separate physical components for: gantry (legs, sill beams, bogies, portal, power supply), fixed upper steelwork (tower, A-frame, machine house, backreach), moving shipward boom (hinged segment and stays), trolley, hoist and spreader, rail corridor (bounds, buffers, exclusion zones), and ship collision objects (hull, deck boxes, bridge, funnel, masts, aerials).

Collision checks use **swept volumes** of the gantry and the raised or lowered boom with configurable clearance margins, never centre points only.

---

## 4. When is a boom raised or lowered?

| Scenario | Typical behaviour | Modelling guidance |
|---|---|---|
| Loading or discharging | Boom **down**, over ship | Trolley crosses rows, gantry stays aligned with the current bay |
| Move to adjacent clear bay | **Gantry with boom down** if permitted and clear | Do not add a mandatory boom cycle to each bay change |
| Pass a tall bridge, funnel or mast | May need **boom up** | Test swept clearance. Raise only if the lowered boom would hit |
| Vessel arriving or leaving | Often booms up and clear first | Gate on berth and ship movement clearance and local procedure |
| Idle or parked | May be raised or in a parking pose | Expose a crane-specific parking angle |
| Storm or high wind | Secured in a specified state | Separate procedural states, stow position, brakes and pins |
| Maintenance | Special access and locking | Separate from operating movement |

**Critical distinction:** raising a boom changes only **overhead clearance**. It does not let one gantry overtake another on shared rails.

---

## 5. Timings and speeds (reference examples, not TTI values) [R]

No boom-hoist or gantry speed for an individual TTI crane was established. External BCT Poland specifications give usable defaults:

| Motion | Example value |
|---|---|
| Boom stowed to operating, each way | 2.5 min (2024 spec) |
| Boom hoist, one way (earlier procurement) | about 5 min |
| Gantry travel | 50 m/min (0.833 m/s) |
| Gantry acceleration and deceleration | 6 s each, in the specified wind conditions |
| Gantry travel with boom up or down | permitted in that spec under listed conditions, not automatically for every crane |

Suggested config:

```json
{
  "referenceTerminal": "TTI Algeciras",
  "equipmentTimingSource": "BCT Poland example, NOT TTI verified",
  "gantryMaxSpeedMPerMin": 50,
  "gantryAccelerationSeconds": 6,
  "gantryDecelerationSeconds": 6,
  "boomHoistSecondsOneWay": 150,
  "boomHoistAlternativeSlowSecondsOneWay": 300,
  "workingBoomAngleDeg": 0,
  "stowedBoomAngleDeg": 80,
  "stowedAngleIsAssumption": true,
  "railGaugeMetres": 30.48,
  "safetySeparationMetres": null,
  "craneBodyLengthAlongQuayMetres": null,
  "canGantryWithBoomDownWhenClear": true,
  "canGantryWithBoomRaised": "equipment-and-site-dependent"
}
```

- 50 m/min is a **maximum**, so model start and stop ramps. Travel-only times at full speed: 6 m 7.2 s, 12 m 14.4 s, 50 m 60 s, 100 m 120 s. With 6 s ramps each end a 100 m run is about 126 s.
- Illustration only: raise + 100 m gantry + lower is about 7.1 min mechanically (2.5 min booms) or about 12.1 min (5 min booms).
- Keep extra delays separate: brake release, positioning, trolley parking, spreader securing, interlocks, permits, waiting for neighbours, ship clearance, final alignment.
- Whether gantry travel can overlap an active boom transition is not established. Default to **no overlap**.
- Nominal bay step proxies: about 6.06 m (20 ft), 12.19 m (40 ft). Real bay reference points and numbering come from the vessel plan, and odd and even bay numbers are not always equal in physical spacing.

---

## 6. Crane sequencing and collision avoidance

**Non-crossing is fundamental** (standard Quay Crane Scheduling Problem constraint): cranes sharing one straight rail pair cannot pass each other. Order them by `gantryX`.

- Each crane has a **non-zero longitudinal envelope**. Neighbours need a minimum physical separation plus operational clearance.
- If crane A is left of B, a command to swap positions is **impossible**, even with both booms upright. Reassign work within reachable ordered regions, move one or both, or change the schedule.
- A following crane can be **blocked** by the one ahead. Queue and reschedule, never teleport.
- Boom-to-boom, boom-to-ship and gantry-to-gantry checks are separate. A crane parked boom up can still block the track.
- A reachable bay can still be unsafe because of an adjacent crane, hull obstruction, bridge or unavailable corridor.
- Two cranes reaching the same vessel does not mean they can work neighbouring bays at the same time. Check envelopes and overlapping motions.
- With several vessels on one quay line, a crane can be blocked behind a crane assigned to another vessel.

**Example cases**

1. Crane 105 works bay 15 then bay 17, path clear: gantry a short distance **boom down**. No raise.
2. Crane 105 must pass the vessel bridge: if the lowered boom would intersect it, park trolley and secure hoist, raise, gantry (if permitted), lower, resume.
3. Crane 105 (left of 106) wants work to the right of 106: impossible without 106 moving, order is preserved.
4. Vessel approaching berth: mark the ship's berth-entry zone and require cranes and booms in the position local procedure demands.
5. Two cranes on adjacent bays: check envelopes before admitting simultaneous moves, else delay or shift one.

---

## 7. Suggested motion state machine

| State | Boom | Gantry | Trolley and spreader |
|---|---|---|---|
| `WORKING` | Down | Stationary or controlled reposition | Active cargo cycle |
| `PREPARE_GANTRY` | Usually unchanged | Stationary | Secure load and spreader |
| `GANTRY_TRAVEL_DOWN` | Down | Moving along X | Parked and restrained |
| `PREPARE_BOOM_UP` | Down | Stationary | Park trolley away from the hinged boom, secure spreader, satisfy interlocks |
| `RAISING_BOOM` | Rotating up | Stationary (conservative) | Safe parked position |
| `BOOM_UP` | Raised or stowed | Stationary | Cargo work unavailable |
| `GANTRY_TRAVEL_UP` | Raised | Moving if equipment and site allow | Safe parked |
| `LOWERING_BOOM` | Rotating down | Stationary (conservative) | Secured |
| `BLOCKED` | Any safe state | Stationary | Waiting on ship or crane clearance |
| `STORM_SECURE` | Equipment-specific | At designated stow position | Stow and lock procedures |

A software abstraction, not TTI's PLC interlocks. One external example: the BCT spec prevents boom hoist while the trolley is on the boom.

Sample record (fictional values):

```json
{
  "craneId": "STS-108",
  "type": "Malaccamax",
  "manufacturer": "ZPMC",
  "railSegmentId": "east-quay-example",
  "gantryXMetres": 350.0,
  "boomAngleDegrees": 0.0,
  "boomState": "WORKING",
  "trolleyYMetres": 25.0,
  "spreaderZMetres": 20.0,
  "assignedShipId": "SHIP-001",
  "assignedBay": "35",
  "workState": "LOADING",
  "hasSuspendedLoad": false,
  "movementBlockReason": null,
  "visual": {
    "bodyColour": "cobalt-blue",
    "boomText": "TTI ALGECIRAS",
    "craneNumber": "108",
    "machineryHousingColour": "white"
  }
}
```

**Acceptance tests for a model**

- A short bay relocation does not trigger `RAISING_BOOM`.
- Boom up/down pivots at the hinge without moving the four legs vertically.
- Swapping two cranes on the same rails is rejected or rescheduled.
- An approaching gantry stops before its neighbour's safety envelope.
- A boom-down gantry cannot pass through the bridge or masts in the collision model.
- A raised boom clears an obstacle only if its swept geometry does.
- Movement through the berth region respects berth and ship movement restrictions.
- Trolley and spreader reach a permitted configuration before boom hoisting starts.
- A 100 m gantry trip is never instant: ramps and travel time are visible.
- A boom-up parked crane still blocks neighbours on that track.
- The 2021 to 2023 heightening is never mixed into routine boom-up animation.

---

## 8. Unknowns (parameterise, do not assume)

Not verified for individual TTI cranes: boom hoist time, maximum gantry and trolley speed, stowed boom angle, crane footprint along the quay, minimum separation between neighbours, swept envelopes, whether all crane pairs share connected rail, berth operating procedure, and PLC interlocks. Photos show shape, colour and component placement, not dimensioned drawings, so take scale from the published numbers.

---

## 9. Image index

Folder: `knowledge-base/images/tti-algeciras-sts/`. All files are press or editorial photographs fetched from the publisher links on 21 Nov 2026 and are kept here **as private visual reference for modelling only**. Copyright stays with each photographer and publisher, and the links are **not a commercial reuse licence**. Do not ship these in the built app, put them in `assets/` of a sim, or commit them into a public release without clearing rights. Source pages are listed so a CDN change can be recovered.

### A. Main appearance

| File | What it shows | Source page |
|---|---|---|
| `A01.jpg` | Boom side close-up: dark blue beam, large white TTI ALGECIRAS, overhead bracing, walkway | [Diario del Puerto](https://www.diariodelpuerto.com/maritimo/tti-algeciras-formaliza-la-entrada-de-cma-cgm-en-su-accionariado-NVGD16146766731235680) |
| `A02.jpg` | Long line of horizontal booms, white machinery houses, crane spacing and perspective | [Europa Sur](https://www.europasur.es/maritimas/TTI-Algeciras-operador-economico-autorizado_0_1825918096.html) |
| `A03.webp` | Low angle along several working booms: trusses, wheels, IDs | [Europa Sur](https://www.europasur.es/maritimas/video-recrecido-cinco-gruas-TTI-Algeciras_0_1636037453.html) |
| `A04.jpg` | Frontal TTI boom branding on overlapping booms, tip details and railings | [Europa Sur](https://www.europasur.es/maritimas/inversion-Puerto-TTI-Algeciras-recrecido-gruas-buques-grandes-mundo_0_1578144384.html) |
| `A05.jpg` | Rows of STS cranes with projecting horizontal booms: side elevation and cable stays | [Europa Sur](https://www.europasur.es/maritimas/inversion-Puerto-TTI-Algeciras-recrecido-gruas-buques-grandes-mundo_0_1578144384.html) |
| `A06.jpg` | Crane in operation with suspended container, spreader and load | editorial image, source page not recorded |
| `A07.jpg` | Quay-level crane view under clear sky, general scene reference | editorial image, source page not recorded |

### B. Raised booms and structure

| File | What it shows | Source page |
|---|---|---|
| `B01.jpg` | **Best raised vs lowered reference**: two booms near vertical (left, cranes 107 area), crane 108 boomed out (right). Also shows white machine house and logo, leg stairs, crane number and ZPMC plate | [Europa Sur](https://www.europasur.es/algeciras/Comienza-recrecido-gruas-portacontenedores-TTI-Puerto-Algeciras_0_1581142244.html) |
| `B02.jpg` | Raised boom behind a horizontal crane: raised shape against normal working shape | [Europa Sur](https://www.europasur.es/maritimas/TTI-Algeciras-recrecido-primera-gruas-buques-grandes-mundo_0_1613240480.html) |
| `B04.jpg` | Blue structural close-up with yellow cable reel, bracing and wheel gantry. **Not TTI Algeciras** (Piraeus Container Terminal), secondary engineering reference only | [PCT gallery](https://www.pct.com.gr/fotografies) |

The reference file's item B03 is the same photo as A01 and is not duplicated.

### C. Aerials and ship scale

| File | What it shows | Source page |
|---|---|---|
| `C01.jpg` | Aerial of TTI terminal operation: several cranes and quay layout | industry editorial image, source page not recorded |
| `C02.jpg` | Large container ship alongside TTI cranes, ship-to-crane scale | editorial image, source page not recorded |
| `C03.jpg` | Broad landscape of terminal and blue cranes | [Cadena de Suministro](https://www.cadenadesuministro.es/) |

More angles: [Europa Sur 27-photo gallery](https://www.europasur.es/algeciras/mejores-fotos-TTI-Algeciras-contenedores-estiba_3_1509179068.html).

### D. Construction and upgrade (geometry only, NOT normal operation)

| File | What it shows | Source page |
|---|---|---|
| `D01.jpg` | Lower leg structure on red temporary jacking towers | [Europa Sur](https://www.europasur.es/maritimas/video-recrecido-cinco-gruas-TTI-Algeciras_0_1636037453.html) |
| `D02.jpg` | Upgrade under floodlights: lattice detail and night lighting | [Europa Sur gallery](https://www.europasur.es/maritimas/fotos-Proceso-recrecido-gruas-portacontenedores-TTI-Algeciras_3_1636066394.html) |
| `D03.jpg` | Crane 104 with temporary steel supports | [Europa Sur](https://www.europasur.es/maritimas/TTI-Algeciras-recrecido-cinco-gruas-portacontenedores_0_1736828294.html) |

### Official and video references

- [TTI equipment specifications](https://www.ttialgeciras.com/en/equipment/), [terminal and fleet](https://www.ttialgeciras.com/en/the-company/), [five-crane heightening](https://www.ttialgeciras.com/en/behind-the-scenes-sts-crane-extension-project-unveiled/), [crane 108 upgrade](https://www.ttialgeciras.com/en/tti-algeciras-successfully-finalizes-heightening-works-for-the-first-malaccamax-crane/).
- Videos (construction, not routine operation): [TTI / ZPMC upgrade footage](https://www.youtube.com/watch?v=ESGdKF64r7U), [first Malaccamax heightening](https://www.youtube.com/watch?v=Ph_vHjbMuoA). A generic STS boom-up video, [https://www.youtube.com/watch?v=_8hdSrUyENM](https://www.youtube.com/watch?v=_8hdSrUyENM), is not validated as TTI.
- Non-TTI principles: [Liebherr STS description](https://www.liebherr.com/en-gb/maritime-cranes/products/port-equipment/ship-to-shore-container-cranes-4311239), [Konecranes concept crane raising boom to clear superstructure](https://www.porttechnology.org/news/global-trade/ctac2018_konecranes_reveals_sts_crane_concept/), [boomed-down cranes while a vessel berths](https://www.marine-pilots.com/articles/13503-safe-working-with-harbour-cranes).
- Scheduling: [rich quay crane scheduling problems](https://www.sciencedirect.com/science/article/pii/S0305054811002875), [non-crossing and safety clearance](https://www.sciencedirect.com/science/article/pii/S0305054819300747).
