/**
 * The 3D view's perspective camera settings, in one place for `useTwinScene` and for tests that rebuild the view's
 * camera from a `CameraPose` (unit tests and smoke specs read where a world point lands on the canvas).
 */
import * as THREE from 'three'
import type { CameraPose } from './cameraKeys'

/** Vertical field of view (degrees) and clip planes (metres) of the 3D view's camera. */
export const SCENE_CAMERA = { fovDeg: 45, near: 1, far: 14000 } as const

/** A new camera with the view's settings for a canvas of the given aspect ratio. */
export function sceneCamera(aspect: number): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(SCENE_CAMERA.fovDeg, aspect, SCENE_CAMERA.near, SCENE_CAMERA.far)
}

/** The view's camera placed at an orbit pose, looking at its target, on a canvas of `width` by `height` px. */
export function cameraAtPose(pose: CameraPose, width: number, height: number): THREE.PerspectiveCamera {
  const camera = sceneCamera(width / height)
  const target = new THREE.Vector3(pose.target.x, pose.target.y, pose.target.z)
  camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(pose.distance, pose.polar, pose.azimuth)))
  camera.lookAt(target)
  camera.updateMatrixWorld()
  return camera
}

/** Canvas pixel where a world point lands. */
export function canvasPixelOf(camera: THREE.PerspectiveCamera, p: THREE.Vector3, width: number, height: number): { x: number; y: number } {
  camera.updateMatrixWorld()
  const v = p.clone().project(camera)
  return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height }
}
