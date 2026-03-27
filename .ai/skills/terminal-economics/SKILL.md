---
name: terminal-economics
description: >-
  Data structures, schemas, and default values for container terminal economics:
  tariff structures, handling charges, storage fees, surcharges, and cost
  modeling. Use when implementing economic models, billing systems, or cost
  tracking in terminal simulations.
---

# Terminal Economics & Tariff Data Structures

Comprehensive reference for container terminal tariffs, charge calculations, invoicing, and financial tracking. All interfaces are TypeScript-first, strict-mode compatible, and include realistic industry defaults. Use this as the canonical source when generating economics-related code — no external lookup should be needed.

---

## 1. Tariff Structure Overview

Terminal charges fall into four categories, billed on one of several charge bases:

### Charge Categories

| # | Category | Description |
|---|----------|-------------|
| 1 | **Base handling charges** | Per-container move charges for load, discharge, gate, rail, shifting |
| 2 | **Surcharges** | Premiums for hazardous, reefer, overweight, out-of-gauge, off-hours |
| 3 | **Storage / dwell charges** | Daily fees after a free-time period expires |
| 4 | **Optional services** | VGM weighing, seal application, inspections, cleaning, lashing |

### Charge Bases

```ts
export type ChargeBasis =
  | 'per_container'
  | 'per_move'
  | 'per_teu'
  | 'per_day'
  | 'per_hour'
  | 'per_kg'
  | 'per_transaction'
```

### Charge Category Enum

```ts
export type ChargeCategory =
  | 'handling'
  | 'surcharge'
  | 'storage'
  | 'service'
```

---

## 2. Base Handling Charges

### Rate Table

| Move Type | 20ft (USD) | 40ft (USD) | Basis |
|-----------|-----------|-----------|-------|
| Vessel load/discharge | 150–250 | 220–350 | per container |
| Truck gate in/out | 50–100 | 75–150 | per container |
| Rail load/unload | 80–130 | 120–200 | per container |
| Inter-terminal transfer | 100–180 | 150–270 | per container |
| Restow (onboard) | 200–350 | 300–500 | per container |
| Restow (via quay) | 300–500 | 450–700 | per container |
| Shifting in yard | 40–80 | 60–120 | per move |

### Interfaces

```ts
export type MoveType =
  | 'vessel_load'
  | 'vessel_discharge'
  | 'truck_gate_in'
  | 'truck_gate_out'
  | 'rail_load'
  | 'rail_unload'
  | 'inter_terminal_transfer'
  | 'restow_onboard'
  | 'restow_via_quay'
  | 'yard_shift'

export type ContainerSize = '20ft' | '40ft'

export interface HandlingCharge {
  charge_id: string
  move_type: MoveType
  container_size: ContainerSize
  base_rate: number
  currency: string  // default "USD"
}
```

### Default Handling Charges

```ts
export const DEFAULT_HANDLING_CHARGES: HandlingCharge[] = [
  // Vessel load/discharge
  { charge_id: 'HC-VL-20', move_type: 'vessel_load',       container_size: '20ft', base_rate: 185, currency: 'USD' },
  { charge_id: 'HC-VL-40', move_type: 'vessel_load',       container_size: '40ft', base_rate: 275, currency: 'USD' },
  { charge_id: 'HC-VD-20', move_type: 'vessel_discharge',  container_size: '20ft', base_rate: 185, currency: 'USD' },
  { charge_id: 'HC-VD-40', move_type: 'vessel_discharge',  container_size: '40ft', base_rate: 275, currency: 'USD' },

  // Truck gate
  { charge_id: 'HC-TGI-20', move_type: 'truck_gate_in',   container_size: '20ft', base_rate: 70,  currency: 'USD' },
  { charge_id: 'HC-TGI-40', move_type: 'truck_gate_in',   container_size: '40ft', base_rate: 105, currency: 'USD' },
  { charge_id: 'HC-TGO-20', move_type: 'truck_gate_out',  container_size: '20ft', base_rate: 70,  currency: 'USD' },
  { charge_id: 'HC-TGO-40', move_type: 'truck_gate_out',  container_size: '40ft', base_rate: 105, currency: 'USD' },

  // Rail
  { charge_id: 'HC-RL-20', move_type: 'rail_load',         container_size: '20ft', base_rate: 100, currency: 'USD' },
  { charge_id: 'HC-RL-40', move_type: 'rail_load',         container_size: '40ft', base_rate: 155, currency: 'USD' },
  { charge_id: 'HC-RU-20', move_type: 'rail_unload',       container_size: '20ft', base_rate: 100, currency: 'USD' },
  { charge_id: 'HC-RU-40', move_type: 'rail_unload',       container_size: '40ft', base_rate: 155, currency: 'USD' },

  // Inter-terminal transfer
  { charge_id: 'HC-ITT-20', move_type: 'inter_terminal_transfer', container_size: '20ft', base_rate: 135, currency: 'USD' },
  { charge_id: 'HC-ITT-40', move_type: 'inter_terminal_transfer', container_size: '40ft', base_rate: 200, currency: 'USD' },

  // Restow onboard
  { charge_id: 'HC-RSO-20', move_type: 'restow_onboard',  container_size: '20ft', base_rate: 265, currency: 'USD' },
  { charge_id: 'HC-RSO-40', move_type: 'restow_onboard',  container_size: '40ft', base_rate: 390, currency: 'USD' },

  // Restow via quay
  { charge_id: 'HC-RSQ-20', move_type: 'restow_via_quay', container_size: '20ft', base_rate: 385, currency: 'USD' },
  { charge_id: 'HC-RSQ-40', move_type: 'restow_via_quay', container_size: '40ft', base_rate: 560, currency: 'USD' },

  // Yard shift
  { charge_id: 'HC-YS-20', move_type: 'yard_shift',       container_size: '20ft', base_rate: 55,  currency: 'USD' },
  { charge_id: 'HC-YS-40', move_type: 'yard_shift',       container_size: '40ft', base_rate: 85,  currency: 'USD' },
]
```

### Lookup Helper

```ts
export function findHandlingCharge(
  charges: HandlingCharge[],
  moveType: MoveType,
  containerSize: ContainerSize,
): HandlingCharge | undefined {
  return charges.find(c => c.move_type === moveType && c.container_size === containerSize)
}
```

---

## 3. Surcharges

### Rate Table

| Surcharge Type | Rate | Condition |
|---------------|------|-----------|
| Hazardous cargo | +50–100% of base | IMDG classes 1–9 |
| Reefer monitoring | $30–80/day | Temperature-controlled container |
| Reefer power | $40–100/day | Plugged into power supply |
| Overweight (>30 t) | +25–50% of base | Verified gross mass exceeds 30,000 kg |
| Out-of-gauge | +50–150% of base | OOG dimensions |
| Off-hours / weekend | +25–50% | Outside normal shift hours |
| Express handling | +100–200% | Priority processing requested |
| Fumigation | $100–250 flat | Per container |

### Interfaces

```ts
export type SurchargeType =
  | 'hazardous'
  | 'reefer_monitoring'
  | 'reefer_power'
  | 'overweight'
  | 'out_of_gauge'
  | 'off_hours'
  | 'express_handling'
  | 'fumigation'

export type RateType = 'percentage' | 'flat'

export interface Surcharge {
  surcharge_type: SurchargeType
  rate_type: RateType
  /** For 'percentage': decimal multiplier (e.g. 0.75 = +75%). For 'flat': dollar amount. */
  rate_value: number
  condition: string
  /** Which charge categories or move types this surcharge can apply to */
  applicable_to: (MoveType | ChargeCategory)[]
}
```

### Default Surcharges

```ts
export const DEFAULT_SURCHARGES: Surcharge[] = [
  {
    surcharge_type: 'hazardous',
    rate_type: 'percentage',
    rate_value: 0.75,
    condition: 'Container carries IMDG class 1–9 dangerous goods',
    applicable_to: ['vessel_load', 'vessel_discharge', 'truck_gate_in', 'truck_gate_out', 'rail_load', 'rail_unload', 'yard_shift'],
  },
  {
    surcharge_type: 'reefer_monitoring',
    rate_type: 'flat',
    rate_value: 50,
    condition: 'Temperature-controlled container requiring monitoring',
    applicable_to: ['storage'],
  },
  {
    surcharge_type: 'reefer_power',
    rate_type: 'flat',
    rate_value: 65,
    condition: 'Reefer container plugged into terminal power',
    applicable_to: ['storage'],
  },
  {
    surcharge_type: 'overweight',
    rate_type: 'percentage',
    rate_value: 0.35,
    condition: 'VGM exceeds 30,000 kg',
    applicable_to: ['vessel_load', 'vessel_discharge', 'truck_gate_in', 'truck_gate_out', 'rail_load', 'rail_unload'],
  },
  {
    surcharge_type: 'out_of_gauge',
    rate_type: 'percentage',
    rate_value: 1.0,
    condition: 'Container exceeds standard ISO dimensions (OOG)',
    applicable_to: ['vessel_load', 'vessel_discharge', 'truck_gate_in', 'truck_gate_out', 'rail_load', 'rail_unload', 'yard_shift'],
  },
  {
    surcharge_type: 'off_hours',
    rate_type: 'percentage',
    rate_value: 0.35,
    condition: 'Operation outside normal working hours (Mon–Fri 07:00–19:00)',
    applicable_to: ['vessel_load', 'vessel_discharge', 'truck_gate_in', 'truck_gate_out', 'rail_load', 'rail_unload'],
  },
  {
    surcharge_type: 'express_handling',
    rate_type: 'percentage',
    rate_value: 1.5,
    condition: 'Priority processing requested by customer',
    applicable_to: ['vessel_load', 'vessel_discharge', 'truck_gate_in', 'truck_gate_out'],
  },
  {
    surcharge_type: 'fumigation',
    rate_type: 'flat',
    rate_value: 175,
    condition: 'Fumigation treatment required (biosecurity or customer request)',
    applicable_to: ['service'],
  },
]
```

### Surcharge Calculation

```ts
export function applySurcharge(
  baseAmount: number,
  surcharge: Surcharge,
): number {
  if (surcharge.rate_type === 'percentage') {
    return baseAmount * surcharge.rate_value
  }
  return surcharge.rate_value
}

export function applySurcharges(
  baseAmount: number,
  surcharges: Surcharge[],
): { surchargeTotal: number; breakdown: { type: SurchargeType; amount: number }[] } {
  const breakdown = surcharges.map(s => ({
    type: s.surcharge_type,
    amount: applySurcharge(baseAmount, s),
  }))
  return {
    surchargeTotal: breakdown.reduce((sum, b) => sum + b.amount, 0),
    breakdown,
  }
}
```

---

## 4. Storage / Dwell Charges

### Free Storage Periods

| Visit Type | Free Days | Measured From |
|-----------|-----------|---------------|
| Import | 3–7 | Date of vessel discharge |
| Export | 5–10 | Days before vessel departure (receiving window) |
| Transshipment | 7–14 | Date of vessel discharge |
| Empty | 10–21 | Date of gate-in |

### Tiered Daily Rates After Free Period

| Days After Free | 20ft/day (USD) | 40ft/day (USD) |
|----------------|---------------|---------------|
| 1–3 | 15–25 | 25–40 |
| 4–7 | 30–50 | 50–80 |
| 8–14 | 50–80 | 80–130 |
| 15+ | 80–150 | 130–250 |

### Interfaces

```ts
export type VisitType = 'import' | 'export' | 'transshipment' | 'empty_reposition'

export interface StorageTier {
  day_from: number   // inclusive, 1-indexed from first chargeable day
  day_to: number     // inclusive; use Infinity for open-ended final tier
  rate_20ft: number  // USD per day
  rate_40ft: number  // USD per day
}

export interface StoragePolicy {
  visit_type: VisitType
  free_days: number
  tiers: StorageTier[]
}
```

### Default Storage Policies

```ts
export const DEFAULT_STORAGE_POLICIES: StoragePolicy[] = [
  {
    visit_type: 'import',
    free_days: 5,
    tiers: [
      { day_from: 1,  day_to: 3,        rate_20ft: 20,  rate_40ft: 32  },
      { day_from: 4,  day_to: 7,        rate_20ft: 40,  rate_40ft: 65  },
      { day_from: 8,  day_to: 14,       rate_20ft: 65,  rate_40ft: 105 },
      { day_from: 15, day_to: Infinity,  rate_20ft: 110, rate_40ft: 180 },
    ],
  },
  {
    visit_type: 'export',
    free_days: 7,
    tiers: [
      { day_from: 1,  day_to: 3,        rate_20ft: 18,  rate_40ft: 30  },
      { day_from: 4,  day_to: 7,        rate_20ft: 35,  rate_40ft: 58  },
      { day_from: 8,  day_to: 14,       rate_20ft: 60,  rate_40ft: 95  },
      { day_from: 15, day_to: Infinity,  rate_20ft: 100, rate_40ft: 165 },
    ],
  },
  {
    visit_type: 'transshipment',
    free_days: 10,
    tiers: [
      { day_from: 1,  day_to: 3,        rate_20ft: 15,  rate_40ft: 25  },
      { day_from: 4,  day_to: 7,        rate_20ft: 30,  rate_40ft: 50  },
      { day_from: 8,  day_to: 14,       rate_20ft: 55,  rate_40ft: 90  },
      { day_from: 15, day_to: Infinity,  rate_20ft: 95,  rate_40ft: 155 },
    ],
  },
  {
    visit_type: 'empty_reposition',
    free_days: 14,
    tiers: [
      { day_from: 1,  day_to: 7,        rate_20ft: 10,  rate_40ft: 18  },
      { day_from: 8,  day_to: 14,       rate_20ft: 25,  rate_40ft: 42  },
      { day_from: 15, day_to: Infinity,  rate_20ft: 50,  rate_40ft: 85  },
    ],
  },
]
```

### Storage Cost Calculation

```ts
/**
 * Calculate the total storage cost for a container dwell.
 * Returns 0 if the container departs within the free period.
 */
export function calculateStorageCost(
  arrivalDate: Date,
  departureDate: Date,
  containerSize: ContainerSize,
  visitType: VisitType,
  policies: StoragePolicy[] = DEFAULT_STORAGE_POLICIES,
): { totalCost: number; chargeableDays: number; dailyBreakdown: number[] } {
  const policy = policies.find(p => p.visit_type === visitType)
  if (!policy) {
    throw new Error(`No storage policy found for visit type: ${visitType}`)
  }

  const totalDays = Math.max(0, Math.ceil(
    (departureDate.getTime() - arrivalDate.getTime()) / (1000 * 60 * 60 * 24)
  ))
  const chargeableDays = Math.max(0, totalDays - policy.free_days)

  if (chargeableDays === 0) {
    return { totalCost: 0, chargeableDays: 0, dailyBreakdown: [] }
  }

  const rateKey = containerSize === '20ft' ? 'rate_20ft' : 'rate_40ft'
  const dailyBreakdown: number[] = []
  let totalCost = 0

  for (let day = 1; day <= chargeableDays; day++) {
    const tier = policy.tiers.find(t => day >= t.day_from && day <= t.day_to)
    const rate = tier ? tier[rateKey] : policy.tiers[policy.tiers.length - 1][rateKey]
    dailyBreakdown.push(rate)
    totalCost += rate
  }

  return { totalCost, chargeableDays, dailyBreakdown }
}
```

---

## 5. Optional Services

### Rate Table

| Service | Rate (USD) | Unit | Mandatory |
|---------|-----------|------|-----------|
| VGM weighing | 25–50 | per container | No |
| Seal application | 10–20 | per seal | No |
| Seal verification | 15–30 | per check | No |
| Physical inspection | 100–200 | per container | No |
| X-ray scan | 50–100 | per container | No |
| Customs exam | 150–300 | per container | Yes (when ordered) |
| Plug/unplug reefer | 25–50 | per event | Yes (for reefers) |
| Pre-trip inspection (PTI) | 50–100 | per reefer | Yes (for reefers) |
| Container cleaning | 50–150 | per container | No |
| Lashing/unlashing | 20–40 | per container | Yes (for OOG/flat rack) |

### Interfaces

```ts
export type ServiceType =
  | 'vgm_weighing'
  | 'seal_application'
  | 'seal_verification'
  | 'physical_inspection'
  | 'xray_scan'
  | 'customs_exam'
  | 'reefer_plug_unplug'
  | 'pre_trip_inspection'
  | 'container_cleaning'
  | 'lashing_unlashing'

export interface ServiceCharge {
  service_type: ServiceType
  rate: number
  unit: ChargeBasis
  is_mandatory: boolean
}
```

### Default Service Charges

```ts
export const DEFAULT_SERVICE_CHARGES: ServiceCharge[] = [
  { service_type: 'vgm_weighing',       rate: 35,  unit: 'per_container',    is_mandatory: false },
  { service_type: 'seal_application',    rate: 15,  unit: 'per_container',    is_mandatory: false },
  { service_type: 'seal_verification',   rate: 22,  unit: 'per_container',    is_mandatory: false },
  { service_type: 'physical_inspection', rate: 150, unit: 'per_container',    is_mandatory: false },
  { service_type: 'xray_scan',          rate: 75,  unit: 'per_container',    is_mandatory: false },
  { service_type: 'customs_exam',       rate: 225, unit: 'per_container',    is_mandatory: true  },
  { service_type: 'reefer_plug_unplug', rate: 35,  unit: 'per_transaction',  is_mandatory: true  },
  { service_type: 'pre_trip_inspection', rate: 75,  unit: 'per_container',    is_mandatory: true  },
  { service_type: 'container_cleaning', rate: 95,  unit: 'per_container',    is_mandatory: false },
  { service_type: 'lashing_unlashing',  rate: 30,  unit: 'per_container',    is_mandatory: true  },
]
```

---

## 6. Cargo Class Modifiers

Cargo class modifiers are applied as multipliers to the base handling rate. They account for the additional complexity, equipment, and time required for non-standard cargo.

### Modifier Table

| Cargo Class | Modifier | Notes |
|------------|----------|-------|
| General dry | 1.0x | Base rate — no adjustment |
| Reefer | 1.3–1.5x | Power connection + monitoring overhead |
| DG class 1 (explosives) | 2.0–3.0x | Maximum surcharge, segregation required |
| DG class 2–6 | 1.5–2.0x | Standard dangerous goods handling |
| DG class 7 (radioactive) | 2.5–4.0x | Special handling, security, documentation |
| DG class 8–9 | 1.3–1.8x | Lower-risk dangerous goods |
| Out-of-gauge (OOG) | 1.5–2.5x | Special lifting equipment, planning |
| Empty | 0.5–0.7x | Reduced handling complexity |
| Tank container | 1.2–1.5x | Special handling and securing |
| Flat rack | 1.3–1.8x | Lashing required, no stack above |

### Interface & Defaults

```ts
export type CargoClass =
  | 'general_dry'
  | 'reefer'
  | 'dg_class_1'
  | 'dg_class_2_6'
  | 'dg_class_7'
  | 'dg_class_8_9'
  | 'out_of_gauge'
  | 'empty'
  | 'tank'
  | 'flat_rack'

export interface CargoClassModifier {
  cargo_class: CargoClass
  modifier: number
  notes: string
}

export const CARGO_CLASS_MODIFIERS: CargoClassModifier[] = [
  { cargo_class: 'general_dry',  modifier: 1.0,  notes: 'Base rate' },
  { cargo_class: 'reefer',       modifier: 1.4,  notes: 'Power + monitoring' },
  { cargo_class: 'dg_class_1',   modifier: 2.5,  notes: 'Explosives — max surcharge' },
  { cargo_class: 'dg_class_2_6', modifier: 1.75, notes: 'Standard DG handling' },
  { cargo_class: 'dg_class_7',   modifier: 3.0,  notes: 'Radioactive — special handling' },
  { cargo_class: 'dg_class_8_9', modifier: 1.5,  notes: 'Lower-risk DG' },
  { cargo_class: 'out_of_gauge', modifier: 2.0,  notes: 'Special equipment required' },
  { cargo_class: 'empty',        modifier: 0.6,  notes: 'Reduced handling' },
  { cargo_class: 'tank',         modifier: 1.35, notes: 'Special securing' },
  { cargo_class: 'flat_rack',    modifier: 1.5,  notes: 'Lashing required' },
]

export function getCargoModifier(cargoClass: CargoClass): number {
  const entry = CARGO_CLASS_MODIFIERS.find(m => m.cargo_class === cargoClass)
  return entry?.modifier ?? 1.0
}

/**
 * Apply the cargo class modifier to a base handling rate.
 */
export function applyCargoModifier(baseRate: number, cargoClass: CargoClass): number {
  return baseRate * getCargoModifier(cargoClass)
}
```

---

## 7. Revenue & Cost Tracking

### Interfaces

```ts
export interface RevenueByCategoryBreakdown {
  handling: number
  storage: number
  surcharges: number
  services: number
}

export interface CostByCategoryBreakdown {
  labor: number
  equipment_maintenance: number
  fuel_energy: number
  infrastructure_depreciation: number
  overheads: number
}

export interface TerminalFinancials {
  period: string                                // e.g. '2026-Q1', '2026-03', '2026-W13'
  total_revenue: number
  revenue_by_category: RevenueByCategoryBreakdown
  total_cost: number
  cost_by_category: CostByCategoryBreakdown
  profit_margin: number                         // decimal, e.g. 0.25 = 25%
  revenue_per_teu: number
  cost_per_teu: number
}
```

### Industry Benchmarks

| Metric | Low | Typical | High | Unit |
|--------|-----|---------|------|------|
| Revenue per TEU | 120 | 200 | 300 | USD |
| Cost per TEU | 80 | 140 | 200 | USD |
| Profit margin | 15% | 25% | 35% | — |
| Labor cost share | 30% | 38% | 45% | of total cost |
| Equipment cost share | 20% | 25% | 30% | of total cost |
| Energy cost share | 10% | 12% | 15% | of total cost |
| Infrastructure depreciation | 10% | 15% | 20% | of total cost |
| Overheads | 5% | 10% | 15% | of total cost |

### Benchmark Constants

```ts
export const FINANCIAL_BENCHMARKS = {
  revenue_per_teu: { low: 120, typical: 200, high: 300 },
  cost_per_teu:    { low: 80,  typical: 140, high: 200 },
  profit_margin:   { low: 0.15, typical: 0.25, high: 0.35 },
  cost_shares: {
    labor:                       { low: 0.30, typical: 0.38, high: 0.45 },
    equipment_maintenance:       { low: 0.20, typical: 0.25, high: 0.30 },
    fuel_energy:                 { low: 0.10, typical: 0.12, high: 0.15 },
    infrastructure_depreciation: { low: 0.10, typical: 0.15, high: 0.20 },
    overheads:                   { low: 0.05, typical: 0.10, high: 0.15 },
  },
} as const

export function computeProfitMargin(revenue: number, cost: number): number {
  if (revenue === 0) return 0
  return (revenue - cost) / revenue
}

export function createFinancialSnapshot(
  period: string,
  teuCount: number,
  revenueByCategory: RevenueByCategoryBreakdown,
  costByCategory: CostByCategoryBreakdown,
): TerminalFinancials {
  const total_revenue = Object.values(revenueByCategory).reduce((a, b) => a + b, 0)
  const total_cost = Object.values(costByCategory).reduce((a, b) => a + b, 0)

  return {
    period,
    total_revenue,
    revenue_by_category: revenueByCategory,
    total_cost,
    cost_by_category: costByCategory,
    profit_margin: computeProfitMargin(total_revenue, total_cost),
    revenue_per_teu: teuCount > 0 ? total_revenue / teuCount : 0,
    cost_per_teu: teuCount > 0 ? total_cost / teuCount : 0,
  }
}
```

---

## 8. Invoice Generation

### Interfaces

```ts
export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'overdue' | 'cancelled'

export interface InvoiceLineItem {
  description: string
  charge_type: ChargeCategory
  quantity: number
  unit_rate: number
  amount: number
  surcharges_applied: SurchargeType[]
}

export interface Invoice {
  invoice_id: string
  customer_id: string
  container_id: string
  line_items: InvoiceLineItem[]
  subtotal: number
  taxes: number
  total: number
  currency: string
  issue_date: string        // ISO 8601
  due_date: string          // ISO 8601
  status: InvoiceStatus
}
```

### Invoice Generation Function

```ts
export interface ContainerEvent {
  event_type: MoveType | ServiceType
  timestamp: string          // ISO 8601
  container_size: ContainerSize
  cargo_class: CargoClass
  is_off_hours: boolean
  is_express: boolean
}

export interface TariffBook {
  handling_charges: HandlingCharge[]
  surcharges: Surcharge[]
  storage_policies: StoragePolicy[]
  service_charges: ServiceCharge[]
  cargo_modifiers: CargoClassModifier[]
}

let _invoiceSeq = 10000

export function generateInvoice(
  customerId: string,
  containerId: string,
  containerSize: ContainerSize,
  cargoClass: CargoClass,
  visitType: VisitType,
  arrivalDate: Date,
  departureDate: Date,
  events: ContainerEvent[],
  tariffBook: TariffBook,
  taxRate: number = 0,
): Invoice {
  const lineItems: InvoiceLineItem[] = []

  // Process move events (handling charges)
  for (const event of events) {
    const moveTypes: MoveType[] = [
      'vessel_load', 'vessel_discharge', 'truck_gate_in', 'truck_gate_out',
      'rail_load', 'rail_unload', 'inter_terminal_transfer',
      'restow_onboard', 'restow_via_quay', 'yard_shift',
    ]

    if (moveTypes.includes(event.event_type as MoveType)) {
      const charge = findHandlingCharge(
        tariffBook.handling_charges,
        event.event_type as MoveType,
        event.container_size,
      )
      if (!charge) continue

      const modifier = getCargoModifier(event.cargo_class)
      const baseAmount = charge.base_rate * modifier

      const applicableSurcharges: SurchargeType[] = []
      let surchargeAmount = 0

      if (event.is_off_hours) {
        const sc = tariffBook.surcharges.find(s => s.surcharge_type === 'off_hours')
        if (sc) {
          surchargeAmount += applySurcharge(baseAmount, sc)
          applicableSurcharges.push('off_hours')
        }
      }
      if (event.is_express) {
        const sc = tariffBook.surcharges.find(s => s.surcharge_type === 'express_handling')
        if (sc) {
          surchargeAmount += applySurcharge(baseAmount, sc)
          applicableSurcharges.push('express_handling')
        }
      }

      lineItems.push({
        description: `${event.event_type} — ${event.container_size}`,
        charge_type: 'handling',
        quantity: 1,
        unit_rate: baseAmount,
        amount: baseAmount + surchargeAmount,
        surcharges_applied: applicableSurcharges,
      })
    }

    // Process service events
    const serviceTypes: ServiceType[] = [
      'vgm_weighing', 'seal_application', 'seal_verification',
      'physical_inspection', 'xray_scan', 'customs_exam',
      'reefer_plug_unplug', 'pre_trip_inspection', 'container_cleaning',
      'lashing_unlashing',
    ]

    if (serviceTypes.includes(event.event_type as ServiceType)) {
      const svc = tariffBook.service_charges.find(s => s.service_type === event.event_type)
      if (svc) {
        lineItems.push({
          description: `Service: ${event.event_type}`,
          charge_type: 'service',
          quantity: 1,
          unit_rate: svc.rate,
          amount: svc.rate,
          surcharges_applied: [],
        })
      }
    }
  }

  // Storage charges
  const storage = calculateStorageCost(arrivalDate, departureDate, containerSize, visitType, tariffBook.storage_policies)
  if (storage.totalCost > 0) {
    lineItems.push({
      description: `Storage — ${storage.chargeableDays} chargeable day(s) (${visitType})`,
      charge_type: 'storage',
      quantity: storage.chargeableDays,
      unit_rate: storage.totalCost / storage.chargeableDays,
      amount: storage.totalCost,
      surcharges_applied: [],
    })
  }

  const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0)
  const taxes = subtotal * taxRate
  const total = subtotal + taxes

  _invoiceSeq++
  const issueDate = new Date()
  const dueDate = new Date(issueDate)
  dueDate.setDate(dueDate.getDate() + 30)

  return {
    invoice_id: `INV-${_invoiceSeq}`,
    customer_id: customerId,
    container_id: containerId,
    line_items: lineItems,
    subtotal: Math.round(subtotal * 100) / 100,
    taxes: Math.round(taxes * 100) / 100,
    total: Math.round(total * 100) / 100,
    currency: 'USD',
    issue_date: issueDate.toISOString(),
    due_date: dueDate.toISOString(),
    status: 'draft',
  }
}
```

---

## 9. Factory Functions

### Tariff Book Factory

```ts
export type TariffRegion = 'europe' | 'asia' | 'americas'

/**
 * Regional multipliers applied to the default rates.
 * Europe = mid-range baseline (1.0x), Asia = competitive, Americas = premium.
 */
const REGIONAL_MULTIPLIERS: Record<TariffRegion, {
  handling: number
  storage: number
  services: number
  surcharges: number
}> = {
  europe:   { handling: 1.0,  storage: 1.0,  services: 1.0,  surcharges: 1.0  },
  asia:     { handling: 0.7,  storage: 0.65, services: 0.75, surcharges: 0.8  },
  americas: { handling: 1.35, storage: 1.3,  services: 1.25, surcharges: 1.2  },
}

export function createTariffBook(region: TariffRegion = 'europe'): TariffBook {
  const mult = REGIONAL_MULTIPLIERS[region]

  return {
    handling_charges: DEFAULT_HANDLING_CHARGES.map(c => ({
      ...c,
      base_rate: Math.round(c.base_rate * mult.handling),
    })),
    surcharges: DEFAULT_SURCHARGES.map(s => ({
      ...s,
      rate_value: s.rate_type === 'flat'
        ? Math.round(s.rate_value * mult.surcharges)
        : s.rate_value,
    })),
    storage_policies: DEFAULT_STORAGE_POLICIES.map(p => ({
      ...p,
      tiers: p.tiers.map(t => ({
        ...t,
        rate_20ft: Math.round(t.rate_20ft * mult.storage),
        rate_40ft: Math.round(t.rate_40ft * mult.storage),
      })),
    })),
    service_charges: DEFAULT_SERVICE_CHARGES.map(s => ({
      ...s,
      rate: Math.round(s.rate * mult.services),
    })),
    cargo_modifiers: [...CARGO_CLASS_MODIFIERS],
  }
}
```

### Storage Policy Factory

```ts
export function createStoragePolicy(
  visitType: VisitType,
  freeDaysOverride?: number,
): StoragePolicy {
  const base = DEFAULT_STORAGE_POLICIES.find(p => p.visit_type === visitType)
  if (!base) {
    throw new Error(`No default storage policy for visit type: ${visitType}`)
  }
  return {
    ...base,
    free_days: freeDaysOverride ?? base.free_days,
  }
}
```

### Invoice Factory

```ts
/**
 * Convenience wrapper — builds a tariff book for the given region,
 * then generates an invoice for a single container visit.
 */
export function createInvoice(
  customerId: string,
  containerId: string,
  containerSize: ContainerSize,
  cargoClass: CargoClass,
  visitType: VisitType,
  arrivalDate: Date,
  departureDate: Date,
  events: ContainerEvent[],
  region: TariffRegion = 'europe',
  taxRate: number = 0,
): Invoice {
  const tariffBook = createTariffBook(region)
  return generateInvoice(
    customerId, containerId, containerSize, cargoClass,
    visitType, arrivalDate, departureDate, events, tariffBook, taxRate,
  )
}
```

### Total Charges Calculator

```ts
export interface TotalChargesResult {
  handling_total: number
  surcharge_total: number
  storage_total: number
  services_total: number
  grand_total: number
  line_item_count: number
}

/**
 * Calculate the complete charge breakdown for a container visit
 * without generating a full invoice.
 */
export function calculateTotalCharges(
  containerSize: ContainerSize,
  cargoClass: CargoClass,
  visitType: VisitType,
  arrivalDate: Date,
  departureDate: Date,
  events: ContainerEvent[],
  tariffBook: TariffBook,
): TotalChargesResult {
  const invoice = generateInvoice(
    'CALC', 'CALC', containerSize, cargoClass,
    visitType, arrivalDate, departureDate, events, tariffBook,
  )

  const handling_total = invoice.line_items
    .filter(i => i.charge_type === 'handling')
    .reduce((s, i) => s + i.amount, 0)
  const surcharge_total = invoice.line_items
    .filter(i => i.surcharges_applied.length > 0)
    .reduce((s, i) => i.amount - i.unit_rate * i.quantity + s, 0)
  const storage_total = invoice.line_items
    .filter(i => i.charge_type === 'storage')
    .reduce((s, i) => s + i.amount, 0)
  const services_total = invoice.line_items
    .filter(i => i.charge_type === 'service')
    .reduce((s, i) => s + i.amount, 0)

  return {
    handling_total:  Math.round(handling_total * 100) / 100,
    surcharge_total: Math.round(surcharge_total * 100) / 100,
    storage_total:   Math.round(storage_total * 100) / 100,
    services_total:  Math.round(services_total * 100) / 100,
    grand_total:     invoice.subtotal,
    line_item_count: invoice.line_items.length,
  }
}
```

### Regional Rate Summary

| Region | Handling Mult | Storage Mult | Services Mult | Example Vessel Load 40ft |
|--------|--------------|-------------|--------------|------------------------|
| Europe (baseline) | 1.0x | 1.0x | 1.0x | $275 |
| Asia (competitive) | 0.7x | 0.65x | 0.75x | $193 |
| Americas (premium) | 1.35x | 1.3x | 1.25x | $371 |

---

## Quick Reference: All Exported Types

```ts
// Enums / unions
export type { ChargeBasis, ChargeCategory, MoveType, ContainerSize }
export type { SurchargeType, RateType, ServiceType, CargoClass }
export type { VisitType, InvoiceStatus, TariffRegion }

// Core charge interfaces
export type { HandlingCharge, Surcharge, ServiceCharge }
export type { StoragePolicy, StorageTier }
export type { CargoClassModifier }

// Financial tracking
export type { TerminalFinancials, RevenueByCategoryBreakdown, CostByCategoryBreakdown }

// Invoicing
export type { Invoice, InvoiceLineItem, ContainerEvent, TariffBook }
export type { TotalChargesResult }

// Constants
export { DEFAULT_HANDLING_CHARGES, DEFAULT_SURCHARGES }
export { DEFAULT_STORAGE_POLICIES, DEFAULT_SERVICE_CHARGES }
export { CARGO_CLASS_MODIFIERS, FINANCIAL_BENCHMARKS }

// Functions
export { findHandlingCharge, applySurcharge, applySurcharges }
export { calculateStorageCost }
export { getCargoModifier, applyCargoModifier }
export { computeProfitMargin, createFinancialSnapshot }
export { generateInvoice }
export { createTariffBook, createStoragePolicy, createInvoice, calculateTotalCharges }
```
