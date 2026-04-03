---
title: Mobile Harbour Cranes
category: equipment
topic: mobile_harbour_cranes
filename: dk_equipment__mobile_harbour_cranes.md
version: 1.0
status: draft
last_updated: 2026-04-03
priority: P0
sources:
  - Liebherr Mobile Harbour Crane technical information
  - Konecranes Gottwald MHC product information
---

## Summary

This document defines Mobile Harbour Cranes (MHCs) as flexible, multi-purpose port cranes used for container, bulk, and general cargo handling.

It separates the topic into four lenses:
- What it looks like
- How it moves
- What it can do
- When it must stop

## Key characteristics

Mobile harbour cranes are:
- highly mobile
- multi-purpose
- slower but more flexible than STS cranes

They can handle:
- containers
- bulk materials
- general cargo
- heavy lifts

## Physical geometry

- max_outreach_m
- max_lift_height_m
- base_width_m
- base_length_m
- slew_radius_m
- undercarriage_type

Typical ranges:
- outreach: 35–60 m
- lift capacity: 64–300+ t

## Motion model

Primary movements:
- slewing (rotation)
- luffing (boom angle)
- hoisting (vertical)
- travel (optional)

cycle_time =
  slew_time +
  luff_time +
  hoist_time +
  attachment_time +
  wait_penalties

## Functional interfaces

- containers (spreader)
- bulk (grab)
- general cargo (hook)
- heavy lift

## Mobility

Types:
- rubber tyre
- rail portal
- pedestal
- barge-mounted

## Performance

Typical:
- 20–35 container moves/hour
- bulk throughput up to ~2000 tph

## Event model

- MHC_JOB_ASSIGNED
- MHC_SLEWING
- MHC_LUFFING
- MHC_HOIST_LOWERING
- MHC_LOCKING
- MHC_PICK_CONFIRMED
- MHC_HOIST_LIFTING
- MHC_TRANSFER_POSITIONING
- MHC_UNLOCKING
- MHC_SET_CONFIRMED
- MHC_REPOSITIONING
- MHC_JOB_COMPLETED

## Example configuration

{
  "equipment_id": "MHC-01",
  "subtype": "rubber_tyre",
  "max_outreach_m": 48,
  "max_lift_capacity_t": 124,
  "mobility_enabled": true
}

## Key takeaway

- STS = fast, fixed
- ASC/RMG = structured, optimised
- MHC = flexible, slower, multi-role
