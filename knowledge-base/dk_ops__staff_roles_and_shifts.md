---
title: Staff Roles and Shifts
category: ops
topic: staff_roles_and_shifts
filename: dk_ops__staff_roles_and_shifts.md
version: 1.0
status: draft
last_updated: 2026-03-26
priority: P1
sources:
  - Terminal operations practices
  - Port safety guidance (ICHCA, ILO)
  - Equipment operation standards
---

## Summary

This document defines **terminal staff roles, responsibilities, competencies, and shift patterns**.

It provides:
- role definitions mapped to terminal processes
- staffing constraints and dependencies
- shift models and handover effects
- safety responsibilities and risk exposure

---

## Why this matters for simulation and gameplay

People are the hidden constraint in terminals.

Without modelling staff:
- equipment runs infinitely
- no fatigue or bottlenecks
- safety never fails

With staff:
- capacity depends on labour
- shift changes disrupt flow
- mistakes and incidents become possible

---

## Key definitions and vocabulary

- **Role**  
  A job function tied to specific equipment or processes

- **Competency**  
  Certification required to perform a role

- **Shift**  
  Time period a worker is assigned

- **Handover**  
  Transfer of responsibility between shifts

- **Safety zone**  
  Area requiring trained personnel

---

## Scope boundaries

### Included
- operational roles
- staffing constraints
- shift patterns
- safety considerations

### Excluded
- HR/payroll systems
- detailed training programs

---

## Key attributes and dimensions

### Staff member

```json
{
  "staff_id": "string",
  "role": "string",
  "competencies": ["string"],
  "shift": "day | night",
  "status": "active | off_shift | unavailable"
}
```

---

## Core roles

| Role | Function |
|------|--------|
| Quay Crane Operator | Load/discharge containers |
| Yard Crane Operator | Move containers in yard |
| Truck Driver (internal) | Horizontal transport |
| Gate Clerk | Gate processing |
| Planner | Stowage and yard planning |
| Supervisor | Operational control |
| Maintenance | Equipment repair |

---

## Rules, constraints, algorithms

### 1. Role dependency

```pseudo
if no_operator_available:
  equipment_idle = true
```

---

### 2. Competency constraint

```pseudo
if staff.role != required_role:
  deny_task()
```

---

### 3. Shift coverage

```pseudo
if active_staff < required_staff:
  reduce_capacity()
```

---

### 4. Shift handover impact

```pseudo
handover_time = 15-30 minutes

during_handover:
  reduce_productivity()
  increase_error_probability()
```

---

### 5. Fatigue (optional)

```pseudo
if hours_worked > threshold:
  error_rate += increase
```

---

## Safety responsibilities

- crane exclusion zones
- hazardous cargo handling
- traffic control in yard
- PPE compliance

### Risk factors
- fatigue
- poor communication
- shift transitions
- equipment congestion

---

## Example outputs

### Staffing table

| Role | Required per shift |
|------|-------------------|
| QC Operator | 3 |
| Yard Operator | 5 |
| Gate Staff | 2 |

---

## Data schemas

```json
{
  "staff": [
    {
      "staff_id": "string",
      "role": "string",
      "shift": "string"
    }
  ]
}
```

---

## Sample data

### JSON

```json
{
  "staff_id": "ST001",
  "role": "QC_OPERATOR",
  "shift": "day",
  "status": "active"
}
```

---

## Visualisation guidance

```mermaid
flowchart LR
  Staff --> Equipment --> Operations
```

---

## 3D rendering notes

- show operators in cranes/vehicles
- visualise shift change (staff swap)
- highlight idle equipment due to no staff

---

## Validation checklist

- [ ] roles mapped to equipment
- [ ] shift coverage affects capacity
- [ ] competency enforced
- [ ] handover impacts included

---

## Open questions

- union rules / labour agreements
- multi-skill workforce modelling
- real fatigue modelling
