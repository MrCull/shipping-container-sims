/**
 * Contact shadows (#248): a cheap, local darkening where a container meets the ground or the box below, done in the
 * container material's fragment shader from the box-local height (no extra pass, no extra draw). Boxes are modelled
 * with their origin at the bottom, so the lowest `CONTACT_HEIGHT_M` of every face gets a soft ramp from dark to clear.
 * One shared uniform turns it off (the Low quality level), so no material is rebuilt.
 */
import type * as THREE from 'three'

/** Height (m) over which the darkening fades out. */
export const CONTACT_HEIGHT_M = 0.7
/** Darkest factor taken off the colour at the very bottom edge (0 to 1). */
export const CONTACT_STRENGTH = 0.5

/** The on/off strength shared by every patched material: 0 = off. */
export const contactShadowUniform = { value: CONTACT_STRENGTH }

export function setContactShadows(on: boolean): void {
  contactShadowUniform.value = on ? CONTACT_STRENGTH : 0
}

/** Brightness factor (1 = untouched) at height `y` metres above the box bottom: the GLSL ramp, in TypeScript, for tests. */
export function contactFactor(y: number, strength: number = CONTACT_STRENGTH): number {
  const t = Math.min(1, Math.max(0, y / CONTACT_HEIGHT_M))
  const ramp = t * t * (3 - 2 * t)
  return 1 - strength * (1 - ramp)
}

/** Adds the contact darkening to a material's shader (call from inside its `onBeforeCompile`, after any other patch). */
export function patchContactShadow(shader: { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string }): void {
  shader.uniforms.contactStrength = contactShadowUniform
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying float vBoxY;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBoxY = position.y;')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vBoxY;\nuniform float contactStrength;')
    .replace(
      '#include <opaque_fragment>',
      `float contactT = clamp(vBoxY / ${CONTACT_HEIGHT_M.toFixed(2)}, 0.0, 1.0);
outgoingLight *= 1.0 - contactStrength * (1.0 - contactT * contactT * (3.0 - 2.0 * contactT));
#include <opaque_fragment>`,
    )
}
