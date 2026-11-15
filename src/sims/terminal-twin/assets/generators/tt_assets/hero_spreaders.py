"""Hero spreaders (spec #273): a detailed spreader per source rig, shown in place of the rig's own within about 25 m.

One GLB per source rig: `hero-spreader-sts`, `hero-spreader-asc`, `hero-spreader-shc`. The `LOD0` node IS the source
rig's `spreader` node frame (same origin, axes and size as `sts.py#spreader_part`, `asc.py#spreader_mesh`,
`shc.py#spreader_mesh`), so the renderer adds `LOD0` under that rig's `spreader` node with an identity transform.
The rig nodes below it keep the source names and pivots, so the rig code that turns twist-locks and slides telescopes
can drive them:

  hero-spreader-asc | -shc > LOD0 > spreader_geo, twistlock_fl|fr|rl|rr > twistlock_*_geo
  hero-spreader-sts        > LOD0 > spreader_geo,
                                    spreader_tele_fore|aft > *_geo, twistlock_{fore|aft}_{land|sea} > *_geo
                                    twin_locks > twin_locks_geo, twistlock_twin_{aft|fore}_{land|sea} > *_geo

Rig nodes are empties at the pivot; the mesh is the `<name>_geo` child (see docs/assets-pipeline.md). Flippers are
modelled raised and have no node. One material (`hero_spreader`): UV0 picks a swatch of a small palette, UV1 is metres
over DETAIL_TILE_M for the detail normal and ORM maps shared with the hero container faces. Deterministic.

Geometry is written in a canonical frame (u = along the spreader, v = across, w = up, w 0 = the twist-lock plane) and
mapped to each rig's Blender axes by `_Builder`.
"""
import bpy

from . import asc as A
from . import sts as STS
from .blender import MeshBuilder, empty
from .hero_containers import DETAIL_TILE_M, TEX_SIZE

KINDS = ('sts', 'asc', 'shc')
SOURCE_ASSET = {'sts': STS.NAME, 'asc': 'asc', 'shc': 'shc'}
PALETTE = {
    'yellow': (0.93, 0.68, 0.04), 'red': (0.72, 0.09, 0.07), 'black': (0.03, 0.03, 0.03), 'steel': (0.52, 0.54, 0.56),
    'dark': (0.09, 0.09, 0.1), 'white': (0.86, 0.87, 0.85), 'amber': (0.95, 0.5, 0.05), 'zinc': (0.7, 0.72, 0.74),
}
SWATCH_PX = 8
ALL = ('+x', '-x', '+y', '-y', '+z', '-z')
SHC_LOCK_U, SHC_LOCK_V = 6.0, 1.138   # shc.py#build_lod twist-lock pivots
FIXED_HALF_LEN = 6.0                  # end beam centres of the ASC and SHC spreaders (40 ft)
# Extra extents the source spreaders have: ASC side bumpers and end lamps (asc.py#spreader_mesh).
FIXED = {
    'asc': {'paint': 'yellow', 'lock_u': A.TWIST_Y, 'lock_v': A.TWIST_X, 'bumper_v': 1.46, 'lamp_u': 6.35},
    'shc': {'paint': 'red', 'lock_u': SHC_LOCK_U, 'lock_v': SHC_LOCK_V, 'bumper_v': None, 'lamp_u': None},
}
STRIPE = 0.004


def asset_name(kind):
    return f'hero-spreader-{kind}'


def write_palette(path):
    names = list(PALETTE)
    w = SWATCH_PX * len(names)
    pixels = []
    for _ in range(SWATCH_PX):
        for name in names:
            pixels.extend((*PALETTE[name], 1.0) * SWATCH_PX)
    img = bpy.data.images.new('hero_spreader_palette', w, SWATCH_PX, alpha=False, float_buffer=False)
    img.pixels.foreach_set(pixels)
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


def spreader_material(palette_image, normal_image, orm_image):
    """One Principled material: palette colour on UV0, detail normal and ORM roughness on UV1."""
    mat = bpy.data.materials.new('hero_spreader')
    mat.use_nodes = True
    mat.use_backface_culling = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    uv0 = nt.nodes.new('ShaderNodeUVMap')
    uv0.uv_map = 'UVMap'
    base = nt.nodes.new('ShaderNodeTexImage')
    base.image = palette_image
    base.interpolation = 'Closest'
    nt.links.new(uv0.outputs['UV'], base.inputs['Vector'])
    nt.links.new(base.outputs['Color'], bsdf.inputs['Base Color'])
    uv1 = nt.nodes.new('ShaderNodeUVMap')
    uv1.uv_map = 'UV1'
    ntex = nt.nodes.new('ShaderNodeTexImage')
    ntex.image = normal_image
    ntex.extension = 'REPEAT'
    nt.links.new(uv1.outputs['UV'], ntex.inputs['Vector'])
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nmap.space = 'TANGENT'
    nmap.uv_map = 'UV1'
    nmap.inputs['Strength'].default_value = 0.6
    nt.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    otex = nt.nodes.new('ShaderNodeTexImage')
    otex.image = orm_image
    otex.extension = 'REPEAT'
    nt.links.new(uv1.outputs['UV'], otex.inputs['Vector'])
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(otex.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    return mat


def _swatch(colour):
    i = list(PALETTE).index(colour)
    return ((i + 0.5) / len(PALETTE), 0.5)


def _uv1(face, pts):
    a, b = {'x': (1, 2), 'y': (0, 2), 'z': (0, 1)}[face[1]]
    return [(p[a] / DETAIL_TILE_M, p[b] / DETAIL_TILE_M) for p in pts]


class _Builder:
    """Boxes and cylinders in the canonical (u, v, w) frame, written in Blender axes. `swap`: the rig's long axis is
    Blender Y (the ASC), else Blender X. STS and SHC: Blender (u, v, w); the STS's landward side (glTF +Z) is v < 0."""

    def __init__(self, swap):
        self.swap = swap
        self.m = MeshBuilder(uv_layers=2)

    def point(self, c):
        return (c[1], c[0], c[2]) if self.swap else (c[0], c[1], c[2])

    def box(self, lo, hi, colour):
        a, b = self.point(lo), self.point(hi)
        uv = _swatch(colour)
        self.m.box_faces(tuple(min(p, q) for p, q in zip(a, b)), tuple(max(p, q) for p, q in zip(a, b)), ALL, lambda f, pts: [uv] * 4, _uv1)

    def cyl(self, base, radius, length, axis, colour, segs=8):
        """A capped prism from `base` along canonical `axis` ('u', 'v' or 'w')."""
        ax = {'u': 'y' if self.swap else 'x', 'v': 'x' if self.swap else 'y', 'w': 'z'}[axis]
        self.m.cylinder(self.point(base), radius, length, segs, _swatch(colour), axis=ax, caps=True)


def _stripes(b, su, u_face, v_half, w0, w1, paint, n=10):
    """Yellow and black warning bands across an end face (thin plates just off the paint)."""
    step = 2 * v_half / n
    for i in range(n):
        colour = 'black' if i % 2 == 0 else ('yellow' if paint != 'yellow' else None)
        if colour:
            b.box((su * u_face, -v_half + i * step, w0), (su * (u_face + STRIPE), -v_half + (i + 1) * step, w1), colour)


def _flipper(b, su, sv, u_edge, v_corner, base, top, ext, paint):
    """A raised corner flipper: an end plate and a side plate with black tips, a hinge and its hydraulic cylinder."""
    tip = top - 0.14
    for (u0, u1, v0, v1) in ((u_edge - 0.04, u_edge, v_corner - 0.3, v_corner + ext), (u_edge - 0.5, u_edge - 0.04, v_corner - 0.04, v_corner)):
        b.box((su * u0, sv * v0, base), (su * u1, sv * v1, tip), paint)
        b.box((su * u0, sv * v0, tip), (su * u1, sv * v1, top), 'black')
    b.cyl((su * (u_edge - 0.04), sv * (v_corner - 0.3) if sv > 0 else sv * (v_corner + ext), base), 0.035, 0.3 + ext, 'v', 'steel', 6)
    b.cyl((su * (u_edge - 0.3), sv * (v_corner - 0.14), base), 0.035, (top - base) * 0.6, 'w', 'zinc', 6)


def _fixed_body(b, kind):
    """ASC and SHC: a fixed-length 40 ft frame, as their source spreaders."""
    k = FIXED[kind]
    paint, hl = k['paint'], FIXED_HALF_LEN
    for su in (-1, 1):
        b.box((su * hl - 0.3, -1.4, 0.04), (su * hl + 0.3, 1.4, 0.5), paint)                      # end beam
        _stripes(b, su, hl + 0.3, 1.4, 0.08, 0.46, paint)
        for sv in (-1, 1):
            b.box((su * hl - 0.32, sv * 1.1, 0.0), (su * hl + 0.32, sv * 1.42, 0.06), 'dark')     # corner guide shoe
            b.box((su * (hl + 0.3), sv * 1.16, 0.06), (su * (hl + 0.32), sv * 1.42, 0.22), 'dark')  # corner guide lip
            b.cyl((su * k['lock_u'], sv * k['lock_v'], 0.0), 0.1, 0.04, 'w', 'steel', 10)          # twist-lock housing collar
            b.box((su * k['lock_u'] - 0.16, sv * k['lock_v'] - 0.14, 0.5), (su * k['lock_u'] + 0.16, sv * k['lock_v'] + 0.14, 0.58), 'dark')  # lock actuator cover
            _flipper(b, su, sv, hl + 0.3, 1.4, 0.5, 0.95, 0.0, paint)
            b.box((su * (hl - 0.9) - 0.03, sv * 0.3, 0.5), (su * (hl - 0.9) + 0.03, sv * 1.3, 0.56), 'steel')  # beam stiffener
        if k['bumper_v']:
            b.box((su * hl - 0.2, -k['bumper_v'], 0.1), (su * hl + 0.2, k['bumper_v'], 0.2), 'black')
        if k['lamp_u']:
            b.box((su * (hl + 0.3), -0.35, 0.1), (su * k['lamp_u'], 0.35, 0.4), 'amber')
    b.box((-3.2, -0.9, 0.2), (3.2, 0.9, 0.7), paint)                                              # main beam (telescopic housing)
    for sv in (-1, 1):
        for i in range(7):                                                                        # lightening holes and ribs
            x = -2.7 + i * 0.9
            b.box((x - 0.2, sv * 0.9, 0.32), (x + 0.2, sv * 0.906, 0.58), 'dark')
            if i < 6:
                b.box((x + 0.43, sv * 0.9, 0.22), (x + 0.47, sv * 0.93, 0.68), paint)
        b.box((-FIXED_HALF_LEN, sv * 0.5 - 0.12, 0.28), (FIXED_HALF_LEN, sv * 0.5 + 0.12, 0.52), 'steel')  # telescopic inner beam
        for su in (-1, 1):
            b.box((su * 3.2 - 0.06, sv * 0.5 - 0.16, 0.24), (su * 3.2 + 0.06, sv * 0.5 + 0.16, 0.56), 'dark')   # beam collar
            b.cyl((su * 3.34, sv * 0.5 - 0.14, 0.57), 0.05, 0.28, 'v', 'zinc', 10)                # guide roller, top
            b.cyl((su * 3.34, sv * 0.5 + sv * 0.17, 0.3), 0.05, 0.2, 'w', 'zinc', 10)             # guide roller, side
            b.box((su * 4.5 - 0.15, sv * 0.5 - 0.125, 0.275), (su * 4.5 + 0.15, sv * 0.5 + 0.125, 0.525), 'black')  # wear pad
            b.cyl((su * 3.26 if su > 0 else -5.7, sv * 0.5, 0.545), 0.025, 2.44, 'u', 'dark', 6)   # hydraulic hose to the end beam
        b.cyl((-3.1, sv * 0.75, 0.725), 0.025, 6.2, 'u', 'dark', 6)                               # hydraulic hose on the housing
    # Headblock: base plate, four rope sheaves in brackets.
    b.box((-0.7, -0.55, 0.7), (0.7, 0.55, 0.84), 'dark')
    for su in (-1, 1):
        for sv in (-1, 1):
            b.cyl((su * 0.4, sv * 0.3 - 0.04, 0.86), 0.14, 0.08, 'v', 'steel', 12)
            for off in (-0.07, 0.05):
                b.box((su * 0.4 - 0.05, sv * 0.3 + off, 0.84), (su * 0.4 + 0.05, sv * 0.3 + off + 0.02, 0.92), paint)
    # Cable festoon: loops hanging from a carrier rail, and the hydraulic power pack with its motor.
    b.box((0.9, -0.03, 0.86), (3.1, 0.03, 0.9), 'steel')
    for i in range(7):
        b.box((0.95 + i * 0.3, -0.2, 0.7), (0.99 + i * 0.3, 0.2, 0.86), 'dark')
    b.box((-2.2, -0.45, 0.7), (-1.1, 0.45, 0.96), 'white')
    b.cyl((-3.05, 0.0, 0.83), 0.12, 0.8, 'u', 'steel', 10)


def _fixed_lock(b):
    b.cyl((0, 0, -0.06), 0.045, 0.12, 'w', 'dark', 10)
    b.box((-0.07, -0.03, -0.08), (0.07, 0.03, -0.04), 'steel')


def _sts_body(b):
    b.box((-2.2, -1.1, 0.15), (2.2, 1.1, 0.95), 'yellow')                                          # main frame
    b.box((-1.0, -0.8, 0.95), (1.0, 0.8, 1.0), 'dark')                                             # headblock seat
    for sv in (-1, 1):
        b.box((-2.9, sv * 0.55 - 0.18, 0.3), (2.9, sv * 0.55 + 0.18, 0.85), 'yellow')              # telescope sleeves
        for su in (-1, 1):
            b.box((su * 2.84, sv * 0.55 - 0.2, 0.28), (su * 2.9, sv * 0.55 + 0.2, 0.87), 'dark')   # sleeve mouth collar
            b.cyl((su * 2.7, sv * 0.55 - 0.16, 0.9), 0.05, 0.32, 'v', 'zinc', 10)                  # guide roller
            if sv > 0:
                b.cyl((0.9 if su > 0 else -1.9, 1.12, 0.55), 0.12, 1.0, 'u', 'dark', 10)             # twin-lift cylinders (as the source)
        for i in range(5):                                                                         # lightening holes and ribs
            x = -1.6 + i * 0.8
            b.box((x - 0.18, sv * 1.1, 0.4), (x + 0.18, sv * 1.106, 0.7), 'dark')
            if i < 4:
                b.box((x + 0.38, sv * 1.1, 0.17), (x + 0.42, sv * 1.13, 0.93), 'yellow')
        b.cyl((-2.1, sv * 0.95, 0.975), 0.025, 4.2, 'u', 'dark', 6)                                # hydraulic hose
    b.box((1.05, -0.03, 0.97), (2.15, 0.03, 1.0), 'steel')                                         # festoon carrier
    for i in range(4):
        b.box((1.1 + i * 0.3, -0.2, 0.95), (1.14 + i * 0.3, 0.2, 0.99), 'dark')


def _sts_tele(b, sx):
    x = sx * STS.TELE_X
    lo, hi = (x - 0.2, x + 0.15) if sx > 0 else (x - 0.15, x + 0.2)
    edge = max(abs(lo), abs(hi))
    b.box((lo, -1.25, 0.1), (hi, 1.25, 0.95), 'yellow')                                            # end beam
    _stripes(b, sx, edge, 1.25, 0.15, 0.9, 'yellow')
    arm_v = 0.55 if sx > 0 else 0.35
    for sv in (-1, 1):
        b.box((x - sx * 4.4, sv * arm_v - 0.12, 0.38), (x, sv * arm_v + 0.12, 0.78), 'steel')      # telescopic inner beam
        b.box((x - sx * 1.6 - 0.15, sv * arm_v - 0.125, 0.375), (x - sx * 1.6 + 0.15, sv * arm_v + 0.125, 0.785), 'black')  # wear pad
        b.box((lo, sv * 0.95, 0.02), (hi, sv * 1.25, 0.1), 'dark')                                 # corner guide shoe
        b.cyl((sx * STS.TWISTLOCK_X, sv * STS.TWISTLOCK_Z, 0.04), 0.1, 0.06, 'w', 'steel', 10)     # twist-lock housing collar
        _flipper(b, sx, sv, edge, 1.25, 0.95, 1.55, 0.3, 'yellow')
    b.cyl((x, -1.2, 0.975), 0.025, 2.4, 'v', 'dark', 6)                                            # hose along the end beam


def _sts_twin(b):
    drop = STS.TWIN_DROP
    b.box((-0.45, -1.32, drop + 0.02), (0.45, 1.32, drop + 0.6), 'yellow')
    for sv in (-1, 1):
        for i in range(4):
            if i % 2 == 0:
                b.box((-0.45 + i * 0.225, sv * 1.32, drop + 0.06), (-0.225 + i * 0.225, sv * (1.32 + STRIPE), drop + 0.56), 'black')
        for su in (-1, 1):
            b.cyl((su * (STS.HALF_OFFSET - STS.TWISTLOCK_X), sv * STS.TWISTLOCK_Z, drop - 0.03), 0.1, 0.05, 'w', 'steel', 10)


def _sts_lock(b):
    b.cyl((0, 0, -0.06), 0.065, 0.16, 'w', 'steel', 10)
    b.box((-0.06, -0.11, -0.14), (0.06, 0.11, -0.06), 'dark')


def _rig(kind):
    """[(node, parent, canonical pivot in the LOD0 frame, build function or None, description, role)] in creation order."""
    out = [('spreader_geo', 'LOD0', (0, 0, 0), None, 'main frame: beams, headblock or its seat, hoses, festoon, fixed fittings', 'mesh')]
    if kind != 'sts':
        k = FIXED[kind]
        for name, su, sv in (('fl', 1, 1), ('fr', 1, -1), ('rl', -1, 1), ('rr', -1, -1)):
            out.append((f'twistlock_{name}', 'LOD0', (su * k['lock_u'], sv * k['lock_v'], 0.0), _fixed_lock, 'twist-lock; 90 degrees = locked', 'rig'))
        return out
    for side, sx in (('fore', 1), ('aft', -1)):
        out.append((f'spreader_tele_{side}', 'LOD0', (sx * STS.TELE_X, 0, 0), lambda b, sx=sx: _sts_tele(b, sx), f'{side} telescope end beam, inner beams, flippers (20 ft at rest)', 'rig'))
    out.append(('twin_locks', 'LOD0', (0, 0, STS.TWIN_DROP), _sts_twin, 'twin-20 centre twist-lock units (retracted at rest)', 'rig'))
    for lock, (parent, (gx, gy, gz)) in STS.LOCKS.items():
        out.append((lock, parent, (gx, -gz, gy), _sts_lock, 'twist-lock; 90 degrees = locked', 'rig'))
    return out


def build_spreader(kind, material):
    """Builds one hero spreader; returns (root, info)."""
    swap = kind == 'asc'
    name = asset_name(kind)
    root = empty(name)
    lod0 = empty('LOD0', root)
    objects = {'LOD0': (lod0, (0.0, 0.0, 0.0))}
    nodes = [{'name': 'LOD0', 'parent': name, 'role': 'lod', 'description': "the only level; this node is the source rig's `spreader` frame"}]
    tris = 0
    lo, hi = [1e9] * 3, [-1e9] * 3

    def mesh(node, parent, builder, pivot, description):
        nonlocal tris
        for v in builder.m.verts:
            for i in range(3):
                lo[i], hi[i] = min(lo[i], v[i]), max(hi[i], v[i])
        builder.m.shift(builder.point(pivot))
        builder.m.to_object(node, material, parent)
        tris += builder.m.triangles
        nodes.append({'name': node, 'parent': parent.name, 'role': 'mesh', 'description': description})

    for node, parent, pivot, build, description, role in _rig(kind):
        b = _Builder(swap)
        if role == 'mesh':
            (_sts_body if kind == 'sts' else lambda bb: _fixed_body(bb, kind))(b)
            mesh(node, lod0, b, (0, 0, 0), description)
            continue
        parent_obj, parent_pivot = objects[parent]
        local = tuple(p - q for p, q in zip(pivot, parent_pivot))
        obj = empty(node, parent_obj, b.point(local))
        objects[node] = (obj, pivot)
        gl = b.point(pivot)
        nodes.append({'name': node, 'parent': parent, 'role': 'rig', 'pivot': [round(gl[0], 4), round(gl[2], 4), round(-gl[1], 4)], 'description': description})
        if build in (_fixed_lock, _sts_lock):
            build(b)            # written about the pivot
            c = b.point(pivot)
            b.m.verts = [(x + c[0], y + c[1], z + c[2]) for x, y, z in b.m.verts]
        else:
            build(b)            # written in the LOD0 frame
        mesh(f'{node}_geo', obj, b, pivot, f'mesh of {node}')
    # glTF frame: X = Blender X, Y = Blender Z, Z = -Blender Y.
    bounds = {'min': [round(lo[0], 4), round(lo[2], 4), round(-hi[1], 4)], 'max': [round(hi[0], 4), round(hi[2], 4), round(-lo[1], 4)]}
    return root, {'name': name, 'kind': kind, 'nodes': nodes, 'triangles': tris, 'bounds': bounds}


def sidecar(info):
    kind, name = info['kind'], info['name']
    b = info['bounds']
    size = [round(b['max'][i] - b['min'][i], 3) for i in range(3)]
    long_axis = 'Z' if kind == 'asc' else 'X'
    limits = {n['name']: {'type': 'rotation', 'axis': '+Y', 'minDeg': 0, 'maxDeg': 90, 'rest': 0, 'tag': 'A', 'note': 'driven by the source rig code'}
              for n in info['nodes'] if n['name'].startswith('twistlock_') and n['role'] == 'rig'}
    if kind == 'sts':
        stroke = round(STS.TELE_STROKE, 4)
        limits['spreader_tele_fore'] = {'type': 'translation', 'axis': '+X', 'minM': 0, 'maxM': stroke, 'rest': 0, 'tag': 'V'}
        limits['spreader_tele_aft'] = {'type': 'translation', 'axis': '-X', 'minM': 0, 'maxM': stroke, 'rest': 0, 'tag': 'V'}
        limits['twin_locks'] = {'type': 'translation', 'axis': '-Y', 'minM': 0, 'maxM': STS.TWIN_DROP, 'rest': 0, 'tag': 'A'}
    return {
        'asset': name,
        'kind': 'hero-equipment',
        'version': 1,
        'generator': 'src/sims/terminal-twin/assets/generators/build.py --only hero-equipment',
        'units': 'm',
        'dimensions': {
            'lengthM': size[2] if kind == 'asc' else size[0], 'widthM': size[0] if kind == 'asc' else size[2], 'heightM': size[1],
            'boundsMin': b['min'], 'boundsMax': b['max'], 'tag': 'A',
            'source': f"the LOD0 spreader of {SOURCE_ASSET[kind]} at rest (same origin, axes and extents; tests/hero-equipment-asset.test.ts compares them)",
        },
        'axes': {
            'up': '+Y',
            'length': f'{long_axis} (the source rig\'s spreader long axis)',
            'origin': "the source rig's `spreader` node: centre of the twist-lock plane (STS: the container attach point)",
            'handedness': 'right-handed, glTF',
        },
        'heroEquipment': {
            'kind': kind,
            'sourceAsset': SOURCE_ASSET[kind],
            'attachUnder': 'spreader',
            'attach': "add LOD0 as a child of the source rig's LOD0 `spreader` node with an identity transform, hide that node's own meshes, and drive the rig nodes below LOD0 with the same values as the source rig's nodes of the same name",
            'flippers': 'modelled raised, no node',
            'material': 'hero_spreader: UV0 = palette swatch, UV1 = metres / %s for hero_detail_normal and hero_orm (%dx%d, shared with the hero container faces)' % (DETAIL_TILE_M, TEX_SIZE, TEX_SIZE),
        },
        'nodes': info['nodes'],
        'travelLimits': limits,
        'attachPoints': [],
        'groundContact': {'y': 0, 'points': [], 'tag': 'A', 'note': 'y 0 is the twist-lock plane, not the ground'},
        'lods': {'LOD0': {'triangles': info['triangles']}},
        'provenance': [
            {'fact': 'frame, pivots and overall extents copied from the source rig spreader', 'tag': 'A', 'source': f'tt_assets/{kind}.py'},
            {'fact': 'headblock sheaves, telescopic inner beams, guide rollers, twist-lock housings, raised flippers, hoses, festoon, warning bands',
             'tag': 'A', 'source': 'generic telescopic container spreader; no manufacturer drawing'},
            {'fact': 'detail maps are procedural noise, not scans', 'tag': 'A'},
        ],
    }
