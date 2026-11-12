"""Hero container faces (spec #243, ticket #255): very realistic boxes at about 10 m, built per face.

One GLB per size (20, 40, 40HC) and face kind (side, door, front, roof): `hero-<size>-<face>`. Each is modelled in the
box frame (origin = bottom centre of the box, Blender X = length, Y = width, Z = up) at the face's true position, so
the four faces of one size assemble into the box with no offsets. The side face is the -Y (glTF +Z) side; the opposite
side is the same model turned 180 degrees about the vertical axis. The underside is never modelled.

Hierarchy (glTF names): hero-<size>-<face> > LOD0 > paint, hardware, dark (mesh nodes, one primitive each; the
`hardware` and `dark` nodes exist only where the face has such parts).
  paint     tinted by the renderer: livery colour and colour-by tint multiply the white base colour
  hardware  fixed galvanised metal (locking bars, cam keepers, hinges, handles)
  dark      fixed black rubber and openings (door gaskets, casting apertures, forklift pockets)
UV0 spans the face 0..1 (markings, livery regions); UV1 is in metres over DETAIL_TILE_M for the repeating detail maps.
Textures: `hero_detail_normal` (tangent-space micro-relief) and `hero_orm` (G = roughness variation, B = 0 metal; R is a
wear mask the renderer may read), both on UV1, shared by the three materials. Everything here is deterministic.
"""
import math

import bpy

from .blender import MeshBuilder, empty
from .containers import BOTTOM_RAIL_TOP, CAST_H, CAST_L, CAST_W, DOOR_BAR_FRACS, EDGE, POST_INSET, SIZES, TOP_RAIL_DEPTH
from .liveries import RIB_BASE_HALF, RIB_DEPTH_M, RIB_TOP_HALF

FACES = ('side', 'door', 'front', 'roof')
HERO_PITCH_M = 0.25          # target corrugation pitch; the actual pitch divides the span evenly
ROOF_RIB_DEPTH_M = 0.016     # roof sheet corrugation is shallow
DETAIL_TILE_M = 0.5          # UV1 repeat length of the detail maps
TEX_SIZE = 256
DOOR_BANDS = 4               # horizontal corrugation bands of a door leaf
LIFT = 0.0008                # decals (apertures) sit this far off the surface


def asset_name(size_key, face):
    return f'hero-{size_key.lower()}-{face}'


def rib_layout(span, target=HERO_PITCH_M):
    n = max(1, round(span / target))
    return n, span / n


# ---------------------------------------------------------------- textures

def _hash(ix, iy, seed):
    h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    h ^= h >> 16
    return (h & 0xFFFF) / 65535.0


def _smooth(t):
    return t * t * (3 - 2 * t)


def _noise(x, y, fx, fy, seed):
    """Tileable value noise over [0, 1)^2 with fx x fy lattice cells."""
    gx, gy = x * fx, y * fy
    ix, iy = int(math.floor(gx)), int(math.floor(gy))
    tx, ty = _smooth(gx - ix), _smooth(gy - iy)

    def v(i, j):
        return _hash(i % fx, j % fy, seed)
    a = v(ix, iy) * (1 - tx) + v(ix + 1, iy) * tx
    b = v(ix, iy + 1) * (1 - tx) + v(ix + 1, iy + 1) * tx
    return a * (1 - ty) + b * ty


def _height(x, y):
    """Sheet-metal micro relief: fine grain plus faint streaks along u (rolling and wiping marks)."""
    return (0.5 * _noise(x, y, 16, 16, 1) + 0.3 * _noise(x, y, 32, 32, 2) + 0.35 * _noise(x, y, 3, 48, 3)
            + 0.15 * _noise(x, y, 64, 64, 4))


def write_detail_textures(normal_path, orm_path, size=TEX_SIZE):
    """Writes the tileable detail normal map and the ORM map (PNG)."""
    h = [[_height((i + 0.5) / size, (j + 0.5) / size) for i in range(size)] for j in range(size)]
    strength = 0.9
    normal, orm = [], []
    for j in range(size):
        for i in range(size):
            dx = h[j][(i + 1) % size] - h[j][(i - 1) % size]
            dy = h[(j + 1) % size][i] - h[(j - 1) % size][i]
            nx, ny, nz = -dx * strength * 2.0, -dy * strength * 2.0, 1.0
            ln = math.sqrt(nx * nx + ny * ny + nz * nz)
            normal.extend((nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5, 1.0))
            n = _noise((i + 0.5) / size, (j + 0.5) / size, 8, 8, 7)
            wear = _noise((i + 0.5) / size, (j + 0.5) / size, 4, 4, 9)
            orm.extend((0.55 + 0.45 * (1 - wear), 0.46 + 0.28 * n + 0.12 * (h[j][i] - 0.7), 0.0, 1.0))
    for path, pixels, name in ((normal_path, normal, 'hero_detail_normal'), (orm_path, orm, 'hero_orm')):
        img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
        img.colorspace_settings.name = 'Non-Color'
        img.pixels.foreach_set(pixels)
        img.filepath_raw = path
        img.file_format = 'PNG'
        img.save()
        bpy.data.images.remove(img)


def hero_materials(normal_image, orm_image):
    """(paint, hardware, dark) Principled materials sharing the detail maps on UV1."""
    out = []
    for name, base, metallic, textured_roughness in (
            ('hero_paint', (1.0, 1.0, 1.0, 1.0), 0.0, True),
            ('hero_hardware', (0.62, 0.64, 0.66, 1.0), 0.35, False),  # galvanised: mostly diffuse, so it stays grey without an environment map (Low)
            ('hero_dark', (0.02, 0.02, 0.022, 1.0), 0.0, False)):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        mat.use_backface_culling = True
        nt = mat.node_tree
        bsdf = nt.nodes['Principled BSDF']
        bsdf.inputs['Base Color'].default_value = base
        bsdf.inputs['Metallic'].default_value = metallic
        bsdf.inputs['Roughness'].default_value = 0.55 if metallic else 0.8
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
        if textured_roughness:
            otex = nt.nodes.new('ShaderNodeTexImage')
            otex.image = orm_image
            otex.extension = 'REPEAT'
            nt.links.new(uv1.outputs['UV'], otex.inputs['Vector'])
            sep = nt.nodes.new('ShaderNodeSeparateColor')
            nt.links.new(otex.outputs['Color'], sep.inputs['Color'])
            nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
            nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
        out.append(mat)
    return out


# ---------------------------------------------------------------- geometry

class _Face:
    """One face under construction: three builders and the UV mapping of the face."""

    def __init__(self, size_key, face):
        d = SIZES[size_key]
        self.L, self.W, self.H = d['length'], d['width'], d['height']
        self.hl, self.hw = self.L / 2, self.W / 2
        self.face = face
        self.paint, self.hardware, self.dark = (MeshBuilder(uv_layers=2) for _ in range(3))

    def uv0(self, p):
        x, y, z = p
        if self.face == 'side':
            return ((x + self.hl) / self.L, z / self.H)
        if self.face == 'door':
            return ((y + self.hw) / self.W, z / self.H)
        if self.face == 'front':
            return (1 - (y + self.hw) / self.W, z / self.H)
        return ((x + self.hl) / self.L, (y + self.hw) / self.W)

    def uv1(self, p):
        x, y, z = p
        t = DETAIL_TILE_M
        if self.face == 'side':
            return (x / t, z / t)
        if self.face in ('door', 'front'):
            return (y / t, z / t)
        return (x / t, y / t)

    def quad(self, builder, pts, outward):
        builder.quad(pts, [self.uv0(p) for p in pts], [self.uv1(p) for p in pts], outward=outward)

    def box(self, builder, lo, hi, faces):
        lo, hi = tuple(min(a, b) for a, b in zip(lo, hi)), tuple(max(a, b) for a, b in zip(lo, hi))
        builder.box_faces(lo, hi, faces, lambda f, pts: [self.uv0(p) for p in pts], lambda f, pts: [self.uv1(p) for p in pts])


def _castings(f, kind):
    """Corner castings and their share of the posts, with apertures, for one face kind."""
    hl, hw, H = f.hl, f.hw, f.H
    own = {'side': '-y', 'door': '+x', 'front': '-x', 'roof': '+z'}[kind]
    for sx in (-1, 1):
        for sy in (-1, 1):
            if (kind == 'side' and sy > 0) or (kind == 'door' and sx < 0) or (kind == 'front' and sx > 0):
                continue
            for top in (False, True):
                if kind == 'roof' and not top:
                    continue
                x0, x1 = sorted((sx * hl, sx * (hl - CAST_L)))
                y0, y1 = sorted((sy * hw, sy * (hw - CAST_W)))
                z0, z1 = (H - CAST_H, H) if top else (0.0, CAST_H)
                f.box(f.paint, (x0, y0, z0), (x1, y1, z1), [own])
                cx, cy, cz = (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2
                if kind == 'side':
                    yy = y0 - LIFT
                    pts = [(cx - 0.045, yy, cz - 0.018), (cx + 0.045, yy, cz - 0.018), (cx + 0.045, yy, cz + 0.018), (cx - 0.045, yy, cz + 0.018)]
                    f.quad(f.dark, pts, (0, -1, 0))
                elif kind in ('door', 'front'):
                    xx = (x1 + LIFT) if kind == 'door' else (x0 - LIFT)
                    pts = [(xx, cy - 0.035, cz - 0.02), (xx, cy + 0.035, cz - 0.02), (xx, cy + 0.035, cz + 0.02), (xx, cy - 0.035, cz + 0.02)]
                    f.quad(f.dark, pts, (1 if kind == 'door' else -1, 0, 0))
                else:
                    zz = z1 + LIFT
                    pts = [(cx - 0.062, cy - 0.032, zz), (cx + 0.062, cy - 0.032, zz), (cx + 0.062, cy + 0.032, zz), (cx - 0.062, cy + 0.032, zz)]
                    f.quad(f.dark, pts, (0, 0, 1))
            if kind == 'roof':
                continue
            x0, x1 = sorted((sx * (hl - POST_INSET), sx * (hl - CAST_L + 0.008)))
            y0, y1 = sorted((sy * (hw - POST_INSET), sy * (hw - CAST_W + 0.007)))
            f.box(f.paint, (x0, y0, CAST_H), (x1, y1, H - CAST_H), [own])


def _rails(f, kind):
    hl, hw, H = f.hl, f.hw, f.H
    if kind == 'side':
        f.box(f.paint, (-hl + CAST_L, -(hw - EDGE), 0.012), (hl - CAST_L, -(hw - 0.08), BOTTOM_RAIL_TOP), ['-y', '+z'])
        f.box(f.paint, (-hl + CAST_L, -(hw - EDGE), H - TOP_RAIL_DEPTH), (hl - CAST_L, -(hw - TOP_RAIL_DEPTH), H - 0.012), ['-y', '-z'])
    elif kind in ('door', 'front'):
        sx = 1 if kind == 'door' else -1
        ox = '+x' if sx > 0 else '-x'
        f.box(f.paint, (sx * (hl - EDGE), -hw + CAST_W, 0.012), (sx * (hl - 0.08), hw - CAST_W, BOTTOM_RAIL_TOP), [ox] + (['+z'] if kind == 'door' else []))
        f.box(f.paint, (sx * (hl - EDGE), -hw + CAST_W, H - TOP_RAIL_DEPTH), (sx * (hl - 0.12), hw - CAST_W, H - 0.012), [ox, '-z'])
    else:
        for sy in (-1, 1):
            f.box(f.paint, (-hl + CAST_L, sy * (hw - EDGE), H - TOP_RAIL_DEPTH), (hl - CAST_L, sy * (hw - TOP_RAIL_DEPTH), H - 0.012), ['+z'])
        for sx in (-1, 1):
            f.box(f.paint, (sx * (hl - EDGE), -hw + CAST_W, H - TOP_RAIL_DEPTH), (sx * (hl - 0.12), hw - CAST_W, H - 0.012), ['+z'])


def _ribbed(f, builder, at, a0, n, pitch, valley, crest, b0, b1, out):
    """A corrugated panel: a valley plane plus n trapezoid ribs along the second axis.

    `at(a, depth, b)` maps (position across the ribs, depth, position along the ribs) to a point."""
    f.quad(builder, [at(a0, valley, b0), at(a0 + n * pitch, valley, b0), at(a0 + n * pitch, valley, b1), at(a0, valley, b1)], out)
    for i in range(n):
        ac = a0 + (i + 0.5) * pitch
        pa = [ac - RIB_BASE_HALF * pitch, ac - RIB_TOP_HALF * pitch, ac + RIB_TOP_HALF * pitch, ac + RIB_BASE_HALF * pitch]
        for (xa, da), (xb, db) in (((pa[0], valley), (pa[1], crest)), ((pa[1], crest), (pa[2], crest)), ((pa[2], crest), (pa[3], valley))):
            f.quad(builder, [at(xa, da, b0), at(xb, db, b0), at(xb, db, b1), at(xa, da, b1)], out)


def _build_side(f, size_key):
    hl, hw, H = f.hl, f.hw, f.H
    _castings(f, 'side')
    _rails(f, 'side')
    n, pitch = rib_layout(f.L - 2 * CAST_L)
    valley, crest = -(hw - 0.05), -(hw - (0.05 - RIB_DEPTH_M))
    _ribbed(f, f.paint, lambda a, d, z: (a, d, z), -hl + CAST_L, n, pitch, valley, crest, BOTTOM_RAIL_TOP, H - TOP_RAIL_DEPTH, (0, -1, 0))
    if size_key == '20':
        # Forklift pockets (20 ft only): 355 x 115 mm openings 2.05 m apart in the bottom side rail.
        yo = -(hw - EDGE)
        for cx in (-1.025, 1.025):
            f.box(f.paint, (cx - 0.2, yo - 0.014, 0.018), (cx + 0.2, yo, 0.158), ['-y', '+z', '-z', '+x', '-x'])
            yy = yo - 0.014 - LIFT
            f.quad(f.dark, [(cx - 0.1775, yy, 0.03), (cx + 0.1775, yy, 0.03), (cx + 0.1775, yy, 0.145), (cx - 0.1775, yy, 0.145)], (0, -1, 0))
    return {'ribs': n, 'pitchM': pitch}


def _build_end(f, kind):
    hl, hw, H = f.hl, f.hw, f.H
    sx = 1 if kind == 'door' else -1
    _castings(f, kind)
    _rails(f, kind)
    fy = hw - CAST_W + 0.007
    zb, zt = BOTTOM_RAIL_TOP, H - TOP_RAIL_DEPTH
    if kind == 'front':
        n, pitch = rib_layout(2 * fy)
        valley, crest = -(hl - 0.05), -(hl - (0.05 - RIB_DEPTH_M))
        _ribbed(f, f.paint, lambda a, d, z: (d, a, z), -fy, n, pitch, valley, crest, zb, zt, (-1, 0, 0))
        return {'ribs': n, 'pitchM': pitch}
    # Door end: two leaves with a 10 mm gap to the seam and to the post. A door leaf is corrugated across its height
    # (DOOR_BANDS wide horizontal bands, reference photographs), unlike the vertical ribs of the walls.
    w = fy - 0.02
    band = (zt - zb) / DOOR_BANDS
    valley, crest = hl - 0.075, hl - 0.075 + RIB_DEPTH_M
    cx = hl - 0.022
    for side in (1, -1):
        lo = 0.01 if side > 0 else -(fy - 0.01)
        _ribbed(f, f.paint, lambda a, d, y: (d, y, a), zb, DOOR_BANDS, band, valley, crest, lo, lo + w, (1, 0, 0))
        for frac in DOOR_BAR_FRACS:
            yc = side * fy * frac
            f.hardware.cylinder((cx, yc, zb + 0.04), 0.018, zt - zb - 0.08, 8, (0.5, 0.5), axis='z', caps=False)
            for gz in (0.45, H * 0.5, H - 0.55):  # bar guides
                f.box(f.hardware, (cx - 0.018, yc - 0.03, gz - 0.025), (cx + 0.004, yc + 0.03, gz + 0.025), ['+x', '+y', '-y', '+z'])
            f.box(f.hardware, (cx - 0.02, yc - 0.035, zb + 0.012), (cx + 0.006, yc + 0.035, zb + 0.067), ['+x', '+y', '-y', '+z'])  # cam keeper, sill
            f.box(f.hardware, (cx - 0.02, yc - 0.035, zt - 0.07), (cx + 0.006, yc + 0.035, zt), ['+x', '+y', '-y', '-z'])  # cam keeper, header
            f.box(f.hardware, (cx + 0.004, yc - 0.012, 1.05), (cx + 0.022, yc + side * 0.2, 1.10), ['+x', '+z', '-z'])  # handle
        hinges = 5 if H > 2.8 else 4
        for k in range(hinges):
            hz = zb + 0.18 + (zt - zb - 0.36) * k / (hinges - 1)
            f.hardware.cylinder((hl - 0.045, side * (fy + 0.03), hz - 0.07), 0.024, 0.14, 6, (0.5, 0.5), axis='z', caps=False)
    # Gaskets: dark rubber strips around the opening and along the centre seam.
    gx = hl - 0.068
    for y0, y1, z0, z1 in ((-fy, -fy + 0.025, zb, zt), (fy - 0.025, fy, zb, zt), (-0.012, 0.012, zb, zt), (-fy, fy, zb, zb + 0.025), (-fy, fy, zt - 0.025, zt)):
        f.box(f.dark, (gx, y0, z0), (gx + 0.004, y1, z1), ['+x'])
    return {'ribs': DOOR_BANDS, 'pitchM': band}


def _build_roof(f):
    hl, hw, H = f.hl, f.hw, f.H
    _castings(f, 'roof')
    _rails(f, 'roof')
    x0, x1 = -hl + 0.12, hl - 0.12
    n, pitch = rib_layout(x1 - x0)
    valley, crest = H - 0.012 - ROOF_RIB_DEPTH_M, H - 0.012
    _ribbed(f, f.paint, lambda a, d, y: (a, y, d), x0, n, pitch, valley, crest, -hw + TOP_RAIL_DEPTH, hw - TOP_RAIL_DEPTH, (0, 0, 1))
    return {'ribs': n, 'pitchM': pitch}


def build_face(size_key, face, mats, prefix=''):
    """Builds one face model; returns (root, info). `mats` = (paint, hardware, dark); `prefix` keeps Blender names unique."""
    f = _Face(size_key, face)
    name = asset_name(size_key, face)
    if face == 'side':
        extra = _build_side(f, size_key)
    elif face == 'roof':
        extra = _build_roof(f)
    else:
        extra = _build_end(f, face)
    root = empty(prefix + name)
    lod0 = empty(prefix + 'LOD0', root)
    nodes = []
    tris = 0
    for node, builder, mat in (('paint', f.paint, mats[0]), ('hardware', f.hardware, mats[1]), ('dark', f.dark, mats[2])):
        if not builder.faces:
            continue
        builder.to_object(prefix + node, mat, lod0)
        nodes.append(node)
        tris += builder.triangles
    return root, {'name': name, 'size': size_key, 'face': face, 'dims': SIZES[size_key], 'nodes': nodes, 'triangles': tris, **extra}


# ---------------------------------------------------------------- sidecar

NODE_DOCS = {
    'paint': 'tinted surface: corrugated panel, castings, posts and rails; base colour is white so livery colour and colour-by tint multiply it',
    'hardware': 'fixed galvanised metal: locking bars and guides, cam keepers, handles, hinge barrels',
    'dark': 'fixed black rubber and openings: door gaskets, casting apertures, forklift pocket openings',
}
FACE_DOC = {
    'side': 'long side panel on the -Y (glTF +Z) side with its share of corner posts, castings and rails; the opposite side is this model turned 180 degrees about the vertical axis; 20 ft boxes also have forklift pockets',
    'door': 'door end (+X): two leaves corrugated in horizontal bands, gaskets, locking bars, cam keepers, handles, hinges, with its posts and castings',
    'front': 'front end (-X): corrugated panel with its posts, castings and rails',
    'roof': 'roof (+Z): corrugated sheet, top rails and the four top castings with apertures',
}


def sidecar(info):
    d = info['dims']
    L, W, H = d['length'], d['width'], d['height']
    name = info['name']
    return {
        'asset': name,
        'kind': 'hero-container',
        'version': 1,
        'generator': 'src/sims/terminal-twin/assets/generators/build.py --only hero',
        'units': 'm',
        'isoSizeType': d['iso'],
        'dimensions': {'lengthM': L, 'widthM': W, 'heightM': H, 'tag': 'V', 'source': 'ISO 668 external dimensions'},
        'axes': {
            'up': '+Y',
            'length': '+X (front end at -X, doors at +X)',
            'width': '+Z',
            'origin': 'bottom centre of the box (ground contact); every face of a size is modelled in this one frame',
            'handedness': 'right-handed, glTF',
        },
        'hero': {
            'size': info['size'],
            'face': info['face'],
            'description': FACE_DOC[info['face']],
            'ribs': info['ribs'],
            'pitchM': round(info['pitchM'], 4),
            'tintedNode': 'paint',
            'uv0': 'face 0..1: sides and roof u along +X (roof v along the width), ends u along the width; v = height / box height on sides and ends',
            'uv1': f'metres / {DETAIL_TILE_M}: repeating detail normal and ORM maps; rust, dents and scuffs are driven per box by the wear seed in the renderer',
            'textures': {'normal': f'hero_detail_normal {TEX_SIZE}x{TEX_SIZE} tangent space', 'orm': f'hero_orm {TEX_SIZE}x{TEX_SIZE}: R wear mask, G roughness variation, B metal 0'},
            'opposite': 'rotate 180 degrees about +Y' if info['face'] == 'side' else None,
        },
        'nodes': [{'name': 'LOD0', 'parent': name, 'role': 'lod', 'description': 'the only level: hero detail for faces within about 15 m'}] + [
            {'name': n, 'parent': 'LOD0', 'role': 'mesh', 'description': NODE_DOCS[n]} for n in info['nodes']],
        'travelLimits': {},
        'attachPoints': [],
        'groundContact': {'y': 0, 'points': [], 'tag': 'V'},
        'lods': {'LOD0': {'triangles': info['triangles']}},
        'provenance': [
            {'fact': f'external dimensions {round(L * 1000)} x {round(W * 1000)} x {round(H * 1000)} mm', 'tag': 'V', 'source': 'ISO 668'},
            {'fact': 'corner casting envelope 178 x 162 x 118 mm', 'tag': 'V', 'source': 'ISO 1161'},
            {'fact': f'{info["ribs"]} corrugation ribs at {round(info["pitchM"], 3)} m pitch, {RIB_DEPTH_M} m deep (roof {ROOF_RIB_DEPTH_M} m)', 'tag': 'A',
             'source': 'real pitch is about 0.25 m; depth and rib profile as the LOD0 box'},
            {'fact': 'door furniture: gaskets, locking bars with guides, cam keepers, handles, 4 hinges (5 on high cube) per leaf', 'tag': 'P',
             'source': 'reference photographs (not committed); dimensions approximated'},
            {'fact': 'forklift pockets 355 x 115 mm, 2.05 m apart, 20 ft only', 'tag': 'V', 'source': 'ISO 1496-1 (frame detail approximated)'},
            {'fact': 'detail maps are procedural noise, not scans', 'tag': 'A'},
        ],
    }
