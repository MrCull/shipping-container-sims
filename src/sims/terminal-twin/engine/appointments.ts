/**
 * Truck appointment planning (TT-R15), pure: books windows from the hourly profile, bunching spans and the
 * per-window cap. The landside subsystem schedules one `TruckArrivalDue` per booking at ScenarioStarted.
 *
 * Demand per window = profile rate at the window's clock hour x window length x the bunching factors of the spans
 * that overlap it. The expected count is rounded with one draw (floor + Bernoulli of the fraction). Demand above the
 * window's cap is rejected and counted: the generator never books beyond a cap.
 */
import type { AppointmentConfig, ScenarioConfig, TruckTransactionKind } from '../scenario/types'
import { pickWeighted } from '../scenario/bayPlan'
import { HOUR_S, kpiClockOf } from './kpi/clock'
import type { Appointment } from './state'
import { blockSpecs } from './yardLayout'

export const DEFAULT_APPOINTMENT_WINDOW_S = 1800
/** [A] Mean seconds a truck occupies a transfer stall. */
export const DEFAULT_STALL_SERVICE_S = 300
const DEFAULT_HORIZON_S = 24 * HOUR_S

const appointmentsOf = (config: ScenarioConfig): AppointmentConfig => config.landside?.appointments ?? {}
export const appointmentWindowS = (config: ScenarioConfig): number => appointmentsOf(config).windowS ?? DEFAULT_APPOINTMENT_WINDOW_S

/** Most trucks one window can take: the smaller of gate throughput and transfer stall throughput (and `maxPerWindow`). */
export function appointmentCap(config: ScenarioConfig): number {
  const a = appointmentsOf(config)
  const windowS = appointmentWindowS(config)
  const gate = config.landside?.gate
  const gateCap = gate ? Math.floor((gate.inLanes * windowS) / Math.max(1, gate.inProcessingS)) : Infinity
  const stalls = blockSpecs(config).reduce((n, b) => n + b.transferStalls, 0)
  const stallCap = Math.floor((stalls * windowS) / Math.max(1, a.stallServiceS ?? DEFAULT_STALL_SERVICE_S))
  return Math.max(0, Math.min(gateCap, stallCap, a.maxPerWindow ?? Infinity))
}

export function appointmentHorizonS(config: ScenarioConfig): number {
  const a = appointmentsOf(config)
  if (a.horizonS !== undefined) return a.horizonS
  const end = config.endConditions?.simDurationS
  if (end === undefined) return DEFAULT_HORIZON_S
  return end + (config.yardStart?.mode === 'warmup' ? (config.yardStart.warmUpS ?? 48 * HOUR_S) : 0)
}

export interface AppointmentPlan {
  appointments: Appointment[]
  /** Bookings refused because their window was full. */
  rejected: number
  capPerWindow: number
  windows: number
}

/** Book every window of the horizon. `random` is uniform [0, 1) (the landside RNG stream in the engine). */
export function planAppointments(config: ScenarioConfig, random: () => number): AppointmentPlan {
  const cfg = config.landside
  const a = appointmentsOf(config)
  const windowS = appointmentWindowS(config)
  const cap = appointmentCap(config)
  const windows = Math.ceil(appointmentHorizonS(config) / windowS)
  const clock = kpiClockOf(config)
  const appointments: Appointment[] = []
  let rejected = 0
  for (let w = 0; w < windows; w++) {
    const startS = w * windowS
    const hour = Math.floor((clock.startTimeOfDayS + startS) / HOUR_S)
    const rate = cfg?.hourlyProfile[((hour % 24) + 24) % 24] ?? 0
    const factor = (a.bunching ?? []).filter((s) => s.fromS < startS + windowS && s.toS > startS).reduce((f, s) => f * s.factor, 1)
    const expected = (rate * windowS * factor) / HOUR_S
    const demand = Math.floor(expected) + (random() < expected - Math.floor(expected) ? 1 : 0)
    const booked = Math.min(demand, cap)
    rejected += demand - booked
    for (let i = 0; i < booked; i++) {
      const arriveAtS = Math.round((startS + random() * windowS) * 1000) / 1000
      const transaction = cfg ? pickWeighted<TruckTransactionKind>(cfg.mix, random) : 'dropEmpty'
      appointments.push({ id: '', windowIndex: w, arriveAtS, transaction })
    }
  }
  appointments.sort((x, y) => x.arriveAtS - y.arriveAtS)
  appointments.forEach((ap, i) => (ap.id = `A${String(i + 1).padStart(4, '0')}`))
  return { appointments, rejected, capPerWindow: cap, windows }
}
