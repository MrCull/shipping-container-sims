---
title: Terminal Tractors (Yard Trucks / Shunters)
category: equipment
topic_slug: terminal_tractors
version: 1.0
status: draft
last_updated: 2026-03-27
sources:
  - common port operations practice
  - terminal equipment OEM specifications
  - simulation modelling assumptions (non-regulatory)
---

# Summary

Terminal tractors (also known as yard trucks, shunters, or terminal tractors) are specialised vehicles used within container terminals to move trailers and containers between operational zones such as quay cranes, yard blocks, and gates. They are optimised for short-distance, high-frequency hauling rather than long-distance transport.

They typically operate in tightly controlled environments with predefined routes, safety constraints, and coordination with cranes and yard equipment.

# Why this matters for simulation and gameplay

- Core transport layer between quay and yard operations.
- Primary driver of congestion, queueing, and throughput bottlenecks.
- Enables realistic modelling of:
  - Crane waiting times
  - Yard congestion
  - Dispatch optimisation problems
- Supports gameplay mechanics like:
  - Route optimisation
  - Fleet sizing decisions
  - Traffic management systems

# Key definitions and vocabulary

- Terminal Tractor (TT)
- Bomb Cart / Terminal Trailer
- Haul Cycle
- Drop-and-Pick
- Live Load
- Deadhead
- Dispatching
- Quay Crane Interface Zone

# Scope boundaries

## Included
- Tractor movement behaviour
- Trailer coupling/decoupling logic
- Path planning within terminal road network
- Interaction with cranes and yard equipment
- Queueing and dispatching

## Excluded
- External trucking
- Detailed mechanical engineering
- Fuel/maintenance systems

# Key attributes and dimensions

## Vehicle characteristics

| Attribute | Typical Value |
|----------|--------------|
| Max speed | 25–40 km/h |
| Operational speed | 10–25 km/h |
| Acceleration | Low |
| Turning radius | Tight |
| Capacity | 1 container |
| Coupling time | 5–20 sec |
| Decoupling time | 5–15 sec |

# Rules, constraints, and algorithms

## Haul-only behaviour

State machine:
IDLE → ASSIGNED → TRAVEL → COUPLE → HAUL → DECOUPLE → NEXT

## Path planning

cost = distance / speed_limit * congestion_multiplier

## Queueing

wait_time = queue_length * service_time

# Data schema

{
  "id": "TT-12",
  "status": "moving",
  "position": { "x": 120.5, "y": 45.2 },
  "is_loaded": true
}

# Validation checklist

- Tractor carries one container only
- Uses defined road network
- Queueing works
- Speed varies correctly
