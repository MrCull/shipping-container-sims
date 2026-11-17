"""Hero truck (#276): a detailed skeletal chassis and three detailed tractor cabs, shown in place of the truck LOD0 near
the camera.

`truck-cab-*.glb` holds the tractor AND the chassis; the hero pieces split them so the chassis and the cab swap on their
own: `hero-truck-chassis` replaces LOD0's chassis part (`chassis`, `wheel_t1|t2|t3`), `hero-truck-cab-<shape>` replaces
LOD0's `fifth_wheel` subtree. Same root frame as the truck GLBs (origin = ground contact below the centre of a 40 ft box
on the chassis, Blender X = cab end, Z = up), same rig node names, pivots and axes, all imported from `truck.py`:

  hero-truck-chassis > LOD0 > chassis                    truck.py chassis + twist-lock castings, cross tubes, gooseneck
                                                         gussets, landing-leg pads and cranks, mudguard stays, lamps, ABS lines
                              wheel_t1|t2|t3 > *_geo     tyres with tread lugs, rims with nuts
  hero-truck-cab-<shape> > LOD0 > fifth_wheel            articulation pivot (kingpin)
                                    tractor              truck.py tractor + glazing seals, wipers, mirrors, grille, steps and
                                                         handles, exhaust shield, fifth-wheel ramps and lock
                                    steer_fl|fr > wheel_fl|fr > *_geo
                                    wheel_r > wheel_r_geo

Rig nodes are empties at the pivot with the mesh in `<name>_geo`. One material, `truck_atlas`, the truck livery atlas
with TEXCOORD_0 on tile 0 like the truck GLBs: the runtime puts the rig's per-shape, per-livery material on every mesh
(the cab colour and wordmark are on `tractor`, the chassis colour on `chassis`). Deterministic.
"""
import math

from . import truck as T
from . import truck_meta as TM
from .blender import empty, textured_material

TYRE_SEGS = 24
LUGS = 14          # tread lugs per tyre half
NUTS = 10
MATERIAL = 'truck_atlas'


# ---- wheels ------------------------------------------------------------------
def _sector_block(p, a0, a1, r0, r1, y0, y1, swatch):
    """A block between two angles about the Blender Y axle, radii r0..r1, axle offsets y0..y1 (no inner face)."""
    def pt(r, y, a):
        return (r * math.cos(a), y, r * math.sin(a))
    uv = [T.ATLAS_SPEC.swatch_uv(swatch)] * 4
    am = (a0 + a1) / 2
    p.m.quad([pt(r1, y0, a0), pt(r1, y0, a1), pt(r1, y1, a1), pt(r1, y1, a0)], uv, outward=(math.cos(am), 0, math.sin(am)))
    for a, s in ((a0, -1), (a1, 1)):
        p.m.quad([pt(r0, y0, a), pt(r1, y0, a), pt(r1, y1, a), pt(r0, y1, a)], uv, outward=(-math.sin(a) * s, 0, math.cos(a) * s))
    for y, s in ((y0, -1), (y1, 1)):
        p.m.quad([pt(r0, y, a0), pt(r1, y, a0), pt(r1, y, a1), pt(r0, y, a1)], uv, outward=(0, s, 0))


def tyre(p, yc, width, outer):
    """One tyre centred at (0, yc, 0) rolling about Blender Y, radius T.R: a recessed tread band with staggered lugs
    reaching T.R (so the rolling radius matches the truck GLBs), and a rim with nuts on the `outer` face (+1 / -1)."""
    w, r = width / 2, T.R
    base = r - 0.03
    prof = [(0.0, -0.8 * w, 'a-', 'zinc'), (0.28, -0.8 * w, 'a-', 'steel'), (0.34, -w, 'a-', 'rubber'), (r - 0.08, -w, 'r', 'rubber'),
            (r - 0.02, -0.88 * w, 'r', 'rubber'), (base, -0.78 * w, 'r', 'black'), (base, 0.78 * w, 'r', 'rubber'),
            (r - 0.02, 0.88 * w, 'a+', 'rubber'), (r - 0.08, w, 'a+', 'rubber'), (0.34, w, 'a+', 'steel'), (0.28, 0.8 * w, 'a+', 'zinc'), (0.0, 0.8 * w, 'a+', 'zinc')]
    p.revolve((0, yc, 0), 'y', prof, TYRE_SEGS, lambda k, e: prof[e][3])
    pitch = 2 * math.pi / LUGS
    for i in range(LUGS):
        for side, off in ((-1, 0.0), (1, 0.5)):
            a0 = (i + off) * pitch
            y0, y1 = (-w * 0.78, -w * 0.05) if side < 0 else (w * 0.05, w * 0.78)
            _sector_block(p, a0, a0 + pitch * 0.55, base - 0.004, r, yc + y0, yc + y1, 'rubber')
    # rim: dished white disc and a ring of wheel nuts on the outer face
    face = 'a+' if outer > 0 else 'a-'
    yf = yc + outer * 0.8 * w
    p.revolve((0, 0, 0), 'y', [(0.27, yf, 'r', 'white'), (0.27, yf + outer * 0.012, face, 'white'), (0.1, yf + outer * 0.012, face, 'white')], 16, lambda k, e: 'white')
    for i in range(NUTS):
        a = i * 2 * math.pi / NUTS
        x, z = 0.17 * math.cos(a), 0.17 * math.sin(a)
        p.revolve((x, 0, z), 'y', [(0.022, yf, 'r', 'zinc'), (0.022, yf + outer * 0.035, face, 'zinc'), (0.0, yf + outer * 0.035, face, 'zinc')], 6, lambda k, e: 'zinc')


def front_wheel_mesh(sy):
    p = T.Part()
    tyre(p, 0.0, T.TYRE_W['front'], sy)
    p.cbox((0, sy * (T.TYRE_W['front'] / 2 + 0.04), 0), (0.1, 0.08, 0.1), 'zinc', ('+y', '-y'))   # hub cap, as truck.py
    return p


def drive_wheel_mesh():
    p = T.Part()
    for sy in (-1, 1):
        for y in T.DRIVE_Y:
            tyre(p, sy * y, T.TYRE_W['drive'], sy)
    p.beam((0, -0.7, 0), (0, 0.7, 0), 0.14, 0.14, 'dark')
    return p


def trailer_wheel_mesh():
    p = T.Part()
    for sy in (-1, 1):
        tyre(p, sy * T.TRACK_TRAILER_Y, T.TYRE_W['trailer'], sy)
    p.beam((0, -0.8, 0), (0, 0.8, 0), 0.13, 0.13, 'dark')
    return p


# ---- chassis -----------------------------------------------------------------
def chassis_mesh():
    p = T.chassis_mesh(0)
    # twist-lock castings at every pin (the corners of load_40, load_20_* and the twin seats): a collar on the housing,
    # the cone, and side apertures on the outer face
    for x in T.PIN_XS:
        for sy in (-1, 1):
            y = sy * T.PIN_Y
            p.box((x - 0.09, y - 0.09, T.DECK - 0.03), (x + 0.09, y + 0.09, T.DECK), 'steel', ('+x', '-x', '+y', '-y', '+z'))
            p.revolve((x, y, T.DECK), 'z', [(0.055, 0.0, 'r', 'zinc'), (0.04, 0.03, 'r', 'zinc'), (0.022, 0.048, 'a+', 'zinc'), (0.0, 0.048, 'a+', 'zinc')], 8, lambda k, e: 'zinc')
            p.lens((x, y + sy * 0.111, 1.2), (0.1, 0.004, 0.06), 'black', 'y', sy)
    # cross tubes between the rails, below the cross members
    for x in (5.1, 3.8, 2.2, 0.8, -0.8, -1.8, -2.6, -3.6, -4.6, -5.3, -6.1):
        p.box((x - 0.035, -0.55, 0.99), (x + 0.035, 0.55, 1.05), 'chassis', ('+x', '-x', '-z'))
    # gooseneck: side gussets where the diagonal beams leave the rails, and a tunnel plate over the kingpin
    for sy in (-1, 1):
        yc = sy * 0.55
        for dx in (0.0, 0.35):
            p.slant([(4.2 + dx, yc + sy * 0.09, 1.03), (4.5 + dx, yc + sy * 0.09, 1.03), (4.5 + dx, yc + sy * 0.09, 1.22), (4.2 + dx, yc + sy * 0.09, 1.22)], 'chassis', (0, sy, 0))
    p.box((4.0, -0.5, 1.27), (4.2, 0.5, 1.29), 'steel', ('+z', '-x'))
    # landing legs: sand-shoe pads, outer leg bands, crank handle grip and stowage clip, the second (high-speed) crank
    for sy in (-1, 1):
        yl = sy * 0.95
        p.box((3.3 - 0.16, yl - 0.13, 0.17), (3.3 + 0.16, yl + 0.13, 0.2), 'black', ('+z', '+x', '-x', '+y', '-y'))
        for z in (0.45, 0.75):
            p.box((3.3 - 0.075, yl - 0.075, z), (3.3 + 0.075, yl + 0.075, z + 0.04), 'yellow', ('+x', '-x', '+y', '-y'))
    p.beam((3.3 - 0.06, -1.45, 0.62), (3.3 + 0.12, -1.45, 0.62), 0.04, 0.04, 'black')
    p.box((3.3 - 0.05, -1.42, 0.7), (3.3 + 0.05, -1.4, 0.76), 'zinc')
    p.beam((3.3, -0.95, 1.05), (3.3, 0.95, 1.05), 0.03, 0.03, 'zinc')   # cross shaft between the legs
    # mudguard stays from the rails to the wing guards and the rear mud-flap hangers
    gx0, gx1 = T.TRAILER_X[2] - 0.62, T.TRAILER_X[0] + 0.62
    for sy in (-1, 1):
        for x in (gx0 + 0.15, (gx0 + gx1) / 2, gx1 - 0.15):
            p.beam((x, sy * 0.64, 1.05), (x, sy * 1.2, 1.05), 0.04, 0.03, 'dark')
        p.box((gx0 + 0.02, sy * 0.85, 0.65), (gx0 + 0.06, sy * 1.2, 0.7), 'dark')
        p.box((gx0 + 0.03, min(sy * 0.86, sy * 1.19), 0.2), (gx0 + 0.05, max(sy * 0.86, sy * 1.19), 0.65), 'black', ('+x', '-x'))
    # lamps: rear cluster bezels, reversing and fog lamps, front outline markers, number-plate lamp
    for sy in (-1, 1):
        p.box((T.REAR_X - 0.04, sy * 1.12 - 0.15, 0.86), (T.REAR_X - 0.035, sy * 1.12 + 0.15, 1.04), 'dark', ('-x',))
        p.lens((T.REAR_X - 0.045, sy * 0.78, 0.95), (0.03, 0.1, 0.1), 'white' if sy > 0 else 'lens_red', 'x', -1)
        p.lens((T.PIN_X_END + 0.1, sy * 1.25, 1.22), (0.02, 0.08, 0.05), 'white', 'x', 1)
    p.lens((T.REAR_X - 0.065, 0.0, 0.76), (0.02, 0.12, 0.04), 'white', 'x', -1)
    # ABS and air lines along the inner rail webs to each axle's brake chambers, and the ABS modulator
    for sy in (-1, 1):
        y = sy * 0.52
        p.beam((T.PIN_X_END - 0.3, y, 1.1), (T.TRAILER_X[2] + 0.3, y, 1.1), 0.018, 0.018, 'black')
        p.beam((T.PIN_X_END - 0.3, y - sy * 0.03, 1.07), (T.TRAILER_X[2] + 0.3, y - sy * 0.03, 1.07), 0.018, 0.018, 'yellow')
        for ax in T.TRAILER_X:
            p.beam((ax + 0.3, y, 1.07), (ax + 0.3, sy * 0.7, 0.75), 0.018, 0.018, 'black')
    p.box((T.TRAILER_X[0] + 0.6, -0.25, 0.92), (T.TRAILER_X[0] + 0.9, 0.25, 1.05), 'dark')
    return p


# ---- tractor -----------------------------------------------------------------
def tractor_mesh(cab):
    c = T.CABS[cab]
    H, x0, x1 = c['height'], c['x0'], T.CAB_X1
    p = T.tractor_mesh(cab, 0)
    lower_top = 2.05
    top = H - (0.32 if c['sleeper'] else 0.2)
    win_top = top - 0.12
    # glazing: windscreen seals along the pillars and the bottom edge, side-window frames
    for sy in (-1, 1):
        p.beam((x1 + 0.01, sy * 1.15, lower_top - 0.05), (x1 - 0.19, sy * 1.15, top), 0.06, 0.04, 'black')
        p.box((x1 - 1.62, sy * 1.25, win_top), (x1 - 0.23, sy * 1.25 + sy * 0.02, win_top + 0.04), 'black', ('+y' if sy > 0 else '-y', '+z', '-z'))
        p.box((x1 - 1.62, sy * 1.25, 1.68), (x1 - 0.23, sy * 1.25 + sy * 0.02, 1.72), 'black', ('+y' if sy > 0 else '-y', '+z', '-z'))
        p.box((x1 - 0.66, sy * 1.25, 1.72), (x1 - 0.63, sy * 1.25 + sy * 0.02, win_top), 'black', ('+y' if sy > 0 else '-y', '+x', '-x'))  # quarter-light bar
    p.box((x1 - 0.005, -1.15, lower_top - 0.08), (x1 + 0.02, 1.15, lower_top - 0.04), 'black', ('+x', '+z'))
    # wipers: pivots and blades along the bottom of the screen
    for sy in (-0.55, 0.45):
        p.revolve((x1 + 0.02, sy, lower_top - 0.02), 'x', [(0.03, 0.0, 'r', 'dark'), (0.03, 0.03, 'a+', 'dark'), (0.0, 0.03, 'a+', 'dark')], 6, lambda k, e: 'dark')
        p.beam((x1 + 0.025, sy - 0.05, lower_top + 0.02), (x1 - 0.02, sy + 0.55, lower_top + 0.3), 0.02, 0.025, 'black')
    # mirrors: housings with glass faces, lower arm, kerb mirror over the right (passenger) door
    for sy in (-1, 1):
        p.lens((x1 - 0.51, sy * 1.52, 2.3), (0.004, 0.05, 0.62), 'glass', 'x', -1)
        p.lens((x1 - 0.46, sy * 1.35, 1.675), (0.004, 0.05, 0.22), 'glass', 'x', -1)
        p.beam((x1 - 0.4, sy * 1.26, 1.9), (x1 - 0.4, sy * 1.5, 2.0), 0.035, 0.035, 'zinc')
        p.box((x1 - 0.52, sy * 1.52 - 0.035, 2.63), (x1 - 0.28, sy * 1.52 + 0.035, 2.67), 'cab_dark')
    p.beam((x1 - 0.2, -1.1, H - 0.05), (x1 - 0.05, -1.3, H - 0.25), 0.035, 0.035, 'zinc')
    p.box((x1 - 0.12, -1.4, H - 0.5), (x1 - 0.02, -1.22, H - 0.25), 'dark')
    # grille: surround, vertical bars between the slats, badge bar under the wordmark
    for y0, y1, z0, z1 in ((-0.65, 0.65, 1.75, 1.79), (-0.65, 0.65, 1.04, 1.08), (-0.66, -0.62, 1.04, 1.79), (0.62, 0.66, 1.04, 1.79)):
        p.box((x1 - 0.01, y0, z0), (x1 + 0.05, y1, z1), 'cab_dark', ('+x', '+y', '-y', '+z', '-z'))
    for i in range(9):
        y = -0.52 + i * 0.13
        p.box((x1 + 0.03, y - 0.008, 1.1), (x1 + 0.04, y + 0.008, 1.27), 'dark', ('+x', '+y', '-y'))
        p.box((x1 + 0.03, y - 0.008, 1.55), (x1 + 0.04, y + 0.008, 1.73), 'dark', ('+x', '+y', '-y'))
    p.box((x1 + 0.03, -0.45, 1.29), (x1 + 0.045, 0.45, 1.31), 'zinc', ('+x', '+z', '-z'))
    # steps and handles: tread strips on both steps, grab handles on the A-pillars and the rear cab corners
    for sy in (-1, 1):
        for z in (0.56, 0.86):
            for k in range(4):
                xs = x1 - 0.9 + k * 0.17
                p.box((xs, sy * 1.16, z), (xs + 0.06, sy * 1.44, z + 0.008), 'black', ('+z', '+x', '-x'))
        p.beam((x1 - 0.17, sy * 1.28, 1.1), (x1 - 0.17, sy * 1.28, 1.95), 0.03, 0.03, 'zinc')
        for z in (1.1, 1.95):
            p.beam((x1 - 0.17, sy * 1.25, z), (x1 - 0.17, sy * 1.28, z), 0.025, 0.025, 'zinc')
        p.beam((x0 + 0.08, sy * 1.27, 1.2), (x0 + 0.08, sy * 1.27, 1.9), 0.03, 0.03, 'zinc')
    # exhaust: perforated heat shield, clamps, tail pipe and rain cap (below the stack top)
    ex, ey, ez = x0 - 0.25, -1.0, 1.0
    p.revolve((ex, ey, ez), 'z', [(0.085, 0.6, 'r', 'steel'), (0.085, 1.5, 'a+', 'steel'), (0.065, 1.5, 'a+', 'steel')], 10, lambda k, e: 'steel' if k % 2 else 'zinc', phase=-math.pi / 2)
    for h in (0.55, 1.55, H - 1.6):
        p.revolve((ex, ey, ez + h), 'z', [(0.07, 0.0, 'r', 'dark'), (0.07, 0.04, 'a+', 'dark'), (0.06, 0.04, 'a+', 'dark')], 8, lambda k, e: 'dark')
    p.box((ex - 0.06, ey - 0.03, ez + 0.3), (ex + 0.06, ey + 0.03, ez + 0.36), 'dark')
    p.beam((ex, ey + 0.06, ez + 0.33), (x0 - 0.01, ey + 0.06, ez + 0.33), 0.03, 0.03, 'dark')   # bracket to the cab
    p.slant([(ex - 0.06, ey - 0.06, H - 0.1), (ex + 0.06, ey - 0.06, H - 0.1), (ex + 0.06, ey + 0.06, H - 0.08), (ex - 0.06, ey + 0.06, H - 0.08)], 'black', (0, 0.2, 1))
    # fifth wheel: lead-in ramps at the rear, lock handle on the left, mounting brackets, grease grooves on the plate
    kx = T.KING_X
    for sy in (-1, 1):
        p.slant([(kx - 0.55, sy * 0.15, 1.25), (kx - 0.55, sy * 0.5, 1.25), (kx - 0.85, sy * 0.5, 1.12), (kx - 0.85, sy * 0.15, 1.12)], 'steel', (-0.4, 0, 1))
        p.box((kx - 0.3, sy * 0.42 - 0.03, 0.95), (kx + 0.3, sy * 0.42 + 0.03, 1.12), 'dark')
    p.beam((kx - 0.1, 0.42, 1.15), (kx - 0.1, 0.72, 1.15), 0.03, 0.03, 'zinc')
    p.box((kx - 0.14, 0.72, 1.12), (kx - 0.06, 0.78, 1.18), 'lens_red')
    for dx in (-0.25, 0.0, 0.25):
        p.box((kx + dx - 0.01, -0.45, 1.25), (kx + dx + 0.01, 0.45, 1.252), 'black', ('+z',))
    return p


# ---- the assets ----------------------------------------------------------------
CHASSIS = 'hero-truck-chassis'
CAB_NAMES = {cab: f'hero-truck-cab-{cab}' for cab in T.CABS}
TRAILER_RIG = [(f'wheel_t{i + 1}', (ax, 0, T.R)) for i, ax in enumerate(T.TRAILER_X)]
STEER_RIG = [(f'steer_{n}', f'wheel_{n}', sy, (T.FRONT_X, sy * T.FRONT_STEER_Y, T.R)) for n, sy in T.CORNERS]
DRIVE_PIVOT = (T.DRIVE_X, 0, T.R)
KING = (T.KING_X, 0, 0)


class _Builder:
    def __init__(self, name, material):
        self.material = material
        self.root = empty(name)
        self.lod = empty('LOD0', self.root)
        self.tris = 0
        self.meshes = 0
        self.lo, self.hi = [1e9] * 3, [-1e9] * 3

    def obj(self, part, name, parent, loc, origin):
        """Mesh object `name` at `loc` under `parent`; `origin` = the world position of its local origin (bounds)."""
        for v in part.m.verts:
            for i in range(3):
                self.lo[i], self.hi[i] = min(self.lo[i], v[i] + origin[i]), max(self.hi[i], v[i] + origin[i])
        self.tris += part.triangles
        self.meshes += 1
        o = part.m.to_object(name, self.material, parent)
        o.location = loc
        return o

    def rig(self, part, name, parent, loc, origin):
        node = empty(name, parent, loc)
        self.obj(part, name + '_geo', node, (0, 0, 0), origin)
        return node

    def info(self, name, cab):
        lo, hi = self.lo, self.hi
        bounds = {'min': [round(lo[0], 4), round(lo[2], 4), round(-hi[1], 4)], 'max': [round(hi[0], 4), round(hi[2], 4), round(-lo[1], 4)]}
        return {'name': name, 'cab': cab, 'triangles': self.tris, 'meshes': self.meshes, 'bounds': bounds}


def build_chassis(atlas_image):
    """The hero chassis; returns (root, info)."""
    b = _Builder(CHASSIS, textured_material(MATERIAL, atlas_image, roughness=0.6, metallic=0.1))
    b.obj(chassis_mesh(), 'chassis', b.lod, (0, 0, 0), (0, 0, 0))
    for name, pivot in TRAILER_RIG:
        b.rig(trailer_wheel_mesh(), name, b.lod, pivot, pivot)
    return b.root, b.info(CHASSIS, None)


def build_cab(atlas_image, cab):
    """The hero tractor of one cab shape (the `fifth_wheel` subtree of truck-cab-<cab>.glb LOD0); returns (root, info)."""
    name = CAB_NAMES[cab]
    b = _Builder(name, textured_material(MATERIAL, atlas_image, roughness=0.6, metallic=0.1))
    fw = empty('fifth_wheel', b.lod, KING)
    b.obj(tractor_mesh(cab), 'tractor', fw, (-T.KING_X, 0, 0), (0, 0, 0))
    for steer_name, wheel_name, sy, pivot in STEER_RIG:
        steer = empty(steer_name, fw, (pivot[0] - T.KING_X, pivot[1], pivot[2]))
        b.rig(front_wheel_mesh(sy), wheel_name, steer, (0, 0, 0), pivot)
    b.rig(drive_wheel_mesh(), 'wheel_r', fw, (DRIVE_PIVOT[0] - T.KING_X, 0, T.R), DRIVE_PIVOT)
    return b.root, b.info(name, cab)


def _gl(p):
    return [round(p[0], 4), round(p[2], 4), round(-p[1] + 0.0, 4)]


# The source sidecar fields a hero sidecar copies; for a cab also SOURCE_CAB_FIELDS.
SOURCE_FIELDS = ('axes', 'travelLimits', 'attachPoints', 'loadConfigurations', 'wheel')
SOURCE_CAB_FIELDS = ('cab', 'liveries', 'atlas', 'fifthWheel')


def source_facts(cab):
    """The rig facts of the source GLB a hero file replaces (truck-chassis.glb for cab None, else truck-cab-<cab>.glb):
    the truck_meta.sidecar() fields in SOURCE_FIELDS, plus SOURCE_CAB_FIELDS for a cab. None of them depends on the
    source's triangle counts, name or overall height, which the hero build does not have, so those inputs are left out
    of truck_meta.sidecar() by passing neutral values and the fields that use them are dropped."""
    full = TM.sidecar({'name': None, 'cab': cab, 'triangles': {f'LOD{i}': 0 for i in range(3)}, 'height': None})
    return {k: full[k] for k in SOURCE_FIELDS + (SOURCE_CAB_FIELDS if cab is not None else ())}


def sidecar(info, source):
    """`source` = source_facts(info['cab']): the source GLB's axes, limits, attach points, loads, wheel (and cab facts)."""
    name, cab = info['name'], info['cab']
    b = info['bounds']
    size = [round(b['max'][i] - b['min'][i], 3) for i in range(3)]
    nodes = [{'name': 'LOD0', 'parent': name, 'role': 'lod', 'description': 'the only level; same frame as the truck GLBs LOD0'}]
    if cab is None:
        nodes.append({'name': 'chassis', 'parent': 'LOD0', 'role': 'mesh', 'livery': True,
                      'description': 'truck.py chassis plus twist-lock castings, cross tubes, gooseneck gussets, landing-leg pads and cranks, mudguard stays, lamps, ABS and air lines'})
        for n, pivot in TRAILER_RIG:
            nodes.append({'name': n, 'parent': 'LOD0', 'role': 'rig', 'pivot': _gl(pivot), 'axis': '+Z', 'description': 'trailer axle: tyres with tread lugs on rims with nuts'})
        rig_names = [n for n, _ in TRAILER_RIG]
        livery_mesh = 'chassis'
    else:
        nodes.append({'name': 'fifth_wheel', 'parent': 'LOD0', 'role': 'rig', 'pivot': _gl(KING), 'axis': '+Y', 'description': 'articulation pivot through the kingpin'})
        nodes.append({'name': 'tractor', 'parent': 'fifth_wheel', 'role': 'mesh', 'livery': True,
                      'description': 'truck.py tractor plus glazing seals, wipers, mirror glass and kerb mirror, grille bars, step treads and grab handles, exhaust heat shield, fifth-wheel ramps and lock'})
        for steer_name, wheel_name, _, pivot in STEER_RIG:
            nodes.append({'name': steer_name, 'parent': 'fifth_wheel', 'role': 'rig', 'pivot': _gl(pivot), 'axis': '+Y', 'description': 'steering knuckle'})
            nodes.append({'name': wheel_name, 'parent': steer_name, 'role': 'rig', 'pivot': _gl(pivot), 'axis': '+Z', 'description': 'front tyre with tread lugs, rim nuts'})
        nodes.append({'name': 'wheel_r', 'parent': 'fifth_wheel', 'role': 'rig', 'pivot': _gl(DRIVE_PIVOT), 'axis': '+Z', 'description': 'drive axle, dual tyres with tread lugs'})
        rig_names = ['fifth_wheel'] + [s for s, _, _, _ in STEER_RIG] + [w for _, w, _, _ in STEER_RIG] + ['wheel_r']
        livery_mesh = 'tractor'
    for rig in [n for n in nodes if n['role'] == 'rig' and n['name'] != 'fifth_wheel' and not n['name'].startswith('steer_')]:
        nodes.append({'name': rig['name'] + '_geo', 'parent': rig['name'], 'role': 'mesh', 'description': 'mesh of ' + rig['name']})
    replaces = 'LOD0 > chassis, wheel_t1, wheel_t2, wheel_t3' if cab is None else 'LOD0 > fifth_wheel (tractor, steer_fl|fr, wheel_fl|fr, wheel_r)'
    meta = {
        'asset': name,
        'kind': 'hero-truck-chassis' if cab is None else 'hero-truck-cab',
        'version': 1,
        'generator': 'src/sims/terminal-twin/assets/generators/build.py --only hero-equipment',
        'units': 'm',
        'dimensions': {'lengthM': size[0], 'widthM': size[2], 'heightM': size[1], 'boundsMin': b['min'], 'boundsMax': b['max'], 'tag': 'A',
                       'source': ('truck-chassis.glb LOD0' if cab is None else f'the fifth_wheel subtree of truck-cab-{cab}.glb LOD0') +
                       ' (same origin, axes and extents; tests/hero-truck-asset.test.ts compares them)'},
        'axes': source['axes'],
        'heroEquipment': {
            'kind': 'truck-chassis' if cab is None else 'truck-cab', 'sourceAsset': 'truck-chassis' if cab is None else f'truck-cab-{cab}', 'replaces': replaces,
            'attach': "add LOD0's children under the truck root beside its own LOD0 (identity transform) and drive the rig nodes with the same values as LOD0's nodes of the same name; the `_geo` children are meshes, not rig nodes",
            'materials': {MATERIAL: 'the truck livery atlas, TEXCOORD_0 on tile 0 as in the truck GLBs; the runtime replaces it with the rig material for the truck shape and livery'},
        },
        'livery': {'material': MATERIAL, 'mesh': livery_mesh, 'tile': 0, 'tileCols': T.TILE_COLS, 'tileRows': T.TILE_ROWS,
                   'note': ('chassis colour swatch' if cab is None else 'cab colour, cab_dark and maker wordmark') +
                   ' on this mesh; every mesh of the file uses the same material, so the rig material for the shape and livery goes on all of them'},
        'nodes': nodes,
        'travelLimits': {k: v for k, v in source['travelLimits'].items() if k in rig_names},
        'attachPoints': source['attachPoints'],
        'loadConfigurations': source['loadConfigurations'],
        'groundContact': {'y': 0, 'points': sorted(n for n in rig_names if n.startswith('wheel_')), 'tag': 'V'},
        'wheel': source['wheel'],
        'lods': {'LOD0': {'triangles': info['triangles'], 'meshes': info['meshes'], 'material': MATERIAL}},
        'provenance': [
            {'fact': 'pivots, tyre radius, attach points, load configurations and overall extents from truck.py / truck_meta.py LOD0', 'tag': 'A', 'source': 'tt_assets/truck.py'},
            {'fact': 'tread lugs, rim nuts, twist-lock castings, cross tubes, gussets, landing-leg pads and cranks, lamps, ABS lines, glazing seals, wipers, mirrors, grille bars, step treads, grab handles, exhaust shield, fifth-wheel ramps and lock',
             'tag': 'A', 'source': 'generic European tractor and skeletal chassis detail; no manufacturer drawing'},
        ],
    }
    if cab is not None:
        meta['cab'] = source['cab']
        meta['liveries'] = source['liveries']
        meta['atlas'] = source['atlas']
        meta['fifthWheel'] = source['fifthWheel']
    return meta
