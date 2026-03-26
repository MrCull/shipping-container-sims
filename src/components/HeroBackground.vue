<script setup lang="ts">
import { ref, watch } from 'vue'
import { useThreeScene, type ThreeSceneContext } from '@/composables/useThreeScene'
import * as THREE from 'three'

const canvas = ref<HTMLCanvasElement | null>(null)
const containers: THREE.Mesh[] = []

const sceneCtx = useThreeScene(canvas, (ctx, delta) => {
  containers.forEach((c, i) => {
    c.rotation.y += delta * 0.3
    c.position.y = Math.sin(Date.now() * 0.001 + i * 1.2) * 0.3 + c.userData.baseY
  })
  ctx.camera.position.x = Math.sin(Date.now() * 0.0002) * 2
  ctx.camera.lookAt(0, 0, 0)
})

watch(sceneCtx, (ctx: ThreeSceneContext | null) => {
  if (!ctx) return

  ctx.scene.fog = new THREE.FogExp2(0x0a0e1a, 0.06)

  const ambient = new THREE.AmbientLight(0x4466aa, 0.6)
  ctx.scene.add(ambient)

  const directional = new THREE.DirectionalLight(0xffffff, 1.2)
  directional.position.set(5, 10, 7)
  ctx.scene.add(directional)

  const colors = [0x3b82f6, 0xef4444, 0x10b981, 0xf59e0b, 0x8b5cf6]

  for (let i = 0; i < 12; i++) {
    const w = 2.4 + Math.random() * 0.5
    const h = 2.6
    const d = 1.2
    const geo = new THREE.BoxGeometry(w, h, d)
    const mat = new THREE.MeshStandardMaterial({
      color: colors[i % colors.length],
      metalness: 0.4,
      roughness: 0.6,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(
      (Math.random() - 0.5) * 20,
      (Math.random() - 0.5) * 6,
      -5 - Math.random() * 15
    )
    mesh.rotation.set(
      Math.random() * 0.4,
      Math.random() * Math.PI,
      Math.random() * 0.2
    )
    mesh.userData.baseY = mesh.position.y
    containers.push(mesh)
    ctx.scene.add(mesh)
  }

  ctx.camera.position.set(0, 2, 12)
}, { once: true })
</script>

<template>
  <canvas ref="canvas" class="hero-canvas" />
</template>

<style scoped>
.hero-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
}
</style>
