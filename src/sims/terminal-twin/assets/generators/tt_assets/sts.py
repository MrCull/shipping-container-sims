"""STS quay crane: ZPMC-style Malaccamax, three LODs, fully rigged.

All geometry here is written in the glTF frame ("G"): X along the quay rail,
Y up, Z landward (the sea is at -Z), metres. Origin: the waterside rail
centreline at rail level, on the crane's centre line. `_b()` converts to
Blender's Z-up frame (X, -Z, Y) when objects are created.

Hierarchy (LOD0 names; LOD1/LOD2 append `_lod1` / `_lod2` to every node):

  sts-malaccamax
    LOD0
      gantry                 travels along the rail (+X); pivot at the origin
        gantry_geo           legs, portal, sills, bogies, girders, A-frame, house, ...
        boom                 raising hinge (+X axis), seaward of the waterside legs
          boom_geo           lattice boom, forestays, catwalks, floodlights
        trolley              along the boom/backreach (+Z); pivot on the trolley rails at Z = 0
          trolley_geo        frame, wheels, operator cab
          ropes              hoist ropes, unit length downwards: scale Y = rope length
            ropes_geo
          hoist              +Y = spreader underside height above the rail
            hoist_geo        headblock
            spreader         skew (+Y rotation); its origin is the container attach point
              spreader_geo
              spreader_tele_fore / spreader_tele_aft   telescopes, 20 ft -> 40 ft
                twistlock_{fore|aft}_{land|sea}         (LOD0 only)
              twin_locks     twin-20 centre locks drop (-Y)
                twistlock_twin_{aft|fore}_{land|sea}    (LOD0 only)

Rig nodes are empties (no mesh, no rotation, no scale), so the meshopt
quantisation transforms that gltf-transform writes on mesh nodes never move a
pivot. Geometry lives in the `*_geo` children.
"""
import math

from mathutils import Vector

from .blender import empty, textured_material
from . import sts_atlas as SA

NAME = 'sts-malaccamax'

# ---- Dimensions -------------------------------------------------------------
# [V] TTI reference pack (Malaccamax builder version, all eight cranes).
RAIL_GAUGE = 30.48
LIFT_ABOVE_RAIL = 52.0
OUTREACH = 68.0          # waterside rail -> spreader centre at full outreach
# [A] Approximations (not verified by the reference pack).
BACKREACH = 18.0         # landside rail -> spreader centre at full backreach
LEG_X = 9.0              # leg centres either side of the crane centre line
BOGIE_TOP = 3.2
SILL_Y = (15.0, 17.0)
PORTAL_Y = (51.6, 54.0)
GIRDER_X = 4.6           # trolley rails / girder centres
GIRDER_HALF_W = 0.7
GIRDER_Y = (54.0, 57.2)
TROLLEY_RAIL_Y = 57.4
HINGE = (55.6, -3.2)     # boom hinge pin (Y, Z)
BOOM_TIP_Z = -(OUTREACH + 6.0)
GIRDER_END_Z = RAIL_GAUGE + BACKREACH + 12.5
APEX = (4.2, 82.0, 4.0)  # half-width, height, Z
HOUSE = {'x': 6.2, 'y': (57.4, 64.8), 'z': (51.8, 60.6)}
BUFFER_X = LEG_X + 4.5   # over buffers = 27 m (= quay.stsMinSpacingM)
# Spreader / headblock.
TWISTLOCK_X = 6.058 / 2 - 0.089    # [V] ISO 1161 casting centres of a 20 ft box
TWISTLOCK_Z = 2.438 / 2 - 0.081
TELE_STROKE = (12.192 - 6.058) / 2  # [V] 20 ft -> 40 ft
HALF_OFFSET = 3.067                 # twin-20 box centres (= scenario HALF_OFFSET_M)
TWIN_DROP = 0.4
HEADBLOCK_SHEAVE_Y = 2.25           # rope ends above the spreader underside

TELE_X = TWISTLOCK_X

# Amber gantry-alarm beacon mount points [A, glTF frame, node `gantry`]: the beacon lamp base on each leg (outer X face)
# and on the portal-beam ends. The gantry alarm ticket attaches its lights here.
BEACONS = {
    f'beacon_{where}_{side}_{xs}': (sx * (LEG_X + (1.45 if where == 'leg' else 1.3)), 6.0 if where == 'leg' else PORTAL_Y[1], z)
    for where in ('leg', 'portal')
    for side, z in (('sea', 0.0), ('land', RAIL_GAUGE))
    for xs, sx in (('xneg', -1), ('xpos', 1))
}


def _b(p):
    """glTF (x, y, z) -> Blender (x, -z, y)."""
    return (p[0], -p[2], p[1])


def _v(p):
    return Vector(p)


def _newell(pts):
    n = Vector((0.0, 0.0, 0.0))
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


class GMesh:
    """Flat-shaded polygons in the glTF frame, one UV per corner, material index per face."""

    def __init__(self):
        self.verts = []
        self.faces = []
        self.uvs = []
        self.mats = []

    @property
    def triangles(self):
        return sum(len(f) - 2 for f in self.faces)

    def poly(self, pts, uv, mat=0, outward=None):
        pts = [_v(p) for p in pts]
        uvs = list(uv) if isinstance(uv, list) else [uv] * len(pts)
        if outward is not None and _newell(pts).dot(_v(outward)) < 0:
            pts.reverse()
            uvs.reverse()
        base = len(self.verts)
        self.verts.extend(pts)
        self.faces.append(tuple(range(base, base + len(pts))))
        self.uvs.extend(uvs)
        self.mats.append(mat)

    def prism(self, ring0, ring1, uv, caps=(True, True), mat=0):
        ring0 = [_v(p) for p in ring0]
        ring1 = [_v(p) for p in ring1]
        c = sum(ring0 + ring1, Vector()) / (len(ring0) * 2)
        n = len(ring0)
        for i in range(n):
            j = (i + 1) % n
            quad = [ring0[i], ring0[j], ring1[j], ring1[i]]
            centre = sum(quad, Vector()) / 4
            self.poly(quad, uv, mat, outward=centre - c)
        for on, ring in zip(caps, (ring0, ring1)):
            if on:
                centre = sum(ring, Vector()) / n
                self.poly(ring, uv, mat, outward=centre - c)

    def box(self, lo, hi, uv, faces=None, mat=0):
        (x0, y0, z0), (x1, y1, z1) = lo, hi
        if faces is None:
            ring0 = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)]
            ring1 = [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
            self.prism(ring0, ring1, uv, mat=mat)
            return
        c = _v(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
        quads = {
            '+x': [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)],
            '-x': [(x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1)],
            '+y': [(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)],
            '-y': [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
            '+z': [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)],
            '-z': [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)],
        }
        for f in faces:
            q = quads[f]
            self.poly(q, uv, mat, outward=sum((_v(p) for p in q), Vector()) / 4 - c)

    @staticmethod
    def _frame(p0, p1, up):
        d = (p1 - p0).normalized()
        u = _v(up)
        if abs(d.dot(u)) > 0.98:
            u = _v((1, 0, 0)) if abs(d.x) < 0.9 else _v((0, 0, 1))
        s = d.cross(u).normalized()
        return d, s, s.cross(d).normalized()

    def beam(self, p0, p1, w, h, uv, up=(0, 1, 0), w1=None, h1=None, caps=True, mat=0):
        """Rectangular member from p0 to p1 (w across, h along `up`), optionally tapered."""
        p0, p1 = _v(p0), _v(p1)
        _, s, u = self._frame(p0, p1, up)
        w1 = w if w1 is None else w1
        h1 = h if h1 is None else h1

        def ring(p, ww, hh):
            return [p - s * ww / 2 - u * hh / 2, p + s * ww / 2 - u * hh / 2, p + s * ww / 2 + u * hh / 2, p - s * ww / 2 + u * hh / 2]
        self.prism(ring(p0, w, h), ring(p1, w1, h1), uv, caps=(caps, caps), mat=mat)

    def cyl(self, p0, p1, r, n, uv, r1=None, caps=True, mat=0, up=(0, 1, 0)):
        p0, p1 = _v(p0), _v(p1)
        _, s, u = self._frame(p0, p1, up)
        r1 = r if r1 is None else r1

        def ring(p, rr):
            return [p + (s * math.cos(2 * math.pi * k / n) + u * math.sin(2 * math.pi * k / n)) * rr for k in range(n)]
        self.prism(ring(p0, r), ring(p1, r1), uv, caps=(caps, caps), mat=mat)

    def decal(self, centre, normal, w, h, rect, up=(0, 1, 0), mat=0, lift=0.02):
        """A textured rectangle facing `normal`, reading upright from outside."""
        n = _v(normal).normalized()
        upv = _v(up).normalized()
        right = upv.cross(n).normalized()
        upv = n.cross(right).normalized()
        c = _v(centre) + n * lift
        u0, v0, u1, v1 = rect
        pts = [c - right * w / 2 - upv * h / 2, c + right * w / 2 - upv * h / 2, c + right * w / 2 + upv * h / 2, c - right * w / 2 + upv * h / 2]
        self.poly(pts, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], mat, outward=n)

    def catenary(self, p0, p1, sag, segments, r, n, uv):
        p0, p1 = _v(p0), _v(p1)
        pts = []
        for i in range(segments + 1):
            t = i / segments
            p = p0.lerp(p1, t)
            p.y -= sag * 4 * t * (1 - t)
            pts.append(p)
        for a, b in zip(pts, pts[1:]):
            self.cyl(a, b, r, n, uv, caps=False)

    def bounds(self, offset=(0, 0, 0)):
        if not self.verts:
            return None
        o = _v(offset)
        lo = Vector((min(v.x for v in self.verts), min(v.y for v in self.verts), min(v.z for v in self.verts))) + o
        hi = Vector((max(v.x for v in self.verts), max(v.y for v in self.verts), max(v.z for v in self.verts))) + o
        return lo, hi

    def to_object(self, name, materials, parent, origin):
        """Mesh object under `parent`; vertices are given in world rest coordinates, `origin` = parent's world pivot."""
        import bpy
        o = _v(origin)
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([tuple(round(c, 5) for c in _b(v - o)) for v in self.verts], [], self.faces)
        mesh.update()
        uv_layer = mesh.uv_layers.new(name='UVMap')
        for i, loop in enumerate(mesh.loops):
            uv_layer.data[i].uv = self.uvs[loop.vertex_index]
        used = sorted(set(self.mats))
        slot = {m: i for i, m in enumerate(used)}
        for m in used:
            mesh.materials.append(materials[m])
        for poly, m in zip(mesh.polygons, self.mats):
            poly.material_index = slot[m]
            poly.use_smooth = False
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = parent
        return obj


P = SA.palette_uv
PAINT, PLATE = 0, 1


# ---- Part builders (world rest coordinates, glTF frame) ----------------------

def _ladder(m, x_face, sx, z0, y0, y1, d):
    """Caged ladder on a leg's outer (±X) face."""
    grey = P('grey')
    x = x_face + sx * 0.3
    for dz in (-0.25, 0.25):
        m.beam((x, y0, z0 + dz), (x, y1, z0 + dz), 0.06, 0.06, grey, up=(1, 0, 0), caps=False)
    y = y0 + 0.3
    while y < y1 - 0.1:
        m.beam((x, y, z0 - 0.25), (x, y, z0 + 0.25), 0.035, 0.035, grey, caps=False)
        y += 0.3 if d == 0 else 1.0
    if d > 0:
        return
    # Cage hoops from 3 m above the foot (half-rings around the ladder), and their vertical bars.
    hoop = [(x + sx * (0.38 + 0.38 * math.sin(k * math.pi / 7)), z0 + 0.38 * math.cos(k * math.pi / 7)) for k in range(8)]
    y = y0 + 3.0
    while y < y1:
        for (xa, za), (xb, zb) in zip(hoop, hoop[1:]):
            m.beam((xa, y, za), (xb, y, zb), 0.05, 0.05, grey, caps=False)
        y += 0.9
    for xa, za in hoop[1:-1]:
        m.beam((xa, y0 + 3.0, za), (xa, y1, za), 0.04, 0.04, grey, up=(1, 0, 0), caps=False)
    # Rest platforms every 12 m.
    y = y0 + 12.0
    while y < y1 - 2:
        m.box((min(x, x + sx * 1.3), y - 0.06, z0 - 0.7), (max(x, x + sx * 1.3), y, z0 + 0.7), grey)
        for dz in (-0.7, 0.7):
            m.beam((x + sx * 1.3, y, z0 + dz), (x + sx * 1.3, y + 1.1, z0 + dz), 0.05, 0.05, grey, up=(1, 0, 0), caps=False)
        m.beam((x + sx * 1.3, y + 1.1, z0 - 0.7), (x + sx * 1.3, y + 1.1, z0 + 0.7), 0.05, 0.05, grey, caps=False)
        y += 12.0


def _handrail(m, x, y, z0, z1, d, post_every=1.5):
    grey = P('grey')
    if d == 0:
        n = max(1, int(abs(z1 - z0) / post_every))
        for i in range(n + 1):
            z = z0 + (z1 - z0) * i / n
            m.beam((x, y, z), (x, y + 1.1, z), 0.05, 0.05, grey, up=(1, 0, 0), caps=False)
        for h in (0.55, 1.1):
            m.beam((x, y + h, z0), (x, y + h, z1), 0.05, 0.05, grey, caps=False)
    else:
        n = max(1, int(abs(z1 - z0) / 4.0))
        for i in range(n + 1):
            z = z0 + (z1 - z0) * i / n
            m.beam((x, y, z), (x, y + 1.0, z), 0.08, 0.08, grey, up=(1, 0, 0), caps=False)
        m.beam((x, y + 1.0, z0), (x, y + 1.0, z1), 0.08, 0.08, grey, caps=False)


def _floodlight(m, centre, facing=(0, -1, 0)):
    x, y, z = centre
    m.box((x - 0.35, y - 0.25, z - 0.3), (x + 0.35, y + 0.15, z + 0.3), P('grey'))
    m.decal((x, y - 0.25, z), facing, 0.6, 0.5, (P('lamp')[0], P('lamp')[1], P('lamp')[0], P('lamp')[1]), up=(0, 0, 1), lift=0.01)


def _uvrect(name):
    u, v = P(name)
    return (u, v, u, v)


def gantry_structure(d):
    m = GMesh()
    blue, dblue, white, grey, dark, red, yellow = (P(k) for k in ('blue', 'blue_dark', 'white', 'grey', 'dark', 'red', 'yellow'))
    amber = P('amber')
    caps = d < 2
    legs = [(sx * LEG_X, z) for sx in (-1, 1) for z in (0.0, RAIL_GAUGE)]
    # Legs, tapered, from the bogie sill to the portal.
    for x, z in legs:
        m.beam((x, BOGIE_TOP, z), (x, PORTAL_Y[0], z), 2.4, 2.4, blue, up=(0, 0, 1), w1=1.8, h1=1.8, caps=caps)
        if d < 2:
            for y in (10.0, 22.0, 34.0, 46.0):
                t = (y - BOGIE_TOP) / (PORTAL_Y[0] - BOGIE_TOP)
                s = 2.4 + (1.8 - 2.4) * t + 0.12
                m.beam((x, y - 0.15, z), (x, y + 0.15, z), s, s, dblue, up=(0, 0, 1))
    # Portal beams (along X) and upper side beams (along Z).
    for z in (0.0, RAIL_GAUGE):
        m.box((-LEG_X - 1.2, PORTAL_Y[0], z - 1.1), (LEG_X + 1.2, PORTAL_Y[1], z + 1.1), blue)
    for sx in (-1, 1):
        x = sx * LEG_X
        m.box((x - 0.8, PORTAL_Y[0] + 0.2, 1.1), (x + 0.8, PORTAL_Y[1], RAIL_GAUGE - 1.1), blue, faces=None if caps else ['+x', '-x', '+y', '-y'])
        m.box((x - 0.8, SILL_Y[0], 1.0), (x + 0.8, SILL_Y[1], RAIL_GAUGE - 1.0), blue, faces=None if caps else ['+x', '-x', '+y', '-y'])
        if d < 2:
            # Side-frame diagonal and knee braces.
            m.beam((x, PORTAL_Y[0] - 1.0, RAIL_GAUGE - 1.2), (x, SILL_Y[1] + 0.5, 1.4), 0.9, 0.9, blue, up=(1, 0, 0))
            # TT-124: the second diagonal makes the side frame an X-braced portal, and a mid-height tie joins the leg pair.
            m.beam((x, PORTAL_Y[0] - 1.0, 1.2), (x, SILL_Y[1] + 0.5, RAIL_GAUGE - 1.4), 0.9, 0.9, blue, up=(1, 0, 0))
            m.box((x - 0.4, 33.6, 1.0), (x + 0.4, 34.4, RAIL_GAUGE - 1.0), blue)
            for z in (0.0, RAIL_GAUGE):
                m.beam((x - sx * 0.8, 46.5, z), (sx * (LEG_X - 2.6), PORTAL_Y[0], z), 0.7, 0.7, blue, up=(0, 0, 1))
                zz = 1.0 if z == 0 else RAIL_GAUGE - 1.0
                zk = 5.0 if z == 0 else RAIL_GAUGE - 5.0
                m.beam((x, PORTAL_Y[0] - 5.0, zz), (x, PORTAL_Y[0], zk), 0.6, 0.6, blue, up=(1, 0, 0))
    # Bogies: sill under each leg, equaliser beam, sub-bogies and wheels, buffers.
    for x, z in legs:
        sx = 1 if x > 0 else -1
        m.box((x - 1.6, BOGIE_TOP - 0.8, z - 1.3), (x + 1.6, BOGIE_TOP, z + 1.3), dblue)
        if d == 2:
            m.box((x - 4.2, 0.2, z - 0.6), (x + 4.2, BOGIE_TOP - 0.8, z + 0.6), dark)
            continue
        m.box((x - 4.2, 1.7, z - 0.7), (x + 4.2, BOGIE_TOP - 0.8, z + 0.7), dblue)
        subs = (-3.15, -1.05, 1.05, 3.15) if d == 0 else (-2.1, 2.1)
        for ox in subs:
            half = 0.95 if d == 0 else 2.0
            m.box((x + ox - half, 1.0, z - 0.55), (x + ox + half, 1.7, z + 0.55), dblue)
            wheels = (-0.5, 0.5) if d == 0 else (-1.0, 1.0)
            if d == 0:
                m.box((x + ox - 0.5, 1.7, z + 0.7), (x + ox + 0.5, 2.3, z + 1.15), dark)   # drive motor / gearbox
            for wx in wheels:
                if d == 0:
                    m.cyl((x + ox + wx, 0.45, z - 0.16), (x + ox + wx, 0.45, z + 0.16), 0.45, 16, dark, up=(1, 0, 0))
                    m.cyl((x + ox + wx, 0.45, z - 0.3), (x + ox + wx, 0.45, z + 0.3), 0.12, 8, grey, up=(1, 0, 0))
                else:
                    m.cyl((x + ox + wx, 0.45, z - 0.16), (x + ox + wx, 0.45, z + 0.16), 0.45, 8, dark, up=(1, 0, 0))
        # Buffers at the outer end, rail clamp and storm pin.
        bx = sx * BUFFER_X
        m.cyl((sx * (LEG_X + 4.2), 2.05, z), (bx, 2.05, z), 0.35, 10 if d == 0 else 6, red, up=(0, 0, 1))
        if d == 0:
            m.box((bx - 0.15, 1.6, z - 0.45), (bx + 0.15, 2.5, z + 0.45), dark)
            m.box((x - sx * 4.0 - 0.3, 0.3, z - 0.5), (x - sx * 4.0 + 0.3, 1.7, z + 0.5), yellow)
            m.box((x + sx * 1.9 - 0.25, 3.4, z - 0.4), (x + sx * 1.9 + 0.25, 4.6, z + 0.4), red)
    # Main girders over the landside portion (the boom continues them seaward), with trolley rails.
    z0, z1 = HINGE[1] + 0.6, GIRDER_END_Z
    for sx in (-1, 1):
        x = sx * GIRDER_X
        m.box((x - GIRDER_HALF_W, GIRDER_Y[0], z0), (x + GIRDER_HALF_W, GIRDER_Y[1], z1), blue)
        if d < 2:
            m.box((x - 0.1, GIRDER_Y[1], z0), (x + 0.1, TROLLEY_RAIL_Y, z1 - 0.8), dark, faces=['+x', '-x', '+y'])
        if d == 0:
            z = z0 + 3.0
            while z < z1 - 1:
                if not 8.0 < z < 24.0:  # leave the wordmark panel clear
                    xo = x + sx * GIRDER_HALF_W
                    m.box((min(xo, xo + sx * 0.08), GIRDER_Y[0], z - 0.08), (max(xo, xo + sx * 0.08), GIRDER_Y[1], z + 0.08), dblue,
                          faces=['+x', '-x', '+z', '-z'])
                z += 3.0
        # TTI ALGECIRAS (white on blue, text only) on the girder's outer face, as on the TTI cranes.
        m.decal((x + sx * GIRDER_HALF_W, (GIRDER_Y[0] + GIRDER_Y[1]) / 2, 16.0), (sx, 0, 0), 12.8, 1.6, SA.region_uv('tti_on_blue'))
    m.box((-GIRDER_X - GIRDER_HALF_W, GIRDER_Y[0], z1 - 0.8), (GIRDER_X + GIRDER_HALF_W, GIRDER_Y[1], z1), blue)
    # A-frame (apex), its ties, and backstays to the girder end.
    ax, ay, az = APEX
    for sx in (-1, 1):
        top = (sx * ax, ay - 0.8, az)
        m.beam((sx * LEG_X, PORTAL_Y[1], 0.0), top, 1.5, 1.5, blue, up=(1, 0, 0), w1=1.1, h1=1.1, caps=caps)
        m.beam((sx * LEG_X, PORTAL_Y[1], RAIL_GAUGE), top, 1.5, 1.5, blue, up=(1, 0, 0), w1=1.1, h1=1.1, caps=caps)
        m.beam((sx * ax, ay - 0.4, az + 0.6), (sx * GIRDER_X, GIRDER_Y[1], GIRDER_END_Z - 0.6), 0.8, 0.8, blue, up=(1, 0, 0), caps=caps)
        if d < 2:
            t = (67.0 - PORTAL_Y[1]) / (ay - 0.8 - PORTAL_Y[1])
            xf = sx * (LEG_X + (ax - LEG_X) * t)
            zf = az * t
            zr = RAIL_GAUGE + (az - RAIL_GAUGE) * t
            m.beam((xf, 67.0, zf), (xf, 67.0, zr), 0.7, 0.7, blue)
    if True:
        t = (67.0 - PORTAL_Y[1]) / (ay - 0.8 - PORTAL_Y[1])
        xf = LEG_X + (ax - LEG_X) * t
        for z in (az * t, RAIL_GAUGE + (az - RAIL_GAUGE) * t):
            m.beam((-xf, 67.0, z), (xf, 67.0, z), 0.7, 0.7, blue)
    m.box((-ax - 0.8, ay - 1.6, az - 0.9), (ax + 0.8, ay, az + 0.9), blue)
    if d == 0:
        m.box((-1.4, ay, az - 0.7), (1.4, ay + 0.9, az + 0.7), dark)       # head sheaves
        m.box((-0.15, ay + 0.9, az - 0.15), (0.15, ay + 1.3, az + 0.15), red)  # aviation light
    # Machinery house (white) on the girders at the backreach end.
    hx, (hy0, hy1), (hz0, hz1) = HOUSE['x'], HOUSE['y'], HOUSE['z']
    nose = [(hz0, hy0), (hz1, hy0), (hz1, hy1), (hz0 + 2.0, hy1), (hz0, hy1 - 1.8)]   # (z, y) profile: sloped seaward roof edge
    m.prism([(-hx, y, z) for z, y in nose], [(hx, y, z) for z, y in nose], white)
    m.box((-hx - 0.3, hy1, hz0 + 1.7), (hx + 0.3, hy1 + 0.4, hz1 + 0.3), grey)
    for sx in (-1, 1):
        m.decal((sx * hx, (hy0 + hy1) / 2 - 0.2, (hz0 + hz1) / 2), (sx, 0, 0), 5.6, 2.1, SA.region_uv('tti_on_white'), lift=0.03)
    m.decal((0.0, hy0 + 2.9, hz0), (0, 0, -1), 5.6, 2.1, SA.region_uv('tti_on_white'), lift=0.03)
    if d < 2:
        m.decal((0.0, 62.2, hz1), (0, 0, 1), 3.6, 2.0, SA.plate_uv(), mat=PLATE)
        m.decal((-4.6, 59.4, hz0), (0, 0, -1), 1.2, 2.2, _uvrect('glass'))
    if d < 2:
        rib = 0.9 if d == 0 else 1.8
        for sx in (-1, 1):
            z = hz0 + 0.45
            while z < hz1 - 0.3:
                if not (hz0 + 1.3 < z < hz1 - 1.3):
                    m.box((sx * hx - 0.05, hy0 + 0.2, z - 0.06), (sx * hx + 0.05, hy1 - 0.1, z + 0.06), white, faces=['+x', '-x', '+z', '-z'])
                z += rib
        for zf, sz in ((hz0, -1), (hz1, 1)):
            x = -hx + 0.5
            while x < hx - 0.3:
                if not (-3.2 < x < 3.2) and not -5.4 < x < -3.8:
                    m.box((x - 0.06, hy0 + 0.2, zf - 0.05), (x + 0.06, hy1 - 0.1, zf + 0.05), white, faces=['+z', '-z', '+x', '-x'])
                x += rib
    if d == 0:
        for vx in (-3.5, 0.0, 3.5):
            m.box((vx - 0.6, hy1 + 0.4, 55.0), (vx + 0.6, hy1 + 1.2, 57.0), grey)
        # House platform with handrails.
        m.box((-hx - 1.2, hy0 - 0.15, hz0 - 1.2), (hx + 1.2, hy0, hz1 + 1.2), grey)
        for sx in (-1, 1):
            _handrail(m, sx * (hx + 1.1), hy0, hz0 - 1.1, hz1 + 1.1, d)
    if d < 2:
        # ZPMC builder plates on the outward Z face of every leg (white plate, blue text).
        for x, z in legs:
            half = (2.4 - 0.6 * (14.0 - BOGIE_TOP) / (PORTAL_Y[0] - BOGIE_TOP)) / 2
            zn = -1 if z == 0 else 1
            m.decal((x, 14.0, z + zn * half), (0, 0, zn), 1.8, 0.45, SA.region_uv('zpmc_on_white'), lift=0.03)
        # Amber gantry-alarm beacons (mount points are in the sidecar's beaconMounts).
        for name, (bx, by, bz) in BEACONS.items():
            sx = 1 if bx > 0 else -1
            m.box((bx - 0.2, by - 0.15, bz - 0.2), (bx + 0.2, by, bz + 0.2), dark)
            m.cyl((bx, by, bz), (bx, by + 0.42, bz), 0.19, 8, amber, up=(1, 0, 0), r1=0.15)
    # Crane-number plates on the portal beams (seaward and landward faces).
    if d < 2:
        m.decal((0.0, (PORTAL_Y[0] + PORTAL_Y[1]) / 2, -1.1), (0, 0, -1), 3.6, 2.0, SA.plate_uv(), mat=PLATE)
        m.decal((0.0, (PORTAL_Y[0] + PORTAL_Y[1]) / 2, RAIL_GAUGE + 1.1), (0, 0, 1), 3.6, 2.0, SA.plate_uv(), mat=PLATE)
    if d == 2:
        return m
    # Catwalks with handrails along both main girders.
    for sx in (-1, 1):
        x = sx * (GIRDER_X + GIRDER_HALF_W + 0.6)
        m.box((x - 0.55, GIRDER_Y[0] - 0.12, z0), (x + 0.55, GIRDER_Y[0], HOUSE['z'][0] - 1.2), grey)
        _handrail(m, x + sx * 0.5, GIRDER_Y[0], z0, HOUSE['z'][0] - 1.2, d)
    # Cable reel on the landside of the -X sill, with its support frame.
    rz = RAIL_GAUGE * 0.5
    n = 24 if d == 0 else 10
    m.cyl((-LEG_X - 1.0, 8.0, rz), (-LEG_X - 2.8, 8.0, rz), 3.0, n, grey, up=(0, 1, 0))
    m.cyl((-LEG_X - 1.2, 8.0, rz), (-LEG_X - 2.6, 8.0, rz), 3.15, n, dark, up=(0, 1, 0), caps=False)
    m.beam((-LEG_X - 0.8, SILL_Y[0], rz - 2.5), (-LEG_X - 1.9, 8.0, rz), 0.5, 0.5, blue)
    m.beam((-LEG_X - 0.8, SILL_Y[0], rz + 2.5), (-LEG_X - 1.9, 8.0, rz), 0.5, 0.5, blue)
    # Electrical room under the landside portal (between the -X legs, above the lanes).
    m.box((-LEG_X - 0.8 - 3.2, 44.0, RAIL_GAUGE - 6.0), (-LEG_X - 0.8, 49.0, RAIL_GAUGE - 1.4), white)
    # Festoon: trolley power cables drooping from a track along the backreach.
    fx = -(GIRDER_X + GIRDER_HALF_W + 1.4)
    m.box((fx - 0.15, 53.5, 31.0), (fx + 0.15, 53.8, 50.5), grey)
    loops = 10 if d == 0 else 6
    span = (50.0 - 31.5) / loops
    for i in range(loops):
        za = 31.5 + i * span
        cables = (-0.18, 0.0, 0.18) if d == 0 else (-0.12, 0.12)
        for ox in cables:
            m.catenary((fx + ox, 53.5, za), (fx + ox, 53.5, za + span), 1.6, 10 if d == 0 else 6, 0.06, 8 if d == 0 else 4, dark)
        if d == 0:
            m.box((fx - 0.3, 53.2, za - 0.2), (fx + 0.3, 53.5, za + 0.2), dark)
    # Floodlights under the girders and on the portal; caged ladders up all four legs.
    if d < 2:
        for sx in (-1, 1):
            for z in (6.0, 20.0, 34.0, 46.0):
                _floodlight(m, (sx * GIRDER_X, GIRDER_Y[0] - 0.2, z))
            _floodlight(m, (sx * LEG_X, PORTAL_Y[0] - 0.2, -1.6))
        for x, z in legs:
            sx = 1 if x > 0 else -1
            _ladder(m, x + sx * 1.2, sx, z, BOGIE_TOP + 0.3, PORTAL_Y[0] - 0.4, d)
    return m


def boom_structure(d):
    m = GMesh()
    blue, dblue, grey, dark = (P(k) for k in ('blue', 'blue_dark', 'grey', 'dark'))
    hz = HINGE[1]
    tip = BOOM_TIP_Z
    frames = (-24.0, -48.0)
    for sx in (-1, 1):
        x = sx * GIRDER_X
        if d == 2:
            m.box((x - GIRDER_HALF_W, 54.4, tip), (x + GIRDER_HALF_W, GIRDER_Y[1], hz), blue)
            continue
        # Lattice girder: top chord (carries the trolley rail), bottom chord rising to the tip, web members.
        m.beam((x, 56.6, hz), (x, 56.6, tip), 1.1, 1.2, blue, up=(0, 1, 0))
        m.beam((x, 54.5, hz), (x, 55.5, tip), 1.0, 1.0, blue, up=(0, 1, 0))
        m.box((x - 0.1, GIRDER_Y[1], tip + 1.0), (x + 0.1, TROLLEY_RAIL_Y, hz), dark, faces=['+x', '-x', '+y'])
        bays = 18 if d == 0 else 8
        for k in range(bays + 1):
            z = hz + (tip - hz) * k / bays
            yb = 54.5 + (55.5 - 54.5) * k / bays
            m.beam((x, yb + 0.5, z), (x, 56.0, z), 0.45, 0.45, dblue, up=(0, 0, 1), caps=False)
            if k < bays:
                zn = hz + (tip - hz) * (k + 1) / bays
                ybn = 54.5 + (55.5 - 54.5) * (k + 1) / bays
                m.beam((x, yb + 0.5, z), (x, 56.0, zn), 0.4, 0.4, dblue, up=(1, 0, 0), caps=False)
                if d == 0:
                    m.beam((x, 56.0, z), (x, ybn + 0.5, zn), 0.3, 0.3, dblue, up=(1, 0, 0), caps=False)
        # Catwalk with handrails on the outer side.
        cx = x + sx * (GIRDER_HALF_W + 0.6)
        m.box((cx - 0.55, 54.2, tip + 1.0), (cx + 0.55, 54.32, hz), grey)
        _handrail(m, cx + sx * 0.5, 54.32, tip + 1.0, hz, d)
    # Overhead frames over the trolley path (forestay anchors) and the boom nose.
    ax, ay, az = APEX
    for z in frames:
        for sx in (-1, 1):
            m.beam((sx * GIRDER_X, GIRDER_Y[1], z), (sx * GIRDER_X, 63.0, z), 0.8, 0.8, blue, up=(0, 0, 1), caps=d < 2)
            # Forestays (tension members) up to the apex.
            m.beam((sx * GIRDER_X, 63.0, z), (sx * ax, ay - 1.0, az - 0.6), 0.45, 0.45, blue, up=(1, 0, 0), caps=d < 2)
        m.box((-GIRDER_X - 0.4, 62.6, z - 0.4), (GIRDER_X + 0.4, 63.4, z + 0.4), blue)
        if d == 2:
            break
    m.box((-GIRDER_X - GIRDER_HALF_W, 54.4, tip - 0.8), (GIRDER_X + GIRDER_HALF_W, GIRDER_Y[1], tip), blue)
    # TT-124: the long forestay tension rods from the apex to the boom nose (a pair per side; twin cables at LOD0).
    for sx in (-1, 1):
        for ox in ((-0.25, 0.25) if d == 0 else (0.0,)):
            m.beam((sx * ax + ox, ay - 1.0, az - 0.6), (sx * GIRDER_X + ox, 58.0, tip + 0.4), 0.3, 0.3, blue, up=(1, 0, 0), caps=d < 2)
    if d == 2:
        return m
    # Hinge lugs and pins.
    for sx in (-1, 1):
        m.cyl((sx * (GIRDER_X - 1.0), HINGE[0], hz), (sx * (GIRDER_X + 1.0), HINGE[0], hz), 0.45, 10 if d == 0 else 6, dark, up=(0, 1, 0))
    if d < 2:
        for sx in (-1, 1):
            for z in (-14.0, -30.0, -46.0, -62.0):
                _floodlight(m, (sx * GIRDER_X, 54.2, z))
        m.box((-1.0, 57.2, tip + 0.2), (1.0, 58.4, tip + 1.0), dark)  # tip sheave housing
    return m


def trolley_part(d):
    """World rest coordinates with the trolley at Z = 0."""
    m = GMesh()
    white, grey, dark = P('white'), P('grey'), P('dark')
    y = TROLLEY_RAIL_Y
    m.box((-5.4, y + 0.5, -3.4), (5.4, y + 2.8, 3.4), white)
    if d == 2:
        m.box((-2.0, y - 2.8, -3.4), (0.6, y, -1.4), white)
        return m
    m.box((-5.4, y + 2.8, -3.0), (5.4, y + 3.0, 3.0), grey)
    for sx in (-1, 1):
        m.box((sx * GIRDER_X - 0.45, y + 0.2, -3.2), (sx * GIRDER_X + 0.45, y + 0.5, 3.2), grey)
        for z in ((-2.6, -1.3, 1.3, 2.6) if d == 0 else (-2.0, 2.0)):
            if d == 0:
                m.cyl((sx * GIRDER_X - 0.12, y + 0.38, z), (sx * GIRDER_X + 0.12, y + 0.38, z), 0.38, 12, dark, up=(0, 1, 0))
            else:
                m.box((sx * GIRDER_X - 0.12, y, z - 0.38), (sx * GIRDER_X + 0.12, y + 0.76, z + 0.38), dark)
    # Rope sheave housings under the frame.
    for sx in (-1, 1):
        for sz in (-1, 1):
            m.box((sx * 2.4 - 0.3, y - 0.1, sz * 0.9 - 0.3), (sx * 2.4 + 0.3, y + 0.5, sz * 0.9 + 0.3), dark)
    # Operator cab hanging under the seaward end, with windows.
    cab = ((-2.0, y - 2.8, -3.4), (0.6, y, -1.4))
    m.box(cab[0], cab[1], white)
    m.beam((-1.6, y, -2.4), (-1.6, y + 0.5, -2.4), 0.2, 0.2, grey, up=(0, 0, 1))
    m.beam((0.2, y, -2.4), (0.2, y + 0.5, -2.4), 0.2, 0.2, grey, up=(0, 0, 1))
    win = _uvrect('glass')
    m.decal((-0.7, y - 1.3, -3.4), (0, 0, -1), 2.2, 1.4, win)
    m.decal((-2.0, y - 1.3, -2.4), (-1, 0, 0), 1.6, 1.4, win)
    m.decal((0.6, y - 1.3, -2.4), (1, 0, 0), 1.6, 1.4, win)
    for sx in (-1, 1):
        m.cyl((sx * 0.6, y + 3.6, -2.0), (sx * 3.6, y + 3.6, -2.0), 0.6, 12 if d == 0 else 6, dark, up=(0, 1, 0))
    m.box((-1.8, y + 3.0, 0.8), (1.8, y + 4.4, 2.8), white)
    if d == 0:
        m.decal((-0.7, y - 2.8, -2.4), (0, -1, 0), 2.0, 1.4, win, up=(0, 0, 1))
        for sx in (-1, 1):
            _handrail(m, sx * 5.2, y + 3.0, -2.8, 2.8, d, post_every=1.4)
    return m


def ropes_part(d):
    """Unit-length ropes hanging from the trolley sheaves (world rest coordinates)."""
    m = GMesh()
    dark = P('dark')
    y = TROLLEY_RAIL_Y
    if d == 2:
        for sx in (-1, 1):
            m.beam((sx * 2.4, y, 0.0), (sx * 2.4, y - 1.0, 0.0), 0.25, 0.12, dark, up=(0, 0, 1), caps=False)
        return m
    offsets = (-0.12, 0.12) if d == 0 else (0.0,)
    for sx in (-1, 1):
        for sz in (-1, 1):
            for ox in offsets:
                m.cyl((sx * 2.4 + ox, y, sz * 0.9), (sx * 2.4 + ox, y - 1.0, sz * 0.9), 0.05, 8 if d == 0 else 4, dark, caps=False, up=(0, 0, 1))
    return m


def headblock_part(d):
    m = GMesh()
    white, dark = P('white'), P('dark')
    m.box((-2.9, 1.15, -1.15), (2.9, 2.1, 1.15), white)
    m.box((-1.2, 0.95, -0.6), (1.2, 1.15, 0.6), dark)
    if d == 0:
        for sx in (-1, 1):
            for sz in (-1, 1):
                m.cyl((sx * 2.4 - 0.18, HEADBLOCK_SHEAVE_Y, sz * 0.9), (sx * 2.4 + 0.18, HEADBLOCK_SHEAVE_Y, sz * 0.9), 0.35, 10, dark, up=(0, 1, 0))
    return m


def spreader_part(d):
    m = GMesh()
    yellow, dark = P('yellow'), P('dark')
    if d == 2:
        m.box((-TELE_X - 0.15, 0.15, -1.2), (TELE_X + 0.15, 0.95, 1.2), yellow)
        return m
    m.box((-2.2, 0.15, -1.1), (2.2, 0.95, 1.1), yellow)
    for sz in (-0.55, 0.55):
        m.box((-2.9, 0.3, sz - 0.18), (2.9, 0.85, sz + 0.18), yellow)
    if d == 0:
        m.box((-1.0, 0.95, -0.8), (1.0, 1.0, 0.8), dark)
        for sx in (-1, 1):
            m.cyl((sx * 0.9, 0.55, -1.12), (sx * 1.9, 0.55, -1.12), 0.12, 8, dark, up=(0, 1, 0))
    return m


def tele_part(d, sx):
    m = GMesh()
    yellow = P('yellow')
    x = sx * TELE_X
    m.box((x - 0.2 if sx > 0 else x - 0.15, 0.1, -1.25), (x + 0.15 if sx > 0 else x + 0.2, 0.95, 1.25), yellow)
    arm_z = 0.55 if sx > 0 else 0.35
    inner = x - sx * 4.4
    for sz in (-1, 1):
        m.box((min(inner, x), 0.38, sz * arm_z - 0.12), (max(inner, x), 0.78, sz * arm_z + 0.12), yellow)
    if d == 0:
        # Corner flippers, folded up.
        for sz in (-1, 1):
            m.box((x - 0.05 + sx * 0.05, 0.95, sz * 1.25 - 0.3), (x + 0.05 + sx * 0.05, 1.55, sz * 1.25 + 0.3), yellow)
    return m


def twin_part(d):
    m = GMesh()
    yellow = P('yellow')
    m.box((-0.45, TWIN_DROP + 0.02, -1.32), (0.45, TWIN_DROP + 0.6, 1.32), yellow)
    return m


def twistlock_part(pivot):
    m = GMesh()
    dark = P('dark')
    x, y, z = pivot
    m.cyl((x, y + 0.1, z), (x, y - 0.06, z), 0.065, 8, dark)
    m.box((x - 0.06, y - 0.14, z - 0.11), (x + 0.06, y - 0.06, z + 0.11), dark)
    return m


# ---- Assembly ---------------------------------------------------------------

def _materials(atlas_image):
    paint = textured_material('sts_paint', atlas_image, roughness=0.6, metallic=0.15)
    plate = textured_material('sts_plate', atlas_image, roughness=0.5)
    return [paint, plate]


class _Rig:
    def __init__(self):
        self.nodes = []         # sidecar node list
        self.objects = {}       # name -> (object, world pivot)
        self.triangles = {}

    def empty(self, name, parent_name, world, role, rig=None, axis=None, description=None):
        parent_obj, parent_world = self.objects[parent_name]
        local = tuple(world[i] - parent_world[i] for i in range(3))
        obj = empty(name, parent_obj, _b(local))
        self.objects[name] = (obj, world)
        entry = {'name': name, 'parent': parent_name, 'role': role, 'pivot': [round(c, 4) for c in world]}
        if rig:
            entry['rig'] = rig
        if axis:
            entry['axis'] = axis
        if description:
            entry['description'] = description
        self.nodes.append(entry)
        return obj

    def geo(self, name, parent_name, mesh, materials, lod, description):
        if not mesh.faces:
            return
        parent_obj, parent_world = self.objects[parent_name]
        mesh.to_object(name, materials, parent_obj, parent_world)
        self.nodes.append({'name': name, 'parent': parent_name, 'role': 'mesh', 'description': description})
        self.triangles[lod] = self.triangles.get(lod, 0) + mesh.triangles


RIG_AXES = {
    'gantry': '+X', 'boom': '+X', 'trolley': '+Z', 'ropes': '-Y', 'hoist': '+Y', 'spreader': '+Y',
    'spreader_tele_fore': '+X', 'spreader_tele_aft': '-X', 'twin_locks': '-Y',
}
LOCKS = {
    'twistlock_fore_land': ('spreader_tele_fore', (TWISTLOCK_X, 0.0, TWISTLOCK_Z)),
    'twistlock_fore_sea': ('spreader_tele_fore', (TWISTLOCK_X, 0.0, -TWISTLOCK_Z)),
    'twistlock_aft_land': ('spreader_tele_aft', (-TWISTLOCK_X, 0.0, TWISTLOCK_Z)),
    'twistlock_aft_sea': ('spreader_tele_aft', (-TWISTLOCK_X, 0.0, -TWISTLOCK_Z)),
    'twistlock_twin_aft_land': ('twin_locks', (-(HALF_OFFSET - TWISTLOCK_X), TWIN_DROP, TWISTLOCK_Z)),
    'twistlock_twin_aft_sea': ('twin_locks', (-(HALF_OFFSET - TWISTLOCK_X), TWIN_DROP, -TWISTLOCK_Z)),
    'twistlock_twin_fore_land': ('twin_locks', (HALF_OFFSET - TWISTLOCK_X, TWIN_DROP, TWISTLOCK_Z)),
    'twistlock_twin_fore_sea': ('twin_locks', (HALF_OFFSET - TWISTLOCK_X, TWIN_DROP, -TWISTLOCK_Z)),
}


def build_sts(atlas_image):
    """Builds the asset hierarchy; returns (root, info)."""
    mats = _materials(atlas_image)
    root = empty(NAME)
    rig = _Rig()
    rig.objects[NAME] = (root, (0.0, 0.0, 0.0))
    bounds = None
    for level in range(3):
        lod = f'LOD{level}'
        sfx = '' if level == 0 else f'_lod{level}'
        n = (lambda base: base + sfx)
        lod_obj = empty(lod, root)
        rig.objects[lod] = (lod_obj, (0.0, 0.0, 0.0))
        rig.nodes.append({'name': lod, 'parent': NAME, 'role': 'lod'})
        rig.empty(n('gantry'), lod, (0.0, 0.0, 0.0), 'rig', 'gantry', '+X', 'travels along the quay rail')
        gantry_mesh = gantry_structure(level)
        rig.geo(n('gantry_geo'), n('gantry'), gantry_mesh, mats, lod, 'legs, portal, sills, bogies, girders, A-frame, machinery house, ladders, festoon')
        rig.empty(n('boom'), n('gantry'), (0.0, HINGE[0], HINGE[1]), 'rig', 'boom', '+X', 'boom hinge pin; positive rotation raises the boom')
        boom_mesh = boom_structure(level)
        rig.geo(n('boom_geo'), n('boom'), boom_mesh, mats, lod, 'seaward lattice boom, forestays, catwalks, floodlights')
        if level == 0:
            bounds = (gantry_mesh.bounds(), boom_mesh.bounds())
        rig.empty(n('trolley'), n('gantry'), (0.0, TROLLEY_RAIL_Y, 0.0), 'rig', 'trolley', '+Z', 'on the trolley rails; Z = trolley position from the waterside rail')
        rig.geo(n('trolley_geo'), n('trolley'), trolley_part(level), mats, lod, 'trolley frame, wheels, operator cab')
        rig.empty(n('ropes'), n('trolley'), (0.0, TROLLEY_RAIL_Y, 0.0), 'rig', 'ropes', '-Y', 'hoist ropes, 1 m long at rest: scale Y = rope length (see stretch)')
        rig.geo(n('ropes_geo'), n('ropes'), ropes_part(level), mats, lod, 'hoist ropes (unit length)')
        rig.empty(n('hoist'), n('trolley'), (0.0, 0.0, 0.0), 'rig', 'hoist', '+Y', 'spreader underside centre; Y = height above the rail')
        rig.geo(n('hoist_geo'), n('hoist'), headblock_part(level) if level < 2 else GMesh(), mats, lod, 'headblock')
        rig.empty(n('spreader'), n('hoist'), (0.0, 0.0, 0.0), 'rig', 'spreader', '+Y', 'container attach point (top centre of the box); skew rotation')
        rig.geo(n('spreader_geo'), n('spreader'), spreader_part(level), mats, lod, 'telescopic spreader main frame')
        for side, sx in (('fore', 1), ('aft', -1)):
            node = f'spreader_tele_{side}'
            rig.empty(n(node), n('spreader'), (sx * TELE_X, 0.0, 0.0), 'rig', node, RIG_AXES[node], f'{side} telescope end beam (20 ft at rest)')
            if level < 2:
                rig.geo(n(f'{node}_geo'), n(node), tele_part(level, sx), mats, lod, f'{side} telescope end beam and arms')
        rig.empty(n('twin_locks'), n('spreader'), (0.0, TWIN_DROP, 0.0), 'rig', 'twin_locks', '-Y', 'twin-20 centre twist-lock units (retracted at rest)')
        if level < 2:
            rig.geo(n('twin_locks_geo'), n('twin_locks'), twin_part(level), mats, lod, 'twin-lift housing')
        if level == 0:
            for lock, (parent, pivot) in LOCKS.items():
                rig.empty(lock, parent, pivot, 'rig', lock, '+Y', 'twist-lock; 90 degrees = locked')
                rig.geo(f'{lock}_geo', lock, twistlock_part(pivot), mats, lod, 'twist-lock cone')
    lo = Vector((min(b[0].x for b in bounds), min(b[0].y for b in bounds), min(b[0].z for b in bounds)))
    hi = Vector((max(b[1].x for b in bounds), max(b[1].y for b in bounds), max(b[1].z for b in bounds)))
    return root, {'nodes': rig.nodes, 'triangles': rig.triangles, 'bounds': (lo, hi), 'objects': rig.objects}


# [A] LOD switch distances (camera to crane centre, m), tuned so detail pops are not visible.
LOD_DISTANCES = (250, 900)

SPREADER_MODES = {
    '20': {'spreader_tele_fore': 0.0, 'spreader_tele_aft': 0.0, 'twin_locks': 0.0},
    '40': {'spreader_tele_fore': round(TELE_STROKE, 4), 'spreader_tele_aft': round(TELE_STROKE, 4), 'twin_locks': 0.0},
    'twin-20': {'spreader_tele_fore': round(TELE_STROKE, 4), 'spreader_tele_aft': round(TELE_STROKE, 4), 'twin_locks': TWIN_DROP},
}


def sidecar(info, scene_water_rail_z):
    lo, hi = info['bounds']
    tri = info['triangles']
    limits = {
        'gantry': {'type': 'translation', 'axis': '+X', 'minM': -40, 'maxM': 40, 'rest': 0, 'tag': 'A',
                   'note': 'unbounded along the quay rail in the twin; this range is for the asset viewer'},
        'trolley': {'type': 'translation', 'axis': '+Z', 'minM': -OUTREACH, 'maxM': round(RAIL_GAUGE + BACKREACH, 2), 'rest': 0, 'tag': 'V',
                    'note': f'from the waterside rail; {OUTREACH:g} m outreach [V], {BACKREACH:g} m backreach behind the landside rail [A]'},
        'hoist': {'type': 'translation', 'axis': '+Y', 'minM': -20, 'maxM': LIFT_ABOVE_RAIL, 'rest': 0, 'tag': 'V',
                  'note': 'spreader underside height above the rail: 52 m lift [V]; 20 m below the rail into the hold [A]'},
        'spreader': {'type': 'rotation', 'axis': '+Y', 'minDeg': -5, 'maxDeg': 5, 'rest': 0, 'tag': 'A', 'note': 'skew'},
        'spreader_tele_fore': {'type': 'translation', 'axis': '+X', 'minM': 0, 'maxM': round(TELE_STROKE, 4), 'rest': 0, 'tag': 'V',
                               'note': '0 = 20 ft, max = 40 ft (ISO 668 lengths)'},
        'spreader_tele_aft': {'type': 'translation', 'axis': '-X', 'minM': 0, 'maxM': round(TELE_STROKE, 4), 'rest': 0, 'tag': 'V',
                              'note': '0 = 20 ft, max = 40 ft (ISO 668 lengths)'},
        'twin_locks': {'type': 'translation', 'axis': '-Y', 'minM': 0, 'maxM': TWIN_DROP, 'rest': 0, 'tag': 'A',
                       'note': 'lowered = twin-20 lift (inner castings of two 20 ft boxes)'},
        'boom': {'type': 'rotation', 'axis': '+X', 'minDeg': 0, 'maxDeg': 80, 'rest': 0, 'tag': 'A', 'note': 'boom up for vessel passage'},
    }
    for lock in LOCKS:
        limits[lock] = {'type': 'rotation', 'axis': '+Y', 'minDeg': 0, 'maxDeg': 90, 'rest': 0, 'tag': 'A', 'note': '90 = locked'}

    def g(value, tag, **extra):
        return {'value': round(value, 3), 'tag': tag, **extra}
    return {
        'asset': NAME,
        'kind': 'sts',
        'version': 1,
        'generator': 'src/sims/terminal-twin/assets/generators/build.py --only sts',
        'units': 'm',
        'dimensions': {
            'lengthM': round(hi.x - lo.x, 2), 'widthM': round(hi.z - lo.z, 2), 'heightM': round(hi.y, 2), 'tag': 'A',
            'note': 'overall LOD0 extents at rest (boom down): length along the rail (over buffers), width across (boom tip to backreach end), height to the apex',
        },
        'geometry': {
            'railGaugeM': g(RAIL_GAUGE, 'V', source='TTI reference pack, STS table'),
            'liftHeightAboveRailM': g(LIFT_ABOVE_RAIL, 'V', source='TTI reference pack (operator height above rail)'),
            'outreachM': g(OUTREACH, 'V', source='TTI reference pack (Malaccamax seaward outreach)'),
            'backreachM': g(BACKREACH, 'A', reason='not verified; functional backreach behind the landside rail'),
            'apexHeightM': g(APEX[1], 'A', reason='overall steel height not verified; proportional structure above the 52 m envelope'),
            'trolleyRailHeightM': g(TROLLEY_RAIL_Y, 'A', reason='52 m lift + spreader/headblock + clearance'),
            'boomHingeM': {'y': HINGE[0], 'z': HINGE[1], 'tag': 'A'},
            'legSpacingM': g(2 * LEG_X, 'A', reason='leg centres along the rail; mechanical-clearance approximation'),
            'overBuffersM': g(2 * BUFFER_X, 'A', reason='matches quay.stsMinSpacingM (27 m)'),
            'boomTipM': g(-BOOM_TIP_Z, 'A'),
        },
        'axes': {
            'up': '+Y',
            'rail': '+X (along the quay)',
            'landward': '+Z (the sea and the boom are at -Z)',
            'origin': 'waterside rail centreline at rail level, on the crane centre line',
            'handedness': 'right-handed, glTF',
        },
        'sceneMounting': {
            'waterRailZ': scene_water_rail_z,
            'note': 'the twin places the root at (0, 0, waterRailZ); gantry.x = gantryX, trolley.z = trolleyZ - waterRailZ, hoist.y = hoistY',
        },
        'lodNaming': {'LOD0': '', 'LOD1': '_lod1', 'LOD2': '_lod2', 'note': 'every node under LODn carries the suffix; twist-locks exist in LOD0 only'},
        'nodes': info['nodes'],
        'travelLimits': limits,
        'stretch': [
            {'node': 'ropes', 'to': 'hoist', 'axis': 'Y', 'offsetM': HEADBLOCK_SHEAVE_Y, 'unitLengthM': 1.0,
             'note': 'ropes.scale.y = ropes.y - (hoist.y + offsetM), both children of the trolley'},
        ],
        'spreaderModes': SPREADER_MODES,
        'attachPoints': [
            {'name': 'container', 'node': 'spreader', 'position': [0, 0, 0], 'tag': 'V',
             'description': 'top centre of a single 20/40 ft box (twist-locks at the ISO 1161 casting centres)'},
            {'name': 'container_twin_aft', 'node': 'spreader', 'position': [-HALF_OFFSET, 0, 0], 'tag': 'A',
             'description': 'top centre of the aft box of a twin-20 lift'},
            {'name': 'container_twin_fore', 'node': 'spreader', 'position': [HALF_OFFSET, 0, 0], 'tag': 'A',
             'description': 'top centre of the fore box of a twin-20 lift'},
        ],
        'beaconMounts': [
            {'name': name, 'node': 'gantry', 'position': [round(c, 3) for c in pos],
             'colour': SA.PALETTE['amber'], 'lens': 'amber', 'tag': 'A',
             'description': ('on the outer X face of a leg at gantry-alarm height' if '_leg_' in name else 'on the end of a portal beam')
             + f', {"seaward" if "_sea_" in name else "landward"} side; rides with the gantry'}
            for name, pos in BEACONS.items()
        ],
        'groundContact': {'y': 0, 'rails': [{'z': 0}, {'z': RAIL_GAUGE}], 'wheelsPerCorner': 8, 'tag': 'A'},
        'lods': {
            'LOD0': {'triangles': tri['LOD0'], 'maxDistanceM': LOD_DISTANCES[0], 'note': 'camera to crane centre; the renderer adds 15 % hysteresis'},
            'LOD1': {'triangles': tri['LOD1'], 'maxDistanceM': LOD_DISTANCES[1]},
            'LOD2': {'triangles': tri['LOD2']},
        },
        'materials': {'sts_paint': 'palette + wordmarks (sts-atlas)', 'sts_plate': 'crane-number plates; UVs for tile 0 (crane 101)'},
        'branding': {
            'wordmark': SA.WORDMARK,
            'livery': SA.OPERATOR_NAME,
            'typeface': SA.WORDMARK_FONT.replace('.ttf', ''),
            'placement': 'TTI over ALGECIRAS on the machinery house sides and seaward end (blue on white), TTI ALGECIRAS on the main girder outer faces (white on blue), ZPMC builder plates on the legs',
            'craneNumbers': {
                'first': SA.PLATE_FIRST, 'count': SA.PLATE_COUNT,
                'placement': 'seaward and landward portal beams, landside end of the machinery house',
                **SA.manifest()['plates'],
            },
            'operatorBranding': True,
            'note': 'text only (open-licence typeface), no logo artwork',
            'tag': 'P',
        },
        'provenance': [
            {'fact': f'rail gauge {RAIL_GAUGE} m', 'tag': 'V', 'source': 'TTI reference pack, STS table'},
            {'fact': f'{LIFT_ABOVE_RAIL:g} m lift height above rail (hoist travel maximum)', 'tag': 'V', 'source': 'TTI reference pack'},
            {'fact': f'{OUTREACH:g} m seaward outreach from the waterside rail (trolley travel minimum)', 'tag': 'V', 'source': 'TTI reference pack'},
            {'fact': 'Malaccamax geometry on every crane', 'tag': 'M', 'reason': 'builder version: real fleet is 5 Malaccamax + 3 Super Post-Panamax'},
            {'fact': 'blue steelwork, white machinery house, yellow spreader, lattice boom, ties, ladders, catwalks, floodlights',
             'tag': 'P', 'source': 'reference photographs (not committed)'},
            {'fact': 'apex, trolley-rail and hinge heights, leg spacing, backreach, bogie layout, house size', 'tag': 'A'},
            {'fact': 'wordmarks set in Archivo ExtraBold; crane numbers 101-124 on plates', 'tag': 'A'},
            {'fact': 'TTI ALGECIRAS livery: cobalt-blue steel, white machinery house with a sloped seaward nose and TTI / ALGECIRAS text, TTI ALGECIRAS text along the girders, ZPMC plates on the legs, crane number plates, X-braced side frames, long forestay rods from the apex to the boom nose, amber beacons',
             'tag': 'P', 'source': 'TTI Algeciras reference photographs of the STS cranes (git-ignored, not committed)'},
            {'fact': 'no TTI emblem or logo artwork', 'tag': 'M', 'reason': 'text names only'},
            {'fact': 'beacon mount positions', 'tag': 'A', 'reason': 'photos show amber beacons low on the legs; exact heights are estimated'},
            {'fact': 'forestays rotate with the boom (they detach from the apex when the boom is raised)', 'tag': 'M',
             'reason': 'boom raising is a viewer-only pose; real tie bars fold'},
            {'fact': 'ladder cages, handrail posts and festoon loops simplified', 'tag': 'M', 'reason': 'triangle budget'},
        ],
    }
