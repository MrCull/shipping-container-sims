---
title: Vessel Physical Classes and Structure
category: vessels
topic: physical_classes_and_structure
filename: dk_vessels__physical_classes_and_structure.md
version: 1.0
status: draft
last_updated: 2026-03-26
priority: P0
sources:
  - IMO ship classification and safety frameworks
  - Industry vessel size classifications (ULCV, Post-Panamax, etc.)
  - General container vessel design references
---

## Summary

This document defines **container vessel physical classes and structural layout**, providing a simulation-ready abstraction of:
- vessel size categories
- structural components
- stowage-relevant geometry
- constraints affecting terminal operations

It is intended to support:
- procedural ship generation
- berth and crane planning
- stowage capacity modelling
- believable 3D representation

This is not naval architecture. It’s “enough truth to make it feel right and behave correctly”.

---

## Why this matters for simulation and gameplay

If containers are your “items”, vessels are your “levels”.

Without vessel structure:
- crane planning is meaningless
- yard planning loses context
- stowage becomes random instead of constrained
- ship sizes feel fake and interchangeable
- port capacity and bottlenecks disappear

Key systems affected:
- berth allocation
- quay crane assignment
- load/discharge sequencing
- stowage planning constraints
- turnaround time simulation

Big ships = efficiency + chaos  
Small ships = flexibility + frequency

Pick your poison.

---

## Key definitions and vocabulary

- **TEU capacity**  
  Approximate number of 20ft containers a vessel can carry.

- **Bay**  
  Longitudinal section of the ship (front to back).

- **Row**  
  Transverse position (left to right).

- **Tier**  
  Vertical position (bottom to top).

- **Cell guides**  
  Vertical rails in holds that guide containers into position.

- **Under deck / on deck**  
  Whether containers are inside the hull or stacked above it.

- **Hatch cover**  
  Removable deck section covering cargo holds.

- **Lashing bridge**  
  Structure used for securing on-deck containers.

- **Accommodation block**  
  Living quarters and bridge (usually at stern).

- **Engine room**  
  Machinery space, typically below accommodation.

---

## Scope boundaries

### Included
- Container ship classes
- Structural layout relevant to container stowage
- Geometry needed for simulation and rendering
- Operational implications of vessel size

### Excluded
- Detailed hydrodynamics
- Fuel systems and propulsion modelling
- Crew operations
- Non-container vessel types (tankers, bulk carriers)

---

## Key attributes and dimensions (human-level data model)

### Vessel class overview

| Class | TEU Range | Length (m) | Beam (m) | Bays | Cranes Required |
|------|----------|-----------|----------|------|----------------|
| Feeder | 500–3,000 | 100–200 | 20–30 | 10–20 | 1–2 |
| Feedermax | 3,000–5,000 | 180–250 | 30–35 | 20–30 | 2–3 |
| Panamax | 3,000–5,000 | ~294 | 32.2 | 25–30 | 3–4 |
| Post-Panamax | 5,000–10,000 | 250–300 | 40–45 | 30–40 | 4–6 |
| New Panamax | 10,000–14,500 | 300–366 | 49 | 40–50 | 5–7 |
| ULCV | 14,500–24,000+ | 350–400 | 50–61 | 50–65 | 6–8 |

### Core physical attributes

- `length_m`
- `beam_m`
- `depth_m`
- `draft_m`
- `teu_capacity`
- `max_stack_height_tiers`
- `max_underdeck_tiers`
- `max_ondeck_tiers`
- `bay_count`
- `row_count_max`
- `tier_count_max`

---

## Rules, constraints, and algorithms

### 1. Bay generation

```pseudo
bay_count = round(length_m / 6.1)

if bay_count is odd:
  include 20ft bay spacing logic


  20ft containers occupy single bay
40ft containers span two bay positions
2. Row calculation
row_count = floor(beam_m / 2.5)
Wider ships = more rows = more crane workload
3. Tier limits
underdeck_tiers = random_between(8, 12)
ondeck_tiers = random_between(4, 10)

total_stack_height = underdeck_tiers + ondeck_tiers

Constraint:

if total_stack_height > stability_limit:
  reject_configuration()
4. Crane requirement estimation
cranes_required = ceil(bay_count / 10)

Constraint:

if cranes_assigned < cranes_required:
  operations_slowdown = true
5. Hatch segmentation
Bays grouped into hatch blocks
hatch_count = bay_count / 4

Constraint:

Cannot access below-deck containers unless hatch open
6. Stowage constraint example
if slot.under_deck and not slot.cell_guides:
  reject_assignment()

if container.height > slot.max_height:
  reject_assignment()
Standards and authoritative references to confirm
International Maritime Organization
SOLAS (safety and structural rules)
Load Line Convention
Stability Code
International Organization for Standardization
Container compatibility (ISO 668, etc.)
Classification societies (to validate structural assumptions):
Lloyd’s Register
DNV
ABS
Example outputs to include
Vessel archetype comparison
Vessel	TEU	Bays	Rows	Max Tiers	Notes
Small feeder	1,200	16	10	10	Short turnaround
Panamax	4,500	28	13	12	Canal-limited
ULCV	20,000	60	24	20	Requires mega-terminal
Data schemas
{
  "vessel_id": "VESSEL-001",
  "class": "ULCV",
  "dimensions": {
    "length_m": 400,
    "beam_m": 59,
    "draft_m": 16
  },
  "capacity": {
    "teu": 20000,
    "bay_count": 60,
    "row_count": 24,
    "tier_count": 20
  },
  "structure": {
    "has_cell_guides": true,
    "hatch_count": 15,
    "lashing_bridges": true
  }
}
Sample data
JSON
{
  "vessel_id": "VESSEL-MSC-ALPHA",
  "class": "ULCV",
  "dimensions": {
    "length_m": 399,
    "beam_m": 59,
    "draft_m": 15.5
  },
  "capacity": {
    "teu": 19800,
    "bay_count": 58,
    "row_count": 23,
    "tier_count": 20
  },
  "structure": {
    "cell_guides": true,
    "hatch_count": 14,
    "lashing_bridges": true
  }
}
YAML
vessel_id: VESSEL-FEEDER-01
class: feeder
dimensions:
  length_m: 150
  beam_m: 25
  draft_m: 8
capacity:
  teu: 1200
  bay_count: 18
  row_count: 10
  tier_count: 10
structure:
  cell_guides: true
  hatch_count: 4
  lashing_bridges: false