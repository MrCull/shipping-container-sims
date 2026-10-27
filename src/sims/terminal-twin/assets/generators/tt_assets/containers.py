"""ISO container assets: 20 ft, 40 ft and 40 ft high cube, each with two LODs.

Hierarchy (glTF names):
  container-<size>          root, origin = bottom centre (ground contact)
    LOD0                    detailed (~300-440 triangles)
      body                  frame, castings, corrugated side walls, roof, front wall
      door_left             door leaf + 2 locking bars + handles; pivot at its hinge
      door_right
    LOD1                    12-triangle box, normal-mapped corrugation (TEXCOORD_1)

Blender axes: X = length (front end -X, door end +X), Y = width, Z = up.
glTF axes:    X = length (doors at +X), Y = up, Z = width.
"""
import math

from .blender import MeshBuilder, empty, textured_material
from .liveries import RIB_BASE_HALF, RIB_DEPTH_M, RIB_TOP_HALF, region_uv_point, region_uv_rect

# [V] ISO 668 external dimensions (m).
SIZES = {
    '20': {'length': 6.058, 'width': 2.438, 'height': 2.591, 'side': 'side20', 'iso': '22G1', 'teu': 1},
    '40': {'length': 12.192, 'width': 2.438, 'height': 2.591, 'side': 'side40', 'iso': '42G1', 'teu': 2},
    '40HC': {'length': 12.192, 'width': 2.438, 'height': 2.896, 'side': 'side40', 'iso': '45G1', 'teu': 2},
}

# [V] ISO 1161 corner casting envelope (m).
CAST_L, CAST_W, CAST_H = 0.178, 0.162, 0.118
# [M] Geometric corrugation pitch: about twice the real ~0.28 m pitch, to stay
# within the ~400-triangle LOD0 budget. LOD1's normal map uses the same pitch.
TARGET_PITCH_M = 0.56
DOOR_SWING_DEG = 270  # [P] doors open 270 degrees and rest against the side walls.

BOTTOM_RAIL_TOP = 0.16
TOP_RAIL_DEPTH = 0.10
WALL_INSET = 0.05         # side-wall valley plane, inset from the outer envelope
RIB_OUTSET = WALL_INSET - RIB_DEPTH_M
EDGE = 0.006              # rails sit just inside the castings' outer faces
POST_INSET = 0.008
DOOR_PLANE = 0.03         # door leaves' outer face, inset from the door-end envelope
HINGE_INSET = 0.01


def corrugation(length):
    """Number of ribs and the actual pitch on a side wall between the corner posts."""
    span = length - 2 * CAST_L
    n = max(1, round(span / TARGET_PITCH_M))
    return n, span / n, -length / 2 + CAST_L


def _side_uv(size_key, L, H, side_sign):
    """UV for a point on a long side: +Y side reads with u along -X, -Y side along +X."""
    u0, v0, u1, v1 = region_uv_rect(SIZES[size_key]['side'])

    def uv(p):
        x, _, z = p
        t = (x + L / 2) / L
        if side_sign > 0:
            t = 1 - t
        return (u0 + t * (u1 - u0), v0 + (z / H) * (v1 - v0))
    return uv


def _end_uv(region, W, H, sign):
    """UV for a point on an end face: door end (+X) u along +Y, front end (-X) along -Y."""
    u0, v0, u1, v1 = region_uv_rect(region)

    def uv(p):
        _, y, z = p
        t = (y + W / 2) / W
        if sign < 0:
            t = 1 - t
        return (u0 + t * (u1 - u0), v0 + (z / H) * (v1 - v0))
    return uv


def _const(region):
    pt = region_uv_point(region)
    return lambda *_: [pt] * 4


def build_body(size_key):
    d = SIZES[size_key]
    L, W, H = d['length'], d['width'], d['height']
    hl, hw = L / 2, W / 2
    m = MeshBuilder()
    solid, dark = _const('solid'), _const('dark')

    # Corner castings: 8, outward faces only.
    for sx in (-1, 1):
        for sy in (-1, 1):
            for top in (False, True):
                x0, x1 = sorted((sx * hl, sx * (hl - CAST_L)))
                y0, y1 = sorted((sy * hw, sy * (hw - CAST_W)))
                z0, z1 = (H - CAST_H, H) if top else (0.0, CAST_H)
                faces = ['+x' if sx > 0 else '-x', '+y' if sy > 0 else '-y', '+z' if top else '-z']
                m.box_faces((x0, y0, z0), (x1, y1, z1), faces, dark)
    # Corner posts between the castings.
    for sx in (-1, 1):
        for sy in (-1, 1):
            x0, x1 = sorted((sx * (hl - POST_INSET), sx * (hl - CAST_L + 0.008)))
            y0, y1 = sorted((sy * (hw - POST_INSET), sy * (hw - CAST_W + 0.007)))
            m.box_faces((x0, y0, CAST_H), (x1, y1, H - CAST_H), ['+x', '-x', '+y', '-y'], solid)
    # Side rails (bottom: top + outer; top: top + outer + underside).
    for sy in (-1, 1):
        oy = '+y' if sy > 0 else '-y'
        y0, y1 = sorted((sy * (hw - EDGE), sy * (hw - 0.08)))
        m.box_faces((-hl + CAST_L, y0, 0.012), (hl - CAST_L, y1, BOTTOM_RAIL_TOP), ['+z', oy], solid)
        y0, y1 = sorted((sy * (hw - EDGE), sy * (hw - TOP_RAIL_DEPTH)))
        m.box_faces((-hl + CAST_L, y0, H - TOP_RAIL_DEPTH), (hl - CAST_L, y1, H - 0.012), ['+z', oy, '-z'], solid)
    # End rails (sill/header at the door end, bottom/top rail at the front end).
    for sx in (-1, 1):
        ox = '+x' if sx > 0 else '-x'
        x0, x1 = sorted((sx * (hl - EDGE), sx * (hl - 0.08)))
        m.box_faces((x0, -hw + CAST_W, 0.012), (x1, hw - CAST_W, BOTTOM_RAIL_TOP), ['+z', ox], solid)
        x0, x1 = sorted((sx * (hl - EDGE), sx * (hl - 0.12)))
        m.box_faces((x0, -hw + CAST_W, H - TOP_RAIL_DEPTH), (x1, hw - CAST_W, H - 0.012), ['+z', ox, '-z'], solid)
    # Roof and underside.
    m.quad([(-hl + 0.12, -hw + TOP_RAIL_DEPTH, H - 0.012), (hl - 0.12, -hw + TOP_RAIL_DEPTH, H - 0.012),
            (hl - 0.12, hw - TOP_RAIL_DEPTH, H - 0.012), (-hl + 0.12, hw - TOP_RAIL_DEPTH, H - 0.012)],
           solid(), outward=(0, 0, 1))
    m.quad([(-hl + CAST_L, -hw + EDGE, 0.012), (hl - CAST_L, -hw + EDGE, 0.012),
            (hl - CAST_L, hw - EDGE, 0.012), (-hl + CAST_L, hw - EDGE, 0.012)],
           dark(), outward=(0, 0, -1))
    # Front end wall.
    fy, zb, zt = hw - CAST_W + 0.007, BOTTOM_RAIL_TOP, H - TOP_RAIL_DEPTH
    fx = -hl + 0.05
    front_uv = _end_uv('front', W, H, -1)
    pts = [(fx, fy, zb), (fx, -fy, zb), (fx, -fy, zt), (fx, fy, zt)]
    m.quad(pts, [front_uv(p) for p in pts], outward=(-1, 0, 0))
    # Dark interior behind the doors (seen only when they are open).
    ix = hl - 0.06
    pts = [(ix, -fy, zb), (ix, fy, zb), (ix, fy, zt), (ix, -fy, zt)]
    m.quad(pts, dark(), outward=(1, 0, 0))
    # Corrugated long sides: a valley plane plus trapezoid ribs (3 quads each).
    n, pitch, x_start = corrugation(L)
    for sy in (-1, 1):
        uv = _side_uv(size_key, L, H, sy)
        yv = sy * (hw - WALL_INSET)
        yr = sy * (hw - RIB_OUTSET)
        out = (0, sy, 0)
        pts = [(x_start, yv, zb), (-x_start, yv, zb), (-x_start, yv, zt), (x_start, yv, zt)]
        m.quad(pts, [uv(p) for p in pts], outward=out)
        for i in range(n):
            xc = x_start + (i + 0.5) * pitch
            xb0, xt0, xt1, xb1 = xc - RIB_BASE_HALF * pitch, xc - RIB_TOP_HALF * pitch, xc + RIB_TOP_HALF * pitch, xc + RIB_BASE_HALF * pitch
            for (xa, ya), (xb, yb) in (((xb0, yv), (xt0, yr)), ((xt0, yr), (xt1, yr)), ((xt1, yr), (xb1, yv))):
                pts = [(xa, ya, zb), (xb, yb, zb), (xb, yb, zt), (xa, ya, zt)]
                m.quad(pts, [uv(p) for p in pts], outward=out)
    return m


def build_door(size_key, side):
    """One door leaf in the hinge's local frame (pivot at the hinge, closed = 0 deg).

    side +1 = door_left (hinge at +Y), -1 = door_right (hinge at -Y).
    Returns (builder, pivot_location)."""
    d = SIZES[size_key]
    L, W, H = d['length'], d['width'], d['height']
    hl, hw = L / 2, W / 2
    pivot = (hl - HINGE_INSET, side * (hw - HINGE_INSET), 0.0)
    m = MeshBuilder()
    door_uv = _end_uv('door', W, H, 1)
    metal, dark = _const('metal'), _const('dark')
    px, py, _ = pivot
    xo = hl - DOOR_PLANE - px                     # leaf outer face, local
    y_hinge = side * (hw - CAST_W + 0.007) - py  # leaf edge at the corner post
    y_centre = -py                               # leaf edge at the centre seam
    zb, zt = BOTTOM_RAIL_TOP, H - TOP_RAIL_DEPTH

    def world(p):
        return (p[0] + px, p[1] + py, p[2])

    ya, yb = sorted((y_hinge, y_centre))
    pts = [(xo, ya, zb), (xo, yb, zb), (xo, yb, zt), (xo, ya, zt)]
    m.quad(pts, [door_uv(world(p)) for p in pts], outward=(1, 0, 0))
    m.quad([(xo - 0.02, ya, zb), (xo - 0.02, yb, zb), (xo - 0.02, yb, zt), (xo - 0.02, ya, zt)], dark(), outward=(-1, 0, 0))
    # Two locking bars per leaf (at 0.24 and 0.76 of the leaf width) with handles.
    for f in (0.24, 0.76):
        yc = y_centre + (y_hinge - y_centre) * f
        m.box_faces((xo, yc - 0.018, zb + 0.05), (xo + 0.035, yc + 0.018, zt - 0.04), ['+x', '+y', '-y'], metal)
        hy0, hy1 = sorted((yc, yc + (y_hinge - y_centre) * 0.22))
        m.box_faces((xo + 0.02, hy0, 1.05), (xo + 0.06, hy1, 1.10), ['+x', '+z', '-z'], metal)
    return m, pivot


def build_lod1(size_key):
    d = SIZES[size_key]
    L, W, H = d['length'], d['width'], d['height']
    hl, hw = L / 2, W / 2
    m = MeshBuilder(uv_layers=2)
    _, pitch, x_start = corrugation(L)
    side_uv = {1: _side_uv(size_key, L, H, 1), -1: _side_uv(size_key, L, H, -1)}
    door_uv, front_uv = _end_uv('door', W, H, 1), _end_uv('front', W, H, -1)
    flat_u1 = 0.5  # middle of a rib top: flat normal

    def uv0(face, pts):
        if face == '+y':
            return [side_uv[1](p) for p in pts]
        if face == '-y':
            return [side_uv[-1](p) for p in pts]
        if face == '+x':
            return [door_uv(p) for p in pts]
        if face == '-x':
            return [front_uv(p) for p in pts]
        return [region_uv_point('solid')] * 4

    def uv1(face, pts):
        # Same u direction as uv0 (the -Y side reads along +X, the +Y side along -X),
        # in pitches from the first rib's start, so rib centres sit at u = k + 0.5.
        if face == '-y':
            return [((p[0] - x_start) / pitch, p[2]) for p in pts]
        if face == '+y':
            return [((-x_start - p[0]) / pitch, p[2]) for p in pts]
        return [(flat_u1, 0.5)] * 4

    m.box_faces((-hl, -hw, 0), (hl, hw, H), ['+x', '-x', '+y', '-y', '+z', '-z'], uv0, uv1)
    return m


def build_container(size_key, atlas_image, normal_image):
    """Builds the asset hierarchy; returns (root, info)."""
    d = SIZES[size_key]
    name = f'container-{size_key.lower()}'
    lod0_mat = textured_material('container_lod0', atlas_image, roughness=0.55)
    lod1_mat = textured_material('container_lod1', atlas_image, roughness=0.55, normal_image=normal_image)
    root = empty(name)
    lod0 = empty('LOD0', root)
    body = build_body(size_key)
    body.to_object('body', lod0_mat, lod0)
    doors = {}
    for side, node in ((1, 'door_left'), (-1, 'door_right')):
        builder, pivot = build_door(size_key, side)
        obj = builder.to_object(node, lod0_mat, lod0)
        obj.location = pivot
        doors[node] = (builder, pivot)
    lod1 = build_lod1(size_key)
    lod1.to_object('LOD1', lod1_mat, root)
    n, pitch, _ = corrugation(d['length'])
    tris = {
        'LOD0': body.triangles + sum(b.triangles for b, _ in doors.values()),
        'LOD1': lod1.triangles,
    }
    return root, {'name': name, 'dims': d, 'pivots': {k: v[1] for k, v in doors.items()}, 'ribs': n, 'pitch': pitch, 'triangles': tris}


def _gl(p):
    """Blender (x, y, z) -> glTF (x, z, -y), rounded to mm."""
    x, y, z = p
    return [round(x, 4), round(z, 4), round(-y + 0.0, 4)]


def sidecar(size_key, info):
    d = info['dims']
    L, W, H = d['length'], d['width'], d['height']
    hl, hw = L / 2, W / 2
    # Top corner-casting apertures: spreader twist-lock points [V ISO 1161 positions, approx. centres].
    tl = []
    bl = []
    for sx, ex in ((-1, 'front'), (1, 'door')):
        for sy, ey in ((1, 'left'), (-1, 'right')):
            c = (sx * (hl - CAST_L / 2), sy * (hw - CAST_W / 2))
            tl.append({'name': f'twistlock_{ex}_{ey}', 'position': _gl((c[0], c[1], H)), 'tag': 'V'})
            bl.append({'name': f'stack_{ex}_{ey}', 'position': _gl((c[0], c[1], 0.0)), 'tag': 'V'})
    pl, pr = info['pivots']['door_left'], info['pivots']['door_right']
    return {
        'asset': info['name'],
        'kind': 'container',
        'version': 1,
        'generator': 'src/sims/terminal-twin/assets/generators/build.py --only containers',
        'units': 'm',
        'isoSizeType': d['iso'],
        'teu': d['teu'],
        'dimensions': {'lengthM': L, 'widthM': W, 'heightM': H, 'tag': 'V', 'source': 'ISO 668 external dimensions'},
        'axes': {
            'up': '+Y',
            'length': '+X (front end at -X, doors at +X)',
            'width': '+Z',
            'origin': 'bottom centre of the box (ground contact)',
            'handedness': 'right-handed, glTF',
        },
        'nodes': [
            {'name': 'LOD0', 'parent': info['name'], 'role': 'lod', 'description': 'detailed; renderer uses it for the nearest few hundred boxes'},
            {'name': 'body', 'parent': 'LOD0', 'role': 'mesh', 'description': 'frame, corner castings, corrugated sides, roof, front wall'},
            {'name': 'door_left', 'parent': 'LOD0', 'role': 'rig', 'pivot': _gl(pl), 'axis': '+Y',
             'description': 'door leaf hinged at +Z (glTF) side; positive rotation opens it'},
            {'name': 'door_right', 'parent': 'LOD0', 'role': 'rig', 'pivot': _gl(pr), 'axis': '+Y',
             'description': 'door leaf hinged at -Z (glTF) side; negative rotation opens it'},
            {'name': 'LOD1', 'parent': info['name'], 'role': 'lod', 'description': '12-triangle box with normal-mapped corrugation (TEXCOORD_1)'},
        ],
        'travelLimits': {
            'door_left': {'type': 'rotation', 'axis': '+Y', 'minDeg': 0, 'maxDeg': DOOR_SWING_DEG, 'rest': 0, 'tag': 'P'},
            'door_right': {'type': 'rotation', 'axis': '+Y', 'minDeg': -DOOR_SWING_DEG, 'maxDeg': 0, 'rest': 0, 'tag': 'P'},
        },
        'attachPoints': tl + bl,
        'groundContact': {'y': 0, 'points': [b['name'] for b in bl], 'tag': 'V'},
        'lods': {
            'LOD0': {'triangles': info['triangles']['LOD0'], 'material': 'container_lod0'},
            'LOD1': {'triangles': info['triangles']['LOD1'], 'material': 'container_lod1'},
        },
        'liveries': {
            'atlas': 'livery-atlas.json',
            'uv': 'TEXCOORD_0 is authored for atlas tile 0 (HMM); offset by the tile of the instance\'s livery index',
            'corrugationNormalMap': {'texCoord': 1, 'pitchM': round(info['pitch'], 4), 'ribs': info['ribs']},
        },
        'provenance': [
            {'fact': f'external dimensions {round(L * 1000)} x {round(W * 1000)} x {round(H * 1000)} mm', 'tag': 'V', 'source': 'ISO 668'},
            {'fact': 'corner casting envelope 178 x 162 x 118 mm at the eight corners', 'tag': 'V', 'source': 'ISO 1161'},
            {'fact': 'twist-lock / stacking points at the corner-casting centres', 'tag': 'V', 'source': 'ISO 1161 (aperture centres approximated)'},
            {'fact': 'two door leaves with two vertical locking bars each, opening 270 degrees', 'tag': 'P', 'source': 'reference photographs (not committed)'},
            {'fact': f'side-wall corrugation pitch {round(info["pitch"], 3)} m and depth {RIB_DEPTH_M} m', 'tag': 'M',
             'reason': 'real pitch is about 0.28 m; doubled to fit the ~400-triangle LOD0 budget. LOD1 normal map uses the same pitch so LODs match'},
            {'fact': 'rail, post and door-plane insets', 'tag': 'A'},
            {'fact': 'front end wall and roof drawn flat (no corrugation)', 'tag': 'M', 'reason': 'triangle budget'},
            {'fact': 'livery colours and wordmarks', 'tag': 'A', 'source': 'livery-atlas.json'},
        ],
    }


def set_door_angle(obj, degrees):
    obj.rotation_euler = (0.0, 0.0, math.radians(degrees))
