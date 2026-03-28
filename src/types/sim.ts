import type { Component } from 'vue'

export type SimStatus = 'playable' | 'coming-soon' | 'wip'

export interface SimDefinition {
  id: string
  title: string
  tagline: string
  description: string
  icon: string
  /** Optional raster/vector URL for home cards and in-sim branding (Vite: `?url` import). */
  logoSrc?: string
  status: SimStatus
  color: string
  tags: string[]
  order?: number
  component: () => Promise<{ default: Component }>
}
