"""Haulier truck assets (TT-26): European cab-over tractors with a skeletal container chassis.

Three cab shapes (`truck-cab-high`, `truck-cab-mid`, `truck-cab-day`), each GLB holding the tractor AND the
chassis, plus `truck-chassis` (the chassis alone). Hierarchy (glTF names; every LOD repeats the rig names, the
build step strips the `@LODn` suffix that keeps Blender's object names unique):

  <asset>                      root, origin = ground contact below the centre of a 40 ft box on the chassis
    LOD0 / LOD1 / LOD2
      chassis                  static: rails, cross members, gooseneck, landing legs, twist-lock housings, lights
      wheel_t1|t2|t3           trailer axles (one node each, single wide tyres both sides; pivot on the axle)
      fifth_wheel              articulation pivot (vertical axis through the kingpin); everything of the tractor hangs here
        tractor                static: frame, fifth wheel, tanks, cab, mirrors, lights, bumper
        steer_fl|fr            steering knuckles (vertical axis), pivot at the wheel centre
          wheel_fl|fr          front tyres
        wheel_r                drive axle, dual tyres both sides

Blender axes: X = length (cab end +X), Y = width (left +Y), Z = up. glTF: X forward, Y up, Z = -Blender Y.
One material and one atlas: 8 livery tiles (cab colour + maker wordmark); the renderer selects a tile by UV offset.
Every dimension is [A] (generic European tractor, typical 3-axle 40 ft skeletal) unless the sidecar tags it otherwise.
"""
import math

from .blender import empty, textured_material
from .parts import Atlas, Part as _Part

# ---- dimensions (m) --------------------------------------------------------
DECK = 1.3                       # box bottom = top of the twist-lock housings (engine TRUCK_DECK_M)
R = 0.5                          # all tyres: outer radius (445/385/315 mm sections on 22.5 in rims)
PIN_X_END = 5.9925               # ISO 1161: casting centres of a 40 ft box (11.985 m apart)
PIN_X_MID = 0.1405               # inner castings of two 20 ft boxes standing end to end (76 mm gap)
PIN_Y = 1.1295                   # casting centres 2.259 m apart
BOX20_X = 3.0675                 # centre of a 20 ft box on the front / rear pins
KING_X = 4.9                     # kingpin / fifth wheel centre
DRIVE_X = 4.7                    # tractor drive axle
FRONT_X = 8.4                    # tractor steer axle
TRAILER_X = (-3.4, -4.7, -6.0)   # tri-axle group
REAR_X = -6.55                   # rear of the chassis (under-run bar, lamps)
FRONT_STEER_Y = 1.0
TRACK_TRAILER_Y = 1.0
DRIVE_Y = (0.80, 1.10)           # inner / outer dual tyre centres
TYRE_W = {'front': 0.315, 'drive': 0.295, 'trailer': 0.385}
MAX_STEER_DEG = 35
MAX_ARTIC_DEG = 40
CORNERS = (('fl', 1), ('fr', -1))  # steered front corners: name, Blender Y sign

CAB_X1 = 9.35                    # cab front face (bumper at +0.12)

# ---- atlas -----------------------------------------------------------------
ATLAS_W, ATLAS_H = 2048, 1024
TILE = 512
CELL = 64
TILE_COLS, TILE_ROWS = 4, 2
SWATCH_NAMES = ['cab', 'cab_dark', 'chassis', 'steel', 'dark', 'rubber', 'black', 'glass', 'white', 'yellow', 'orange', 'amber',
                'lens_red', 'zinc', 'grey', 'seat']
REGIONS = {                      # pixel rects inside a tile (x0, y0, x1, y1), origin top-left
    'wordmark': (0, 256, 512, 384),
    'plate': (0, 384, 256, 448),
}

# Base swatch colours that do not depend on the livery (the livery overrides `cab`, `cab_dark`, `chassis`).
BASE_SWATCHES = {
    'steel': '#8b9198', 'dark': '#2b2e33', 'rubber': '#18181a', 'black': '#0d0d0e', 'glass': '#6f97ad', 'white': '#f1f1ef',
    'yellow': '#f2b705', 'orange': '#e8641b', 'amber': '#ffb43a', 'lens_red': '#d11818', 'zinc': '#a8adb3', 'grey': '#b9bdc2',
    'seat': '#3a3d44',
}

# Order = the livery index the renderer picks. maker = the wordmark on the cab; no logo artwork, no haulier branding.
LIVERIES = [
    {'maker': 'Volvo', 'cab': '#1f4e9c', 'chassis': '#2b2e33', 'font': 'Montserrat-SemiBold.ttf', 'spacing': 1.35, 'text': '#f1f1ef'},
    {'maker': 'Scania', 'cab': '#b3122b', 'chassis': '#3a3f45', 'font': 'Archivo-ExtraBold.ttf', 'spacing': 1.1, 'text': '#f1f1ef'},
    {'maker': 'DAF', 'cab': '#f1f1ef', 'chassis': '#5a6169', 'font': 'Archivo-ExtraBold.ttf', 'spacing': 1.0, 'text': '#1b3a82'},
    {'maker': 'MAN', 'cab': '#2c3f4e', 'chassis': '#2b2e33', 'font': 'Montserrat-ExtraBold.ttf', 'spacing': 1.1, 'text': '#f1f1ef'},
    {'maker': 'Mercedes-Benz', 'cab': '#b7bcc2', 'chassis': '#2b2e33', 'font': 'Montserrat-SemiBold.ttf', 'spacing': 1.15, 'text': '#1d1d1b'},
    {'maker': 'Volvo', 'cab': '#e9eaec', 'chassis': '#1f4e9c', 'font': 'Montserrat-SemiBold.ttf', 'spacing': 1.35, 'text': '#1d1d1b'},
    {'maker': 'Scania', 'cab': '#16294d', 'chassis': '#16294d', 'font': 'Archivo-ExtraBold.ttf', 'spacing': 1.1, 'text': '#f1f1ef'},
    {'maker': 'DAF', 'cab': '#d65a1a', 'chassis': '#3a3f45', 'font': 'Archivo-ExtraBold.ttf', 'spacing': 1.0, 'text': '#ffffff'},
]


def shade(hex_colour, factor):
    h = hex_colour.lstrip('#')
    return '#' + ''.join(f'{min(255, round(int(h[i:i + 2], 16) * factor)):02x}' for i in (0, 2, 4))


def tile_swatches(index):
    out = dict(BASE_SWATCHES)
    liv = LIVERIES[index]
    out['cab'] = liv['cab']
    out['cab_dark'] = shade(liv['cab'], 0.72)
    out['chassis'] = liv['chassis']
    return out


class TruckAtlas(Atlas):
    """Tile 0 of a 4 x 2 tile atlas; the renderer shifts UVs to other tiles."""

    def __init__(self):
        super().__init__(ATLAS_W, CELL, {n: None for n in SWATCH_NAMES}, REGIONS)

    def swatch_uv(self, name):
        i = self.order.index(name)
        cx, cy = (i % 8) * CELL + CELL / 2, (i // 8) * CELL + CELL / 2
        return (cx / ATLAS_W, 1 - cy / ATLAS_H)

    def region_uv(self, name):
        x0, y0, x1, y1 = self.regions[name]
        return (x0 / ATLAS_W, 1 - y1 / ATLAS_H, x1 / ATLAS_W, 1 - y0 / ATLAS_H)


ATLAS_SPEC = TruckAtlas()


class Part(_Part):
    def __init__(self):
        super().__init__(ATLAS_SPEC)

    def slant(self, pts, swatch, outward):
        """One quad through four explicit points."""
        self.m.quad(pts, [ATLAS_SPEC.swatch_uv(swatch)] * 4, outward=outward)


# ---- wheels ----------------------------------------------------------------
def tyre(p, y, width, detail):
    """One tyre centred at (0, y, 0), axle along Y (rolls about Blender Y)."""
    w = width / 2
    if detail == 0:
        segs = 24
        # profile points; the edge that leaves each point takes its kind and swatch
        prof = [(0.0, -0.8 * w, 'a-', 'zinc'), (0.3, -0.8 * w, 'a-', 'steel'), (0.36, -w, 'a-', 'rubber'), (R - 0.07, -w, 'r', 'rubber'),
                (R, -0.75 * w, 'r', 'rubber'), (R, 0.75 * w, 'r', 'black'), (R - 0.07, w, 'a+', 'rubber'), (0.36, w, 'a+', 'steel'),
                (0.3, 0.8 * w, 'a+', 'zinc'), (0.0, 0.8 * w, 'a+', 'zinc')]

        def sw(k, e):
            return 'rubber' if (e == 4 and k % 2 == 0) else prof[e][3]
    else:
        segs = 10
        prof = [(0.3, -w, 'a-', 'steel'), (R - 0.05, -w, 'r', 'rubber'), (R, 0.0, 'r', 'black'), (R - 0.05, w, 'a+', 'rubber'), (0.3, w, 'a+', 'steel')]
        sw = None
    shifted = [(r, h + y, kind, s) for r, h, kind, s in prof]
    p.revolve((0, 0, 0), 'y', shifted, segs, sw if sw else (lambda k, e: shifted[e][3]))


def front_wheel_mesh(sy, detail):
    p = Part()
    tyre(p, 0.0, TYRE_W['front'], detail)
    if detail == 0:
        p.cbox((0, sy * (TYRE_W['front'] / 2 + 0.04), 0), (0.1, 0.08, 0.1), 'zinc', ('+y', '-y'))
    return p


def drive_wheel_mesh(detail):
    p = Part()
    for sy in (-1, 1):
        for y in DRIVE_Y:
            tyre(p, sy * y, TYRE_W['drive'], detail)
    if detail == 0:
        p.beam((0, -0.7, 0), (0, 0.7, 0), 0.14, 0.14, 'dark')
    return p


def trailer_wheel_mesh(detail):
    p = Part()
    for sy in (-1, 1):
        tyre(p, sy * TRACK_TRAILER_Y, TYRE_W['trailer'], detail)
    if detail == 0:
        p.beam((0, -0.8, 0), (0, 0.8, 0), 0.13, 0.13, 'dark')
    return p


# ---- chassis ----------------------------------------------------------------
PIN_XS = (PIN_X_END, PIN_X_MID, -PIN_X_MID, -PIN_X_END)


def chassis_mesh(detail, with_wheels=False):
    """Skeletal gooseneck chassis in truck coordinates (no wheels unless `with_wheels`, LOD2)."""
    p = Part()
    x0, x1 = REAR_X + 0.15, 4.5
    for sy in (-1, 1):
        yc = sy * 0.55
        if detail == 2:
            p.box((x0, yc - 0.09, 0.98), (x1, yc + 0.09, 1.27), 'chassis')
            continue
        p.box((x0, yc - 0.09, 1.22), (x1, yc + 0.09, 1.27), 'chassis')   # top flange
        p.box((x0, yc - 0.09, 0.98), (x1, yc + 0.09, 1.03), 'chassis')   # bottom flange
        p.box((x0, yc - 0.015, 1.03), (x1, yc + 0.015, 1.22), 'chassis', ('+y', '-y', '+x', '-x'))  # web
        # gooseneck: diagonal beams from the rail ends to the front cross member
        p.beam((x1, yc, 1.2), (PIN_X_END - 0.1, sy * (PIN_Y - 0.05), 1.2), 0.18, 0.16, 'chassis')
    # kingpin plate
    p.box((4.2, -0.62, 1.22), (5.55, 0.62, 1.30), 'steel' if detail < 2 else 'dark')
    if detail == 2:
        p.box((PIN_X_END - 0.12, -1.25, 1.15), (PIN_X_END + 0.12, 1.25, 1.3), 'chassis')
        p.box((-PIN_X_END - 0.12, -1.25, 1.15), (-PIN_X_END + 0.12, 1.25, 1.3), 'chassis')
        p.box((-0.3, -1.2, 1.15), (0.3, 1.2, 1.3), 'chassis')
        p.box((REAR_X, -1.12, 0.45), (REAR_X + 0.1, 1.12, 0.6), 'dark', ('+x', '-x', '+z'))
        if with_wheels:
            for ax in TRAILER_X:
                p.box((ax - R * 0.8, -1.2, 0.05), (ax + R * 0.8, 1.2, 2 * R - 0.05), 'rubber', ('+x', '-x', '+y', '-y', '+z'))
        return p
    # cross members and the 8 twist-lock housings (outriggers carry the castings)
    xs = [PIN_X_END, PIN_X_MID, -PIN_X_MID, -PIN_X_END] + ([x for x in (4.3, 2.8, 1.5, -1.3, -2.2, -3.0, -4.2, -5.0, -5.6) if detail == 0] or [2.8, -2.2, -4.2])
    pin_set = set(PIN_XS)
    for x in xs:
        is_pin = x in pin_set
        half = PIN_Y + 0.12 if is_pin else 0.62
        p.box((x - 0.07, -half, 1.12), (x + 0.07, half, 1.2), 'chassis')
        if is_pin:
            for sy in (-1, 1):
                p.box((x - 0.11, sy * PIN_Y - 0.11, 1.12), (x + 0.11, sy * PIN_Y + 0.11, DECK), 'dark')   # housing
                if detail == 0:
                    p.revolve((x, sy * PIN_Y, DECK), 'z', [(0.03, 0.0, 'r', 'zinc'), (0.03, 0.05, 'a+', 'zinc'), (0.0, 0.05, 'a+', 'zinc')], 6, lambda k, e: 'zinc')
    # front cross member between the gooseneck beams
    p.box((PIN_X_END - 0.12, -1.2, 1.15), (PIN_X_END + 0.12, 1.2, 1.28), 'chassis', ('+x', '-x', '+z', '-z', '+y', '-y'))
    # landing legs (stowed) and bracing
    for sy in (-1, 1):
        yl = sy * 0.95
        p.box((3.3 - 0.07, yl - 0.07, 0.3), (3.3 + 0.07, yl + 0.07, 1.0), 'steel')
        p.box((3.3 - 0.12, yl - 0.12, 0.2), (3.3 + 0.12, yl + 0.12, 0.3), 'dark')
        if detail == 0:
            p.box((3.3 - 0.09, yl - 0.09, 0.9), (3.3 + 0.09, yl + 0.09, 1.2), 'chassis')
    p.box((3.3 - 0.04, -0.95, 0.6), (3.3 + 0.04, 0.95, 0.68), 'zinc')
    # rear under-run bar, lamps, plate, mud flaps
    p.box((REAR_X - 0.04, -1.12, 0.45), (REAR_X + 0.06, 1.12, 0.6), 'dark')
    for sy in (-1, 1):
        p.box((REAR_X, sy * 1.0 - 0.04, 0.6), (REAR_X + 0.06, sy * 1.0 + 0.04, 1.12), 'dark')
        p.lens((REAR_X - 0.045, sy * 1.12, 0.95), (0.03, 0.25, 0.12), 'lens_red', 'x', -1)
        p.lens((REAR_X - 0.045, sy * 0.95, 0.95), (0.03, 0.12, 0.12), 'amber', 'x', -1)
    if detail == 0:
        p.plate((REAR_X - 0.06, 0.26, 0.64), (0, -1, 0), (0, 0, 1), 0.52, 0.11, 'plate', normal=(-1, 0, 0))
        for ax in TRAILER_X:
            for sy in (-1, 1):
                p.box((ax - R - 0.05, sy * 0.72 - 0.1, 0.62), (ax + R + 0.05, sy * 0.72 + 0.1, 1.0), 'dark')  # air springs / hangers
        p.revolve((-1.6, -0.62, 0.85), 'x', [(0.17, -0.6, 'r', 'zinc'), (0.17, 0.6, 'a+', 'zinc'), (0.0, 0.6, 'a+', 'zinc')], 10, lambda k, e: 'zinc')  # air tank
        p.box((0.5, 0.55, 0.78), (1.4, 0.88, 1.0), 'dark')                                                                                       # tool / battery box
        # brake chambers, mud flaps and ABS valves at every axle
        for ax in TRAILER_X:
            for sy in (-1, 1):
                p.revolve((ax + 0.3, sy * 0.78, 0.7), 'y', [(0.11, -0.1, 'r', 'dark'), (0.11, 0.1, 'a+', 'dark'), (0.0, 0.1, 'a+', 'dark')], 10, lambda k, e: 'dark')
            p.box((ax + 0.55, -1.15, 0.2), (ax + 0.59, -0.85, 0.65), 'black')
            p.box((ax + 0.55, 0.85, 0.2), (ax + 0.59, 1.15, 0.65), 'black')
        # side marker lights and reflectors along the rails
        for sy in (-1, 1):
            for x in (-5.4, -3.6, -1.0, 1.6, 3.6):
                p.lens((x, sy * 0.642, 1.12), (0.12, 0.03, 0.05), 'amber', 'y', sy)
    else:
        for ax in TRAILER_X:
            p.box((ax - 0.2, -0.72, 0.62), (ax + 0.2, 0.72, 1.0), 'dark')
    if with_wheels:
        for ax in TRAILER_X:
            p.box((ax - R * 0.8, -1.2, 0.05), (ax + R * 0.8, 1.2, 2 * R - 0.05), 'rubber')
    return p


# ---- tractor ----------------------------------------------------------------
CABS = {
    # name: roof height, cab rear face x, sleeper (extra raised roof), extenders, roof spoiler
    'high': {'height': 3.95, 'x0': 6.95, 'sleeper': True, 'extenders': True, 'spoiler': True},
    'mid': {'height': 3.55, 'x0': 6.95, 'sleeper': True, 'extenders': False, 'spoiler': True},
    'day': {'height': 3.15, 'x0': 7.45, 'sleeper': False, 'extenders': False, 'spoiler': False},
}


def tractor_mesh(cab, detail):
    """Frame, fifth wheel, tanks, mudguards, cab and furniture in truck coordinates."""
    c = CABS[cab]
    H, x0, x1 = c['height'], c['x0'], CAB_X1
    p = Part()
    # chassis frame, axles, differential, fifth wheel
    for sy in (-1, 1):
        p.box((3.0, sy * 0.42 - 0.07, 0.72), (8.95, sy * 0.42 + 0.07, 1.0), 'dark')
    p.box((FRONT_X - 0.07, -0.95, 0.42), (FRONT_X + 0.07, 0.95, 0.56), 'dark')   # steer axle beam
    p.box((DRIVE_X - 0.28, -0.3, 0.3), (DRIVE_X + 0.28, 0.3, 0.72), 'dark')       # differential
    p.box((KING_X - 0.55, -0.42, 1.0), (KING_X + 0.55, 0.42, 1.08), 'dark')
    p.revolve((KING_X, 0, 1.08), 'z', [(0.55, 0.0, 'r', 'steel'), (0.55, 0.17, 'a+', 'steel'), (0.0, 0.17, 'a+', 'steel')], 16 if detail == 0 else 8, lambda k, e: 'steel')
    p.box((KING_X + 0.08, -0.55, 1.08), (KING_X + 0.55, 0.55, 1.25), 'black') if detail < 2 else None  # slot
    if detail == 2:
        p.box((3.0, -0.5, 0.72), (8.95, 0.5, 1.25), 'dark')
    # mudguards and side skirts
    for sy in (-1, 1):
        p.box((DRIVE_X - 0.75, sy * 0.68 - (0 if sy > 0 else 0.62), 1.04), (DRIVE_X + 0.75, sy * 0.68 + (0.62 if sy > 0 else 0), 1.1), 'cab_dark') if detail < 2 else None
        p.box((3.2, sy * 1.2 - 0.02, 0.62), (6.5, sy * 1.2 + 0.02, 1.02), 'cab_dark') if detail < 2 else None
    if detail < 2:
        # fuel tank (left), battery / AdBlue box (right), air tanks
        p.revolve((6.0, 1.0, 0.72), 'x', [(0.33, -0.6, 'r', 'zinc'), (0.33, 0.6, 'a+', 'zinc'), (0.0, 0.6, 'a+', 'zinc')], 12 if detail == 0 else 6, lambda k, e: 'zinc')
        p.box((5.6, -1.2, 0.45), (6.5, -0.7, 0.95), 'dark')
        if detail == 0:
            p.box((5.55, -1.22, 0.55), (6.55, -1.18, 0.9), 'steel', ('-y',))
            for sx in (-1, 1):
                p.revolve((3.8, sx * 0.25, 0.86), 'x', [(0.14, -0.5, 'r', 'zinc'), (0.14, 0.5, 'a+', 'zinc'), (0.0, 0.5, 'a+', 'zinc')], 8, lambda k, e: 'zinc')
    # exhaust stack behind the cab, right side
    p.revolve((x0 - 0.25, -1.0, 1.0), 'z', [(0.06, 0.0, 'r', 'zinc'), (0.06, H - 1.1, 'a+', 'zinc'), (0.0, H - 1.1, 'a+', 'zinc')], 8 if detail == 0 else 4, lambda k, e: 'zinc') if c['sleeper'] and detail < 2 else None
    # ---- cab ---------------------------------------------------------------
    lower_top = 2.05
    p.box((x0, -1.25, 0.95), (x1, 1.25, lower_top), 'cab')                                  # lower cab: doors, front, rear
    p.box((x0, -1.22, lower_top), (x1 - 0.2, 1.22, H if c['sleeper'] else H - 0.15), 'cab')       # upper cab
    if detail == 2:
        return p
    p.box((x0 + 0.02, -1.255, 0.92), (x1 - 0.02, 1.255, 1.0), 'cab_dark', ('+y', '-y', '-z'))   # sill
    # windscreen (raked), side windows
    top = H - (0.32 if c['sleeper'] else 0.2)
    p.slant([(x1 + 0.005, -1.12, lower_top - 0.05), (x1 + 0.005, 1.12, lower_top - 0.05), (x1 - 0.2, 1.12, top), (x1 - 0.2, -1.12, top)], 'glass', (1, 0, 0.1))
    p.box((x1 - 0.2, -1.2, top), (x1 + 0.01, 1.2, top + 0.06), 'cab_dark', ('+x', '+z'))
    win_top = top - 0.12
    for sy in (-1, 1):
        p.box((x1 - 1.6, sy * 1.25 - 0.005, 1.7), (x1 - 0.25, sy * 1.25 + 0.012, win_top), 'glass', ('+y' if sy > 0 else '-y',))
        p.box((x1 - 1.64, sy * 1.25 - 0.003, 0.97), (x1 - 1.62, sy * 1.25 + 0.012, win_top + 0.05), 'cab_dark', ('+y' if sy > 0 else '-y',))     # door seam
        p.box((x1 - 0.22, sy * 1.25 - 0.003, 0.97), (x1 - 0.2, sy * 1.25 + 0.012, win_top + 0.05), 'cab_dark', ('+y' if sy > 0 else '-y',))
    # grille, headlamps, bumper, wordmark, number plate, steps
    p.box((x1 - 0.01, -0.62, 1.08), (x1 + 0.03, 0.62, 1.75), 'dark', ('+x',))
    p.plate((x1 + 0.03, -0.4, 1.32), (0, 1, 0), (0, 0, 1), 0.8, 0.2, 'wordmark', normal=(1, 0, 0))
    for sy in (-1, 1):
        p.lens((x1 + 0.01, sy * 0.95, 1.3), (0.03, 0.34, 0.2), 'white', 'x', 1)
        p.lens((x1 + 0.01, sy * 0.95, 1.05), (0.03, 0.34, 0.1), 'amber', 'x', 1)
    p.box((x1 - 0.02, -1.25, 0.62), (x1 + 0.12, 1.25, 0.95), 'dark')
    p.plate((x1 + 0.125, -0.26, 0.7), (0, 1, 0), (0, 0, 1), 0.52, 0.11, 'plate', normal=(1, 0, 0))
    for sy in (-1, 1):
        p.box((x1 - 0.95, sy * 1.15, 0.5), (x1 - 0.25, sy * 1.45, 0.56), 'zinc')            # entry steps
        p.box((x1 - 0.95, sy * 1.15, 0.8), (x1 - 0.25, sy * 1.45, 0.86), 'zinc')
        # mirrors: arm, main mirror, wide-angle mirror; door handle; side wordmark
        p.beam((x1 - 0.4, sy * 1.26, 2.35), (x1 - 0.35, sy * 1.52, 2.45), 0.05, 0.05, 'zinc')
        p.box((x1 - 0.5, sy * 1.52 - 0.03, 1.95), (x1 - 0.3, sy * 1.52 + 0.03, 2.65), 'dark')
        p.box((x1 - 0.45, sy * 1.35 - 0.03, 1.55), (x1 - 0.3, sy * 1.35 + 0.03, 1.8), 'dark')
        p.box((x1 - 1.45, sy * 1.25 - 0.005, 1.4), (x1 - 1.25, sy * 1.25 + 0.025, 1.46), 'zinc', ('+y' if sy > 0 else '-y',))
        p.plate((x1 - 0.4 if sy > 0 else x1 - 1.25, sy * 1.25, 1.1), (-1 if sy > 0 else 1, 0, 0), (0, 0, 1), 0.85, 0.2, 'wordmark', lift=0.012, normal=(0, sy, 0))
    # roof: visor, lamps, spoiler / extenders, sleeper rear
    p.box((x1 - 0.25, -1.2, H - 0.02), (x1 + 0.05, 1.2, H + 0.1), 'cab_dark')              # sun visor
    for i in range(4):
        p.lens((x1 - 0.1, -0.45 + i * 0.3, H + 0.11), (0.1, 0.18, 0.06), 'white' if i % 3 else 'amber', 'z', 1)
    if c['spoiler']:
        p.slant([(x0 + 0.05, -1.2, H), (x0 + 0.05, 1.2, H), (x0 + 1.25, 1.2, H + 0.35 if cab != 'mid' else H + 0.25), (x0 + 1.25, -1.2, H + 0.35 if cab != 'mid' else H + 0.25)], 'cab', (0, 0, 1))
        p.box((x0 + 0.05, -1.2, H - 0.01), (x0 + 1.25, 1.2, H), 'cab_dark', ('-z',))
    if c['extenders']:
        for sy in (-1, 1):
            p.slant([(x0, sy * 1.22, H - 0.3), (x0 + 1.3, sy * 1.22, H - 0.3), (x0 + 1.3, sy * 1.35, H - 0.5), (x0, sy * 1.35, H - 0.5)], 'cab_dark', (0, sy, 0.3))
    # rear wall details: two panels and a ladder step
    p.box((x0 - 0.03, -1.0, 1.1), (x0 + 0.01, 1.0, 1.9), 'cab_dark', ('-x',))
    if detail == 0:
        # interior seen through the glass: seats, dash, steering wheel
        for sy in (-0.5, 0.5):
            p.box((x1 - 1.6, sy - 0.25, 1.3), (x1 - 1.2, sy + 0.25, 1.75), 'seat')
            p.box((x1 - 1.35, sy - 0.25, 1.75), (x1 - 1.25, sy + 0.25, 2.35), 'seat')
        p.box((x1 - 0.55, -1.1, 1.45), (x1 - 0.1, 1.1, 1.75), 'dark')
        p.beam((x1 - 0.65, 0.5, 1.75), (x1 - 0.95, 0.5, 1.95), 0.04, 0.04, 'dark')
        if c['sleeper']:
            p.box((x0 + 0.1, -0.85, 1.5), (x0 + 1.1, 0.85, 1.7), 'seat')                    # bunk
        # grille slats and door recesses
        for i in range(7):
            p.box((x1 + 0.025, -0.58, 1.12 + i * 0.085), (x1 + 0.045, 0.58, 1.15 + i * 0.085), 'zinc' if i % 2 else 'dark') if i != 3 else None
        for sy in (-1, 1):
            p.box((x1 - 1.55, sy * 1.25, 1.05), (x1 - 0.3, sy * 1.25 + sy * 0.012, 1.6), 'cab_dark', ('+y' if sy > 0 else '-y',))
            p.box((x1 - 1.55, sy * 1.25, 0.93), (x1 - 0.2, sy * 1.25 + sy * 0.02, 1.0), 'dark', ('+y' if sy > 0 else '-y',))
        # air horn, fog lamps, wipers, cab-corner marker lamps, air intake
        p.box((x0 + 0.3, 0.7, H + 0.0), (x0 + 0.5, 0.9, H + 0.22), 'zinc') if c['spoiler'] else None
        for sy in (-1, 1):
            p.lens((x1 + 0.015, sy * 0.6, 0.85), (0.03, 0.1, 0.07), 'white', 'x', 1)
            p.beam((x1 - 0.22, sy * 0.3, 1.58), (x1 - 0.25, sy * 0.95, 1.9), 0.03, 0.03, 'black')
            p.lens((x1 - 0.02, sy * 1.25, H - 0.3), (0.05, 0.06, 0.05), 'amber', 'y', sy)
        p.box((x0 + 0.1, 1.255, 1.65), (x0 + 0.5, 1.28, 1.9), 'dark', ('+y',))
    return p


# ---- assembly -----------------------------------------------------------------
def _obj(part, name, material, parent, location=(0, 0, 0)):
    obj = part.m.to_object(name, material, parent)
    obj.location = location
    return obj


def build_lod(root, level, material, cab=None):
    """One LOD subtree. `cab` None builds the chassis alone (the standalone chassis asset)."""
    suffix = f'@LOD{level}'
    lod = empty(f'LOD{level}', root)
    tris = 0

    def add(part, name, parent, loc=(0, 0, 0), pivot=None):
        nonlocal tris
        if pivot is not None:
            part.m.shift(pivot)
        tris += part.triangles
        return _obj(part, name + suffix, material, parent, loc)

    if level == 2:
        add(chassis_mesh(2, with_wheels=True), 'chassis', lod)
        if cab is not None:
            fw = empty('fifth_wheel' + suffix, lod, (KING_X, 0, 0))
            t = tractor_mesh(cab, 2)
            t.box((DRIVE_X - R * 0.8, -1.25, 0.05), (DRIVE_X + R * 0.8, 1.25, 2 * R - 0.05), 'rubber', ('+x', '-x', '+y', '-y', '+z'))
            t.box((FRONT_X - R * 0.8, -1.15, 0.05), (FRONT_X + R * 0.8, 1.15, 2 * R - 0.05), 'rubber', ('+x', '-x', '+y', '-y', '+z'))
            add(t, 'tractor', fw, (-KING_X, 0, 0))
        return lod, tris
    detail = level
    add(chassis_mesh(detail), 'chassis', lod)
    for i, ax in enumerate(TRAILER_X):
        add(trailer_wheel_mesh(detail), f'wheel_t{i + 1}', lod, (ax, 0, R))
    if cab is None:
        return lod, tris
    fw = empty('fifth_wheel' + suffix, lod, (KING_X, 0, 0))
    add(tractor_mesh(cab, detail), 'tractor', fw, (-KING_X, 0, 0))
    for name, sy in CORNERS:
        piv = (FRONT_X, sy * FRONT_STEER_Y, R)
        steer = empty(f'steer_{name}{suffix}', fw, (piv[0] - KING_X, piv[1], piv[2]))
        add(front_wheel_mesh(sy, detail), f'wheel_{name}', steer, (0, 0, 0))
    add(drive_wheel_mesh(detail), 'wheel_r', fw, (DRIVE_X - KING_X, 0, R))
    return lod, tris


def build_truck(atlas_image, cab):
    """Returns (root, info): `cab` is a CABS key, or None for the chassis-only asset."""
    material = textured_material('truck_atlas', atlas_image, roughness=0.6, metallic=0.1)
    name = f'truck-cab-{cab}' if cab else 'truck-chassis'
    root = empty(name)
    triangles = {}
    for level in (0, 1, 2):
        _, tris = build_lod(root, level, material, cab)
        triangles[f'LOD{level}'] = tris
    return root, {'name': name, 'cab': cab, 'triangles': triangles, 'height': CABS[cab]['height'] if cab else 1.3 + 0.0}


def hide_lods_for_preview(keep='LOD0'):
    import bpy
    for obj in bpy.data.objects:
        if obj.name.startswith('LOD') and obj.name != keep and obj.type == 'EMPTY':
            stack = [obj]
            while stack:
                o = stack.pop()
                o.hide_render = True
                stack.extend(o.children)
