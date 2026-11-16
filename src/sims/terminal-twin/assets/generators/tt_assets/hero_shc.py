"""Hero SHC body (#275): a detailed shuttle carrier body, shown in place of `shc.glb` LOD0 near the camera.

The body is `shc.py` LOD0 without the `spreader` subtree (spreader and its four twist-locks): the #273 hero spreader
already replaces those under LOD0's `spreader` node and keeps working unchanged. Same root frame as `shc.glb` (origin =
ground contact below the frame centre, Blender X = front, Z = up), same rig node names, pivots and axes, imported from
`shc.py` rather than copied:

  hero-shc > LOD0 > frame                      static: shc.py frame + leg stiffeners, cab glazing bars, wipers,
                                               second mirror, cab handrails, leg-head sprockets, bumper warning bands
                    plates                     fleet-number plates, material shc_plate (the renderer finds it by name)
                    steer_fl|fr|rl|rr > steer_*_geo
                      wheel_* > wheel_*_geo    tyre with geometric chevron tread lugs, sidewall ribs, rim with 10 nuts
                    hoist > hoist_geo          shc.py hoist + chain stubs and hazard bands on the beam ends

Rig nodes are empties at the pivot with the mesh in `<name>_geo` (as in shc.glb). Two materials, the shc.glb atlas
(`shc_atlas`) and plates (`shc_plate`): 11 meshes, 11 draw calls. Deterministic.
"""
import math

from . import shc as S
from .blender import empty, textured_material

NAME = 'hero-shc'
LUGS = 36          # chevron tread lugs per tyre half
TYRE_SEGS = 72
NUTS = 10


# ---- wheel -------------------------------------------------------------------
def _sector_block(p, a0, a1, r0, r1, y0, y1, swatch):
    """A block between two angles about the Blender Y axle, radii r0..r1, axle offsets y0..y1 (no inner face)."""
    def pt(r, y, a):
        return (r * math.cos(a), y, r * math.sin(a))
    uv = [S.ATLAS_SPEC.swatch_uv(swatch)] * 4
    am = (a0 + a1) / 2
    radial = (math.cos(am), 0, math.sin(am))
    p.m.quad([pt(r1, y0, a0), pt(r1, y0, a1), pt(r1, y1, a1), pt(r1, y1, a0)], uv, outward=radial)
    for a, s in ((a0, -1), (a1, 1)):
        tangent = (-math.sin(a) * s, 0, math.cos(a) * s)
        p.m.quad([pt(r0, y0, a), pt(r1, y0, a), pt(r1, y1, a), pt(r0, y1, a)], uv, outward=tangent)
    for y, s in ((y0, -1), (y1, 1)):
        p.m.quad([pt(r0, y, a0), pt(r1, y, a0), pt(r1, y, a1), pt(r0, y, a1)], uv, outward=(0, s, 0))


def wheel_mesh():
    """One large single tyre on a white rim, axle origin, rolls about Blender Y. The tread is a recessed band with raised
    chevron lugs reaching the full tyre radius (S.TYRE_R), so the rolling radius and the bounds match shc.glb."""
    p = S.Part()
    w, r = S.TYRE_W / 2, S.TYRE_R
    base = r - 0.035
    prof = [(0.2, -w, 'a-', 'steel'), (0.34, -w, 'a-', 'white'), (0.66, -w, 'a-', 'rubber'), (r - 0.14, -w, 'r', 'rubber'),
            (r - 0.03, -w * 0.9, 'r', 'rubber'), (base, -w * 0.78, 'r', 'black'), (base, w * 0.78, 'r', 'rubber'),
            (r - 0.03, w * 0.9, 'a+', 'rubber'), (r - 0.14, w, 'a+', 'rubber'), (0.66, w, 'a+', 'white'), (0.34, w, 'a+', 'steel'), (0.2, w, 'a+', 'steel')]
    p.revolve((0, 0, 0), 'y', prof, TYRE_SEGS, lambda k, e: prof[e][3])
    pitch = 2 * math.pi / LUGS
    for i in range(LUGS):
        for side, off in ((-1, 0.0), (1, 0.5)):   # staggered halves read as a chevron
            a0 = (i + off) * pitch
            y0, y1 = (-w * 0.8, -w * 0.06) if side < 0 else (w * 0.06, w * 0.8)
            _sector_block(p, a0, a0 + pitch * 0.55, base - 0.005, r, y0, y1, 'rubber')
    for sgn in (-1, 1):
        face = 'a+' if sgn > 0 else 'a-'
        # sidewall: a raised lettering band ring
        p.revolve((0, 0, 0), 'y', [(r - 0.22, sgn * w, 'r', 'rubber'), (r - 0.22, sgn * (w + 0.012), face, 'black'),
                                    (r - 0.3, sgn * (w + 0.012), 'ri', 'black'), (r - 0.3, sgn * w, face, 'rubber')], 36, lambda k, e: 'black' if k % 3 else 'rubber')
        # rim: dished white disc, hub cap and a ring of wheel nuts
        p.revolve((0, 0, 0), 'y', [(0.42, sgn * w, 'r', 'white'), (0.42, sgn * (w + 0.02), face, 'white'), (0.2, sgn * (w + 0.02), face, 'white')], 24, lambda k, e: 'white')
        p.revolve((0, 0, 0), 'y', [(0.22, sgn * (w + 0.02), 'r', 'dark'), (0.22, sgn * (w + 0.06), face, 'dark'),
                                    (0.08, sgn * (w + 0.08), face, 'steel'), (0.0, sgn * (w + 0.08), face, 'steel')], 12, lambda k, e: 'dark' if e == 0 else 'steel')
        for i in range(NUTS):
            a = i * 2 * math.pi / NUTS
            x, z = 0.29 * math.cos(a), 0.29 * math.sin(a)
            p.revolve((x, 0, z), 'y', [(0.032, sgn * (w + 0.02), 'r', 'zinc'), (0.032, sgn * (w + 0.055), face, 'zinc'), (0.0, sgn * (w + 0.055), face, 'zinc')],
                      6, lambda k, e: 'zinc')
    return p


# ---- steering, hoist ---------------------------------------------------------
def steer_mesh():
    p = S.steer_mesh(0)
    fork_y = S.TYRE_W / 2 + 0.07
    top = 1.75 - S.AXLE_Z
    for sy in (-1, 1):   # fork-leg stiffeners and a grease line to the knuckle
        p.box((0.3, sy * fork_y - 0.05, -0.2), (0.34, sy * fork_y + 0.05, top), 'red_dark', ('+x', '+y', '-y'))
        p.box((-0.34, sy * fork_y - 0.05, -0.2), (-0.3, sy * fork_y + 0.05, top), 'red_dark', ('-x', '+y', '-y'))
    p.beam((-0.45, -0.3, top + 0.2), (-0.45, 0.3, top + 0.2), 0.12, 0.12, 'zinc')   # steering cylinder
    return p


def hoist_mesh():
    p = S.hoist_mesh(0)
    z0 = 0.5
    for sx in (-1, 1):
        for sy in (-1, 1):
            # hazard bands on the beam ends, outer faces (clear of the guide shoes at x = +-3.0)
            p.plate((sx * 2.5 + sy * 0.3, sy * 1.94, z0 + 0.04), (-sy, 0, 0), (0, 0, 1), 0.6, 0.37, 'hazard', normal=(0, sy, 0))
            # hoist chain from the frame corner up to the sprockets (travels with the frame), links as alternating plates
            cx, cy = sx * 2.83, sy * 1.8
            for k in range(6):
                z = z0 + 0.5 + k * 0.1
                if k % 2 == 0:
                    p.box((cx - 0.04, cy - 0.012, z), (cx + 0.04, cy + 0.012, z + 0.11), 'steel')
                else:
                    p.box((cx - 0.012, cy - 0.04, z), (cx + 0.012, cy + 0.04, z + 0.11), 'steel')
    return p


# ---- frame -------------------------------------------------------------------
def frame_mesh():
    p = S.frame_mesh(0)
    LW = S.LEG_W / 2
    for _, sx, sy in S.CORNERS:
        cx, cy = sx * S.LEG_X, sy * S.LEG_Y
        # leg plates: vertical stiffeners on the end face above the hazard bands, and horizontal diaphragm lips
        xe = cx + sx * LW
        for dy in (-0.22, 0.22):
            p.box((min(xe, xe + sx * 0.05), cy + dy - 0.025, S.SILL_Z1 + 1.55), (max(xe, xe + sx * 0.05), cy + dy + 0.025, S.TOP_UNDER - 0.1), 'red_dark', ('+x' if sx > 0 else '-x', '+y', '-y', '+z', '-z'))
        for z in (5.0, 5.8):
            p.box((min(xe, xe + sx * 0.05), cy - 0.3, z), (max(xe, xe + sx * 0.05), cy + 0.3, z + 0.05), 'red_dark', ('+x' if sx > 0 else '-x', '+z', '-z'))
        # chain sprocket at the leg head, inner face: a toothed disc on a shaft
        iy = cy - sy * (LW + 0.12)
        p.revolve((cx - sx * 0.25, iy, S.TOP_UNDER - 0.3), 'y', [(0.0, -0.04, 'a-', 'dark'), (0.2, -0.04, 'r', 'dark'), (0.2, 0.04, 'a+', 'dark'), (0.0, 0.04, 'a+', 'dark')],
                  16, lambda k, e: 'dark')
        for t in range(12):
            a = t * math.pi / 6
            px, pz = cx - sx * 0.25 + 0.22 * math.cos(a), S.TOP_UNDER - 0.3 + 0.22 * math.sin(a)
            p.cbox((px, iy, pz), (0.05, 0.06, 0.05), 'steel')
        p.beam((cx - sx * 0.25, cy - sy * LW, S.TOP_UNDER - 0.3), (cx - sx * 0.25, iy - sy * 0.06, S.TOP_UNDER - 0.3), 0.07, 0.07, 'zinc')
    cx0, cx1, cy0, cy1, cz0 = S.CAB
    ch = S.CAB_H
    gl0, gl1 = cz0 + 0.55, cz0 + ch - 0.05
    # glazing bars and wipers on the front screen
    for y in (cy0 + (cy1 - cy0) / 3, cy0 + 2 * (cy1 - cy0) / 3):
        p.box((cx1 + 0.02, y - 0.025, gl0), (cx1 + 0.045, y + 0.025, gl1), 'dark', ('+x', '+y', '-y'))
    for y in (cy0 + 0.4, cy0 + 1.2, cy0 + 2.0):
        p.beam((cx1 + 0.05, y, gl0 + 0.06), (cx1 + 0.05, y - 0.25, gl0 + 0.75), 0.025, 0.02, 'black')
    p.box((cx0 + 1.2 - 0.025, cy1 + 0.02, gl0), (cx0 + 1.2 + 0.025, cy1 + 0.045, gl1), 'dark', ('+y', '+x', '-x'))   # side door frame
    p.beam((cx0 + 1.05, cy1 + 0.06, cz0 + 1.0), (cx0 + 1.05, cy1 + 0.06, cz0 + 1.6), 0.03, 0.03, 'zinc')               # door grab
    # second mirror on the -Y side of the cab
    p.beam((cx1 + 0.1, cy0 + 0.2, cz0 + ch - 0.2), (cx1 + 0.3, cy0 - 0.25, cz0 + ch - 0.4), 0.05, 0.05, 'zinc')
    p.box((cx1 + 0.26, cy0 - 0.4, cz0 + ch - 0.7), (cx1 + 0.34, cy0 - 0.22, cz0 + ch - 0.3), 'dark')
    # cab roof handrail
    rz = cz0 + ch + 0.12
    for x in (cx0 - 0.05, cx1 + 0.05):
        for y in (cy0 - 0.05, cy1 + 0.05):
            p.box((x - 0.02, y - 0.02, rz), (x + 0.02, y + 0.02, rz + 0.45), 'yellow')
    for y in (cy0 - 0.05, cy1 + 0.05):
        p.box((cx0 - 0.07, y - 0.02, rz + 0.43), (cx1 + 0.07, y + 0.02, rz + 0.47), 'yellow')
    for x in (cx0 - 0.05, cx1 + 0.05):
        p.box((x - 0.02, cy0 - 0.07, rz + 0.43), (x + 0.02, cy1 + 0.07, rz + 0.47), 'yellow')
    # warning bands on the bumper rails (front and rear faces)
    for sx in (-1, 1):
        xf = sx * (S.FRAME_HALF_LEN + 0.05)
        for i in range(12):
            if i % 2 == 0:
                y0 = -S.LEG_Y - LW + i * (2 * (S.LEG_Y + LW)) / 12
                y1 = y0 + (2 * (S.LEG_Y + LW)) / 12
                p.box((min(xf, xf + sx * 0.004), y0, S.TOP_UNDER - 0.33), (max(xf, xf + sx * 0.004), y1, S.TOP_UNDER - 0.02), 'yellow', ('+x' if sx > 0 else '-x',))
    return p


# ---- the asset -----------------------------------------------------------------
RIG = [(f'steer_{n}', (sx * S.LEG_X, sy * S.LEG_Y, S.AXLE_Z)) for n, sx, sy in S.CORNERS]


def _gl(p):
    return [round(p[0], 4), round(p[2], 4), round(-p[1] + 0.0, 4)]


def build(atlas_image, plate_image):
    """Builds the hero body; returns (root, info)."""
    material = textured_material('shc_atlas', atlas_image, roughness=0.6, metallic=0.1)
    plate_material = textured_material('shc_plate', plate_image, roughness=0.5, metallic=0.1)
    root = empty(NAME)
    lod = empty('LOD0', root)
    tris = 0
    meshes = 0
    lo, hi = [1e9] * 3, [-1e9] * 3

    def obj(part, name, mat, parent, origin):
        nonlocal tris, meshes
        for v in part.m.verts:
            for i in range(3):
                lo[i], hi[i] = min(lo[i], v[i] + origin[i]), max(hi[i], v[i] + origin[i])
        tris += part.triangles
        meshes += 1
        return part.m.to_object(name, mat, parent)

    def rig(part, name, parent, loc, origin):
        node = empty(name, parent, loc)
        obj(part, name + '_geo', material, node, origin)
        return node

    obj(frame_mesh(), 'frame', material, lod, (0, 0, 0))
    obj(S.plates_mesh(), 'plates', plate_material, lod, (0, 0, 0))
    for (name, pivot), (c, _, _) in zip(RIG, S.CORNERS):
        steer = rig(steer_mesh(), name, lod, pivot, pivot)
        rig(wheel_mesh(), f'wheel_{c}', steer, (0, 0, 0), pivot)
    rig(hoist_mesh(), 'hoist', lod, (0, 0, S.ATTACH_Z), (0, 0, S.ATTACH_Z))
    bounds = {'min': [round(lo[0], 4), round(lo[2], 4), round(-hi[1], 4)], 'max': [round(hi[0], 4), round(hi[2], 4), round(-lo[1], 4)]}
    return root, {'name': NAME, 'triangles': tris, 'meshes': meshes, 'bounds': bounds}


def sidecar(info):
    b = info['bounds']
    size = [round(b['max'][i] - b['min'][i], 3) for i in range(3)]
    nodes = [
        {'name': 'LOD0', 'parent': NAME, 'role': 'lod', 'description': 'the only level; same frame as shc.glb LOD0, without the spreader subtree'},
        {'name': 'frame', 'parent': 'LOD0', 'role': 'mesh', 'description': 'shc.py frame plus leg stiffeners, leg-head sprockets, cab glazing bars, wipers, mirrors and roof handrail, bumper warning bands'},
        {'name': 'plates', 'parent': 'LOD0', 'role': 'mesh', 'description': 'fleet-number plates in material shc_plate (authored for tile 0, as shc.glb)'},
    ]
    for (name, pivot), (c, _, _) in zip(RIG, S.CORNERS):
        nodes.append({'name': name, 'parent': 'LOD0', 'role': 'rig', 'pivot': _gl(pivot), 'axis': '+Y', 'description': 'steering knuckle and fork'})
        nodes.append({'name': f'wheel_{c}', 'parent': name, 'role': 'rig', 'pivot': _gl(pivot), 'axis': '+Z', 'description': 'tyre with tread lugs on a rim with nuts'})
    nodes.append({'name': 'hoist', 'parent': 'LOD0', 'role': 'rig', 'pivot': _gl((0, 0, S.ATTACH_Z)), 'axis': '+Y',
                  'description': 'lifting frame with chain stubs and hazard bands; the hero spreader hangs below it (not in this file)'})
    for rig in [n for n in nodes if n['role'] == 'rig']:
        nodes.append({'name': rig['name'] + '_geo', 'parent': rig['name'], 'role': 'mesh', 'description': 'mesh of ' + rig['name']})
    limits = {}
    for c, _, _ in S.CORNERS:
        limits[f'steer_{c}'] = {'type': 'rotation', 'axis': '+Y', 'minDeg': -35, 'maxDeg': 35, 'rest': 0, 'tag': 'A'}
        limits[f'wheel_{c}'] = {'type': 'rotation', 'axis': '+Z', 'minDeg': -360, 'maxDeg': 360, 'rest': 0, 'continuous': True, 'tag': 'A'}
    limits['hoist'] = {'type': 'translation', 'axis': '+Y', 'minM': -S.HOIST_TRAVEL, 'maxM': 0, 'rest': 0, 'tag': 'A'}
    return {
        'asset': NAME,
        'kind': 'hero-shc',
        'version': 1,
        'generator': 'src/sims/terminal-twin/assets/generators/build.py --only hero-equipment',
        'units': 'm',
        'dimensions': {'lengthM': size[0], 'widthM': size[2], 'heightM': size[1], 'boundsMin': b['min'], 'boundsMax': b['max'], 'tag': 'A',
                       'source': 'shc.glb LOD0 without the spreader subtree (same origin, axes and extents; tests/hero-shc-asset.test.ts compares them)'},
        'axes': {'up': '+Y', 'length': '+X (front, cab end)', 'width': '+Z', 'origin': 'ground contact below the frame centre', 'handedness': 'right-handed, glTF'},
        'heroEquipment': {
            'kind': 'shc-body', 'sourceAsset': 'shc', 'replaces': 'LOD0',
            'attach': "add LOD0 under the SHC's root beside its own LOD0 (identity transform) and drive the rig nodes with the same values as LOD0's nodes of the same name; the spreader stays LOD0's (or the #273 hero spreader) and is not in this file",
            'leftOut': ['spreader', 'twistlock_fl', 'twistlock_fr', 'twistlock_rl', 'twistlock_rr'],
            'materials': {'shc_atlas': 'the shc.glb atlas', 'shc_plate': 'fleet-number plates; the renderer offsets the UVs per SHC as for shc.glb'},
        },
        'nodes': nodes,
        'travelLimits': limits,
        'attachPoints': [],
        'groundContact': {'y': 0, 'points': [f'wheel_{c}' for c, _, _ in S.CORNERS], 'tag': 'V'},
        'lods': {'LOD0': {'triangles': info['triangles'], 'meshes': info['meshes']}},
        'provenance': [
            {'fact': 'frame, pivots, tyre radius and overall extents from shc.py LOD0', 'tag': 'A', 'source': 'tt_assets/shc.py'},
            {'fact': 'chevron tread lugs, sidewall band, rim nuts, leg stiffeners, sprockets and chains, glazing bars, wipers, mirrors, handrails, warning bands',
             'tag': 'A', 'source': 'generic shuttle carrier detail; no manufacturer drawing'},
        ],
    }
