"""Kalmar-style shuttle carrier (SHC) asset, three LODs, rigged (TT-25).

Hierarchy (glTF names; every animated LOD repeats the rig names, the build
step strips the `@LODn` suffix that keeps Blender's object names unique):
  shc                       root, origin = ground contact below the frame centre
    LOD0 / LOD1 / LOD2
      frame                 static: legs, gantry, sills, bracing, engine/hoist assembly,
                            cab, ladder, rails, stripes, branding plates
      steer_fl|fr|rl|rr     steering knuckle + fork, pivot on the vertical steer axis
        wheel_fl|...        dual tyres, pivot on the axle (rolls about glTF +Z)
      hoist                 lifting frame, pivot at the container attach plane (rest = raised)
        spreader            telescopic 40 ft spreader (LOD2: none; a small float travel)
          twistlock_fl|...  four corner twist-locks (LOD0 only)

Blender axes: X = travel direction (front +X, cab end), Y = width, Z = up.
glTF axes: X = front, Y = up, Z = -Blender Y. One material, one small swatch atlas.
All dimensions are [A] approximations of a Kalmar shuttle carrier unless the
sidecar says otherwise.
"""
import math

import bpy

from .blender import empty, textured_material
from .parts import Atlas, Part as _Part

# ---- dimensions (m) --------------------------------------------------------
LEG_X, LEG_Y = 3.3, 2.35         # leg centres (wheelbase 6.6, track 4.7)
LEG_W = 0.8                      # leg section (heavy red box section)
LEG_BOTTOM = 2.2                 # steer housing meets the leg here
TOP_UNDER = 6.4                  # underside of the top beams = clear height
TOP_OVER = 7.2                   # top of the top beams
TYRE_R, TYRE_W, TYRE_GAP = 0.95, 0.72, 0.0   # one large single tyre per corner (TYRE_GAP = offset between tyres, 0 = single)
AXLE_Z = TYRE_R
HOIST_TRAVEL = 3.1               # lowest attach plane: 6.0 - 3.1 = 2.9 m, the top of a 40 ft high-cube box standing on the ground (2.896)
ATTACH_Z = 6.0                   # twist-lock plane at rest (raised)
SPREADER_FLOAT = 0.35
TWIST_DEG = 90
FRAME_HALF_LEN = 4.1
SILL_Z0, SILL_Z1 = 2.2, 3.15     # chassis sill between the legs and over the wheels: wordmarks, hazard end plates
CORNERS = (('fl', 1, 1), ('fr', 1, -1), ('rl', -1, 1), ('rr', -1, -1))  # name, x sign, y sign

# ---- swatch atlas ----------------------------------------------------------
ATLAS = 1024
CELL = 128
SWATCHES = {
    'red': '#c1121a', 'red_dark': '#8d0d13', 'steel': '#8b9198', 'dark': '#2b2e33', 'rubber': '#18181a',
    'glass': '#7fa6bb', 'white': '#f1f1ef', 'yellow': '#f2b705', 'orange': '#e8641b', 'grey': '#b9bdc2',
    'black': '#0d0d0e', 'amber': '#ffb43a', 'lens_red': '#d11818', 'zinc': '#a8adb3', 'seat': '#3a3d44', 'rope': '#4a4d52',
}
ATLAS_SPEC = Atlas(ATLAS, CELL, SWATCHES, {})
SWATCH_ORDER = list(SWATCHES)  # 4 columns x 4 rows of 128 px cells from the top-left (rows 0-3 = 4 x 4)
# Wide regions (pixel rect x0, y0, x1, y1; origin top-left) below the swatch grid.
REGIONS = {
    'hazard': (0, 512, 512, 640),       # white diagonal stripes on red
    'wordmark': (0, 640, 1024, 768),    # KALMAR (white on red)
    'livery': (0, 768, 512, 896),       # TTI ALGECIRAS (white on red), text only: no logo artwork
    'plate': (512, 512, 1024, 640),     # small spec plate (dark, light text)
}
ATLAS_SPEC.regions = REGIONS

# Fleet-number plates ("SHC nn", white on dark): a second 1024 px texture, 8 x 15 tiles of 128 x 64 px, one per SHC id
# 1..120 (the setup dialog allows up to 120 SHCs). The GLB authors the plate quads for tile 0; the renderer offsets the
# UVs of its own copy of the `shc_plate` material per SHC (see shcAssets.ts).
PLATE_ATLAS = 1024
PLATE_COLS, PLATE_ROWS = 8, 15
PLATE_TILE_W, PLATE_TILE_H = 128, 64
PLATE_FIRST, PLATE_COUNT = 1, 120
PLATE_INSET = 2
PLATE_SPEC = Atlas(PLATE_ATLAS, 128, {}, {'tile0': (PLATE_INSET, PLATE_INSET, PLATE_TILE_W - PLATE_INSET, PLATE_TILE_H - PLATE_INSET)})


def swatch_uv(name):
    return ATLAS_SPEC.swatch_uv(name)


def region_uv(name):
    return ATLAS_SPEC.region_uv(name)


# ---- geometry helpers ------------------------------------------------------
class Part(_Part):
    """The shared Part vocabulary bound to the SHC atlas."""

    def __init__(self):
        super().__init__(ATLAS_SPEC)



# ---- parts -----------------------------------------------------------------
def tyre_profile(detail):
    """Tyre cross-section (rho, offset along the axle) from one sidewall over the tread to the other.
    Each point's swatch colours the edge that leaves it. A white rim disc inside the sidewall, as on the TTI SHCs."""
    w = TYRE_W / 2
    r = TYRE_R
    if detail == 0:
        return [(0.2, -w, 'a-', 'steel'), (0.34, -w, 'a-', 'white'), (0.66, -w, 'a-', 'rubber'), (r - 0.14, -w, 'r', 'rubber'),
                (r - 0.03, -w * 0.9, 'r', 'rubber'), (r, -w * 0.7, 'r', 'rubber'), (r, -w * 0.12, 'r', 'black'), (r - 0.025, 0.0, 'r', 'black'),
                (r, w * 0.12, 'r', 'rubber'), (r, w * 0.7, 'r', 'rubber'), (r - 0.03, w * 0.9, 'a+', 'rubber'),
                (r - 0.14, w, 'a+', 'rubber'), (0.66, w, 'a+', 'white'), (0.34, w, 'a+', 'steel'), (0.2, w, 'a+', 'steel')]
    return [(0.2, -w, 'a-', 'white'), (0.66, -w, 'a-', 'rubber'), (r - 0.1, -w, 'r', 'rubber'), (r, -w * 0.7, 'r', 'rubber'),
            (r, w * 0.7, 'a+', 'rubber'), (r - 0.1, w, 'a+', 'rubber'), (0.66, w, 'a+', 'white'), (0.2, w, 'a+', 'white')]


def wheel_mesh(detail):
    """One large single tyre on a white rim, centred on the axle origin (rolls about Blender Y)."""
    p = Part()
    segs = {0: 52, 1: 28, 2: 8}[detail]
    prof = tyre_profile(detail)

    def sw(k, e):
        if detail == 0 and e in (4, 5, 8, 9) and k % 2 == 0:  # tread lugs: alternate blocks read darker
            return 'black'
        return prof[e][3]

    p.revolve((0, 0, 0), 'y', prof, segs, sw)
    if detail == 0:
        w = TYRE_W / 2
        # hub: a dark axle cap on each face, ringed by wheel nuts
        for sgn in (-1, 1):
            p.revolve((0, 0, 0), 'y', [(0.17, sgn * w, 'r', 'dark'), (0.17, sgn * (w + 0.03), 'a+' if sgn > 0 else 'a-', 'dark'), (0.0, sgn * (w + 0.03), 'a+', 'dark')], 10, lambda k, e: 'dark')
            for i in range(8):
                a = i * math.pi / 4
                x, z = 0.28 * math.cos(a), 0.28 * math.sin(a)
                p.box((x - 0.035, sgn * w - (0.0 if sgn > 0 else 0.03), z - 0.035), (x + 0.035, sgn * w + (0.03 if sgn > 0 else 0.0), z + 0.035), 'dark', ('+x', '-x', '+z', '-z', '+y' if sgn > 0 else '-y'))
    return p


def steer_mesh(detail):
    """Steering knuckle and fork around the single wheel; origin on the steer axis at axle height."""
    p = Part()
    fork_y = TYRE_W / 2 + 0.07
    for sy in (-1, 1):
        p.box((-0.3, sy * fork_y - 0.07, -0.3), (0.3, sy * fork_y + 0.07, 1.76 - AXLE_Z), 'red')
    p.box((-0.5, -fork_y - 0.12, 1.75 - AXLE_Z), (0.5, fork_y + 0.12, 2.2 - AXLE_Z), 'red')
    if detail == 0:
        p.box((-0.34, -0.52, 1.5 - AXLE_Z), (0.34, 0.52, 1.78 - AXLE_Z), 'steel')  # turntable ring
        # steering link and cylinder
        p.beam((0.1, -fork_y, 1.1 - AXLE_Z), (0.1, fork_y, 1.1 - AXLE_Z), 0.14, 0.14, 'zinc')
        p.beam((0.5, 0.2, 1.7 - AXLE_Z), (0.5, 0.2, 0.2 - AXLE_Z), 0.1, 0.1, 'zinc')
    return p


# Livery panel on the front end beam: over the -Y half so it clears the cab (+Y half), as on the TTI SHCs.
PANEL_X0, PANEL_X1 = LEG_X - 0.2, LEG_X + 0.45
PANEL_Y0, PANEL_Y1 = -3.0, 0.5
PANEL_H = 0.85
# Cab block (x0, x1, y0, y1, floor z): elevated, offset to the +Y side at the front, overhanging the front leg.
CAB = (2.1, 4.5, 0.9, 3.25, TOP_OVER + 0.1)
CAB_H = 1.95


def _side_decal(p, sy, xc, zc, w, h, region):
    """A wide decal on the outer face of a side member (y = sy * (LEG_Y + LEG_W / 2)), reading left to right from outside."""
    yb = sy * (LEG_Y + LEG_W / 2)
    p.plate((xc + sy * w / 2, yb, zc - h / 2), (-sy, 0, 0), (0, 0, 1), w, h, region, normal=(0, sy, 0))


def frame_decals(p):
    """Flat textured parts of the frame (main atlas): hazard stripes, KALMAR and TTI ALGECIRAS wordmarks."""
    LW = LEG_W / 2
    for _, sx, sy in CORNERS:
        cx, cy = sx * LEG_X, sy * LEG_Y
        z0 = SILL_Z1 + 0.05
        p.plate((cx + sy * LW, cy + sy * LW, z0), (-sy, 0, 0), (0, 0, 1), LEG_W, 1.4, 'hazard', normal=(0, sy, 0))
        p.plate((cx + sx * LW, cy - sx * LW, z0), (0, sx, 0), (0, 0, 1), LEG_W, 1.4, 'hazard', normal=(sx, 0, 0))
    for sx in (-1, 1):  # hazard end plates on the chassis sills (end faces)
        for sy in (-1, 1):
            xe = sx * FRAME_HALF_LEN
            p.plate((xe, sy * LEG_Y - sx * sy * LW, SILL_Z0), (0, sx * sy, 0), (0, 0, 1), LEG_W, SILL_Z1 - SILL_Z0, 'hazard', normal=(sx, 0, 0))
    for sy in (-1, 1):  # sill wordmarks: KALMAR to the rear, TTI ALGECIRAS amidships
        zc = (SILL_Z0 + SILL_Z1) / 2
        _side_decal(p, sy, -2.35, zc, 2.4, 0.3, 'wordmark')
        _side_decal(p, sy, -0.15, zc, 2.0, 0.5, 'livery')
    # livery panel face (front, +X) and small KALMAR plates on the end beams
    p.plate((PANEL_X1, PANEL_Y0 + 0.1, TOP_OVER + 0.14), (0, 1, 0), (0, 0, 1), 2.2, 0.55, 'livery', normal=(1, 0, 0))
    p.plate((-LEG_X - LW, 1.2, 6.55), (0, -1, 0), (0, 0, 1), 1.6, 0.2, 'wordmark', normal=(-1, 0, 0))
    p.plate((LEG_X + LW, -1.6, 6.55), (0, 1, 0), (0, 0, 1), 1.6, 0.2, 'wordmark', normal=(1, 0, 0))


def plates_mesh():
    """The fleet-number plates ("SHC nn", tile 0 of the plate atlas; the renderer picks the tile per SHC): front panel, sills, top beams, rear."""
    p = _Part(PLATE_SPEC)
    LW = LEG_W / 2
    pw, ph = 1.0, 0.5
    # front livery panel, beside the TTI ALGECIRAS text (seen from the front, -Y is on the right)
    p.plate((PANEL_X1, PANEL_Y0 + 2.4, TOP_OVER + 0.14), (0, 1, 0), (0, 0, 1), pw, ph, 'tile0', normal=(1, 0, 0))
    # rear end beam
    p.plate((-LEG_X - LW, 0.5 + pw, 6.55), (0, -1, 0), (0, 0, 1), pw, 0.4, 'tile0', normal=(-1, 0, 0))
    for sy in (-1, 1):
        _side_decal(p, sy, 2.0, (SILL_Z0 + SILL_Z1) / 2, pw, ph, 'tile0')   # sill, ahead of the TTI ALGECIRAS text
        _side_decal(p, sy, -2.6, 6.8, pw, ph, 'tile0')                       # top beam
    return p


def frame_mesh(detail):
    """The static welded gantry: everything that does not move."""
    p = Part()
    LW = LEG_W / 2
    for _, sx, sy in CORNERS:
        cx, cy = sx * LEG_X, sy * LEG_Y
        # tall red box-section leg with a base flange and collars
        p.box((cx - LW, cy - LW, SILL_Z1), (cx + LW, cy + LW, TOP_UNDER), 'red')
        if detail == 0:
            for z in (SILL_Z1 + 1.6, TOP_UNDER - 0.7):
                p.box((cx - LW - 0.03, cy - LW - 0.03, z), (cx + LW + 0.03, cy + LW + 0.03, z + 0.08), 'red_dark')
            # hoist guide rail on the inner face
            iy = -sy
            p.box((cx - 0.1, cy + iy * (LW + 0.03) - 0.04, 4.0), (cx + 0.1, cy + iy * (LW + 0.03) + 0.04, TOP_UNDER), 'steel')
            # hydraulic hose down the inner face of the legs
            p.beam((cx - sx * 0.2, cy + iy * (LW + 0.06), TOP_UNDER - 0.6), (cx - sx * 0.2, cy + iy * (LW + 0.06), SILL_Z1 + 0.2), 0.06, 0.06, 'dark')
    # chassis sills on both sides: a deep red beam over the wheels, longer than the leg base
    for sy in (-1, 1):
        p.box((-FRAME_HALF_LEN, sy * LEG_Y - LW, SILL_Z0), (FRAME_HALF_LEN, sy * LEG_Y + LW, SILL_Z1), 'red')
        if detail == 0:
            for x in (-1.2, 1.2):   # service hatch lips in the outer face
                yo = sy * (LEG_Y + LW)
                p.box((x - 0.35, min(yo, yo + sy * 0.03), SILL_Z0 + 0.12), (x + 0.35, max(yo, yo + sy * 0.03), SILL_Z0 + 0.3), 'red_dark', ('+y', '-y'))
    # top beams: two sides, two ends
    for sy in (-1, 1):
        p.box((-FRAME_HALF_LEN, sy * LEG_Y - LW, TOP_UNDER), (FRAME_HALF_LEN, sy * LEG_Y + LW, TOP_OVER), 'red')
    for sx in (-1, 1):
        p.box((sx * LEG_X - LW, -LEG_Y + LW, TOP_UNDER), (sx * LEG_X + LW, LEG_Y - LW, TOP_OVER), 'red')
    # bridge for the engine and hoist machinery across the middle
    p.box((-1.6, -LEG_Y + LW, TOP_OVER - 0.5), (1.6, LEG_Y - LW, TOP_OVER), 'red_dark')
    # X bracing in the side frames, between the sill and the top beam
    for sy in (-1, 1):
        if detail < 2:
            p.beam((-LEG_X + LW, sy * LEG_Y, SILL_Z1), (LEG_X - LW, sy * LEG_Y, TOP_UNDER), 0.28, 0.28, 'red_dark')
            p.beam((LEG_X - LW, sy * LEG_Y, SILL_Z1), (-LEG_X + LW, sy * LEG_Y, TOP_UNDER), 0.28, 0.28, 'red_dark')
    # livery panel: a red box standing on the front end beam, over the -Y half
    p.box((PANEL_X0, PANEL_Y0, TOP_OVER), (PANEL_X1, PANEL_Y1, TOP_OVER + PANEL_H), 'red')
    frame_decals(p)
    if detail == 0:
        p.box((PANEL_X0 - 0.03, PANEL_Y0 - 0.03, TOP_OVER + PANEL_H), (PANEL_X1 + 0.03, PANEL_Y1 + 0.03, TOP_OVER + PANEL_H + 0.06), 'red_dark')  # panel cap
        # gussets at the leg heads, weld seams along the top beams
        for _, sx, sy in CORNERS:
            cx, cy = sx * LEG_X, sy * LEG_Y
            p.beam((cx, cy - sy * LW, TOP_UNDER - 1.0), (cx, cy - sy * (LW + 0.7), TOP_UNDER), 0.12, 0.12, 'red_dark')
            p.beam((cx - sx * LW, cy, TOP_UNDER - 1.0), (cx - sx * (LW + 0.7), cy, TOP_UNDER), 0.12, 0.12, 'red_dark')
        for sy in (-1, 1):
            for x in range(-4, 5):
                p.box((x * 0.9 - 0.025, sy * (LEG_Y + LW + 0.01), TOP_UNDER + 0.05), (x * 0.9 + 0.025, sy * (LEG_Y + LW + 0.03), TOP_OVER - 0.05), 'red_dark', ('+y', '-y'))
        # engine / hoist assembly above the tunnel (rear)
        e = TOP_OVER
        p.box((-3.7, -1.6, e), (0.5, 1.6, e + 1.25), 'red')                         # engine housing
        p.box((-3.78, -1.68, e + 1.25), (0.58, 1.68, e + 1.34), 'red_dark')        # roof lip
        for i in range(14):                                                        # louvres, both sides
            x = -3.4 + i * 0.26
            for sy in (-1, 1):
                p.box((x, sy * 1.6, e + 0.3), (x + 0.14, sy * 1.66, e + 1.0), 'dark', ('+y', '-y', '+z'))
        p.box((-3.7, -1.2, e + 1.34), (-2.6, 0.0, e + 1.7), 'dark')               # air intake
        p.revolve((-3.1, 0.9, e + 1.34), 'z', [(0.17, 0.0, 'r', 'dark'), (0.17, 1.4, 'a+', 'dark'), (0.0, 1.4, 'a+', 'dark')], 10, lambda k, e_: 'dark')  # exhaust stack
        p.revolve((-3.1, 0.9, e + 2.74), 'z', [(0.22, 0.0, 'r', 'steel'), (0.22, 0.08, 'a+', 'steel'), (0.0, 0.08, 'a+', 'steel')], 10, lambda k, e_: 'steel')  # rain cap
        p.box((0.7, -1.3, e), (2.5, 1.3, e + 0.9), 'red_dark')                      # hoist gearbox/winch housing
        p.revolve((1.6, 0.0, e + 0.55), 'y', [(0.42, -1.1, 'r', 'steel'), (0.42, 1.1, 'a+', 'steel'), (0.0, 1.1, 'a+', 'steel')], 14, lambda k, e_: 'steel')
        p.cbox((2.55, 0, e + 0.45), (0.1, 2.0, 0.6), 'dark', ('+x',))              # sheave guard
        for sy in (-1, 1):
            p.revolve((2.0, sy * 0.6, e + 0.2), 'y', [(0.3, -0.07, 'r', 'zinc'), (0.3, 0.07, 'a+', 'zinc'), (0.0, 0.07, 'a+', 'zinc')], 12, lambda k, e_: 'zinc')
        # walkway and black handrails along both top beams
        for sy in (-1, 1):
            p.box((-FRAME_HALF_LEN, min(sy * (LEG_Y + LW), sy * (LEG_Y + LW + 0.55)), TOP_OVER - 0.08), (FRAME_HALF_LEN, max(sy * (LEG_Y + LW), sy * (LEG_Y + LW + 0.55)), TOP_OVER), 'zinc')
            yr = sy * (LEG_Y + LW + 0.55)
            for i in range(9):
                x = -FRAME_HALF_LEN + 0.1 + i * 1.0
                p.box((x - 0.03, yr - 0.03, TOP_OVER), (x + 0.03, yr + 0.03, TOP_OVER + 1.05), 'dark')
            for z in (TOP_OVER + 0.5, TOP_OVER + 1.05):
                p.box((-FRAME_HALF_LEN, yr - 0.025, z - 0.025), (FRAME_HALF_LEN, yr + 0.025, z + 0.025), 'dark')
        # cab: white, elevated, glazed, on the +Y side at the front, overhanging the front leg
        cx0, cx1, cy0, cy1, cz0 = CAB
        ch = CAB_H
        p.box((cx0 - 0.05, cy0 - 0.05, cz0 - 0.2), (cx1 + 0.05, cy1 + 0.05, cz0), 'steel')       # floor / support
        for x, y in ((cx0, cy0), (cx0, cy1), (cx1, cy0), (cx1, cy1)):
            p.box((x - 0.05, y - 0.05, cz0), (x + 0.05, y + 0.05, cz0 + ch), 'dark')              # pillars
        gl = (cz0 + 0.55, cz0 + ch - 0.05)
        p.box((cx1 - 0.02, cy0 + 0.05, gl[0]), (cx1 + 0.02, cy1 - 0.05, gl[1]), 'glass', ('+x',))
        p.box((cx0 - 0.02, cy0 + 0.05, gl[0]), (cx0 + 0.02, cy1 - 0.05, gl[1]), 'glass', ('-x',))
        p.box((cx0 + 0.05, cy1 - 0.02, gl[0]), (cx1 - 0.05, cy1 + 0.02, gl[1]), 'glass', ('+y',))
        p.box((cx0 + 0.05, cy0 - 0.02, gl[0]), (cx1 - 0.05, cy0 + 0.02, gl[1]), 'glass', ('-y',))
        p.box((cx0 - 0.04, cy0 - 0.04, cz0), (cx1 + 0.04, cy1 + 0.04, cz0 + 0.55), 'white', ('+x', '-x', '+y', '-y'))  # lower panels
        p.box((cx0 - 0.15, cy0 - 0.15, cz0 + ch), (cx1 + 0.15, cy1 + 0.15, cz0 + ch + 0.12), 'white')                    # roof
        p.box((cx0 + 0.3, cy0 + 0.25, cz0 + ch + 0.12), (cx0 + 1.0, cy1 - 0.25, cz0 + ch + 0.25), 'zinc')               # air-conditioning unit
        p.cbox((cx0 + 0.7, (cy0 + cy1) / 2, cz0 + 0.45), (0.5, 0.5, 0.9), 'seat')                                         # seat
        p.cbox((cx1 - 0.55, (cy0 + cy1) / 2, cz0 + 0.55), (0.45, 1.0, 0.5), 'dark')                                       # console
        p.beam((cx1 + 0.1, cy1 - 0.2, cz0 + ch - 0.2), (cx1 + 0.35, cy1 + 0.35, cz0 + ch - 0.4), 0.05, 0.05, 'zinc')     # mirror arm
        p.box((cx1 + 0.3, cy1 + 0.3, cz0 + ch - 0.7), (cx1 + 0.38, cy1 + 0.48, cz0 + ch - 0.3), 'dark')                  # mirror
        p.revolve((cx0 + 0.6, cy1 - 0.4, cz0 + ch + 0.25), 'z', [(0.09, 0.0, 'r', 'orange'), (0.09, 0.18, 'a+', 'orange'), (0.0, 0.18, 'a+', 'orange')], 8, lambda k, e_: 'orange')
        for i in range(3):                                                                                                # work lights on the cab roof
            p.box((cx1 - 0.35, cy0 + 0.35 + i * 0.5, cz0 + ch + 0.12), (cx1 - 0.15, cy0 + 0.6 + i * 0.5, cz0 + ch + 0.3), 'white')
        # caged cab ladder on the front +Y leg: black stiles, zinc rungs, cage hoops
        lx, ly = LEG_X + 0.15, LEG_Y + LW + 0.12
        for dx in (-0.22, 0.22):
            p.box((lx + dx - 0.025, ly - 0.025, 2.0), (lx + dx + 0.025, ly + 0.025, TOP_OVER + 0.1), 'dark')
        for i in range(21):
            z = 2.2 + i * 0.25
            p.box((lx - 0.22, ly - 0.02, z - 0.02), (lx + 0.22, ly + 0.02, z + 0.02), 'zinc')
        for z in (4.4, 5.2, 6.0, 6.8):
            for dx in (-0.4, 0.4):
                p.box((lx + dx - 0.02, ly - 0.02, z), (lx + dx + 0.02, ly + 0.5, z + 0.02), 'dark')
            p.box((lx - 0.42, ly + 0.48, z), (lx + 0.42, ly + 0.52, z + 0.02), 'dark')
        p.box((lx - 0.4, ly - 0.45, TOP_OVER - 0.05), (lx + 0.4, ly + 0.15, TOP_OVER + 0.03), 'zinc')   # landing at the ladder head
        # service ladder on the rear -Y leg, black stiles
        lx2, ly2 = -LEG_X, -(LEG_Y + LW + 0.12)
        for dx in (-0.22, 0.22):
            p.box((lx2 + dx - 0.025, ly2 - 0.025, 2.0), (lx2 + dx + 0.025, ly2 + 0.025, TOP_OVER + 0.1), 'dark')
        for i in range(21):
            z = 2.2 + i * 0.25
            p.box((lx2 - 0.22, ly2 - 0.02, z - 0.02), (lx2 + 0.22, ly2 + 0.02, z + 0.02), 'zinc')
        # grab handles on the legs
        for _, sx, sy in CORNERS:
            p.beam((sx * LEG_X - 0.2, sy * (LEG_Y + LW + 0.08), 4.9), (sx * LEG_X + 0.2, sy * (LEG_Y + LW + 0.08), 4.9), 0.04, 0.04, 'dark')
        # fuel tank, battery box and hydraulic reservoir on the -Y side, above the sill
        p.box((-1.6, -LEG_Y - LW - 0.85, 3.3), (0.6, -LEG_Y - LW, 4.4), 'red_dark')
        p.box((-1.5, -LEG_Y - LW - 0.9, 3.6), (-1.35, -LEG_Y - LW - 0.85, 4.2), 'steel')
        p.box((1.0, -LEG_Y - LW - 0.5, 3.4), (2.2, -LEG_Y - LW, 4.2), 'dark')
        # lights: amber at the front, red at the rear, on the end beams and sills
        for sy in (-1, 1):
            p.lens((LEG_X + LW + 0.01, sy * 1.5, TOP_UNDER + 0.4), (0.03, 0.4, 0.2), 'amber', 'x', 1)
            p.lens((-LEG_X - LW - 0.01, sy * 1.5, TOP_UNDER + 0.4), (0.03, 0.4, 0.2), 'lens_red', 'x', -1)
            p.lens((FRAME_HALF_LEN + 0.01, sy * LEG_Y, SILL_Z1 - 0.15), (0.03, 0.3, 0.14), 'amber', 'x', 1)
        p.box((FRAME_HALF_LEN - 0.1, -LEG_Y - LW, TOP_UNDER - 0.35), (FRAME_HALF_LEN + 0.05, LEG_Y + LW, TOP_UNDER), 'dark')  # front bumper rail
        p.box((-FRAME_HALF_LEN - 0.05, -LEG_Y - LW, TOP_UNDER - 0.35), (-FRAME_HALF_LEN + 0.1, LEG_Y + LW, TOP_UNDER), 'dark')
    else:
        # LOD1 details that survive: cab, engine block, rails as boxes
        e = TOP_OVER
        p.box((-3.7, -1.6, e), (0.5, 1.6, e + 1.3), 'red')
        p.box((0.7, -1.3, e), (2.5, 1.3, e + 0.9), 'red_dark')
        cx0, cx1, cy0, cy1, cz0 = CAB
        p.box((cx0, cy0, cz0), (cx1, cy1, cz0 + CAB_H), 'glass')
        p.box((cx0, cy0, cz0), (cx1, cy1, cz0 + 0.55), 'white', ('+x', '-x', '+y', '-y'))
        p.box((cx0 - 0.15, cy0 - 0.15, cz0 + CAB_H), (cx1 + 0.15, cy1 + 0.15, cz0 + CAB_H + 0.12), 'white')
        for sy in (-1, 1):
            yr = sy * (LEG_Y + LW + 0.55)
            p.box((-FRAME_HALF_LEN, yr - 0.03, TOP_OVER + 0.9), (FRAME_HALF_LEN, yr + 0.03, TOP_OVER + 1.05), 'dark')
        p.box((-1.6, -LEG_Y - LW - 0.85, 3.3), (0.6, -LEG_Y - LW, 4.4), 'red_dark')
    return p


def hoist_mesh(detail):
    """Lifting frame sliding on the leg guides; origin on the attach plane at the centre."""
    p = Part()
    z0 = 0.5  # frame bottom above the attach plane
    for sy in (-1, 1):
        p.box((-3.0, sy * 1.8 - 0.14, z0), (3.0, sy * 1.8 + 0.14, z0 + 0.45), 'red')
    for sx in (-1, 1):
        p.box((sx * 1.5 - 0.2, -1.8, z0), (sx * 1.5 + 0.2, 1.8, z0 + 0.4), 'red')
    if detail == 0:
        for sx in (-1, 1):
            for sy in (-1, 1):
                p.box((sx * 3.0 - 0.15 - (0.0 if sx > 0 else 0.0), sy * 1.8 - 0.2, z0 - 0.05), (sx * 3.0 + 0.15, sy * 1.8 + 0.2, z0 + 0.5), 'dark')  # guide shoes
                p.beam((sx * 1.5, sy * 0.6, 0.45), (sx * 1.5, sy * 0.6, z0), 0.1, 0.1, 'rope')  # hanger rods
        for sx in (-1, 1):  # hoist ropes up to the sheaves (stubs, they travel with the frame)
            p.beam((sx * 1.5, 0.0, z0 + 0.4), (sx * 1.5, 0.0, z0 + 0.9), 0.06, 0.06, 'rope')
    return p


def spreader_mesh(detail):
    """Telescopic 40 ft spreader; origin on the twist-lock plane at the centre."""
    p = Part()
    hl = 6.0
    for sx in (-1, 1):
        p.box((sx * hl - 0.3, -1.4, 0.04), (sx * hl + 0.3, 1.4, 0.5), 'red')            # end beams
        if detail == 0:
            p.box((sx * hl - 0.32, -1.42, 0.0), (sx * hl + 0.32, -1.1, 0.06), 'dark')    # casting guides
            p.box((sx * hl - 0.32, 1.1, 0.0), (sx * hl + 0.32, 1.42, 0.06), 'dark')
            p.box((sx * hl - 0.1, -1.0, 0.5), (sx * hl + 0.1, 1.0, 0.62), 'steel')         # flipper pivots / cabling
    p.box((-3.2, -0.9, 0.2), (3.2, 0.9, 0.7), 'red')                                   # centre telescopic housing
    for sy in (-1, 1):
        p.box((-hl, sy * 0.5 - 0.12, 0.28), (hl, sy * 0.5 + 0.12, 0.52), 'steel')           # inner telescopic tubes
        if detail == 0:
            for sx in (-1, 1):
                p.box((sx * 3.2 - 0.06, sy * 0.5 - 0.16, 0.24), (sx * 3.2 + 0.06, sy * 0.5 + 0.16, 0.56), 'dark')  # tube collars
    if detail == 0:
        for sy in (-1, 1):  # lightening holes through the housing sides
            for x in (-1.2, 0.0, 1.2):
                p.box((x - 0.2, sy * 0.9 - (0.0 if sy > 0 else 0.02), 0.32), (x + 0.2, sy * 0.9 + (0.02 if sy > 0 else 0.0), 0.58), 'dark', ('+y' if sy > 0 else '-y',))
        p.box((-0.6, -0.5, 0.7), (0.6, 0.5, 1.0), 'dark')                                  # junction box
        p.plate((-0.5, 0.905, 0.3), (-1, 0, 0), (0, 0, 1), 1.0, 0.3, 'plate', normal=(0, 1, 0))     # spec plate on the telescopic housing
    return p


def twistlock_mesh():
    """One twist-lock: a stem with a locking cone; origin at the casting aperture centre on the plane."""
    p = Part()
    p.revolve((0, 0, 0), 'z', [(0.045, -0.06, 'r', 'dark'), (0.045, 0.06, 'a+', 'dark'), (0.0, 0.06, 'a+', 'dark')], 8, lambda k, e: 'dark')
    p.box((-0.07, -0.03, -0.08), (0.07, 0.03, -0.04), 'steel')
    return p


def lod2_mesh():
    """About 400 triangles: the silhouette in boxes."""
    p = Part()
    LW = LEG_W / 2
    for _, sx, sy in CORNERS:
        p.box((sx * LEG_X - LW, sy * LEG_Y - LW, 0.0), (sx * LEG_X + LW, sy * LEG_Y + LW, TOP_UNDER), 'red', ('+x', '-x', '+y', '-y'))
        p.revolve((sx * LEG_X, sy * LEG_Y, AXLE_Z), 'y', [(0.0, -TYRE_W / 2, 'a-', 'rubber'), (TYRE_R, -TYRE_W / 2, 'r', 'rubber'), (TYRE_R, TYRE_W / 2, 'a+', 'rubber'), (0.0, TYRE_W / 2, 'a+', 'rubber')], 14, lambda k, e: 'rubber')
    for sy in (-1, 1):
        p.box((-FRAME_HALF_LEN, sy * LEG_Y - LW, TOP_UNDER), (FRAME_HALF_LEN, sy * LEG_Y + LW, TOP_OVER), 'red')
        p.box((-FRAME_HALF_LEN, sy * LEG_Y - LW, SILL_Z0), (FRAME_HALF_LEN, sy * LEG_Y + LW, SILL_Z1), 'red', ('+y', '-y', '+z', '+x', '-x'))
    for sx in (-1, 1):
        p.box((sx * LEG_X - LW, -LEG_Y + LW, TOP_UNDER), (sx * LEG_X + LW, LEG_Y - LW, TOP_OVER), 'red', ('+x', '-x', '+z', '-z'))
    p.box((-3.7, -1.6, TOP_OVER), (0.5, 1.6, TOP_OVER + 1.3), 'red')
    p.box((2.1, 0.9, TOP_OVER + 0.1), (4.5, 3.25, TOP_OVER + 2.05), 'glass')
    p.box((PANEL_X0, PANEL_Y0, TOP_OVER), (PANEL_X1, PANEL_Y1, TOP_OVER + PANEL_H), 'red', ('+x', '+z', '+y', '-y'))
    return p


# ---- the asset ---------------------------------------------------------------
def _obj(part, name, material, parent, location=(0, 0, 0)):
    obj = part.m.to_object(name, material, parent)
    obj.location = location
    return obj


def build_lod(root, level, material, plate_material):
    """Builds one LOD subtree; returns {name: triangles} for the meshes, summed in 'total'."""
    suffix = f'@LOD{level}'
    lod = empty(f'LOD{level}', root)
    tris = 0
    parts = {}

    def add(part, name, parent, loc=(0, 0, 0)):
        nonlocal tris
        tris += part.triangles
        parts[name] = part.triangles
        if name == 'frame':
            return _obj(part, name + suffix, material, parent, loc)
        # a rig node: an empty at the mechanical pivot, with its mesh in the child `<name>_geo` (the compression step puts its
        # dequantisation transform on mesh nodes, which must never be rig nodes)
        rig = empty(name + suffix, parent, loc)
        _obj(part, name + '_geo' + suffix, material, rig)
        return rig

    if level == 2:
        add(lod2_mesh(), 'frame', lod)
        # a bare spreader plate keeps the node name for the viewer at rest height
        sp = Part()
        sp.box((-6.0, -1.3, 0), (6.0, 1.3, 0.5), 'red', ('+z', '+x', '-x', '+y', '-y'))
        add(sp, 'spreader', lod, (0, 0, ATTACH_Z))
        return lod, tris, parts

    detail = level
    add(frame_mesh(detail), 'frame', lod)
    plates = plates_mesh()  # fleet-number plates: own material so the renderer can show each SHC's number
    tris += plates.triangles
    parts['plates'] = plates.triangles
    _obj(plates, 'plates' + suffix, plate_material, lod)
    for name, sx, sy in CORNERS:
        pivot = (sx * LEG_X, sy * LEG_Y, AXLE_Z)
        steer = add(steer_mesh(detail), f'steer_{name}', lod, pivot)
        add(wheel_mesh(detail), f'wheel_{name}', steer, (0, 0, 0))
    hoist = add(hoist_mesh(detail), 'hoist', lod, (0, 0, ATTACH_Z))
    spreader = add(spreader_mesh(detail), 'spreader', hoist, (0, 0, 0))
    if level == 0:
        for name, sx, sy in CORNERS:
            add(twistlock_mesh(), f'twistlock_{name}', spreader, (sx * 6.0, sy * 1.138, 0.0))
    return lod, tris, parts


def build_shc(atlas_image, plate_image):
    material = textured_material('shc_atlas', atlas_image, roughness=0.6, metallic=0.1)
    plate_material = textured_material('shc_plate', plate_image, roughness=0.5, metallic=0.1)
    root = empty('shc')
    triangles = {}
    for level in (0, 1, 2):
        _, tris, _ = build_lod(root, level, material, plate_material)
        triangles[f'LOD{level}'] = tris
    return root, {'name': 'shc', 'triangles': triangles}


def hide_lods_for_preview(keep='LOD0'):
    for obj in bpy.data.objects:
        if obj.name.startswith('LOD') and obj.name != keep and obj.type == 'EMPTY':
            stack = [obj]
            while stack:
                o = stack.pop()
                o.hide_render = True
                stack.extend(o.children)
