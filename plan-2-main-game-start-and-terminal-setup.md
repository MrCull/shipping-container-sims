# Box Empire — Plan 2: Main Game Start and Terminal Setup

> **Status:** Not started
> **Dependencies:** Plan 1 (all core systems: job system, equipment state machine, pathfinding, yard model, economy, events)
> **Builds on:** Job scheduler, equipment controller, yard manager, economy module, event/audio system, Pinia store

---

## Objective

Transition from the guided tutorial to open-ended gameplay. The player starts at a new, larger terminal that is initially empty of both containers and equipment. The player must purchase equipment and yard storage to begin operations. This plan introduces the purchase system, yard block configuration, expanded vessel operations, save/load, and game-over conditions.

---

## Prerequisites — Read Before Implementing

1. **AGENTS.md** — Project conventions, linting
2. **`src/sims/box-empire/box-empire-AGENTS.md`** — Architecture decisions and module map from Plan 1
3. **Master roadmap** — `create-five-other-plans-with-combined-will-result-in-a-full-game.md` §5 (Plan 2)
4. **Skill files:**
   - `.ai/skills/container-cargo-entities/SKILL.md` — Yard grouping heuristic (`computeYardGroupingScore`), priority scoring
   - `.ai/skills/terminal-infrastructure/SKILL.md` — Yard block model, block types, layout archetypes
   - `.ai/skills/terminal-economics/SKILL.md` — Base handling charges, maintenance concept
   - `.ai/skills/terminal-operations/SKILL.md` — Stacking strategies, rehandle rates, congestion model
5. **Knowledge base files:**
   - `knowledge-base/dk_yard__storage_blocks_and_locations.md` — Block types, zoning, slot constraints
   - `knowledge-base/dk_ops__gatehouse_processes.md` — Gate processing, queue management
   - `knowledge-base/dk_sim__economics_tariffs_costs.md` — Tariff structures, charge bases
   - `knowledge-base/dk_equipment__reach_stackers.md` — Reach stacker capacity details
   - `knowledge-base/dk_ops__end_to_end_flows.md` — Import/export container flow details

---

## Player Experience

1. After completing the tutorial (or skipping it), the player enters the main game
2. Starting conditions:
   - Larger terminal area (more space for expansion)
   - Starting capital: **$10,000**
   - No equipment owned
   - No yard storage built
   - Vessels and trucks will arrive once the terminal is operational
3. Player must purchase:
   - At least one reach stacker ($2,000)
   - A gatehouse ($1,500)
   - A mobile harbor crane ($5,000)
   - Yard storage blocks (price varies by size)
4. Once equipped, player opens the gatehouse and begins accepting vessel/truck traffic
5. Gameplay continues indefinitely with increasing vessel sizes and volumes
6. Game can be saved and loaded
7. Game ends (bankruptcy) if money goes negative

---

## Gameplay Scope

| Feature | Description |
|---------|-------------|
| Purchase system | Buy equipment and yard blocks from a catalog |
| Yard configuration | Choose block size (bays × rows), assign block type and filling strategy |
| Expanded vessels | Vessels with 10–30 containers |
| Truck flow | Trucks arrive over time based on vessel schedules |
| Money management | Starting capital, revenue, maintenance costs |
| Save/load | Persist game state to localStorage |
| Game over | If money goes negative, game ends |

---

## New Systems

### 1. Purchase System

```typescript
interface PurchaseCatalog {
  equipment: EquipmentListing[]
  yardBlocks: YardBlockListing[]
  infrastructure: InfrastructureListing[]
}

interface EquipmentListing {
  type: 'reach_stacker' | 'mobile_harbor_crane'
  name: string
  description: string
  price: number
  maintenanceCost: number  // per sim-day
  specs: EquipmentSpecs
  icon: string  // emoji or icon reference
}

interface YardBlockListing {
  basePrice: number  // per slot (bay × row × tier)
  minBays: number
  maxBays: number
  minRows: number
  maxRows: number
  maxTier: number
}

interface InfrastructureListing {
  type: 'gatehouse'
  name: string
  price: number
  maintenanceCost: number
}
```

**Catalog prices (reference values from `terminal-economics` skill):**

| Item | Purchase Price | Daily Maintenance |
|------|---------------|-------------------|
| Reach stacker | $2,000 | $50/day |
| Mobile harbor crane | $5,000 | $100/day |
| Gatehouse | $1,500 | $25/day |
| Yard block | $50 per slot | $0.50 per slot/day |

**Purchase behavior:**
1. Player opens the purchase menu
2. Selects an item from the catalog
3. For yard blocks, configures size and type (see below)
4. Price is deducted from balance
5. Equipment/block appears in the terminal and is immediately operational
6. For equipment: a new `Equipment` entity is added to the store
7. For yard blocks: a new `YardBlock` is added with configured dimensions
8. For gatehouses: a new gatehouse node is added to the terminal map

### 2. Yard Block Configuration

When purchasing a yard block, the player configures:

```typescript
interface YardBlockConfig {
  id: string
  position: { x: number; z: number }  // auto-assigned based on available space
  bays: number  // 5–30
  rows: number  // 1–6
  maxTier: number  // 3–5
  type: 'import' | 'export' | 'mixed'
  fillingStrategy: 'first_available' | 'pod_grouped' | 'fifo'
}
```

**Configuration options:**

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| Bays | 5–30 | 15 | Length of the block |
| Rows | 1–6 | 3 | Width (limited by reach stacker row reach in Plan 2) |
| Max tier | 3–5 | 4 | Stack height |
| Type | import / export / mixed | mixed | Determines which containers can be placed |
| Filling strategy | first_available / pod_grouped / fifo | first_available | Affects rehandle rate |

**Filling strategy details** (from `terminal-operations` skill):

| Strategy | Description | Avg Rehandle Rate |
|----------|-------------|-------------------|
| `first_available` | Fill lowest available slot in first bay | ~0.80 |
| `pod_grouped` | Group by destination port, uses yard grouping score | ~0.40 |
| `fifo` | First-in-first-out, optimizes dwell time | ~0.60 |

**Yard grouping score** (from `container-cargo-entities` skill):
- Same outbound voyage: weight 5
- Same port of discharge: weight 3
- Same liner service: weight 2
- Same cutoff time bucket: weight 4
- Same hazard zone: weight 4
- Same departure mode: weight 3
- Maximum pair score: 21

The `pod_grouped` strategy uses this scoring function to decide optimal slot placement.

**Block placement:** Auto-assign positions in the yard area. Use a simple grid layout — blocks are placed in rows parallel to the quay, with gaps for truck lanes (4m wide between blocks per `terminal-infrastructure` skill defaults).

### 3. Expanded Operations

**Vessels:**
- Small feeders: 50–100m LOA, 10–30 container slots
- Arrival frequency: one vessel every 5–10 sim-minutes initially, scaling up as terminal capacity grows
- Each vessel has a mix of import containers (to discharge) and export containers (to load)
- Vessel scheduling: announce 2–3 minutes before arrival

**Trucks:**
- Export trucks arrive in batches based on vessel schedule (before vessel arrival)
- Import trucks arrive after containers are available in yard (after discharge)
- Multiple trucks may be queued at the gate
- Gate processing time: 15s per truck (from `dk_ops__gatehouse_processes.md` — simplified from real 30–180s)

**Equipment:**
- Multiple reach stackers can operate simultaneously
- Multiple mobile harbor cranes can work the same vessel
- Equipment may have multiple jobs queued — job scheduler assigns based on proximity and idle status

**Maintenance:**
- Daily maintenance costs deducted at each sim-day boundary
- Cost = sum of all owned equipment/infrastructure maintenance rates
- If balance goes negative after deduction → game over warning (grace period of 1 sim-day)

### 4. Save/Load System

Serialize full game state to `localStorage`:

```typescript
interface SaveData {
  version: number  // schema version for migration
  savedAt: string  // ISO timestamp
  state: {
    gamePhase: string
    simTime: number
    timeScale: number
    money: number
    transactions: Transaction[]  // last 100 only
    equipment: Equipment[]
    containers: Container[]
    yardBlocks: YardBlock[]
    vesselVisits: VesselVisit[]
    truckVisits: TruckVisit[]
    jobs: Job[]
    terminalConfig: TerminalConfig
    tutorialCompleted: boolean
    events: GameEvent[]  // last 50 only
  }
}
```

**Save behavior:**
- Auto-save every 60 real seconds
- Manual save from pause menu
- Single save slot (overwrite)
- On load: restore all state, resume simulation

**Load behavior:**
- "Continue" button on start screen if save exists
- Deserialize, validate schema version, restore to Pinia store
- Re-initialize Three.js scene from restored state

### 5. Game Over

**Trigger:** Money balance goes negative after daily maintenance deduction

**Grace period:** 1 sim-day warning — "Your terminal is losing money! You have 1 day to earn revenue or go bankrupt."

**Game over screen:**
- Final stats: days survived, containers handled, total revenue
- "Retry" button → restart main game with $10,000
- "Back to Menu" button → return to start screen

---

## Store Additions (Pinia)

Extend the Plan 1 `BoxEmpireState`:

```typescript
interface BoxEmpireState {
  // ... Plan 1 fields ...

  // Plan 2 additions
  purchasedEquipmentIds: string[]  // IDs of owned equipment
  terminalConfig: TerminalConfig
  dailyMaintenanceCost: number  // computed from owned assets
  lastMaintenanceDeduction: number  // sim time of last deduction
  gameOverReason: string | null
  bankruptcyWarningActive: boolean
  autoSaveEnabled: boolean
}

interface TerminalConfig {
  gatehouses: GatehouseConfig[]
  yardBlocks: YardBlockConfig[]
  quayCranes: QuayCraneConfig[]
  availableYardPositions: { x: number; z: number }[]  // grid of placeable positions
}
```

---

## Terminal Map Expansion

The Plan 1 terminal map node-graph needs to support dynamic nodes:

```typescript
// Extend terminalMap.ts
function addYardBlockNodes(block: YardBlockConfig): PathNode[]
function addGatehouseNode(gatehouse: GatehouseConfig): PathNode
function removeNode(nodeId: string): void
function recalculateEdges(): void
```

When a yard block is purchased:
1. Add yard I/O node(s) for the block
2. Add edges connecting the block to the main road network
3. Equipment pathfinding automatically uses the new nodes

When a gatehouse is purchased:
1. Add gate node
2. Add edges to the road network
3. Trucks can be assigned to the new gatehouse

---

## UI Scope

### New UI Elements

| Element | Component | Description |
|---------|-----------|-------------|
| Purchase menu | `PurchaseMenu.vue` | Catalog of available equipment, yard blocks, infrastructure |
| Yard block configurator | `YardBlockConfigurator.vue` | Set size, type, strategy when buying a block |
| Terminal overview | `TerminalOverview.vue` | See what's built and where |
| Pause menu | `modals/PauseMenu.vue` | Save, load, settings, quit |
| Game over screen | `modals/GameOver.vue` | Bankruptcy screen with stats |
| Skip tutorial button | Update `StartScreen.vue` | Option to skip tutorial and go straight to main game |

### Purchase Menu Design

- Tabbed interface: Equipment | Yard | Infrastructure
- Each item shows: name, price, maintenance cost, description, specs
- "Buy" button (disabled if insufficient funds)
- Yard block tab shows the configurator inline

### Updated Top Bar

- Add "Shop" button to open purchase menu
- Add day counter display
- Add maintenance cost indicator

---

## File Structure (New/Modified)

```
src/sims/box-empire/
├── components/
│   ├── PurchaseMenu.vue              # Equipment/block catalog (NEW)
│   ├── YardBlockConfigurator.vue     # Block setup UI (NEW)
│   ├── TerminalOverview.vue          # What's built (NEW)
│   └── modals/
│       ├── GameOver.vue              # Bankruptcy screen (NEW)
│       └── PauseMenu.vue             # Save/load options (NEW)
├── modules/
│   ├── purchaseSystem.ts             # Buy/sell logic (NEW)
│   ├── yardAssignment.ts             # Smart slot assignment using grouping score (NEW)
│   ├── saveLoad.ts                   # Serialization/deserialization (NEW)
│   ├── maintenance.ts                # Daily cost deductions (NEW)
│   ├── vesselScheduler.ts            # Vessel arrival scheduling for free play (NEW)
│   ├── terminalMap.ts                # MODIFIED — dynamic node addition
│   ├── jobScheduler.ts               # MODIFIED — multi-equipment assignment
│   ├── yardManager.ts                # MODIFIED — multiple blocks, configurable strategies
│   ├── economy.ts                    # MODIFIED — maintenance costs, bankruptcy check
│   └── config.ts                     # MODIFIED — catalog prices, vessel parameters
├── store/
│   └── gameStore.ts                  # MODIFIED — new state fields, purchase actions
├── types/
│   └── index.ts                      # MODIFIED — new interfaces
```

---

## Implementation Order (Recommended)

### Phase A — Types and Config Extensions
1. Add new interfaces to `types/index.ts` (PurchaseCatalog, YardBlockConfig, TerminalConfig, SaveData)
2. Add catalog data to `modules/config.ts` (prices, specs, vessel parameters)

### Phase B — Purchase System
3. Implement `modules/purchaseSystem.ts` (buy logic, balance check, entity creation)
4. Implement `modules/maintenance.ts` (daily cost calculation and deduction)
5. Update `store/gameStore.ts` with new state fields and purchase actions

### Phase C — Yard Expansion
6. Update `modules/yardManager.ts` to support multiple blocks with configurable strategies
7. Implement `modules/yardAssignment.ts` (yard grouping score, POD-grouped placement)
8. Update `modules/terminalMap.ts` for dynamic node addition/removal

### Phase D — Expanded Operations
9. Implement `modules/vesselScheduler.ts` (vessel arrival scheduling for free play)
10. Update `modules/truckManager.ts` for batch arrivals and multi-gatehouse queue assignment
11. Update `modules/jobScheduler.ts` for multi-equipment assignment optimization

### Phase E — Save/Load
12. Implement `modules/saveLoad.ts` (serialize, deserialize, auto-save timer)
13. Wire save/load into store actions

### Phase F — Game Over
14. Add bankruptcy detection to `modules/economy.ts`
15. Add grace period logic and game-over trigger

### Phase G — UI Components
16. Implement `components/PurchaseMenu.vue`
17. Implement `components/YardBlockConfigurator.vue`
18. Implement `components/TerminalOverview.vue`
19. Implement `components/modals/PauseMenu.vue`
20. Implement `components/modals/GameOver.vue`
21. Update `components/TopBar.vue` (shop button, day counter, maintenance indicator)
22. Update `components/modals/StartScreen.vue` (skip tutorial, continue game)

### Phase H — Rendering Updates
23. Update `modules/sceneBuilder.ts` for larger terminal area
24. Update renderers to handle dynamically added yard blocks and equipment
25. Add placement preview rendering for purchase system

### Phase I — Integration and Testing
26. Wire main game flow in `BoxEmpire.vue` (menu → tutorial/skip → main game)
27. Test purchase flow end-to-end
28. Test save/load cycle
29. Test game-over trigger
30. Test vessel scheduling and expanded operations
31. Lint and build

---

## Acceptance Criteria

- [ ] Player can purchase equipment and yard blocks from the catalog
- [ ] Prices are correctly deducted from balance
- [ ] Purchased equipment appears in the terminal and is operational
- [ ] Yard blocks can be configured with different sizes (5–30 bays, 1–6 rows, 3–5 tiers)
- [ ] Yard blocks can be assigned type (import/export/mixed) and filling strategy
- [ ] Yard assignment AI uses grouping score for `pod_grouped` strategy
- [ ] `first_available` and `fifo` strategies work correctly
- [ ] Vessels with 10–30 containers arrive on a schedule and are handled correctly
- [ ] Multiple reach stackers can operate simultaneously
- [ ] Multiple trucks can queue at the gate
- [ ] Maintenance costs are deducted at each sim-day boundary
- [ ] Game state can be saved to localStorage
- [ ] Game state can be loaded from localStorage and play continues correctly
- [ ] Auto-save triggers every 60 real seconds
- [ ] Game over triggers when money goes negative (after 1-day grace period)
- [ ] Game over screen shows final stats
- [ ] Tutorial can be skipped to go directly to main game
- [ ] No lint errors (`npm run lint`)
- [ ] Build succeeds (`npm run build`)

---

## Out of Scope for Plan 2

- 40ft containers
- RMG or STS cranes
- Multiple gatehouses (only 1 purchasable in Plan 2)
- Reefer or hazardous containers
- Dashboards or KPIs
- Vessel scaling beyond small feeders
- Milestone unlocks

---

*End of Plan 2*
