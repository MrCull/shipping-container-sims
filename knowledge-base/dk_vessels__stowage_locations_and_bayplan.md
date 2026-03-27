---
title: Vessel Stowage Locations and Bayplan
category: vessels
topic: stowage_locations_and_bayplan
filename: dk_vessels__stowage_locations_and_bayplan.md
version: 1.0
status: draft
last_updated: 2026-03-26
priority: P0
sources:
  - SMDG BAPLIE and MOVINS implementation guidance
  - Industry bay-row-tier conventions
  - Container vessel stowage planning references
---

## Summary

This document defines the **container stowage coordinate system and bayplan representation** used on container vessels.

It covers:
- bay-row-tier coordinate system
- under-deck vs on-deck structure
- slot capabilities and constraints
- representation of stowage plans (BAPLIE-style)
- transformation from discharge/load lists into executable move plans

This is the backbone of:
- vessel planning
- crane operations
- realistic loading/discharge sequencing

---

## Why this matters for simulation and gameplay

Without stowage logic:
- containers teleport on/off ships
- crane planning is fake
- discharge order is random
- yard planning loses purpose

With it:
- you get real bottlenecks
- restows happen (and piss everyone off)
- planning matters
- bad decisions cost time

This is where “simulation” starts earning the name.

---

## Key definitions and vocabulary

- **Bay-Row-Tier (BRT)**  
  Standard coordinate system for container slots.

- **Bay**  
  Longitudinal position (front to back).

- **Row**  
  Transverse position (left to right).

- **Tier**  
  Vertical position.

- **Odd/Even bay numbering**  
  - Odd: 20ft positions  
  - Even: 40ft positions

- **Row numbering**
  - 00 = centreline (if present)
  - Even numbers one side, odd the other (varies slightly by convention)

- **Tier numbering**
  - Below deck: starts ~02 upward
  - On deck: starts ~80+ upward

- **Under deck / On deck**
  - Inside cargo hold vs stacked above hatch covers

- **Cell guides**
  - Vertical guides below deck

- **BAPLIE**
  - Message format representing vessel stowage

- **MOVINS**
  - Message for stowage instructions

---

## Scope boundaries

### Included
- Bay-row-tier coordinate system
- Slot-level modelling
- Stowage plan representation
- Constraints relevant to gameplay

### Excluded
- Full naval architecture
- Full IMDG segregation matrix (referenced, not duplicated)
- Full EDI message implementation

---

## Key attributes and dimensions (human-level data model)

### Coordinate system structure

| Dimension | Meaning | Example |
|----------|--------|--------|
| Bay | longitudinal | 001, 003, 005 |
| Row | left/right | 02, 04, 06 |
| Tier | vertical | 02, 04, 82 |

### Example slot


Bay: 034
Row: 10
Tier: 84
→ 034/10/84


---

### Bay numbering logic

| Bay Type | Example | Meaning |
|----------|--------|--------|
| Odd | 001 | 20ft slot |
| Even | 002 | 40ft spanning slot |

---

### Tier ranges

| Zone | Typical Range |
|------|--------------|
| Under deck | 02–20 |
| On deck | 80–100 |

---

### Slot attributes

Each slot should include:

- `bay`
- `row`
- `tier`
- `deck_zone`
- `cell_guides`
- `max_weight_kg`
- `reefer_power`
- `hazmat_allowed`
- `max_height`
- `lashing_required`
- `stack_weight_limit`

---

## Rules, constraints, and algorithms

### 1. Slot coordinate validity

```pseudo
if bay not in vessel.bays:
  reject

if row not in vessel.rows:
  reject

if tier not in vessel.tiers:
  reject
2. 20ft vs 40ft placement
if container.length == 40ft:
  require even bay
if container.length == 20ft:
  require odd bay OR paired configuration
3. Deck zone constraint
if container.height > slot.max_height:
  reject

if slot.deck_zone == "under_deck" and container.requires_ondeck:
  reject
4. Stack weight constraint
stack_weight = sum(all containers below)

if stack_weight + container.weight > slot.stack_weight_limit:
  reject
5. Reefer constraint
if container.type == "reefer" and slot.reefer_power == false:
  reject
6. Hazmat constraint (simplified)
if container.hazmat.is_hazardous:
  if slot.hazmat_allowed == false:
    reject
7. Discharge sequencing rule

Containers are removed top-down:

if container_below exists and container_above exists:
  must_remove_above_first()

This creates:

restows
inefficiency
fun (if you're a sadist)
8. Restow detection
if container_above.pod != current_port:
  restow_required = true
Standards and authoritative references to confirm
Shipplanning Message Design Group
BAPLIE (stowage plan representation)
MOVINS (instructions)
International Maritime Organization
Stability and safety constraints impacting stowage
Example outputs to include
Sample bayplan (simplified)
Slot	Container	POD
034/10/84	MSKU1234567	SG
034/10/82	TGHU7654321	NL
034/12/84	CMAU9988776	SG
Example discharge issue
Container for NL under SG container
→ requires restow
Data schemas
Slot schema
{
  "bay": 34,
  "row": 10,
  "tier": 84,
  "deck_zone": "on_deck",
  "cell_guides": false,
  "constraints": {
    "max_weight_kg": 30000,
    "stack_weight_limit": 120000,
    "reefer_power": true,
    "hazmat_allowed": true
  },
  "container_ref": "MSKU1234567"
}
Vessel stowage structure
{
  "vessel_id": "VESSEL-001",
  "voyage_id": "VOY-001",
  "slots": []
}
Sample data
JSON
{
  "bay": 34,
  "row": 10,
  "tier": 84,
  "deck_zone": "on_deck",
  "container_ref": "MSKU1234567",
  "constraints": {
    "max_weight_kg": 30000,
    "reefer_power": true,
    "hazmat_allowed": true
  }
}
YAML
bay: 18
row: 06
tier: 12
deck_zone: under_deck
container_ref: TGHU7654321
constraints:
  max_weight_kg: 28000
  reefer_power: false
  hazmat_allowed: true
Visualisation guidance
Bay-row-tier concept
4
Mermaid: coordinate system
Mermaid: discharge sequence
Mermaid: stowage plan lifecycle
3D rendering notes
Each slot = grid cell aligned to container dimensions
Under deck:
enclosed
guided (cell guides)
On deck:
visible stacks
lashing structures

Visual cues:

hatch covers clearly separate zones
stacks align perfectly
deck stacks look slightly chaotic but structured
Validation checklist
 Bay-row-tier system implemented correctly
 20ft/40ft bay logic respected
 Deck zones correctly separated
 Reefer slots limited and meaningful
 Hazmat constraints enforced
 Restow logic produces realistic inefficiencies
 Sample data matches coordinate rules
 Discharge sequence enforced top-down
Open questions and research backlog
Full bay numbering standard variations across fleets
Detailed lashing constraints (on-deck vs under-deck)
Reefer slot distribution ratios
Stability impact modelling (weight distribution)
Twin-lift and tandem crane logic
Integration with yard planning AI