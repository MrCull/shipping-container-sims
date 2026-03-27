// ---------------------------------------------------------------------------
// Box Empire — Floating text popup sprites (money earned, etc.)
// ---------------------------------------------------------------------------

import * as THREE from 'three'
import type { Position3D } from '../types'

interface FloatingText {
  id: string
  text: string
  color: string
  sprite: THREE.Sprite
  createdAt: number
  duration: number
  startY: number
}

let textCounter = 0

function buildSpriteTexture(text: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')!

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.font = 'bold 36px sans-serif'
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0,0,0,0.8)'
  ctx.shadowBlur = 6
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)

  return new THREE.CanvasTexture(canvas)
}

export class FloatingTextRenderer {
  private active: FloatingText[] = []
  private scene: THREE.Scene

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  spawn(text: string, color: string, worldPos: Position3D): void {
    textCounter++
    const texture = buildSpriteTexture(text, color)
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(6, 1.5, 1)
    sprite.position.set(worldPos.x, worldPos.y + 3, worldPos.z)
    this.scene.add(sprite)

    this.active.push({
      id: `ft-${textCounter}`,
      text,
      color,
      sprite,
      createdAt: performance.now(),
      duration: 2000,
      startY: sprite.position.y,
    })
  }

  update(): void {
    const now = performance.now()
    const toRemove: number[] = []

    for (let i = 0; i < this.active.length; i++) {
      const ft = this.active[i]
      const elapsed = now - ft.createdAt
      const t = elapsed / ft.duration

      if (t >= 1) {
        toRemove.push(i)
        continue
      }

      // Drift upward and fade out
      ft.sprite.position.y = ft.startY + t * 4
      const mat = ft.sprite.material as THREE.SpriteMaterial
      mat.opacity = 1 - t
    }

    for (let i = toRemove.length - 1; i >= 0; i--) {
      const idx = toRemove[i]
      const ft = this.active[idx]
      ft.sprite.material.dispose()
      const mat = ft.sprite.material as THREE.SpriteMaterial
      mat.map?.dispose()
      this.scene.remove(ft.sprite)
      this.active.splice(idx, 1)
    }
  }

  dispose(): void {
    for (const ft of this.active) {
      const mat = ft.sprite.material as THREE.SpriteMaterial
      mat.map?.dispose()
      mat.dispose()
      this.scene.remove(ft.sprite)
    }
    this.active = []
  }
}
