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
  - Attached modelling references "TTI Algeciras STS Crane Line" (editorial links) and "CC0 Asset and Operational Modelling Reference" (21 Nov 2026)
---

## Summary

Modelling reference for a believable line of **ZPMC ship-to-shore (STS) cranes styled on TTI Algeciras, Spain**: what they look like, the published dimensions, which axes move, when a boom is raised, how cranes on shared rails block each other, and which numbers are configurable assumptions.

This is a **modelling brief, not a crane operating or safety manual**. It extends the generic [dk_equipment__quay_cranes_sts.md](dk_equipment__quay_cranes_sts.md) with TTI-specific facts and photos. For the terminal's yard and truck operations see [dk_ops__tti_algeciras_operations.md](dk_ops__tti_algeciras_operations.md).

**Provenance tags** (same idea as the ops file):

- **[V]** verified TTI-specific fact from TTI's own published material.
- **[R]** reference value from another terminal or an academic source. A sensible default, not a TTI measurement.
- **[A]** modelling assumption. Configurable. Do not hard-code it in an engine.
- **[U]** not established for TTI. Parameterise, never state as fact.

CC0 photos are stored in `knowledge-base/images/tti-algeciras-sts/cc0/` and a CC0 crane model in `available-media/3d-models/`. The TTI editorial photos are **link-only** (see section 9).

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

In 2021 to 2023 five entire crane structures were made permanently **9 m taller** and their booms received **3 m extensions**. Photos with red jacking towers, cut leg sections or mobile cranes (editorial photos D01 to D03 in section 9) show **construction works**. Never draw them in an operational crane line, and never mix them into the routine boom-up animation. Normal boom raising rotates the hinged shipward boom; the portal legs never change height. Crane 108 was moved along the terminal and 101 to 107 shifted during the first heightening, an exceptional relocation with marine operations interrupted, not a per-bay delay.

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

## 9. Reference images and 3D assets

### 9.1 What is stored in the repo (CC0 only)

CC0 1.0 is a public-domain dedication: modify, redistribute and use commercially without attribution. Licence of each photo was checked on the Wikimedia Commons file page API on 21 Nov 2026; the GLB carries a CC0 tag in its own metadata. Photos are 1920 px wide copies from Commons (`Special:FilePath?width=1600`), so originals are larger.

**None of these photos or models is TTI Algeciras equipment.** They are generic STS references. P01 is the Algeciras port, but its cranes are light blue and are not TTI's dark-blue ZPMC cranes. Never present any of them as TTI, and keep trademark and logo use separate from the copyright status.

Folder: `knowledge-base/images/tti-algeciras-sts/cc0/`

| File | Place | Useful for | File page |
|---|---|---|---|
| `P01.jpg` | Algeciras, Spain | Port setting and Gibraltar backdrop. Light-blue cranes, **not TTI** | [Commons](https://commons.wikimedia.org/wiki/File:Cranes_in_the_Port_of_Algeciras_and_Gibraltar.jpg) |
| `P02.jpg` | Gothenburg | STS trusses, bracing, suspension geometry, proportions | [Commons](https://commons.wikimedia.org/wiki/File:Container_cranes_at_Skandiahamnen_1.jpg) |
| `P03.jpg` | Gothenburg | Crane line, alternative perspective (portrait) | [Commons](https://commons.wikimedia.org/wiki/File:Container_cranes_at_Skandiahamnen_2.jpg) |
| `P04.jpg` | Antwerp | Legs, running gear, crane line | [Commons](https://commons.wikimedia.org/wiki/File:Container_cranes_at_Antwerp_harbor.JPG) |
| `P05.jpg` | Antwerp | Close-up of framing and structural detail | [Commons](https://commons.wikimedia.org/wiki/File:Container_cranes_at_Antwerp_harbor_Close-up.JPG) |
| `P06.jpg` | Antwerp | Extra quayside viewpoint (portrait) | [Commons](https://commons.wikimedia.org/wiki/File:Container_crane_at_Antwerp_harbour_pic2.JPG) |
| `P07.jpg` | Rio de Janeiro | Terminal cranes in operational context | [Commons](https://commons.wikimedia.org/wiki/File:Container_cranes_at_the_Port_of_Rio_de_Janeiro,_Brazil_2.jpg) |
| `P08.jpg` | Rio de Janeiro | Alternative view of cranes | [Commons](https://commons.wikimedia.org/wiki/File:Container_cranes_at_the_Port_of_Rio_de_Janeiro,_Brazil_3.jpg) |
| `P09.jpg` | Gothenburg | Ship and terminal, crane-to-ship scale | [Commons](https://commons.wikimedia.org/wiki/File:Container_ship_Annaba_at_Skandiahamnen_1.jpg) |
| `P10.jpg` | Rio de Janeiro | Waterfront composition. Check crane type before using as STS geometry | [Commons](https://commons.wikimedia.org/wiki/File:Port_cranes_on_the_Rio_de_Janeiro_waterfront,_Brazil.jpg) |
| `P11.jpg` | Gothenburg | Ship proportions at the quay | [Commons](https://commons.wikimedia.org/wiki/File:Container_ship_OOCL_Malaysia_at_Skandiahamnen_1.jpg) |

Model: `available-media/3d-models/sts-crane-tevy-harbour-crane-lod0-cc0.glb` (tevy.dev Harbour Container Crane, v2 LOD0, CC0, unmodified, downloaded 21 Nov 2026).

- Node hierarchy (checked in the file): root `harbour-crane` with children `body`, `boom` (hinge, with `boom_mesh` and `boom_fittings`), `cable_reel`, `fittings`, `forestay`, and `trolley` (with `hoist_ropes`, `spreader`, `door_cab`).
- The boom is a separate hinged node and the trolley is **not** its child, so a boom raise can be a pure rotation of `boom` about the X axis at the hinge. Forestay and trolley need their own handling when the boom goes up (a raised boom with a trolley hanging in mid-air is wrong, see the checklist in section 2).
- Generic geometry: about 51 m tall, 30 m rail separation, 50 m reach. Rescale or remodel against the TTI numbers in section 1 (65 m and 68 m outreach, 30.48 m gauge) rather than stretching the mesh. Axes and pivots are tevy's own, inspect before mapping to the section 3 axes.
- 64,556 triangles at LOD0, lighter LOD1 and LOD2 exist on the source page.
- No TTI livery. A TTI look needs a cobalt-blue repaint, white machine house and neutral numbers. Branding or the TTI logo needs separate trademark clearance.

### 9.2 Linked only, not stored (CC0, not downloaded)

| Asset | Page | Notes |
|---|---|---|
| Innerscene Container Gantry Crane | [page](https://www.innerscene.com/tools/library/3d-parts/container-gantry-crane-c8a04a92) | Page states CC0. Real-scale generic STS, 30.48 m gauge, about 50.2 m outreach, 15 m backreach, cab, 40 ft box and spreader. Download through the page |
| Innerscene Gantry Crane Rail | [page](https://www.innerscene.com/tools/library/3d-parts/gantry-crane-rail-3a0762fe) | Rail geometry. Verify gauge and scale |
| tevy Quay Crane Rail Strip, Quay Wall Straight | [catalogue](https://tevy.dev/models) | Light quay scene pieces (rail strip about 966 triangles). Licence not individually re-checked here, confirm on the model page |

### 9.3 TTI editorial photos: link-only, NOT in the repo

Press photographs of the real TTI cranes (Europa Sur, Diario del Puerto, Cadena de Suministro and others) show the actual livery and are the best appearance reference, but public access is not reuse permission. They are **not stored in the repo**. Open the pages to look at them.

| ID | Shows | Page |
|---|---|---|
| A01 | Boom side close-up, white TTI ALGECIRAS lettering, walkway, bracing | [Diario del Puerto](https://www.diariodelpuerto.com/maritimo/tti-algeciras-formaliza-la-entrada-de-cma-cgm-en-su-accionariado-NVGD16146766731235680) |
| A02 | Line of horizontal booms, white machine houses, spacing | [Europa Sur](https://www.europasur.es/maritimas/TTI-Algeciras-operador-economico-autorizado_0_1825918096.html) |
| A03 | Low angle along several working booms | [Europa Sur](https://www.europasur.es/maritimas/video-recrecido-cinco-gruas-TTI-Algeciras_0_1636037453.html) |
| A04, A05 | Frontal boom branding, rows of booms, cable stays | [Europa Sur](https://www.europasur.es/maritimas/inversion-Puerto-TTI-Algeciras-recrecido-gruas-buques-grandes-mundo_0_1578144384.html) |
| B01 | **Best raised vs lowered reference**: two booms near vertical (left) and crane 108 boomed out (right). Also white machine house and logo, leg stairs, crane number, ZPMC plate | [Europa Sur](https://www.europasur.es/algeciras/Comienza-recrecido-gruas-portacontenedores-TTI-Puerto-Algeciras_0_1581142244.html) |
| B02 | Raised boom behind a horizontal crane | [Europa Sur](https://www.europasur.es/maritimas/TTI-Algeciras-recrecido-primera-gruas-buques-grandes-mundo_0_1613240480.html) |
| C03 | Broad landscape of terminal and blue cranes | [Cadena de Suministro](https://www.cadenadesuministro.es/) |
| C04 | 27-photo gallery | [Europa Sur gallery](https://www.europasur.es/algeciras/mejores-fotos-TTI-Algeciras-contenedores-estiba_3_1509179068.html) |
| D01 to D03 | **Construction only**: red jacking towers, crane 104 on temporary supports, floodlit upgrade. Never draw in an operational line | [heightening article](https://www.europasur.es/maritimas/video-recrecido-cinco-gruas-TTI-Algeciras_0_1636037453.html), [gallery](https://www.europasur.es/maritimas/fotos-Proceso-recrecido-gruas-portacontenedores-TTI-Algeciras_3_1636066394.html) |

A Liverpool (Seaforth) raised-boom photo exists on Commons but is **CC BY-SA 2.0**, so it needs attribution and ShareAlike on adaptations. It is deliberately not stored. There is no CC0 close-up of a raised TTI boom: generate the boom-up pose from the articulated model.

### 9.4 Asset manifest rule

When an asset is added, record asset id, source URL, file version, licence, download date and any edits (the tables above are that manifest). If a licence or URL cannot be confirmed, link the file page and mark it as needing manual verification rather than swapping in a similar copyrighted image.

### 9.5 Official and other references

- [TTI equipment specifications](https://www.ttialgeciras.com/en/equipment/), [terminal and fleet](https://www.ttialgeciras.com/en/the-company/), [five-crane heightening](https://www.ttialgeciras.com/en/behind-the-scenes-sts-crane-extension-project-unveiled/), [crane 108 upgrade](https://www.ttialgeciras.com/en/tti-algeciras-successfully-finalizes-heightening-works-for-the-first-malaccamax-crane/).
- Videos (construction, not routine operation): [TTI / ZPMC upgrade footage](https://www.youtube.com/watch?v=ESGdKF64r7U), [first Malaccamax heightening](https://www.youtube.com/watch?v=Ph_vHjbMuoA). A generic STS boom-up video, [link](https://www.youtube.com/watch?v=_8hdSrUyENM), is not validated as TTI.
- Non-TTI principles: [Liebherr STS description](https://www.liebherr.com/en-gb/maritime-cranes/products/port-equipment/ship-to-shore-container-cranes-4311239), [Konecranes concept crane raising boom to clear superstructure](https://www.porttechnology.org/news/global-trade/ctac2018_konecranes_reveals_sts_crane_concept/), [boomed-down cranes while a vessel berths](https://www.marine-pilots.com/articles/13503-safe-working-with-harbour-cranes).
- Scheduling: [rich quay crane scheduling problems](https://www.sciencedirect.com/science/article/pii/S0305054811002875), [non-crossing and safety clearance](https://www.sciencedirect.com/science/article/pii/S0305054819300747).
- Timing sources: [BCT Poland 2024 STS specification](https://cdnweb.bct.gdynia.pl/s3fs-public/inline-files/ToR%20STS%20Schedule%205%20%20Technical%20Specification%20EU_30_2024%20KPO%201.pdf) (boom 2.5 min each way, gantry 50 m/min, 6 s ramps), [earlier BCT procurement](https://pl.openprocurements.com/tender/2013-zakup-sprzetu-suwnica-nabrzezowa-quayside-sts-crane/) (boom about 5 min one way).
