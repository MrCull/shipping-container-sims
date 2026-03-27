---
title: Yard Storage Blocks and Locations
category: yard
topic: storage_blocks_and_locations
filename: dk_yard__storage_blocks_and_locations.md
version: 1.0
status: draft
last_updated: 2026-03-27
priority: P0
---

## Summary

This document defines how container yards are structured in a simulation:
- yard blocks and naming conventions
- bay-row-tier coordinate systems within blocks
- interchange zones and handover lanes
- zoning strategies (import/export/reefer/DG/empties/transshipment)

The goal is to provide a **consistent, simulation-ready spatial model** that supports:
- container addressing
- routing decisions
- congestion modelling
- realistic yard behaviour

---

## Why this matters for simulation and gameplay

The yard is where most inefficiency hides.

Bad yard modelling leads to:
- fake productivity gains (cranes always “ready”)
- zero congestion (unrealistic)
- no rehandles (boring and wrong)
- no zoning constraints (hazmat chaos)

Good yard modelling enables:
- realistic bottlenecks
- meaningful planning decisions
- trade-offs between density and accessibility
- emergent problems (buried containers, long dwell, DG conflicts)

---

## Key definitions and vocabulary

- **Yard block**  
  A physical storage area consisting of parallel container stacks.

- **Stack**  
  A vertical pile of containers in a single ground slot.

- **Slot**  
  A single ground position capable of holding a stack.

- **Bay (yard)**  
  Position along the length of a block (front to back).

- **Row (yard)**  
  Position across the width of a block (left to right).

- **Tier (yard)**  
  Vertical position within a stack.

- **Block name**  
  Identifier for a yard block (e.g. IMP-A1, EXP-C3, RF-R1).

- **Interchange lane / handover zone**  
  Area where trucks or AGVs exchange containers with yard cranes.

- **Pre-marshalling**  
  Rearranging containers in the yard to optimise retrieval.

---

## Scope boundaries (what is included/excluded)

### Included
- yard geometry and coordinate systems
- block naming and zoning
- interchange lane logic
- storage constraints and access patterns

### Excluded
- detailed crane mechanics (covered elsewhere)
- optimisation algorithms beyond simplified rules
- terminal-wide routing optimisation engines

---

## Key attributes and dimensions (human-level data model)

### Yard block

- `block_id`
- `block_type` (import, export, reefer, DG, empty, transshipment)
- `bay_count`
- `row_count`
- `max_tier`
- `orientation` (north-south, east-west)
- `interchange_side` (one-side, dual-side)
- `reefer_power_points`
- `hazmat_allowed`

### Yard location (slot)

- `block_id`
- `bay`
- `row`
- `tier`
- `is_occupied`
- `container_id`
- `max_weight_kg`
- `reefer_power_available`
- `hazmat_allowed`

### Interchange

- `lane_id`
- `connected_block`
- `queue_capacity`
- `service_rate`
- `assigned_equipment`

---

## Rules, constraints, and algorithms (include simplified simulation models)

## 1. Yard coordinate system

Each container location is defined as:

```
(block_id, bay, row, tier)
```

Example:
```
EXP-C3 / Bay 12 / Row 4 / Tier 2
```

### Typical numbering rules
- bays increase along block length
- rows increase across block width
- tiers start at 1 (ground) and increase upward

---

## 2. Stack height constraint

```
tier <= max_tier
```

Optional dynamic rule:

```
if heavy_container:
  restrict max_tier
```

---

## 3. Accessibility rule (rehandles)

A container is accessible only if:

```
tier == top_of_stack
```

Otherwise:

```
rehandles_required = containers_above
```

Simulation rule:

```
retrieval_cost = 1 + rehandles_required
```

---

## 4. Zoning rules

Containers must be placed in compatible blocks:

```
if container.type == reefer:
  block.must_have_power = true

if container.hazmat:
  block.hazmat_allowed = true

if container.status == import:
  prefer import_blocks
```

---

## 5. Interchange constraint

A move requires:
- available yard crane
- available transport (truck/AGV)
- free interchange slot

Queue model:

```
waiting_time = f(queue_length, service_rate)
```

---

## 6. Yard congestion heuristic

```
if occupancy_pct > 85:
  rehandle_rate increases
  travel_time increases
```

---

## Standards and authoritative references to confirm (edition/year, what to verify)

- Industry terminal design practices for block layouts
- Equipment manufacturer documentation (ASC/RTG layouts)
- Terminal planning guidelines for zoning and density
- Operational research on yard stacking strategies

---

## Example outputs to include (tables, diagrams, sample data)

### Yard block example

| Block | Type | Bays | Rows | Max Tier | Notes |
|------|------|------|------|----------|------|
| IMP-A1 | Import | 20 | 6 | 4 | Near gate |
| EXP-C3 | Export | 30 | 8 | 5 | Near quay |
| RF-R1 | Reefer | 15 | 4 | 4 | Power points |
| DG-D1 | Hazardous | 10 | 4 | 3 | Segregated |

---

## Data schemas (JSON Schema references or in-file fragments)

```json
{
  "block_id": "EXP-C3",
  "bay": 12,
  "row": 4,
  "tier": 2,
  "container_id": "MSCU1234567"
}
```

---

## Sample data (JSON and YAML)

### JSON

```json
{
  "block_id": "IMP-A1",
  "bay": 5,
  "row": 2,
  "tier": 1,
  "container_id": "MAEU7654321"
}
```

### YAML

```yaml
block_id: RF-R1
bay: 3
row: 1
tier: 2
container_id: CMAU1122334
reefer_power: true
```

---

## Visualisation guidance

### Mermaid diagram: yard coordinate system

```mermaid
grid
  title Yard Block (Top View)
  columns 6
  row 1: B1 B2 B3 B4 B5 B6
  row 2: B1 B2 B3 B4 B5 B6
```

### Mermaid conceptual diagram

```mermaid
flowchart LR
  A[Block] --> B[Bay]
  B --> C[Row]
  C --> D[Tier]
```

---

## 3D rendering notes (scale, dimensions, textures/markings)

- standard container footprint spacing
- realistic lane widths between rows
- crane rails aligned with block
- highlight:
  - occupied slots
  - empty slots
  - reefer connections
  - DG zones

---

## Validation checklist

- [ ] Every container has a unique yard coordinate
- [ ] Block zoning rules enforced
- [ ] Stack height limits respected
- [ ] Rehandle logic implemented
- [ ] Interchange queues modelled
- [ ] Occupancy impacts behaviour

---

## Open questions and research backlog

- Add advanced stacking strategies (block stacking vs row stacking)
- Model automated yard vs manual yard differences
- Introduce dynamic slot assignment optimisation
- Add predictive yard congestion modelling
- Integrate rail-mounted yard systems
