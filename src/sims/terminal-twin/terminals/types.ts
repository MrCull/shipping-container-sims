/**
 * Per-terminal folders (spec #116, ticket #120). A real terminal's layout constants, presets' presentation and
 * scenery live in `terminals/<id>/`; generic modules ask the registry (`terminals/index.ts`) instead of comparing
 * preset names. A scenario no terminal claims renders the generic coastline and no terminal-specific behaviour.
 */
import type * as THREE from 'three'
import type { MessageKey } from '../i18n/messages'
import type { InfraAssetName } from '../modules/infrastructureAssets'

/** What a scenery builder gets to add its procedural parts with (scene axes: quay along +x, water towards -z). */
export interface SceneryContext {
  group: THREE.Group
  /** Quay length (m) of the scenario. */
  quayLengthM: number
  /** Flat-shaded, disposed with the backdrop. */
  flat(color: string): THREE.Material
  /** Adds a named mesh at a position; its geometry is disposed with the backdrop. */
  add(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh
  /** Registers something to dispose with the backdrop. */
  track(thing: { dispose(): void }): void
}

/** The distant scenery of one terminal (or the generic coastline). */
export interface TerminalScenery {
  /** Reported by `__tt.atmosphere().scene.backdrop.kind`. */
  kind: string
  /** Named parts the builder adds (dev API / tests). */
  parts: string[]
  /** Parts a phase 2 GLB replaces once loaded: part name to asset. Parts not listed stay procedural. */
  modelParts: Partial<Record<string, InfraAssetName>>
  /** Fog far distance (m): far enough that the farthest scenery is hazy, not erased. */
  fogFarM: number
  /**
   * Where the opening camera stands relative to the overview target (scene metres, +z landward). A low, seaward-facing
   * pose shows the scenery on the horizon; absent = the generic three-quarter pose from above.
   */
  defaultCameraOffset?: { x: number; y: number; z: number }
  build(ctx: SceneryContext): void
}

/** How the UI and renderer treat one named preset of a terminal. */
export interface TerminalPresetInfo {
  /** Catalogue keys of its plain name, tagline, description and what to watch (start screen, #145). */
  copy: { name: MessageKey; tagline: MessageKey; description: MessageKey; watch: MessageKey }
  /** The bay count comes from a published capacity, not a layout drawing: the setup dialog says so. */
  derivedBays?: boolean
}

export interface TerminalProfile {
  id: string
  label: string
  /** Presets of this terminal, by preset name. */
  presets: Record<string, TerminalPresetInfo>
  scenery: TerminalScenery
}
