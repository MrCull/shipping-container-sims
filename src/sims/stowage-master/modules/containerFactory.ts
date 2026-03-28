import type { Container, WeightCategory } from '../types'
import { CONTAINER, PORTS } from './config'

const OWNER_CODES = ['MAEU', 'MSCU', 'CMAU', 'HLCU', 'EGLV', 'OOLU', 'COSU', 'YMLU']
let serialCounter = 0

function generateCheckDigit(code: string): number {
  const values: Record<string, number> = {}
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  chars.split('').forEach((c, i) => { values[c] = i < 11 ? i : i + 1 })
  let sum = 0
  for (let i = 0; i < 10; i++) {
    sum += (values[code[i]] || 0) * Math.pow(2, i)
  }
  return (sum % 11) % 10
}

export function generateContainerId(): string {
  const owner = OWNER_CODES[Math.floor(Math.random() * OWNER_CODES.length)]
  const serial = String(++serialCounter).padStart(6, '0')
  const base = owner + serial
  const check = generateCheckDigit(base)
  return base + check
}

export function generateWeight(): number {
  const rand = Math.random()
  if (rand < 0.3) {
    return CONTAINER.lightMin + Math.random() * (CONTAINER.lightMax - CONTAINER.lightMin)
  } else if (rand < 0.7) {
    return CONTAINER.mediumMin + Math.random() * (CONTAINER.mediumMax - CONTAINER.mediumMin)
  } else {
    return CONTAINER.heavyMin + Math.random() * (CONTAINER.heavyMax - CONTAINER.heavyMin)
  }
}

export function getWeightCategory(weight: number): WeightCategory {
  if (weight <= CONTAINER.lightMax) return 'light'
  if (weight <= CONTAINER.mediumMax) return 'medium'
  return 'heavy'
}

export function createContainer(index: number, _totalContainers: number, hazmatRate: number): Container {
  const weight = Math.round(generateWeight() * 10) / 10
  const port = PORTS[index % PORTS.length]
  const isHazmat = Math.random() < hazmatRate

  return {
    id: generateContainerId(),
    weight,
    weightCategory: getWeightCategory(weight),
    port: port.name,
    portColor: port.color,
    portHex: port.hex,
    portOrder: port.order,
    isHazmat,
    isImport: false,
  }
}

export function generateContainerList(count: number, hazmatRate: number = CONTAINER.hazmatRate): Container[] {
  const containers: Container[] = []
  for (let i = 0; i < count; i++) {
    containers.push(createContainer(i, count, hazmatRate))
  }
  return containers
}

export function resetSerialCounter(): void {
  serialCounter = 0
}
