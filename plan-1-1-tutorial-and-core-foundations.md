# Plan 1.1: Tutorial Visual and Behavioral Improvements

## Status
Not started

## Dependencies
Plan 1 (implemented)

## Scope
Bug fixes, visual upgrades, and a new speed option within:
`src/sims/box-empire/`

---

## Objective
Fix 11 issues with the current tutorial implementation before moving to Plans 2–5. These include logic bugs, visual upgrades, and a new x100 speed option.

---

## Issues and Solutions

### 1. Gatehouse Truck Queue
**Problem:** Trucks overlap at the gate.

**Solution:** Implement queue system in `truckManager.ts`.

---

### 2. Yard Slot Conflict Prevention
**Problem:** Multiple jobs assign same slot.

**Solution:** Exclude reserved slots when assigning.

---

### 3. Reach Stacker Visual Upgrade
Replace procedural model with GLB.

---

### 4. Road Trucks Moving Backwards
Fix orientation mismatch.

---

### 5. Trucks Not Carrying Containers
Update container position during truck movement.

---

### 6. Truck Visual Upgrade
Use GLB models for trucks.

---

### 7. Container Visual Upgrade
Use OBJ model or improved geometry.

---

### 8. Vessel Arriving Sideways
Implement two-phase approach.

---

### 9. Floating Containers
Hide containers until vessel arrives.

---

### 10. Vessel Visual Upgrade
Replace with GLB model.

---

### 11. Add x100 Speed Option
Increase max speed and tick limits.

---

## Implementation Order

### Phase A - Quick Fixes
1. Speed option
2. Floating containers
3. Truck container sync
4. Yard slot conflict
5. Truck queue
6. Vessel movement

### Phase B - Asset Infrastructure
7. Model directory
8. Model loader

### Phase C - Visual Upgrades
9. Reach stacker
10. Vessel
11. Trucks
12. Containers

### Phase D - Testing
13. Test speeds
14. Verify logic
15. Verify models
16. Lint

---

## Notes
Update `box-empire-AGENTS.md` after implementation.

---

End of Plan 1.1
