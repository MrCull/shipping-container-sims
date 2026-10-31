/**
 * Floating status labels over vessels that are not yet working (#126): "V003 · Mooring · 24:52". One sprite per vessel,
 * shown while its status is waiting for berth or mooring (a vessel that has not arrived is not in the scene, so has no
 * label), hidden as soon as operations start. Colours come from the skin tokens (`--tt-*` on `.terminal-twin`); the
 * canvas is redrawn only when the text changes. Three.js objects stay out of Vue reactivity.
 */
import * as THREE from 'three'
import { t } from '../i18n/messages'
import { entityBounds } from './picking'
import type { SceneModel } from './sceneModel'
import { buildVesselStatus, formatCountdown, vesselStatusInputFromModel, type VesselLabel } from './vesselStatus'

const W_PX = 360
const H_PX = 72
const W_M = 40
const H_M = (W_M * H_PX) / W_PX

/** What one label says now (dev API `scene().vesselLabels`). */
export interface VesselLabelState {
  id: string
  phase: string
  countdownS: number | null
  text: string
}

export function vesselLabelText(id: string, label: VesselLabel): string {
  const phase = t(`vesselStatus.phase.${label.phase}`)
  return label.countdownS === null ? t('vesselStatus.labelNoCountdown', { id, phase }) : t('vesselStatus.label', { id, phase, countdown: formatCountdown(label.countdownS) })
}

function token(name: string, fallback: string): string {
  try {
    const el = document.querySelector('.terminal-twin') ?? document.documentElement
    return getComputedStyle(el).getPropertyValue(name).trim() || fallback
  } catch {
    return fallback
  }
}

interface Entry {
  sprite: THREE.Sprite
  canvas: HTMLCanvasElement
  texture: THREE.CanvasTexture
  text: string
}

export class VesselCountdownLabels {
  readonly group = new THREE.Group()
  private entries = new Map<string, Entry>()
  private shown: VesselLabelState[] = []
  private colours: { fill: string; stroke: string; ink: string } | null = null

  constructor(private readonly model: SceneModel) {}

  private entry(id: string): Entry {
    let e = this.entries.get(id)
    if (e) return e
    const canvas = document.createElement('canvas')
    canvas.width = W_PX
    canvas.height = H_PX
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }))
    sprite.scale.set(W_M, H_M, 1)
    sprite.renderOrder = 11
    sprite.visible = false
    sprite.name = `countdown:${id}`
    this.group.add(sprite)
    e = { sprite, canvas, texture, text: '' }
    this.entries.set(id, e)
    return e
  }

  private draw(e: Entry, text: string): void {
    this.colours ??= { fill: token('--tt-surface', '#fafbfd'), stroke: token('--tt-accent', '#1f5fbf'), ink: token('--tt-text', '#14253f') }
    const ctx = e.canvas.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, W_PX, H_PX)
      ctx.fillStyle = this.colours.fill
      ctx.fillRect(0, 0, W_PX, H_PX)
      ctx.strokeStyle = this.colours.stroke
      ctx.lineWidth = 4
      ctx.strokeRect(2, 2, W_PX - 4, H_PX - 4)
      ctx.fillStyle = this.colours.ink
      ctx.font = '600 30px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, W_PX / 2, H_PX / 2, W_PX - 16)
    }
    e.texture.needsUpdate = true
    e.text = text
  }

  update(time: number): void {
    const shown: VesselLabelState[] = []
    for (const id of this.model.vesselIds) {
      const existing = this.entries.get(id)
      const view = buildVesselStatus(vesselStatusInputFromModel(this.model, id, time), time)
      const b = view.label && view.phase !== 'approaching' ? entityBounds(this.model, id, time) : null
      if (!view.label || !b) {
        if (existing) existing.sprite.visible = false
        continue
      }
      const entry = existing ?? this.entry(id)
      const text = vesselLabelText(id, view.label)
      if (entry.text !== text) this.draw(entry, text)
      entry.sprite.position.set(b.x, b.y + b.sy / 2 + H_M, b.z)
      entry.sprite.visible = true
      shown.push({ id, phase: view.phase, countdownS: view.label.countdownS, text })
    }
    this.shown = shown
  }

  states(): VesselLabelState[] {
    return this.shown.map((s) => ({ ...s }))
  }

  dispose(): void {
    for (const e of this.entries.values()) {
      e.texture.dispose()
      e.sprite.material.dispose()
    }
    this.entries.clear()
  }
}
