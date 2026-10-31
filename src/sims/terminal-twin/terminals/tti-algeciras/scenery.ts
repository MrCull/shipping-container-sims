/**
 * TTI Algeciras scenery: the Rock of Gibraltar across the bay (true scale and placement), the Algeciras hills behind
 * the terminal, the Spanish coast running away from the Rock and the 550 m North Quay rendered non-operational.
 * Scene axes: quay along +x (south), water towards -z (east). The phase 2 GLBs (`backdrop-rock`, `-hills`, `-coast`)
 * replace the procedural Rock, hills and coast; the North Quay stays procedural. Ticket #123 adds the surroundings: the
 * Gibraltar and La Linea shore, vessels at anchor, storage tanks, the Isla Verde road and rail with warehouses, and the
 * town inland (`scenery-*` GLBs, one merged mesh and one draw call each; `SURROUNDINGS` holds placement and budget). Until
 * a GLB loads each part is a few merged boxes in the same place.
 */
type Box = [x: number, y: number, z: number, w: number, h: number, d: number]

/** Merged flat boxes (centre and size): the stand-in a part shows until its GLB loads. */
function boxes(list: Box[]): THREE.BufferGeometry {
  const parts = list.map(([x, y, z, w, h, d]) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z))
  const merged = mergeGeometries(parts)!
  for (const g of parts) g.dispose()
  return merged
}

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { jaggedRidge, ridge } from '../../modules/backdropGeometry'
import type { SceneryContext, TerminalScenery } from '../types'
import { NORTH_QUAY_LENGTH_M, ROCK, SURROUNDINGS } from './constants'

export const TTI_SCENERY: TerminalScenery = {
  kind: 'tti',
  parts: ['land', 'coast', 'rock', 'hills', 'northQuay', 'shore', 'anchorage', 'tanks', 'landside', 'town'],
  modelParts: {
    rock: 'backdrop-rock',
    hills: 'backdrop-hills',
    coast: 'backdrop-coast',
    shore: 'scenery-shore',
    anchorage: 'scenery-anchorage',
    tanks: 'scenery-tanks',
    landside: 'scenery-landside',
    town: 'scenery-town',
  },
  // The Rock's far foot is ~9.8 km out; at 24 km the fog is still only ~40% there, so it reads as haze, not a sky-coloured void.
  fogFarM: 24000,
  // From the apron, a low pose facing the water (about 12 degrees down): the Rock sits on the horizon, 33 degrees wide, in the frame.
  defaultCameraOffset: { x: 40, y: 45, z: 210 },
  build(ctx: SceneryContext): void {
    const midX = ctx.quayLengthM / 2
    // The Rock: procedural fallback is the silhouette extruded across its width; the GLB adds the cross-section.
    ctx.add('rock', ridge(ROCK.profile, ROCK.widthM), ctx.flat('#8f9288'), midX + ROCK.offsetSouthM, 0, -ROCK.distanceM)
    // The low isthmus and Spanish coast running away from the Rock.
    ctx.add('coast', ridge(jaggedRidge(6000, 300, 6, 26, 11), 500), ctx.flat('#8a8f77'), midX + 7200, -0.5, -6200)
    // The Algeciras hills behind the terminal.
    ctx.add('hills', ridge(jaggedRidge(9000, 450, 150, 480, 7), 900), ctx.flat('#6a7358'), midX - 800, -1, 4300)
    // The surroundings (#123): stand-ins here, the GLBs carry the detail.
    const at = SURROUNDINGS
    ctx.add('shore', boxes([[-1500, 0, 540, 5800, 6, 400], [-4900, 0, 1000, 2900, 6, 1400]]), ctx.flat('#b9ae8a'), midX + at.shore.x, at.shore.y, at.shore.z)
    ctx.add('anchorage', boxes([[-2900, 0, -900, 245, 12, 42], [-300, 0, 1300, 330, 14, 58], [1500, 0, 1500, 260, 14, 40], [3100, 0, 900, 200, 10, 32]]), ctx.flat('#3a3f46'), midX + at.anchorage.x, at.anchorage.y, at.anchorage.z)
    ctx.add('tanks', boxes([[-100, 0, 0, 220, 20, 90], [100, 0, 0, 120, 20, 90]]), ctx.flat('#d8d8d4'), at.tanks.x, at.tanks.y, at.tanks.z)
    ctx.add('landside', boxes([[0, 0, -10, 6000, 0.1, 30], [0, 0, 12, 6000, 0.3, 16]]), ctx.flat('#4a4d52'), midX + at.landside.x, at.landside.y, at.landside.z)
    ctx.add('town', boxes([[0, 0, 1300, 7000, 25, 2400]]), ctx.flat('#a8a28a'), midX + at.town.x, at.town.y, at.town.z)
    // North Quay: 550 m of bare quay beside the working berths, no cranes, no lights.
    const north = new THREE.Group()
    north.name = 'northQuay'
    const x0 = ctx.quayLengthM + 70 + NORTH_QUAY_LENGTH_M / 2
    const slabGeo = new THREE.BoxGeometry(NORTH_QUAY_LENGTH_M, 0.3, 70)
    const slab = new THREE.Mesh(slabGeo, ctx.flat('#838a93'))
    slab.position.set(x0, 0.06, 38)
    slab.receiveShadow = true
    const edgeGeo = new THREE.BoxGeometry(NORTH_QUAY_LENGTH_M, 0.32, 1)
    const edge = new THREE.Mesh(edgeGeo, ctx.flat('#6f6a55'))
    edge.position.set(x0, 0.08, 2)
    const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.5, 1.1, 6), ctx.flat('#4a4d52'), 12)
    const m = new THREE.Matrix4()
    for (let i = 0; i < 12; i++) {
      m.makeTranslation(x0 - NORTH_QUAY_LENGTH_M / 2 + 25 + i * 45, 0.7, 4)
      posts.setMatrixAt(i, m)
    }
    ctx.track(slabGeo)
    ctx.track(edgeGeo)
    ctx.track(posts.geometry)
    north.add(slab, edge, posts)
    ctx.group.add(north)
  },
}
