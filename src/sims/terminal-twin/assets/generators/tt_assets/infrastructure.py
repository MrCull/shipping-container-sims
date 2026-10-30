"""Terminal infrastructure assets (TT-28): gate modules, quay furniture, yard infrastructure, buildings, backdrop.

Every asset is one GLB (root = asset name > `LOD0` > mesh nodes; no LODs, the gate and the buildings are ~5k
triangles) sharing one swatch/sign atlas (`infra-atlas.webp`). Repeated items (bollards, fenders, rails, masts,
fence panels, gate lane modules) are instanced by the renderer.

Authoring is done in glTF axes (X across / along the quay, Y up, Z along the gate lane or into the yard): `GPart`
converts to Blender (x, -z, y). Gate modules face +Z (the direction the truck drives); the renderer yaws them for
the other direction. All dimensions are [A] approximations unless a sidecar provenance entry says [V].
"""
import math

import bpy

from .blender import empty, textured_material
from .parts import Atlas, Part

# ---- shared atlas ----------------------------------------------------------
ATLAS = 2048
CELL = 128
SWATCHES = {
    'concrete': '#b9b9b3', 'concrete_dark': '#8e908d', 'asphalt': '#4a4d52', 'steel': '#8b9198',
    'steel_dark': '#3a3f46', 'zinc': '#a8adb3', 'yellow': '#f2b705', 'black': '#101113',
    'white': '#f1f1ef', 'red': '#c0302a', 'green': '#2e8b57', 'blue': '#2b5b98',
    'glass': '#5d86a0', 'lamp': '#fff2c4', 'rubber': '#1a1a1c', 'rock_light': '#9d9d94',
    'rock_dark': '#6d706b', 'scrub': '#6f7d52', 'soil': '#8a7a60', 'hill_green': '#6a7658',
    'hill_dry': '#8c8a68', 'sand': '#b9ae8a', 'roof_grey': '#7d8590', 'wall_cream': '#d8d2c0',
    'door_blue': '#2f4f7f', 'orange': '#e8641b', 'wall_grey': '#aab0b6', 'light_grey': '#d0d3d6',
}
REGIONS = {
    'hazard': (0, 1024, 1024, 1152),        # black and yellow diagonal stripes, 16 per region width
    'road_arrow': (0, 1152, 512, 2048),     # white arrow on asphalt (points up = along the plate's +ey)
    'sign_arrow': (512, 1152, 768, 1408),   # green down arrow on black (lane open)
    'sign_cross': (768, 1152, 1024, 1408),  # red cross on black (lane closed)
    'sign_gate': (1024, 1152, 2048, 1408),  # TERMINAL GATE
    'sign_oog': (1024, 1408, 2048, 1664),   # OVERSIZE LANE
}
SWATCH_ORDER = list(SWATCHES)
ATLAS_OBJ = Atlas(ATLAS, CELL, SWATCHES, REGIONS)

LANE_W = 3.5          # truck lane [V]
OOG_LANE_W = 8.0      # out-of-gauge lane [V]
ISLAND_W = 1.2        # [A] must equal engine GATE_ISLAND_W_M
MODULE_LEN = 12.0     # island / module length along the lane (Z)
CANOPY_LEN = 10.0
CANOPY_Y0, CANOPY_Y1 = 5.9, 6.3
STALL_LEN = 13.0      # engine STALL_LENGTH_M
STALL_W = 3.2
MARK_OFFSET_X = 2.5   # yard-markings: the two markings sit this far either side of the origin


def gv(p):
    """glTF (x, y, z) -> Blender (x, -z, y)."""
    return (p[0], -p[2], p[1])


class GPart(Part):
    """A `Part` authored in glTF axes."""

    def gbox(self, lo, hi, swatch, faces=('+x', '-x', '+y', '-y', '+z', '-z')):
        # Blender face labels are axis labels in Blender space; map the glTF face names.
        m = {'+x': '+x', '-x': '-x', '+y': '+z', '-y': '-z', '+z': '-y', '-z': '+y'}
        self.box(gv(lo), gv(hi), swatch, tuple(m[f] for f in faces))

    def gcbox(self, c, size, swatch, faces=('+x', '-x', '+y', '-y', '+z', '-z')):
        self.gbox(tuple(c[i] - size[i] / 2 for i in range(3)), tuple(c[i] + size[i] / 2 for i in range(3)), swatch, faces)

    def gbeam(self, p0, p1, w, h, swatch):
        self.beam(gv(p0), gv(p1), w, h, swatch)

    def gplate(self, origin, ex, ey, w, h, region, lift=0.004, cell=None):
        self.plate(gv(origin), gv(ex), gv(ey), w, h, region, lift=lift, cell=cell)

    def grevolve(self, centre, axis, profile, segs, swatch=None):
        ax = {'x': 'x', 'y': 'z', 'z': 'y'}[axis]
        self.revolve(gv(centre), ax, profile, segs, swatch)

    def gshift(self, pivot):
        self.m.shift(gv(pivot))


class Asset:
    """Root > LOD0 > nodes; collects the sidecar node list and the triangle count."""

    def __init__(self, name, kind, material, description):
        self.name = name
        self.kind = kind
        self.material = material
        self.root = empty(name)
        self.lod0 = empty('LOD0', self.root)
        self.nodes = [{'name': 'LOD0', 'parent': name, 'role': 'lod', 'description': description}]
        self.triangles = 0

    def mesh(self, node, part, description, parent=None, parent_name='LOD0', role='mesh'):
        obj = part.m.to_object(node, self.material, parent=parent or self.lod0)
        self.triangles += part.triangles
        self.nodes.append({'name': node, 'parent': parent_name, 'role': role, 'description': description})
        return obj

    def rig(self, node, pivot, description, parent=None, parent_name='LOD0', axis='+Z'):
        obj = empty(node, parent or self.lod0, location=gv(pivot))
        self.nodes.append({'name': node, 'parent': parent_name, 'role': 'rig', 'pivot': [round(c, 4) for c in pivot], 'axis': axis, 'description': description})
        return obj

    def info(self, dimensions, provenance, **extra):
        out = {'name': self.name, 'kind': self.kind, 'triangles': {'LOD0': self.triangles}, 'nodes': self.nodes,
               'dimensions': dimensions, 'provenance': provenance}
        out.update(extra)
        return out


def make_material(atlas_image, roughness=0.85):
    return textured_material('infra_atlas', atlas_image, roughness=roughness, metallic=0.0)


# ---- gate ------------------------------------------------------------------
def _canopy_deck(p, half_w, front_sign=None):
    """Canopy roof, front and back fascia and under-lights for a module `half_w` either side of the centre."""
    z = CANOPY_LEN / 2
    p.gbox((-half_w, CANOPY_Y1 - 0.12, -z), (half_w, CANOPY_Y1, z), 'roof_grey')            # roof sheet
    for sz in (-1, 1):                                                                       # steel fascia girders
        z0, z1 = (sz * z - 0.12, sz * z + 0.12)
        p.gbox((-half_w, CANOPY_Y0 + 0.1, min(z0, z1)), (half_w, CANOPY_Y1, max(z0, z1)), 'steel')
    p.gbox((-half_w, CANOPY_Y1 - 0.5, -0.2), (half_w, CANOPY_Y1 - 0.12, 0.2), 'steel_dark')  # ridge truss chord
    n = max(1, int(round(half_w * 2 / 2.0)))
    for i in range(n):                                                                       # lights under the canopy
        cx = -half_w + (i + 0.5) * (2 * half_w / n)
        for lz in (-3.2, 3.2):
            p.gcbox((cx, CANOPY_Y1 - 0.5, lz), (0.9, 0.05, 0.25), 'lamp', ('-y',))
            p.gcbox((cx, CANOPY_Y1 - 0.45, lz), (1.0, 0.08, 0.32), 'steel_dark', ('+x', '-x', '+z', '-z', '+y'))


def _lane_sign(p, x, z, kind):
    """Overhead lane sign hanging below the front fascia: lane arrow (open) or red cross (closed), facing -Z."""
    p.gbox((x - 0.55, CANOPY_Y0 - 0.95, z - 0.1), (x + 0.55, CANOPY_Y0 + 0.1, z + 0.1), 'steel_dark')
    p.gplate((x + 0.5, CANOPY_Y0 - 0.9, z - 0.1), (-1, 0, 0), (0, 1, 0), 1.0, 0.95, 'sign_arrow' if kind == 'open' else 'sign_cross', lift=0.004)
    # (plate normal = ex x ey = -z: faces the approaching truck)


def build_gate_lane(atlas_image, oog=False):
    w = OOG_LANE_W if oog else LANE_W
    name = 'gate-lane-oog' if oog else 'gate-lane'
    a = Asset(name, 'gate', make_material(atlas_image),
              f'one {w:g} m {"out-of-gauge" if oog else "truck"} gate lane module: pavement markings, barrier boom, camera and canopy segment; faces +Z, origin at the lane centre on the kiosk line')
    hw, z0, z1 = w / 2, -MODULE_LEN / 2, MODULE_LEN / 2
    pav = GPart(ATLAS_OBJ)
    pav.gbox((-hw, 0, z0), (hw, 0.09, z1), 'asphalt')
    for sx in (-1, 1):                                                                       # edge lines
        pav.gbox((sx * (hw - 0.2) - 0.06, 0.09, z0), (sx * (hw - 0.2) + 0.06, 0.094, z1), 'white', ('+y',))
    pav.gbox((-hw + 0.25, 0.09, -1.4), (hw - 0.25, 0.094, -1.25), 'white', ('+y',))           # stop line
    if oog:
        for zz in (-5.0, 3.0):                                                                 # hazard hatch across the wide lane
            pav.gplate((hw - 0.3, 0.095, zz), (-1, 0, 0), (0, 0, 1), w - 0.6, 1.0, 'hazard', lift=0.0)
    else:
        pav.gplate((1.5, 0.095, -5.6), (-1, 0, 0), (0, 0, 1), 3.0, 5.2, 'road_arrow', lift=0.0)
    a.mesh('pavement', pav, 'lane slab with edge lines, stop line and the painted lane arrow (hazard hatch on the out-of-gauge lane)')
    can = GPart(ATLAS_OBJ)
    _canopy_deck(can, hw)
    _lane_sign(can, 3.0 if oog else 0.0, -CANOPY_LEN / 2 - 0.1, 'closed' if oog else 'open')
    if oog:
        zf = -CANOPY_LEN / 2 - 0.1
        can.gbox((-2.5, CANOPY_Y0 - 0.95, zf - 0.1), (1.5, CANOPY_Y0 + 0.1, zf + 0.1), 'steel_dark')
        can.gplate((1.5, CANOPY_Y0 - 0.9, zf - 0.1), (-1, 0, 0), (0, 1, 0), 4.0, 0.95, 'sign_oog', lift=0.004)
    # plate-recognition camera housing on a bracket under the canopy, looking down the lane
    can.gbox((-0.18, CANOPY_Y0 - 0.5, -2.1), (0.18, CANOPY_Y0 - 0.05, -1.6), 'white')
    can.gbox((-0.1, CANOPY_Y0 - 0.45, -2.14), (0.1, CANOPY_Y0 - 0.3, -2.1), 'black', ('-z',))
    can.gbox((-0.04, CANOPY_Y0 - 0.05, -1.9), (0.04, CANOPY_Y1 - 0.12, -1.8), 'steel_dark')
    a.mesh('canopy', can, 'overhead canopy segment: roof, fascia girders, lights, lane sign and plate-camera housing')
    # barrier boom: housing on the +x edge, arm hinged on it
    hx = hw - 0.18
    bz = 1.2
    hous = GPart(ATLAS_OBJ)
    hous.gbox((hx - 0.2, 0, bz - 0.2), (hx + 0.2, 1.05, bz + 0.2), 'yellow')
    hous.gbox((hx - 0.2, 1.05, bz - 0.2), (hx + 0.2, 1.1, bz + 0.2), 'steel_dark')
    a.mesh('boom_housing', hous, 'barrier housing')
    boom_len = hw * 2 - 0.5 if oog else hw * 2 - 0.4
    pivot = (hx, 0.95, bz)
    rig = a.rig('boom', pivot, 'barrier boom hinge; rotates about +Z: 0 = closed across the lane, -88 deg = raised', axis='+Z')
    arm = GPart(ATLAS_OBJ)
    seg = boom_len / 8
    for i in range(8):
        arm.gbox((hx - (i + 1) * seg, 0.9, bz - 0.05), (hx - i * seg, 1.0, bz + 0.05), 'red' if i % 2 == 0 else 'white')
    arm.gshift(pivot)
    obj = a.mesh('boom_geo', arm, 'striped red/white boom arm', parent=rig, parent_name='boom')
    obj.location = (0, 0, 0)
    dims = {'lengthM': MODULE_LEN, 'widthM': w, 'heightM': CANOPY_Y1, 'laneWidthM': w, 'tag': 'V' if not oog else 'V',
            'reason': f'{w:g} m {"out-of-gauge" if oog else "truck"} lane width is the ticket figure (TT-28)'}
    prov = [
        {'fact': f'{w:g} m wide {"out-of-gauge" if oog else "truck"} lane', 'tag': 'V', 'source': 'ticket TT-28 (#52): 3.5 m truck lanes and an 8 m OOG lane'},
        {'fact': 'canopy height 6.3 m, 10 m deep, lane arrow/cross signs, under-canopy lights, plate-recognition camera housing', 'tag': 'A',
         'reason': 'typical truck gate gantry; no drawing in the repo'},
        {'fact': 'barrier boom as one rig node (rotation about +Z); the renderer bakes the raised pose (closed on the unused OOG lane)', 'tag': 'M', 'reason': 'instancing'},
    ]
    limits = {'boom': {'type': 'rotation', 'axis': '+Z', 'minDeg': -88, 'maxDeg': 0, 'rest': 0, 'tag': 'A'}}
    attach = [{'name': 'lane_centre', 'node': 'LOD0', 'position': [0, 0, 0], 'tag': 'V', 'description': 'lane centre on the kiosk line (engine kioskZ)'},
              {'name': 'stop_line', 'node': 'LOD0', 'position': [0, 0.09, -1.325], 'tag': 'A', 'description': 'painted stop line'}]
    return a.root, a.info(dims, prov, limits=limits, attach=attach,
                          module={'laneWidthM': w, 'lane': 'oog' if oog else 'truck', 'lengthM': MODULE_LEN, 'faces': '+Z', 'islandWidthM': ISLAND_W})


def build_gate_island(atlas_image):
    a = Asset('gate-island', 'gate', make_material(atlas_image),
              f'concrete island {ISLAND_W} m wide between two gate lanes: black-and-yellow kerbs, yellow pedestal kiosk, camera post, canopy columns and the canopy segment above; origin at the island centre on the kiosk line')
    hw, z0, z1 = ISLAND_W / 2, -MODULE_LEN / 2, MODULE_LEN / 2
    base = GPart(ATLAS_OBJ)
    kh = 0.22
    base.gbox((-hw, 0, z0), (hw, kh, z1), 'concrete', ('+y',))
    base.gbox((-hw, 0, z0), (hw, kh, z1), 'concrete_dark', ('+x', '-x', '+z', '-z'))
    for sx in (-1, 1):                                                                       # kerb stripes on the lane sides
        base.gplate((sx * hw, 0.0, z0 if sx < 0 else z1), (0, 0, 1 if sx < 0 else -1), (0, 1, 0), MODULE_LEN, kh, 'hazard', lift=0.004)
    for sz in (-1, 1):                                                                       # nose stripes
        base.gplate((-hw if sz > 0 else hw, 0.0, sz * z1), (1 if sz > 0 else -1, 0, 0), (0, 1, 0), ISLAND_W, kh, 'hazard', lift=0.004)
    a.mesh('island', base, 'concrete island with black-and-yellow kerb stripes')
    ped = GPart(ATLAS_OBJ)
    ped.gbox((-0.22, kh, -0.22), (0.22, kh + 0.08, 0.22), 'steel_dark')
    ped.gbox((-0.19, kh + 0.08, -0.19), (0.19, kh + 1.05, 0.19), 'yellow')
    ped.gbox((-0.24, kh + 1.05, -0.24), (0.24, kh + 1.32, 0.24), 'steel_dark')
    for sx in (-1, 1):                                                                       # screens and card reader on both lane sides
        ped.gbox((sx * 0.24 - 0.005, kh + 1.07, -0.18), (sx * 0.24 + 0.005, kh + 1.29, 0.18), 'glass', ('+x' if sx > 0 else '-x',))
        ped.gbox((sx * 0.19 - 0.02, kh + 0.65, -0.1), (sx * 0.19 + 0.02, kh + 0.85, 0.1), 'black', ('+x' if sx > 0 else '-x',))
        ped.gbox((sx * 0.19 - 0.025, kh + 0.55, -0.04), (sx * 0.19 + 0.025, kh + 0.6, 0.04), 'lamp', ('+x' if sx > 0 else '-x',))
    a.mesh('kiosk', ped, 'yellow pedestal kiosk with screens and card reader facing both lanes')
    cam = GPart(ATLAS_OBJ)
    cam.gbox((-0.05, kh, 3.0), (0.05, kh + 1.5, 3.1), 'steel')
    cam.gbox((-0.14, kh + 1.5, 2.95), (0.14, kh + 1.8, 3.2), 'white')
    cam.gbox((-0.08, kh + 1.55, 2.92), (0.08, kh + 1.72, 2.95), 'black', ('-z',))
    for sx in (-1, 1):
        cam.gbox((sx * 0.38 - 0.04, kh, -3.3), (sx * 0.38 + 0.04, kh + 0.9, -3.22), 'orange')  # bollard guards at the nose
    a.mesh('camera_post', cam, 'plate-camera post and nose guards')
    can = GPart(ATLAS_OBJ)
    _canopy_deck(can, hw)
    for sz in (-1, 1):                                                                       # canopy columns
        cz = sz * 4.4
        can.gbox((-0.2, kh, cz - 0.2), (0.2, CANOPY_Y1 - 0.12, cz + 0.2), 'steel')
        can.gbox((-0.3, kh, cz - 0.3), (0.3, kh + 0.08, cz + 0.3), 'steel_dark')
        can.gbox((-0.26, CANOPY_Y1 - 0.5, cz - 0.26), (0.26, CANOPY_Y1 - 0.12, cz + 0.26), 'steel_dark')
    a.mesh('canopy', can, 'canopy segment above the island with its two steel columns')
    dims = {'lengthM': MODULE_LEN, 'widthM': ISLAND_W, 'heightM': CANOPY_Y1, 'tag': 'A', 'reason': 'island width and length are approximations'}
    prov = [
        {'fact': 'island 1.2 m wide, 0.22 m high kerb with black-and-yellow stripes (0.75 m period)', 'tag': 'A', 'reason': 'typical gate island'},
        {'fact': 'yellow pedestal kiosk with two screens and card readers (one per neighbouring lane)', 'tag': 'A', 'reason': 'ticket: yellow pedestal kiosks'},
        {'fact': 'steel canopy columns at both ends of the island carry the long canopy', 'tag': 'A'},
    ]
    attach = [{'name': 'kiosk', 'node': 'kiosk', 'position': [0, 1.5, 0], 'tag': 'A', 'description': 'pedestal head (driver window height)'}]
    return a.root, a.info(dims, prov, limits={}, attach=attach, module={'islandWidthM': ISLAND_W, 'lengthM': MODULE_LEN, 'faces': '+Z'})


def build_gate_office(atlas_image):
    a = Asset('gate-office', 'gate', make_material(atlas_image),
              'small gate control office with a flat roof, window band towards the lanes and a door; origin at the floor centre, windows face +Z')
    L, D, H = 12.0, 6.0, 3.4
    p = GPart(ATLAS_OBJ)
    p.gbox((-L / 2, 0, -D / 2), (L / 2, H, D / 2), 'wall_cream')
    p.gbox((-L / 2 - 0.2, H, -D / 2 - 0.2), (L / 2 + 0.2, H + 0.25, D / 2 + 0.2), 'roof_grey')
    p.gbox((-L / 2, 0, -D / 2), (L / 2, 0.25, D / 2), 'concrete_dark', ('+x', '-x', '+z', '-z'))
    for i in range(5):                                                                       # windows on the lane side
        cx = -L / 2 + 1.5 + i * 2.3
        p.gbox((cx - 0.9, 1.1, D / 2), (cx + 0.9, 2.5, D / 2 + 0.05), 'glass', ('+z',))
        p.gbox((cx - 0.95, 1.05, D / 2), (cx + 0.95, 1.1, D / 2 + 0.06), 'steel_dark', ('+z', '+y'))
    p.gbox((L / 2 - 1.5, 0.0, D / 2), (L / 2 - 0.5, 2.3, D / 2 + 0.05), 'door_blue', ('+z',))
    p.gbox((-L / 2 + 1.0, H + 0.25, -1.0), (-L / 2 + 2.4, H + 0.95, 0.4), 'zinc')            # roof AC unit
    p.gbox((L / 2 - 3.0, H + 0.25, -0.6), (L / 2 - 2.9, H + 2.2, -0.5), 'steel')              # antenna mast
    a.mesh('office', p, 'office box, roof, windows, door, AC unit, antenna')
    dims = {'lengthM': L, 'widthM': D, 'heightM': H + 2.2, 'tag': 'A', 'reason': 'small gate control office'}
    return a.root, a.info(dims, [{'fact': 'small gate control office, 12 x 6 x 3.4 m', 'tag': 'A', 'reason': 'ticket: a small control office'}],
                          limits={}, attach=[{'name': 'door', 'node': 'LOD0', 'position': [L / 2 - 1.0, 0, D / 2], 'tag': 'A', 'description': 'entrance'}])


# ---- quay ------------------------------------------------------------------
SEG = 10.0   # length of instanced quay / rail segments (m)


def build_quay_edge(atlas_image):
    a = Asset('quay-edge', 'quay', make_material(atlas_image), '10 m quay edge coping with yellow safety line and a ladder recess; origin at the segment centre on the edge line (z = 0)')
    p = GPart(ATLAS_OBJ)
    h = SEG / 2
    p.gbox((-h, -0.5, -0.3), (h, 0.12, 0.5), 'concrete_dark', ('+x', '-x', '-z', '+z', '-y'))
    p.gbox((-h, 0.0, -0.3), (h, 0.12, 0.5), 'concrete', ('+y',))
    p.gbox((-h, 0.12, 0.05), (h, 0.125, 0.65), 'yellow', ('+y',))
    p.gbox((-0.5, -2.5, -0.35), (0.5, -0.5, -0.3), 'steel_dark', ('-z',))                       # ladder recess
    for i in range(6):
        p.gbox((-0.4, -2.2 + i * 0.4, -0.36), (0.4, -2.14 + i * 0.4, -0.3), 'yellow', ('-z',))
    a.mesh('edge', p, 'quay coping, yellow line, ladder recess')
    dims = {'lengthM': SEG, 'widthM': 1.0, 'heightM': 2.62, 'tag': 'A', 'reason': 'coping and ladder recess are approximations; the 2.5 m quay-above-water height is the engine figure'}
    return a.root, a.info(dims, [{'fact': 'coping with yellow edge line; ladder recess to the water (2.5 m)', 'tag': 'A'}], limits={}, attach=[{'name': 'edge_line', 'node': 'edge', 'position': [0, 0.125, 0.35], 'tag': 'A'}],
                          segment={'lengthM': SEG})


def _rail_segment(a, p, head_w, base_w, head_h, web_h, frame_w, channel_w, top):
    h = SEG / 2
    p.gbox((-h, 0, -frame_w / 2), (h, 0.03, frame_w / 2), 'concrete', ('+y', '+x', '-x'))
    p.gbox((-h, 0.03, -channel_w / 2), (h, 0.034, channel_w / 2), 'steel_dark', ('+y',))
    p.gbox((-h, 0.034, -base_w / 2), (h, 0.034 + 0.025, base_w / 2), 'steel', ('+y', '+z', '-z'))
    p.gbox((-h, 0.059, -0.035), (h, 0.059 + web_h, 0.035), 'steel', ('+z', '-z'))
    p.gbox((-h, 0.059 + web_h, -head_w / 2), (h, 0.059 + web_h + head_h, head_w / 2), 'zinc')
    for i in range(int(SEG)):                                                                 # rail clips every metre
        cx = -h + 0.5 + i
        p.gbox((cx - 0.08, 0.059, -base_w / 2 - 0.04), (cx + 0.08, 0.08, base_w / 2 + 0.04), 'steel_dark', ('+y',))


def build_quay_rail(atlas_image):
    a = Asset('quay-rail', 'quay', make_material(atlas_image), '10 m inset STS crane rail: concrete frame, dark channel, rail on clips; origin at the segment centre on the rail centre line')
    p = GPart(ATLAS_OBJ)
    _rail_segment(a, p, 0.14, 0.32, 0.07, 0.1, 1.3, 0.95, 0.24)
    a.mesh('rail', p, 'rail in its inset channel')
    dims = {'lengthM': SEG, 'widthM': 1.3, 'heightM': 0.24, 'tag': 'A', 'reason': 'rail section is a simplified crane rail'}
    return a.root, a.info(dims, [{'fact': 'crane rail inset in a concrete channel, top about 0.24 m above the apron', 'tag': 'A'}], limits={}, attach=[{'name': 'rail_top', 'node': 'rail', 'position': [0, 0.23, 0], 'tag': 'A'}],
                          segment={'lengthM': SEG})


def build_quay_bollard(atlas_image):
    a = Asset('quay-bollard', 'quay', make_material(atlas_image), 'double-bitt mooring bollard on a base plate (about 100 t); origin at the base centre')
    p = GPart(ATLAS_OBJ)
    p.gbox((-0.7, 0, -0.5), (0.7, 0.08, 0.5), 'steel_dark')
    for sx in (-1, 1):
        p.grevolve((sx * 0.3, 0, 0), 'y', [(0.28, 0.08, 'r', 'steel_dark'), (0.24, 0.55, 'a+', 'steel_dark'), (0.34, 0.62, 'r', 'steel_dark'), (0.34, 0.7, 'a+', 'steel_dark'), (0.0, 0.7, 'r', 'steel_dark')], 8)
    p.gbox((-0.3, 0.3, -0.07), (0.3, 0.42, 0.07), 'steel_dark')
    a.mesh('bollard', p, 'double-bitt bollard')
    dims = {'lengthM': 1.4, 'widthM': 1.0, 'heightM': 0.7, 'tag': 'A', 'reason': 'typical 100 t double bollard'}
    return a.root, a.info(dims, [{'fact': 'double-bitt bollard 1.4 m long, 0.7 m high', 'tag': 'A'}], limits={}, attach=[{'name': 'line', 'node': 'bollard', 'position': [0, 0.5, 0], 'tag': 'A'}])


def build_quay_fender(atlas_image):
    a = Asset('quay-fender', 'quay', make_material(atlas_image), 'cylindrical rubber fender on a steel mount hung on the quay face; origin on the quay edge line at deck level')
    p = GPart(ATLAS_OBJ)
    p.gbox((-0.45, -1.9, -0.32), (0.45, -0.25, -0.28), 'steel_dark')                          # panel
    p.grevolve((0, -1.65, -0.55), 'y', [(0.0, 0.0, 'a-', 'rubber'), (0.3, 0.0, 'r', 'rubber'), (0.3, 1.3, 'a+', 'rubber'), (0.0, 1.3, 'r', 'rubber')], 10)
    p.gbox((-0.06, -1.7, -0.6), (0.06, -0.4, -0.3), 'steel')
    p.gbox((-0.12, -0.52, -0.6), (0.12, -0.4, -0.55), 'steel_dark')
    a.mesh('fender', p, 'rubber cylinder fender with panel')
    dims = {'lengthM': 0.9, 'widthM': 0.6, 'heightM': 1.65, 'tag': 'A', 'reason': 'simplified fender'}
    return a.root, a.info(dims, [{'fact': 'rubber cylinder fender, 0.6 m diameter, hung on the quay face', 'tag': 'A'}], limits={}, attach=[{'name': 'mount', 'node': 'fender', 'position': [0, -0.3, -0.3], 'tag': 'A'}])


# ---- yard ------------------------------------------------------------------
def build_yard_mast(atlas_image):
    a = Asset('yard-mast', 'yard', make_material(atlas_image), '30 m high-mast lighting tower with a ring platform and a lamp head; origin at the base centre')
    p = GPart(ATLAS_OBJ)
    p.gbox((-0.8, 0, -0.8), (0.8, 0.3, 0.8), 'concrete_dark')
    p.grevolve((0, 0.3, 0), 'y', [(0.6, 0.0, 'r', 'steel'), (0.42, 14.0, 'r', 'steel'), (0.3, 27.7, 'a+', 'steel'), (0.0, 27.7, 'r', 'steel')], 8)
    p.gbox((-0.06, 0.4, 0.55), (0.06, 24.0, 0.62), 'steel_dark')                              # ladder rail
    p.grevolve((0, 28.0, 0), 'y', [(0.0, 0.0, 'a-', 'steel_dark'), (1.5, 0.0, 'r', 'steel_dark'), (1.5, 0.15, 'a+', 'steel_dark'), (0.0, 0.15, 'r', 'steel_dark')], 10)
    for k in range(8):                                                                       # handrail posts
        ang = 2 * math.pi * k / 8
        p.gcbox((1.4 * math.cos(ang), 28.6, 1.4 * math.sin(ang)), (0.05, 0.9, 0.05), 'zinc')
    for k in range(6):
        ang = 2 * math.pi * k / 6
        cx, cz = 1.2 * math.cos(ang), 1.2 * math.sin(ang)
        p.gcbox((cx, 29.35, cz), (0.9, 0.25, 0.45), 'steel_dark', ('+x', '-x', '+z', '-z', '+y'))
        p.gcbox((cx, 29.2, cz), (0.82, 0.04, 0.38), 'lamp', ('-y',))
    p.gcbox((0, 29.9, 0), (0.5, 0.7, 0.5), 'steel_dark')
    a.mesh('mast', p, 'pole, ladder rail, platform ring and lamp head')
    dims = {'lengthM': 3.0, 'widthM': 3.0, 'heightM': 30.2, 'tag': 'A', 'reason': 'matches the 30 m mast poles of the TT-21 atmosphere'}
    return a.root, a.info(dims, [{'fact': '30 m high-mast tower, six lamp heads', 'tag': 'A', 'reason': 'TT-21 mast height'}], limits={},
                          attach=[{'name': 'lamp_ring', 'node': 'mast', 'position': [0, 29.2, 0], 'tag': 'A', 'description': 'night glow sits here'}])


def build_yard_fence(atlas_image):
    a = Asset('yard-fence', 'yard', make_material(atlas_image), '5 m security fence panel: posts, rails and pickets; origin at the panel centre on the ground, runs along X')
    p = GPart(ATLAS_OBJ)
    for sx in (-1, 1):
        p.gbox((sx * 2.5 - 0.06, 0, -0.06), (sx * 2.5 + 0.06, 2.5, 0.06), 'steel_dark')
    for y in (0.15, 1.3, 2.35):
        p.gbox((-2.5, y, -0.03), (2.5, y + 0.06, 0.03), 'steel')
    for i in range(14):
        cx = -2.3 + i * (4.6 / 13)
        p.gbox((cx - 0.012, 0.15, -0.012), (cx + 0.012, 2.35, 0.012), 'zinc')
    for i in range(3):                                                                       # barbed outrigger arms
        cx = -2.0 + i * 2.0
        p.gbeam((cx, 2.35, 0), (cx, 2.65, 0.3), 0.03, 0.03, 'steel_dark')
    a.mesh('panel', p, 'fence panel')
    dims = {'lengthM': 5.0, 'widthM': 0.3, 'heightM': 2.65, 'tag': 'A', 'reason': 'typical security fence'}
    return a.root, a.info(dims, [{'fact': '2.5 m fence with outriggers', 'tag': 'A'}], limits={}, attach=[], segment={'lengthM': 5.0})


def build_yard_asc_rail(atlas_image):
    a = Asset('yard-asc-rail', 'yard', make_material(atlas_image), '10 m inset ASC rail on a concrete beam; origin at the segment centre on the rail centre line, runs along Z in the yard (authored along X)')
    p = GPart(ATLAS_OBJ)
    h = SEG / 2
    p.gbox((-h, 0, -0.45), (h, 0.1, 0.45), 'concrete', ('+y', '+x', '-x', '+z', '-z'))
    p.gbox((-h, 0.1, -0.12), (h, 0.17, 0.12), 'steel', ('+y', '+z', '-z'))
    p.gbox((-h, 0.17, -0.2), (h, 0.24, 0.2), 'zinc')
    for i in range(int(SEG)):
        cx = -h + 0.5 + i
        p.gbox((cx - 0.1, 0.1, -0.26), (cx + 0.1, 0.125, 0.26), 'steel_dark', ('+y',))
    a.mesh('rail', p, 'ASC rail on its beam')
    dims = {'lengthM': SEG, 'widthM': 0.9, 'heightM': 0.24, 'tag': 'A', 'reason': 'simplified crane rail on a concrete beam'}
    return a.root, a.info(dims, [{'fact': 'ASC rail head 0.24 m above the yard surface', 'tag': 'A'}], limits={}, attach=[], segment={'lengthM': SEG})


def _outline(p, w, l, t, swatch, y=0.0):
    for sx in (-1, 1):
        p.gbox((sx * (w / 2 - t / 2) - t / 2, y, -l / 2), (sx * (w / 2 - t / 2) + t / 2, y + 0.01, l / 2), swatch, ('+y',))
    for sz in (-1, 1):
        p.gbox((-w / 2 + t, y, sz * (l / 2 - t / 2) - t / 2), (w / 2 - t, y + 0.01, sz * (l / 2 - t / 2) + t / 2), swatch, ('+y',))


def build_yard_markings(atlas_image):
    a = Asset('yard-markings', 'yard', make_material(atlas_image), 'flat ground markings: WTP pad (waterside transfer pad) and truck transfer stall; origins at the marking centres, length along Z')
    pad = GPart(ATLAS_OBJ)
    _outline(pad, STALL_W, STALL_LEN, 0.2, 'yellow')
    pad.gbox((-STALL_W / 2 + 0.2, 0.0, -STALL_LEN / 2 + 0.2), (STALL_W / 2 - 0.2, 0.004, STALL_LEN / 2 - 0.2), 'concrete_dark', ('+y',))
    o = a.mesh('wtp_pad', pad, 'waterside transfer pad: yellow outline on a darker surface; the mesh sits at x = -2.5 so both markings show side by side (the renderer re-centres each)')
    o.location = gv((-MARK_OFFSET_X, 0, 0))
    stall = GPart(ATLAS_OBJ)
    _outline(stall, STALL_W, STALL_LEN, 0.2, 'yellow')
    for sz in (-1, 1):                                                                       # hazard end bars
        z = sz * (STALL_LEN / 2 - 1.0)
        stall.gplate((STALL_W / 2 - 0.25, 0.0, z - 0.4), (-1, 0, 0), (0, 0, 1), STALL_W - 0.5, 0.8, 'hazard', lift=0.002)
    stall.gbox((-0.1, 0.0, -1.0), (0.1, 0.006, 1.0), 'white', ('+y',))
    o = a.mesh('transfer_stall', stall, 'truck transfer stall: yellow outline with hazard end bars and a centre tick; the mesh sits at x = +2.5')
    o.location = gv((MARK_OFFSET_X, 0, 0))
    dims = {'lengthM': STALL_LEN, 'widthM': STALL_W, 'heightM': 0.01, 'tag': 'V', 'reason': 'matches the engine stall (3.2 x 13 m)'}
    return a.root, a.info(dims, [{'fact': 'WTP pad and transfer stall markings 3.2 x 13 m (engine pad and STALL_LENGTH_M)', 'tag': 'V', 'source': 'engine yardLayout.ts'}],
                          limits={}, attach=[{'name': 'wtp_pad', 'node': 'wtp_pad', 'position': [-MARK_OFFSET_X, 0, 0], 'tag': 'V'}, {'name': 'transfer_stall', 'node': 'transfer_stall', 'position': [MARK_OFFSET_X, 0, 0], 'tag': 'V'}])


# ---- buildings -------------------------------------------------------------
def _window_band(p, x0, x1, y0, y1, z, face, bays, mullion=0.12):
    pitch = (x1 - x0) / bays
    for i in range(bays):
        cx0 = x0 + i * pitch + mullion
        cx1 = x0 + (i + 1) * pitch - mullion
        p.gbox((cx0, y0, z), (cx1, y1, z + (0.06 if face == '+z' else -0.06)), 'glass', (face,))


def build_building_control(atlas_image):
    a = Asset('building-control', 'building', make_material(atlas_image), 'two-storey terminal office / control building with window bands, roof plant and a mast; origin at the floor centre, main facade faces +Z')
    L, D, H = 26.0, 13.0, 8.4
    p = GPart(ATLAS_OBJ)
    p.gbox((-L / 2, 0, -D / 2), (L / 2, H, D / 2), 'wall_cream')
    p.gbox((-L / 2 - 0.3, H, -D / 2 - 0.3), (L / 2 + 0.3, H + 0.4, D / 2 + 0.3), 'roof_grey')
    p.gbox((-L / 2, 0, -D / 2), (L / 2, 0.4, D / 2), 'concrete_dark', ('+x', '-x', '+z', '-z'))
    for fl, (y0, y1) in enumerate(((1.0, 2.9), (4.9, 6.8))):
        for face, z in (('+z', D / 2), ('-z', -D / 2)):
            _window_band(p, -L / 2 + 1.0, L / 2 - 1.0, y0, y1, z, face, 8)
        for sx in (-1, 1):
            p.gbox((sx * L / 2, y0, -3.0), (sx * L / 2 + sx * 0.06, y1, 3.0), 'glass', ('+x' if sx > 0 else '-x',))
    p.gbox((-L / 2, 3.6, D / 2), (L / 2, 4.1, D / 2 + 0.25), 'blue', ('+z', '+y', '-y'))       # band between floors
    p.gbox((-1.5, 0.0, D / 2), (1.5, 2.8, D / 2 + 0.06), 'door_blue', ('+z',))                  # main entrance
    p.gbox((-2.5, 2.8, D / 2), (2.5, 3.0, D / 2 + 1.4), 'roof_grey')                            # canopy over the entrance
    for i in range(3):                                                                       # roof plant
        p.gbox((-8 + i * 5, H + 0.4, -2.5), (-5.5 + i * 5, H + 1.7, 0.5), 'zinc')
    p.gbox((L / 2 - 3.1, H + 0.4, 1.9), (L / 2 - 3.0, H + 5.5, 2.0), 'steel')
    p.gbox((L / 2 - 3.8, H + 4.8, 1.85), (L / 2 - 2.3, H + 4.9, 2.05), 'steel')
    a.mesh('building', p, 'office block: facade, window bands, entrance canopy, roof plant, antenna')
    dims = {'lengthM': L, 'widthM': D, 'heightM': H + 5.5, 'tag': 'A', 'reason': 'generic office / control building'}
    return a.root, a.info(dims, [{'fact': 'generic two-storey office / control building, 26 x 13 x 8.4 m', 'tag': 'A', 'reason': 'ticket: office/control building module'}],
                          limits={}, attach=[{'name': 'entrance', 'node': 'LOD0', 'position': [0, 0, D / 2], 'tag': 'A'}])


def build_building_workshop(atlas_image):
    a = Asset('building-workshop', 'building', make_material(atlas_image), 'workshop / SHC maintenance hall: portal-frame shed with roller doors and a clerestory; origin at the floor centre, doors face +Z')
    L, D, H, RIDGE = 40.0, 20.0, 9.0, 11.5
    p = GPart(ATLAS_OBJ)
    p.gbox((-L / 2, 0, -D / 2), (L / 2, H, D / 2), 'wall_grey', ('+x', '-x', '+z', '-z'))
    p.gbox((-L / 2, 0, -D / 2), (L / 2, 0.5, D / 2), 'concrete_dark', ('+x', '-x', '+z', '-z'))
    # gabled roof: two slopes and two gable triangles
    for sz in (-1, 1):
        a0 = (-L / 2 - 0.4, H, sz * (D / 2 + 0.4))
        a1 = (L / 2 + 0.4, H, sz * (D / 2 + 0.4))
        b1 = (L / 2 + 0.4, RIDGE, 0)
        b0 = (-L / 2 - 0.4, RIDGE, 0)
        p.m.quad([gv(q) for q in (a0, a1, b1, b0)], [p.atlas.swatch_uv('roof_grey')] * 4, outward=gv((0, 1, sz * 2)))
        p.m.quad([gv(q) for q in (b0, b1, a1, a0)], [p.atlas.swatch_uv('roof_grey')] * 4, outward=gv((0, -1, -sz * 2)))
    for sx in (-1, 1):                                                                       # gable end triangles
        x = sx * L / 2
        p.m.ngon([gv((x, H, -D / 2)), gv((x, H, D / 2)), gv((x, RIDGE, 0))], [p.atlas.swatch_uv('wall_grey')] * 3, outward=gv((sx, 0, 0)))
    for i in range(4):                                                                       # roller doors on the +Z face
        cx = -L / 2 + 5.5 + i * 9.7
        p.gbox((cx - 3.0, 0.0, D / 2), (cx + 3.0, 7.0, D / 2 + 0.08), 'door_blue', ('+z',))
        for k in range(6):
            p.gbox((cx - 3.0, 0.9 + k * 1.1, D / 2 + 0.08), (cx + 3.0, 0.95 + k * 1.1, D / 2 + 0.1), 'steel_dark', ('+z',))
        p.gbox((cx - 3.1, 7.0, D / 2), (cx + 3.1, 7.2, D / 2 + 0.14), 'yellow', ('+z', '+y'))
    for i in range(14):                                                                      # high-level windows both long sides
        cx = -L / 2 + 1.5 + i * 2.85
        p.gbox((cx - 0.8, 7.6, D / 2), (cx + 0.8, 8.5, D / 2 + 0.05), 'glass', ('+z',))
        p.gbox((cx - 0.8, 7.6, -D / 2 - 0.05), (cx + 0.8, 8.5, -D / 2), 'glass', ('-z',))
    for i in range(4):                                                                       # roof vents
        p.gbox((-15 + i * 10, RIDGE - 0.2, -0.6), (-14 + i * 10, RIDGE + 0.5, 0.6), 'zinc')
    a.mesh('building', p, 'portal-frame workshop: walls, gabled roof, roller doors, windows, vents')
    dims = {'lengthM': L, 'widthM': D, 'heightM': RIDGE + 0.5, 'tag': 'A', 'reason': 'generic SHC / equipment maintenance workshop'}
    return a.root, a.info(dims, [{'fact': 'generic workshop 40 x 20 m, four 6 x 7 m roller doors', 'tag': 'A', 'reason': 'ticket: workshop / SHC maintenance module'}],
                          limits={}, attach=[{'name': 'door_row', 'node': 'LOD0', 'position': [0, 0, D / 2], 'tag': 'A'}])


def build_building_substation(atlas_image):
    a = Asset('building-substation', 'building', make_material(atlas_image), 'small electrical substation / services building; origin at the floor centre, door faces +Z')
    L, D, H = 9.0, 5.5, 4.0
    p = GPart(ATLAS_OBJ)
    p.gbox((-L / 2, 0, -D / 2), (L / 2, H, D / 2), 'wall_grey')
    p.gbox((-L / 2 - 0.2, H, -D / 2 - 0.2), (L / 2 + 0.2, H + 0.3, D / 2 + 0.2), 'roof_grey')
    p.gbox((-L / 2, 0, -D / 2), (L / 2, 0.3, D / 2), 'concrete_dark', ('+x', '-x', '+z', '-z'))
    for cx in (-2.0, 2.0):
        p.gbox((cx - 0.9, 0, D / 2), (cx + 0.9, 2.6, D / 2 + 0.07), 'door_blue', ('+z',))
        for k in range(5):
            p.gbox((cx - 0.8, 0.5 + k * 0.4, D / 2 + 0.07), (cx + 0.8, 0.55 + k * 0.4, D / 2 + 0.09), 'steel_dark', ('+z',))
    p.gbox((-3.5, H + 0.3, -1.0), (-1.5, H + 1.1, 1.0), 'zinc')
    p.gbox((2.0, 1.4, -D / 2 - 0.6), (3.4, 3.2, -D / 2), 'zinc')                              # transformer cabinet on the back
    a.mesh('building', p, 'substation block with two doors and roof plant')
    dims = {'lengthM': L, 'widthM': D, 'heightM': H + 1.1, 'tag': 'A', 'reason': 'generic substation'}
    return a.root, a.info(dims, [{'fact': 'generic substation 9 x 5.5 x 4 m', 'tag': 'A'}], limits={}, attach=[])


# ---- backdrop ----------------------------------------------------------------
def _lcg(seed):
    s = [seed & 0xFFFFFFFF]

    def nxt():
        s[0] = (s[0] * 1664525 + 1013904223) & 0xFFFFFFFF
        return s[0] / 4294967296
    return nxt


def _heightfield(p, xs, zs, height, colour):
    """Flat-shaded grid over (xs, zs) with y = height(i, j); each quad is split into two triangles and coloured by `colour(h, slope)`."""
    grid = [[(xs[i], height(i, j), zs[j]) for j in range(len(zs))] for i in range(len(xs))]
    for i in range(len(xs) - 1):
        for j in range(len(zs) - 1):
            a, b, c, d = grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]
            for tri in ((a, b, c), (a, c, d)):
                hs = [t[1] for t in tri]
                (x0, y0, z0), (x1, y1, z1), (x2, y2, z2) = tri
                ux, uy, uz, vx, vy, vz = x1 - x0, y1 - y0, z1 - z0, x2 - x0, y2 - y0, z2 - z0
                nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
                ln = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
                if ny < 0:
                    nx, ny, nz = -nx, -ny, -nz
                slope = 1.0 - ny / ln
                sw = colour(sum(hs) / 3, slope)
                p.m.ngon([gv(t) for t in tri], [p.atlas.swatch_uv(sw)] * 3, outward=gv((nx, ny, nz)))


# The Rock of Gibraltar at true scale (spec #116, ticket #120). Repeats `ROCK` in
# src/sims/terminal-twin/terminals/tti-algeciras/constants.ts: change both together.
ROCK_LENGTH, ROCK_WIDTH, ROCK_HEIGHT, ROCK_DISTANCE = 5200.0, 1200.0, 426.0, 9200.0
ROCK_PROFILE = [(-2600, 0), (-2570, 70), (-2500, 250), (-2420, 370), (-2250, 420), (-1900, 426), (-1400, 405), (-900, 392), (-300, 415),
                (300, 330), (800, 255), (1200, 185), (1500, 110), (1800, 62), (2300, 48), (2480, 38), (2600, 0)]


def build_backdrop_rock(atlas_image):
    a = Asset('backdrop-rock', 'backdrop', make_material(atlas_image, 1.0), 'low-poly Rock of Gibraltar at true scale (5.2 km north-south along X, 1.2 km wide, 426 m high); origin at the base centre, steep east face on the far (-Z) side, gentler west slope toward +Z')
    rnd = _lcg(21)
    prof = ROCK_PROFILE

    def ridge_h(x):
        for (x0, h0), (x1, h1) in zip(prof, prof[1:]):
            if x0 <= x <= x1:
                return h0 + (h1 - h0) * (x - x0) / (x1 - x0)
        return 0.0
    nx, nz = 80, 18
    xs = [-ROCK_LENGTH / 2 + i * ROCK_LENGTH / nx for i in range(nx + 1)]
    zs = [-ROCK_WIDTH / 2 + j * ROCK_WIDTH / nz for j in range(nz + 1)]
    noise = [[rnd() for _ in zs] for _ in xs]
    half = ROCK_WIDTH / 2
    crest_z = -250.0  # the crest sits toward the east (-Z): steep east face, gentler west slope toward Algeciras

    def narrow(x):
        # the Rock tapers toward Europa Point and is a little narrower at the north face
        if x > 1200:
            return 1.0 - 0.55 * min(1.0, (x - 1200) / 1400)
        return 0.85 + 0.15 * min(1.0, (x + 2600) / 800)

    def section(z, x):
        zn = z / narrow(x)
        if zn <= -half or zn >= half:
            return 0.0
        if zn <= crest_z:
            return ((zn + half) / (crest_z + half)) ** 0.7
        return max(0.0, 1 - (zn - crest_z) / (half - crest_z)) ** 1.15

    def height(i, j):
        h = ridge_h(xs[i]) * section(zs[j], xs[i])
        if h > 0:
            h *= 0.9 + 0.2 * noise[i][j]
        return min(ROCK_HEIGHT, max(0.0, h))

    def colour(h, slope):
        if h < 70:
            return 'scrub'
        if slope > 0.34 and h > 120:
            return 'rock_dark'
        return 'rock_light' if h > 260 else 'hill_dry'
    p = GPart(ATLAS_OBJ)
    _heightfield(p, xs, zs, height, colour)
    a.mesh('rock', p, 'faceted limestone ridge with scrub on the lower slopes')
    dims = {'lengthM': 5200, 'widthM': 1200, 'heightM': 426, 'tag': 'V', 'reason': 'Rock of Gibraltar: about 5.2 km north to south, about 1.2 km wide, 426 m high (true scale, no vertical exaggeration)'}
    return a.root, a.info(dims, [{'fact': 'about 5.2 km long north to south, about 1.2 km wide, 426 m summit', 'tag': 'V', 'source': 'public elevation data and the reference map and photos (summary figures)'},
                                 {'fact': 'steep north face, summit ridge in the north half, stepped fall to Europa Point, steeper east face', 'tag': 'V', 'source': 'reference photo from the Algeciras hills'},
                                 {'fact': 'cross-section taper and facet noise', 'tag': 'A', 'reason': 'silhouette only'}], limits={}, attach=[], backdrop={'distanceM': 9200})


def build_backdrop_hills(atlas_image):
    a = Asset('backdrop-hills', 'backdrop', make_material(atlas_image, 1.0), 'low-poly Algeciras hills behind the terminal (9 km long, 150-480 m); origin at the base centre')
    rnd = _lcg(7)
    nx, nz = 60, 6
    xs = [-4500 + i * 9000 / (nx - 1) for i in range(nx)]
    zs = [-450 + j * 900 / (nz - 1) for j in range(nz)]
    ridge = []
    h = 315.0
    for i in range(nx):
        h = min(480.0, max(150.0, h + (rnd() - 0.5) * 330 * 0.7))
        ridge.append(h)
    noise = [[rnd() for _ in zs] for _ in xs]

    def height(i, j):
        t = abs(zs[j]) / 450.0
        return max(0.0, ridge[i] * (1 - t ** 1.6) * (0.9 + 0.2 * noise[i][j]))

    def colour(hh, slope):
        if slope > 0.3:
            return 'rock_dark'
        return 'hill_dry' if hh > 330 else 'hill_green'
    p = GPart(ATLAS_OBJ)
    _heightfield(p, xs, zs, height, colour)
    a.mesh('hills', p, 'faceted hill range')
    dims = {'lengthM': 9000, 'widthM': 900, 'heightM': 480, 'tag': 'A', 'reason': 'silhouette of the hills behind Algeciras, not a survey'}
    return a.root, a.info(dims, [{'fact': 'hill range 9 km long, 150-480 m', 'tag': 'A', 'reason': 'matches the TT-21 backdrop figures'}], limits={}, attach=[], backdrop={'distanceM': 4300})


def build_backdrop_coast(atlas_image):
    a = Asset('backdrop-coast', 'backdrop', make_material(atlas_image, 1.0), 'low-poly generic coastline: a low isthmus with a few dunes (6 km long, up to 26 m); origin at the base centre')
    rnd = _lcg(11)
    nx, nz = 60, 5
    xs = [-3000 + i * 6000 / (nx - 1) for i in range(nx)]
    zs = [-250 + j * 500 / (nz - 1) for j in range(nz)]
    ridge = []
    h = 16.0
    for _ in xs:
        h = min(26.0, max(6.0, h + (rnd() - 0.5) * 20 * 0.7))
        ridge.append(h)

    def height(i, j):
        t = abs(zs[j]) / 250.0
        return max(0.0, ridge[i] * (1 - t ** 1.5))

    def colour(hh, slope):
        return 'sand' if hh < 9 else 'scrub'
    p = GPart(ATLAS_OBJ)
    _heightfield(p, xs, zs, height, colour)
    a.mesh('coast', p, 'low coastline strip')
    dims = {'lengthM': 6000, 'widthM': 500, 'heightM': 26, 'tag': 'A', 'reason': 'generic low coastline'}
    return a.root, a.info(dims, [{'fact': 'generic coastline strip, 6 km long, 6-26 m', 'tag': 'A'}], limits={}, attach=[], backdrop={'distanceM': 6200})


# name, builder, preview views (each ((x, y, z) camera, (x, y, z) target) in glTF axes), ground size
ASSETS = [
    ('gate-lane', lambda img: build_gate_lane(img, False), [((8, 6.5, -14), (0, 2.5, 0)), ((0, 2.2, -16), (0, 2.5, 0))], 40.0),
    ('gate-lane-oog', lambda img: build_gate_lane(img, True), [((16, 7.5, -16), (0, 2.5, 0)), ((0, 2.5, -20), (0, 2.5, 0))], 50.0),
    ('gate-island', build_gate_island, [((7, 4.0, -11), (0, 2.0, 0)), ((0, 2.0, -12), (0, 2.5, 0))], 40.0),
    ('gate-office', build_gate_office, [((14, 6, 16), (0, 1.8, 0))], 50.0),
    ('quay-edge', build_quay_edge, [((6, 3, 7), (0, -0.3, 0))], 30.0),
    ('quay-rail', build_quay_rail, [((5, 2.2, 4), (0, 0.1, 0))], 30.0),
    ('quay-bollard', build_quay_bollard, [((2.2, 1.4, 2.2), (0, 0.35, 0))], 10.0),
    ('quay-fender', build_quay_fender, [((3.5, -1.0, -8.0), (0, -1.0, -0.4))], 10.0),
    ('yard-mast', build_yard_mast, [((70, 45, 70), (0, 15, 0)), ((7, 31, 7), (0, 29, 0))], 80.0),
    ('yard-fence', build_yard_fence, [((5, 1.8, 6), (0, 1.2, 0))], 20.0),
    ('yard-asc-rail', build_yard_asc_rail, [((5, 2.0, 4), (0, 0.1, 0))], 30.0),
    ('yard-markings', build_yard_markings, [((8, 12, -12), (0, 0, 0))], 30.0),
    ('building-control', build_building_control, [((40, 20, 40), (0, 5, 0))], 120.0),
    ('building-workshop', build_building_workshop, [((55, 25, 60), (0, 5, 0))], 150.0),
    ('building-substation', build_building_substation, [((16, 8, 16), (0, 2, 0))], 60.0),
    ('backdrop-rock', build_backdrop_rock, [((0, 1800, 7000), (0, 150, 0)), ((-1500, 300, 3200), (-500, 200, 0))], 14000.0),
    ('backdrop-hills', build_backdrop_hills, [((0, 700, 6500), (0, 150, 0))], 20000.0),
    ('backdrop-coast', build_backdrop_coast, [((0, 120, 4000), (0, 0, 0))], 10000.0),
]
