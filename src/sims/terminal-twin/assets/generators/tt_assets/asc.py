"""Rail-mounted automated stacking crane (ASC) asset, three LODs, rigged (TT-24).

Hierarchy (glTF names; every LOD repeats the rig names, the build step strips
the `@LODn` suffix that keeps Blender's object names unique):
  asc                          root, origin = ground contact at the span centre and the gantry centre
    LOD0 / LOD1 / LOD2
      gantry                   portal on the two rails: legs, sills, rail bogies, head beams, twin box-beam
                               bridge, walkways, ladders, e-house. Translates along the block rails (glTF +Z).
        trolley                trolley frame + hoist machinery on the bridge rails; translates across the rows (+X).
                               Pivot at the top of the bridge rails on the span centre line.
          ropes                (LOD0/1) four rope strands, pivot at the drum level; scaled along Y with the hoist.
          hoist                head block with sheaves and hangers; translates along Y; pivot = the twist-lock
                               plane at rest (raised).
            spreader           telescopic 40 ft spreader (LOD2: no mesh, merged into `hoist`); small float travel
              twistlock_fl|fr|rl|rr   corner twist-locks (LOD0 only)

Blender axes: X = across the rows (trolley travel, = glTF X), Y = along the block rails (gantry travel; glTF Z = -Y),
Z = up (glTF Y). One material, one 1024^2 atlas (swatches, ZPMC wordmark, numbered panels, "40 t", unit number).
All dimensions are [A] approximations of a ZPMC rail-mounted ASC unless the sidecar says otherwise; the 25.4 m
rail span, the 8 rows and the 40 t rating come from the spec (tag V).
"""
import math

import bpy

from .blender import empty, textured_material
from .parts import Atlas, Part as _Part

# ---- dimensions (m) --------------------------------------------------------
SPAN = 25.4                      # rail centre to rail centre
RX = SPAN / 2
ROW_PITCH = 2.9                  # engine ROW_PITCH_M
ROWS = 8
TIER_PITCH = 2.896               # engine TIER_PITCH_M (40 ft HC)
HC_H = 2.896
DESIGN_TIERS = 5
LEG_C = 3.0                      # leg centre offset along the rails
LEG_W, LEG_D = 1.1, 1.0          # leg section (x, y)
SILL_HALF = 4.7                  # sill half length along the rails
SILL_Z0, SILL_Z1 = 0.9, 1.7
BRIDGE_UNDER = 20.0              # underside of the bridge girders
BRIDGE_TOP = 22.2
GIRDER_C = 2.75                  # girder centre offset (two girders)
GIRDER_W = 1.3
HEAD_HALF_Y = 3.7
REST_PLANE = 18.0                # twist-lock plane with the hoist raised
TROLLEY_Z = BRIDGE_TOP           # trolley origin = top of the bridge rails
TROLLEY_HALF_X = 1.4
TROLLEY_TRAVEL = 11.0
ROPE_TOP_Z = BRIDGE_TOP + 0.3    # rope pivot (drum level)
HEADBLOCK_Z0, HEADBLOCK_Z1 = 1.7, 2.3   # relative to the twist-lock plane
ROPE_REST_LEN = ROPE_TOP_Z - (REST_PLANE + HEADBLOCK_Z1)
SPREADER_FLOAT = 0.35
TWIST_DEG = 90
GANTRY_TRAVEL = 200.0
SPREADER_HALF_Y = 6.0
TWIST_X, TWIST_Y = 1.1295, 5.9925    # ISO 1161 casting centres of a 40 ft box (half width / half length)
CORNERS = (('fl', 1, 1), ('fr', 1, -1), ('rl', -1, 1), ('rr', -1, -1))  # name, y sign (front = +Y), x sign
EHOUSE_X = (12.6, 14.4)
TOTAL_HEIGHT = 24.7
WHEEL_R, WHEEL_W = 0.45, 0.3
UNIT_LABEL = 'ASC 12'
SLAT_PITCH = 0.2
SLATS = int((2 * (RX - 0.8)) / SLAT_PITCH)
CAGE_HOOPS = 19

# ---- swatch atlas ----------------------------------------------------------
ATLAS = 1024
CELL = 128
SWATCHES = {
    'blue': '#2b5b98', 'blue_dark': '#17345a', 'blue_light': '#4a82c2', 'steel': '#8b9198',
    'dark': '#2a2d33', 'yellow': '#f2b705', 'zinc': '#a8adb3', 'white': '#f1f1ef',
    'black': '#0d0d0e', 'orange': '#e8641b', 'lens_red': '#d11818', 'amber': '#ffb43a',
    'glass': '#7fa6bb', 'rope': '#4a4d52', 'grey': '#b9bdc2', 'rubber': '#18181a',
}
REGIONS = {
    'zpmc': (0, 512, 1024, 640),       # ZPMC wordmark, white on blue (8:1)
    'panels': (0, 640, 1024, 768),     # eight numbered bridge panel cells, 1..8
    'swl': (0, 768, 512, 896),         # "40 t" safe working load mark (4:1)
    'number': (512, 768, 1024, 896),   # unit number plate (4:1)
    'hazard': (0, 896, 512, 1024),     # yellow/black warning stripes
    'plate': (512, 896, 1024, 1024),   # spec plate
}
ATLAS_SPEC = Atlas(ATLAS, CELL, SWATCHES, REGIONS)
SWATCH_ORDER = ATLAS_SPEC.order


class Part(_Part):
    """The shared Part vocabulary bound to the ASC atlas."""

    def __init__(self):
        super().__init__(ATLAS_SPEC)

    def mbox(self, lo, hi, swatch, faces=('+x', '-x', '+y', '-y', '+z', '-z')):
        """A box and its mirror image across x = 0 (lo/hi given for x >= 0 side)."""
        self.box(lo, hi, swatch, faces)
        mfaces = tuple({'+x': '-x', '-x': '+x'}.get(f, f) for f in faces)
        self.box((-hi[0], lo[1], lo[2]), (-lo[0], hi[1], hi[2]), swatch, mfaces)

    def ybox(self, lo, hi, swatch, faces=('+x', '-x', '+y', '-y', '+z', '-z')):
        """A box and its mirror across y = 0."""
        self.box(lo, hi, swatch, faces)
        mfaces = tuple({'+y': '-y', '-y': '+y'}.get(f, f) for f in faces)
        self.box((lo[0], -hi[1], lo[2]), (hi[0], -lo[1], hi[2]), swatch, mfaces)


# ---- gantry ------------------------------------------------------------------
def wheel_profile(detail):
    r, w = WHEEL_R, WHEEL_W / 2
    if detail == 0:
        return [(0.12, -w, 'a-', 'steel'), (r - 0.04, -w, 'a-', 'dark'), (r, -w + 0.03, 'r', 'dark'), (r, w - 0.03, 'a+', 'dark'),
                (r - 0.04, w, 'a+', 'dark'), (0.12, w, 'a+', 'steel')]
    return [(0.0, -w, 'a-', 'steel'), (r, -w, 'r', 'dark'), (r, w, 'a+', 'dark'), (0.0, w, 'a+', 'steel')]


def gantry_mesh(detail):
    p = Part()
    lw, ld = LEG_W / 2, LEG_D / 2
    z_top = BRIDGE_UNDER
    for sx in (-1, 1):
        cx = sx * RX
        # sill beam and rail bogies
        p.box((cx - 0.5, -SILL_HALF, SILL_Z0), (cx + 0.5, SILL_HALF, SILL_Z1), 'blue_dark')
        for sy in (-1, 1):
            cy = sy * LEG_C
            p.box((cx - 0.42, cy - 1.3, 0.45), (cx + 0.42, cy + 1.3, SILL_Z0), 'dark')               # bogie frame
            wsegs = 33 if detail == 0 else (16 if detail == 1 else 8)
            for dy in (-0.8, 0.8):
                p.revolve((cx, cy + dy, WHEEL_R), 'x', wheel_profile(detail) if detail < 2 else wheel_profile(1), wsegs, lambda k, e: 'dark')
            # leg column
            p.box((cx - lw, cy - ld, SILL_Z1), (cx + lw, cy + ld, z_top), 'blue')
            if detail == 0:
                p.box((cx - lw - 0.08, cy - ld - 0.08, SILL_Z1), (cx + lw + 0.08, cy + ld + 0.08, SILL_Z1 + 0.18), 'steel')   # base flange
                for k in (-1, 0, 1):
                    for g in (-1, 1):
                        for bx, by in ((cx + k * 0.38, cy + g * (ld + 0.04)), (cx + g * (lw + 0.04), cy + k * 0.3)):
                            p.box((bx - 0.05, by - 0.05, SILL_Z1 + 0.18), (bx + 0.05, by + 0.05, SILL_Z1 + 0.25), 'dark')

                for z in (7.0, 13.0, z_top - 1.0):
                    p.box((cx - lw - 0.04, cy - ld - 0.04, z), (cx + lw + 0.04, cy + ld + 0.04, z + 0.1), 'blue_dark')       # collars
                for k in range(6):                                                                                            # stiffener ribs, outer face
                    z = 3.0 + k * 3.2
                    p.box((cx + sx * lw, cy - 0.35, z), (cx + sx * (lw + 0.07), cy + 0.35, z + 0.14), 'blue_dark')
                p.box((cx + sx * lw, cy - 0.06, SILL_Z1 + 0.2), (cx + sx * (lw + 0.05), cy + 0.06, z_top - 0.2), 'blue_dark')
        # X-bracing between the two legs (in the plane of the rails)
        if detail < 2:
            for a, b in (((-LEG_C + ld, 2.4), (LEG_C - ld, 15.5)), ((LEG_C - ld, 2.4), (-LEG_C + ld, 15.5))):
                p.beam((cx, a[0], a[1]), (cx, b[0], b[1]), 0.3, 0.3, 'blue_dark')
            p.beam((cx, -LEG_C + ld, 15.5), (cx, LEG_C - ld, 15.5), 0.35, 0.35, 'blue_dark')
            p.beam((cx, -LEG_C + ld, 2.4), (cx, LEG_C - ld, 2.4), 0.35, 0.35, 'blue_dark')
        # head beam across the leg tops, under the bridge
        p.box((cx - 0.7, -HEAD_HALF_Y, z_top), (cx + 0.7, HEAD_HALF_Y, BRIDGE_TOP), 'blue_dark')
        # buffers and rail sweepers on the sill ends
        for sy in (-1, 1):
            p.box((cx - 0.45, sy * SILL_HALF, SILL_Z0 + 0.1), (cx + 0.45, sy * (SILL_HALF + 0.35), SILL_Z1 - 0.1), 'dark', ('+y', '-y', '+x', '-x', '+z', '-z'))
            if detail == 0:
                p.plate((cx + 0.4 * sy, sy * (SILL_HALF + 0.352), SILL_Z0 + 0.15), (-sy, 0, 0), (0, 0, 1), 0.8, 0.5, 'hazard', normal=(0, sy, 0))
    # twin box-beam bridge across the span
    for sy in (-1, 1):
        gc = sy * GIRDER_C
        p.box((-RX, gc - GIRDER_W / 2, BRIDGE_UNDER), (RX, gc + GIRDER_W / 2, BRIDGE_TOP), 'blue')
        p.box((-RX, gc - 0.07, BRIDGE_TOP), (RX, gc + 0.07, BRIDGE_TOP + 0.14), 'steel')   # trolley rail
    # walkways, handrails, ladders, e-house, branding: close-range detail
    if detail == 0:
        outer = GIRDER_C + GIRDER_W / 2
        for sy in (-1, 1):
            face = sy * outer
            # girder stiffener ribs and bottom flange
            for k in range(-16, 17):
                x = k * 0.725
                p.box((x - 0.07, min(face, face + sy * 0.07), BRIDGE_UNDER + 0.05), (x + 0.07, max(face, face + sy * 0.07), BRIDGE_TOP - 0.05), 'blue_dark', ('+x', '-x', '+y', '-y', '+z', '-z'))
            p.box((-RX, min(face, face + sy * 0.12), BRIDGE_UNDER), (RX, max(face, face + sy * 0.12), BRIDGE_UNDER + 0.1), 'blue_dark')
            # numbered bridge panels (1..8 over the rows) and the ZPMC wordmark
            for r in range(ROWS):
                x = (r - (ROWS - 1) / 2) * ROW_PITCH
                p.plate((x + sy * 0.4, face + sy * 0.07, BRIDGE_UNDER + 0.3), (-sy, 0, 0), (0, 0, 1), 0.8, 0.8, 'panels', normal=(0, sy, 0), cell=(r, ROWS))
            p.plate((sy * 4.2, face + sy * 0.015, BRIDGE_UNDER + 1.25), (-sy, 0, 0), (0, 0, 1), 8.4, 0.85, 'zpmc', normal=(0, sy, 0))
            # walkway with handrails
            y0, y1 = (outer, outer + 0.85) if sy > 0 else (-outer - 0.85, -outer)
            p.box((-RX + 0.7, y0, BRIDGE_TOP - 0.1), (RX - 0.7, y1, BRIDGE_TOP), 'zinc')
            for k in range(21):
                x = -RX + 0.9 + k * 1.1
                p.box((x - 0.03, sy * (outer + 0.82) - 0.03, BRIDGE_TOP), (x + 0.03, sy * (outer + 0.82) + 0.03, BRIDGE_TOP + 1.1), 'yellow')
            for z in (BRIDGE_TOP + 0.55, BRIDGE_TOP + 1.1):
                p.box((-RX + 0.9, sy * (outer + 0.82) - 0.025, z - 0.025), (RX - 0.9, sy * (outer + 0.82) + 0.025, z + 0.025), 'yellow')
            for k in range(SLATS):  # grating bars across the walkway
                x = -RX + 0.8 + k * SLAT_PITCH
                p.box((x - 0.03, y0, BRIDGE_TOP), (x + 0.03, y1 - 0.06, BRIDGE_TOP + 0.04), 'dark', ('+x', '-x', '+z'))
            p.box((-RX + 0.7, min(y0, y1) if sy > 0 else y1 - 0.08, BRIDGE_TOP), (RX - 0.7, (y0 + 0.08) if sy > 0 else y1, BRIDGE_TOP + 0.12), 'zinc', ('+x', '-x', '+y', '-y', '+z'))  # kick plate
        # head beam decks, cable tray along the bridge, e-house on the +X deck
        for sx in (-1, 1):
            x0, x1 = (RX - 0.7, RX + 1.9) if sx > 0 else (-RX - 1.9, -RX + 0.7)
            p.box((x0, -HEAD_HALF_Y, BRIDGE_TOP - 0.1), (x1, HEAD_HALF_Y, BRIDGE_TOP), 'zinc')
        p.box((EHOUSE_X[0], -3.0, BRIDGE_TOP), (EHOUSE_X[1], 3.0, BRIDGE_TOP + 2.4), 'blue_light')
        p.box((EHOUSE_X[0] - 0.08, -3.1, BRIDGE_TOP + 2.4), (EHOUSE_X[1] + 0.08, 3.1, BRIDGE_TOP + 2.5), 'blue_dark')
        for i in range(8):
            y = -2.5 + i * 0.7
            p.box((EHOUSE_X[1], y, BRIDGE_TOP + 0.5), (EHOUSE_X[1] + 0.05, y + 0.4, BRIDGE_TOP + 1.8), 'dark', ('+x',))
        # ladders on two diagonal legs, landings at 8 m and 15 m
        for sx, sy in ((1, 1), (-1, -1)):
            lx, ly = sx * (RX + LEG_W / 2 + 0.14), sy * LEG_C
            for dy in (-0.22, 0.22):
                p.box((lx - 0.025, ly + dy - 0.025, 1.9), (lx + 0.025, ly + dy + 0.025, BRIDGE_TOP + 0.1), 'yellow')
            for i in range(80):
                z = 2.1 + i * 0.25
                p.box((lx - 0.02, ly - 0.22, z - 0.02), (lx + 0.02, ly + 0.22, z + 0.02), 'zinc')
            for k in range(CAGE_HOOPS):  # safety cage hoops
                z = 4.0 + k * 0.95
                ox = lx + sx * 0.62
                p.box((lx, ly - 0.36, z), (ox, ly - 0.3, z + 0.05), 'zinc') if sx > 0 else p.box((ox, ly - 0.36, z), (lx, ly - 0.3, z + 0.05), 'zinc')
                p.box((lx, ly + 0.3, z), (ox, ly + 0.36, z + 0.05), 'zinc') if sx > 0 else p.box((ox, ly + 0.3, z), (lx, ly + 0.36, z + 0.05), 'zinc')
                p.box((min(ox, ox + sx * 0.05), ly - 0.36, z), (max(ox, ox + sx * 0.05), ly + 0.36, z + 0.05), 'zinc')
            for z in (8.0, 15.0):
                p.box((lx - 0.1, ly - 0.75, z - 0.05), (lx + 0.95 * sx, ly + 0.75, z + 0.03), 'zinc')
                p.box((lx + 0.9 * sx - 0.02, ly - 0.75, z + 0.03), (lx + 0.9 * sx + 0.02, ly + 0.75, z + 1.0), 'yellow')
        # branding on the leg faces: unit number and hazard stripes; spec plate on the head beam
        for sx in (-1, 1):
            for sy in (-1, 1):
                cx, cy = sx * RX, sy * LEG_C
            p.plate((sx * (RX + 0.7 + 0.012), -sx * 1.6, 20.5), (0, sx, 0), (0, 0, 1), 3.2, 0.8, 'number', normal=(sx, 0, 0), lift=0.0)
            p.plate((sx * (RX + 0.7 + 0.012), -sx * 1.4, 21.45), (0, sx, 0), (0, 0, 1), 2.8, 0.7, 'plate', normal=(sx, 0, 0), lift=0.0)
        # cabinets between the legs on the +X side, lamps on the head beams
        p.box((RX + 0.55, -2.4, 2.2), (RX + 1.35, 2.4, 5.4), 'blue_light')
        for sx in (-1, 1):
            for sy in (-1, 1):
                p.box((sx * (RX + 0.71), sy * 3.2 - 0.2, BRIDGE_UNDER + 0.4), (sx * (RX + 0.74), sy * 3.2 + 0.2, BRIDGE_UNDER + 0.8), 'amber')
        # cable trays along the inside of both girders, with clamps
        for sy in (-1, 1):
            gi = sy * (GIRDER_C - GIRDER_W / 2)
            p.box((-RX + 0.8, min(gi, gi - sy * 0.3), BRIDGE_UNDER + 0.55), (RX - 0.8, max(gi, gi - sy * 0.3), BRIDGE_UNDER + 0.62), 'zinc')
            for k in range(27):
                x = -RX + 1.0 + k * 0.9
                p.box((x - 0.04, min(gi, gi - sy * 0.3), BRIDGE_UNDER + 0.48), (x + 0.04, max(gi, gi - sy * 0.3), BRIDGE_UNDER + 0.7), 'dark', ('+x', '-x', '-z', '+z'))
        # louvres on the e-house long sides, door on the end
        for sy in (-1, 1):
            for k in range(8):
                x = EHOUSE_X[0] + 0.2 + k * 0.25
                for z in (BRIDGE_TOP + 0.6, BRIDGE_TOP + 1.0, BRIDGE_TOP + 1.4, BRIDGE_TOP + 1.8):
                    p.box((x, sy * 3.0, z), (x + 0.15, sy * 3.0 + sy * 0.04, z + 0.12), 'dark', ('+y' if sy > 0 else '-y', '+x', '-x'))
        p.box((EHOUSE_X[0] - 0.04, -0.6, BRIDGE_TOP), (EHOUSE_X[0], 0.6, BRIDGE_TOP + 2.0), 'dark', ('-x',))
        # leg side ribs and sill ribs
        for sx in (-1, 1):
            for sy in (-1, 1):
                for g in (-1, 1):
                    for k in range(6):
                        z = 3.2 + k * 2.8
                        p.box((sx * RX - 0.3, sy * LEG_C + g * LEG_D / 2 - 0.0, z), (sx * RX + 0.3, sy * LEG_C + g * (LEG_D / 2 + 0.06), z + 0.14), 'blue_dark', ('+x', '-x', '+y', '-y'))
            for k in range(16):
                y = -SILL_HALF + 0.5 + k * 0.6
                p.box((sx * RX - 0.5, y, SILL_Z1), (sx * RX + 0.5, y + 0.08, SILL_Z1 + 0.1), 'blue', ('+x', '-x', '+y', '-y', '+z'))
    else:
        for sx in (-1, 1):
            x0, x1 = (RX - 0.7, RX + 1.9) if sx > 0 else (-RX - 1.9, -RX + 0.7)
            p.box((x0, -HEAD_HALF_Y, BRIDGE_TOP - 0.1), (x1, HEAD_HALF_Y, BRIDGE_TOP), 'zinc')
        p.box((EHOUSE_X[0], -3.0, BRIDGE_TOP), (EHOUSE_X[1], 3.0, BRIDGE_TOP + 2.4), 'blue_light')
        if detail == 1:
            outer = GIRDER_C + GIRDER_W / 2
            for sy in (-1, 1):
                y0, y1 = (outer, outer + 0.85) if sy > 0 else (-outer - 0.85, -outer)
                p.box((-RX + 0.7, y0, BRIDGE_TOP - 0.1), (RX - 0.7, y1, BRIDGE_TOP), 'zinc')
                p.box((-RX + 0.9, sy * (outer + 0.82) - 0.03, BRIDGE_TOP + 1.0), (RX - 0.9, sy * (outer + 0.82) + 0.03, BRIDGE_TOP + 1.1), 'yellow')
                p.plate((sy * 4.2, sy * outer + sy * 0.015, BRIDGE_UNDER + 1.25), (-sy, 0, 0), (0, 0, 1), 8.4, 0.85, 'zpmc', normal=(0, sy, 0))
            for sx, sy in ((1, 1), (-1, -1)):
                lx, ly = sx * (RX + LEG_W / 2 + 0.14), sy * LEG_C
                for dy in (-0.22, 0.22):
                    p.box((lx - 0.025, ly + dy - 0.025, 1.9), (lx + 0.025, ly + dy + 0.025, BRIDGE_TOP + 0.1), 'yellow', ('+x', '-x', '+y', '-y'))
                for i in range(41):
                    z = 2.1 + i * 0.5
                    p.box((lx - 0.02, ly - 0.22, z - 0.02), (lx + 0.02, ly + 0.22, z + 0.02), 'zinc', ('+x' if sx > 0 else '-x', '+z'))
                for z in (8.0, 15.0):
                    p.box((lx - 0.1, ly - 0.75, z - 0.05), (lx + 0.95 * sx, ly + 0.75, z + 0.03), 'zinc')
            outer = GIRDER_C + GIRDER_W / 2
            for sy in (-1, 1):
                face = sy * outer
                for k in range(-8, 9):
                    x = k * 1.45
                    p.box((x - 0.07, min(face, face + sy * 0.07), BRIDGE_UNDER + 0.05), (x + 0.07, max(face, face + sy * 0.07), BRIDGE_TOP - 0.05), 'blue_dark', ('+x', '-x', '+y', '-y'))
                for r in range(ROWS):
                    x = (r - (ROWS - 1) / 2) * ROW_PITCH
                    p.plate((x + sy * 0.4, face + sy * 0.07, BRIDGE_UNDER + 0.3), (-sy, 0, 0), (0, 0, 1), 0.8, 0.8, 'panels', normal=(0, sy, 0), cell=(r, ROWS))
                for k in range(11):
                    x = -RX + 0.9 + k * 2.2
                    p.box((x - 0.03, sy * (outer + 0.82) - 0.03, BRIDGE_TOP), (x + 0.03, sy * (outer + 0.82) + 0.03, BRIDGE_TOP + 1.1), 'yellow', ('+x', '-x', '+y', '-y'))
                p.box((-RX + 0.9, sy * (outer + 0.82) - 0.03, BRIDGE_TOP + 0.5), (RX - 0.9, sy * (outer + 0.82) + 0.03, BRIDGE_TOP + 0.56), 'yellow')
                y0, y1 = (outer, outer + 0.85) if sy > 0 else (-outer - 0.85, -outer)
                for k in range(40):
                    x = -RX + 0.8 + k * 0.6
                    p.box((x - 0.05, y0, BRIDGE_TOP), (x + 0.05, y1 - 0.06, BRIDGE_TOP + 0.04), 'dark', ('+x', '-x', '+z'))
            for sx in (-1, 1):
                for sy in (-1, 1):
                    cx, cy = sx * RX, sy * LEG_C
                    p.box((cx - LEG_W / 2 - 0.08, cy - LEG_D / 2 - 0.08, SILL_Z1), (cx + LEG_W / 2 + 0.08, cy + LEG_D / 2 + 0.08, SILL_Z1 + 0.18), 'steel')
                    for z in (7.0, 13.0, BRIDGE_UNDER - 1.0):
                        p.box((cx - LEG_W / 2 - 0.04, cy - LEG_D / 2 - 0.04, z), (cx + LEG_W / 2 + 0.04, cy + LEG_D / 2 + 0.04, z + 0.1), 'blue_dark')
                for k in range(8):
                    y = -SILL_HALF + 0.6 + k * 1.2
                    p.box((sx * RX - 0.5, y, SILL_Z1), (sx * RX + 0.5, y + 0.1, SILL_Z1 + 0.1), 'blue', ('+x', '-x', '+z'))
                p.plate((sx * (RX + 0.7 + 0.012), -sx * 1.6, 20.5), (0, sx, 0), (0, 0, 1), 3.2, 0.8, 'number', normal=(sx, 0, 0), lift=0.0)
            for k in range(4):
                z = BRIDGE_TOP + 0.5 + k * 0.45
                for sy in (-1, 1):
                    p.box((EHOUSE_X[0] + 0.2, sy * 3.0, z), (EHOUSE_X[1] - 0.2, sy * 3.0 + sy * 0.04, z + 0.2), 'dark', ('+y' if sy > 0 else '-y',))
    return p


# ---- trolley, ropes, hoist, spreader -----------------------------------------
def trolley_mesh(detail):
    """Trolley frame on the bridge rails (origin at the top of the rails on the centre line) and the hoist machinery."""
    p = Part()
    h = TROLLEY_HALF_X
    for sy in (-1, 1):
        # deck either side of the rope opening, wheels on the rails
        p.box((-h, sy * 1.7 if sy > 0 else -3.45, 0.18), (h, 3.45 if sy > 0 else -1.7, 0.5), 'blue_dark')
        for sx in (-1, 1):
            p.revolve((sx * 1.0, sy * GIRDER_C, 0.18 + 0.2), 'y', [(0.0, -0.1, 'a-', 'dark'), (0.2, -0.1, 'r', 'dark'), (0.2, 0.1, 'a+', 'dark'), (0.0, 0.1, 'a+', 'dark')], 14 if detail == 0 else 8, lambda k, e: 'dark')
        # machinery houses with drums and gearboxes
        lo, hi = (1.9, 3.3) if sy > 0 else (-3.3, -1.9)
        p.box((-h + 0.1, lo, 0.5), (h - 0.1, hi, 2.5), 'blue_light')
        p.box((-h + 0.05, lo - 0.05, 2.5), (h - 0.05, hi + 0.05, 2.6), 'blue_dark')
        if detail == 0:
            for i in range(6):
                x = -h + 0.35 + i * 0.5
                p.box((x, sy * (hi if sy > 0 else lo) - (0 if sy > 0 else 0.0) - (0.03 if sy > 0 else -0.0) - 0.0, 0.9), (x + 0.28, sy * (hi if sy > 0 else lo) + (0.03 if sy > 0 else 0.0), 2.2), 'dark', ('+y' if sy > 0 else '-y',))
            p.revolve((0, (lo + hi) / 2, 1.3), 'y', [(0.0, -0.45, 'a-', 'steel'), (0.38, -0.45, 'r', 'steel'), (0.38, 0.45, 'a+', 'steel'), (0.0, 0.45, 'a+', 'steel')], 18, lambda k, e: 'steel')
    for sx in (-1, 1):
        p.box((sx * h - 0.12, -3.45, 0.18), (sx * h + 0.12, 3.45, 0.7), 'blue_dark')   # end beams
    if detail == 1:
        for sy in (-1, 1):
            lo, hi = (1.9, 3.3) if sy > 0 else (-3.3, -1.9)
            for sx in (-1, 1):
                p.revolve((sx * 1.0, hi if sy > 0 else lo, 1.4), 'y',
                          [(0.0, 0.0, 'a-', 'dark'), (0.32, 0.0, 'r', 'dark'), (0.32, sy * 0.45, 'a+', 'dark'), (0.0, sy * 0.45, 'a+', 'dark')], 10, lambda k, e: 'dark')
            for i in range(4):
                x = -h + 0.3 + i * 0.7
                p.box((x, lo + 0.2, 2.6), (x + 0.12, hi - 0.2, 2.78), 'blue_dark')
            for x in (-h + 0.1, h - 0.1):
                for yy in (lo, hi):
                    p.box((x - 0.025, yy - 0.025, 2.6), (x + 0.025, yy + 0.025, 3.2), 'yellow', ('+x', '-x', '+y', '-y'))
    if detail == 0:
        for sy in (-1, 1):
            lo, hi = (1.9, 3.3) if sy > 0 else (-3.3, -1.9)
            for sx in (-1, 1):  # drive motors and brake discs on the long sides of the machinery houses
                p.revolve((sx * 1.0, hi if sy > 0 else lo, 1.4), 'y',
                          [(0.0, 0.0, 'a-', 'dark'), (0.32, 0.0, 'r', 'dark'), (0.32, sy * 0.45, 'a+', 'dark'), (0.0, sy * 0.45, 'a+', 'dark')], 16, lambda k, e: 'dark')
                p.revolve((sx * 1.0, (hi if sy > 0 else lo) + sy * 0.45, 1.4), 'y',
                          [(0.0, 0.0, 'a-', 'steel'), (0.42, 0.0, 'r', 'steel'), (0.42, sy * 0.05, 'a+', 'steel'), (0.0, sy * 0.05, 'a+', 'steel')], 20, lambda k, e: 'steel')
            for i in range(7):  # cooling fins on the house roof
                x = -h + 0.25 + i * 0.35
                p.box((x, lo + 0.2, 2.6), (x + 0.1, hi - 0.2, 2.78), 'blue_dark')
            # hand rail round the machinery roof
            for x in (-h + 0.1, h - 0.1):
                for yy in (lo, hi):
                    p.box((x - 0.025, yy - 0.025, 2.6), (x + 0.025, yy + 0.025, 3.2), 'yellow')
            for yy in (lo + 0.0, hi):
                p.box((-h + 0.1, yy - 0.02, 3.17), (h - 0.1, yy + 0.02, 3.21), 'yellow')
        for k in range(8):  # cable festoon trolleys on the walkway side
            y = 3.45 + 0.0
            p.box((-h + 0.2 + k * 0.3, y, 0.5), (-h + 0.2 + k * 0.3 + 0.12, y + 0.18, 0.9), 'dark')
        # SWL mark and unit number on the long sides, hazard bumpers, anti-sway rails
        for sy in (-1, 1):
            face = sy * 3.3
            p.plate((sy * 1.0, face + sy * 0.012, 1.0), (-sy, 0, 0), (0, 0, 1), 2.0, 0.5, 'swl', normal=(0, sy, 0))
            p.plate((sy * 1.0, face + sy * 0.012, 1.7), (-sy, 0, 0), (0, 0, 1), 2.0, 0.5, 'number', normal=(0, sy, 0))
        for sx in (-1, 1):
            p.plate((sx * (h + 0.12 + 0.012), -sx * 0.9, 0.2), (0, sx, 0), (0, 0, 1), 1.8, 0.45, 'hazard', normal=(sx, 0, 0), lift=0.0)
            for sy in (-1, 1):
                p.box((sx * (h - 0.05) - 0.04, sy * 0.9 - 0.04, 2.6), (sx * (h - 0.05) + 0.04, sy * 0.9 + 0.04, 3.2), 'yellow')
    return p


def ropes_mesh():
    """Four rope strands from the drums down to the head block sheaves; unit-scaled at rest length."""
    p = Part()
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((sx * 0.9 - 0.035, sy * 1.2 - 0.035, -ROPE_REST_LEN), (sx * 0.9 + 0.035, sy * 1.2 + 0.035, 0.0), 'rope', ('+x', '-x', '+y', '-y'))
    return p


def hoist_mesh(detail, with_spreader=False):
    """Head block with sheaves and hangers; origin at the twist-lock plane at rest."""
    p = Part()
    z0, z1 = HEADBLOCK_Z0, HEADBLOCK_Z1
    p.box((-1.2, -1.5, z0), (1.2, 1.5, z1), 'steel')
    if detail < 2:
        for sx in (-1, 1):
            for sy in (-1, 1):
                p.box((sx * 0.8 - 0.08, sy * 1.3 - 0.08, 0.7), (sx * 0.8 + 0.08, sy * 1.3 + 0.08, z0), 'zinc')   # hangers
                p.revolve((sx * 0.9, sy * 1.2, z1 + 0.28), 'y', [(0.0, -0.07, 'a-', 'zinc'), (0.32, -0.07, 'r', 'zinc'), (0.32, 0.07, 'a+', 'zinc'), (0.0, 0.07, 'a+', 'zinc')],
                         18 if detail == 0 else 10, lambda k, e: 'zinc')
        if detail == 0:
            p.box((-1.3, -1.6, z0 - 0.08), (1.3, 1.6, z0), 'blue_dark')
            for sy in (-1, 1):
                p.box((-0.6, sy * 1.5, z0 + 0.05), (0.6, sy * 1.5 + sy * 0.05, z1 - 0.05), 'dark', ('+y' if sy > 0 else '-y',))
    if with_spreader:
        p.box((-1.4, -SPREADER_HALF_Y - 0.3, 0.04), (1.4, SPREADER_HALF_Y + 0.3, 0.7), 'yellow')
    return p


def spreader_mesh(detail):
    """Telescopic 40 ft spreader; origin on the twist-lock plane at the centre. Long axis = Y."""
    p = Part()
    hl = SPREADER_HALF_Y
    for sy in (-1, 1):
        p.box((-1.4, sy * hl - 0.3, 0.04), (1.4, sy * hl + 0.3, 0.5), 'yellow')                 # end beams
        if detail == 0:
            p.box((-1.42, sy * hl - 0.32, 0.0), (-1.1, sy * hl + 0.32, 0.06), 'dark')            # casting guides
            p.box((1.1, sy * hl - 0.32, 0.0), (1.42, sy * hl + 0.32, 0.06), 'dark')
            p.box((-1.0, sy * hl - 0.1, 0.5), (1.0, sy * hl + 0.1, 0.62), 'steel')                # flippers
            p.box((-1.46, sy * hl - 0.2, 0.1), (1.46, sy * hl + 0.2, 0.2), 'black', ('+x', '-x'))
    p.box((-0.9, -3.2, 0.2), (0.9, 3.2, 0.7), 'yellow')                                          # centre housing
    for sx in (-1, 1):
        p.box((sx * 0.5 - 0.12, -hl, 0.28), (sx * 0.5 + 0.12, hl, 0.52), 'steel')                # telescopic tubes
        if detail == 0:
            for sy in (-1, 1):
                p.box((sx * 0.5 - 0.16, sy * 3.2 - 0.06, 0.24), (sx * 0.5 + 0.16, sy * 3.2 + 0.06, 0.56), 'dark')
    if detail == 1:
        for sy in (-1, 1):
            for sx in (-1, 1):
                p.box((sx * 1.25 - 0.12, sy * (hl - 0.9) - 0.12, 0.5), (sx * 1.25 + 0.12, sy * (hl - 0.9) + 0.12, 0.8), 'black')
                p.box((sx * 1.42 - 0.02, sy * hl - 0.32, 0.0), (sx * 1.42 + 0.02, sy * hl + 0.32, 0.06), 'dark')
            p.box((-1.0, sy * hl - 0.1, 0.5), (1.0, sy * hl + 0.1, 0.62), 'steel')
        p.box((-0.5, -0.6, 0.7), (0.5, 0.6, 1.0), 'dark')
    if detail == 0:
        p.box((-0.5, -0.6, 0.7), (0.5, 0.6, 1.0), 'dark')
        for sy in (-1, 1):
            for sx in (-1, 1):
                p.box((sx * 1.25 - 0.12, sy * (hl - 0.9) - 0.12, 0.5), (sx * 1.25 + 0.12, sy * (hl - 0.9) + 0.12, 0.8), 'black')   # flipper cylinders
                p.beam((sx * 1.25, sy * (hl - 0.9), 0.8), (sx * 1.0, sy * (hl - 0.5), 0.55), 0.06, 0.06, 'zinc')
            p.box((-0.35, sy * (hl + 0.3), 0.1), (0.35, sy * (hl + 0.3) + sy * 0.05, 0.4), 'amber', ('+y' if sy > 0 else '-y',))
        for k in range(5):
            y = -2.8 + k * 1.4
            p.box((-0.92, y, 0.25), (0.92, y + 0.1, 0.68), 'blue_dark', ('+x', '-x', '+y', '-y'))
    return p


def twistlock_mesh():
    p = Part()
    p.revolve((0, 0, 0), 'z', [(0.045, -0.06, 'r', 'dark'), (0.045, 0.06, 'a+', 'dark'), (0.0, 0.06, 'a+', 'dark')], 8, lambda k, e: 'dark')
    p.box((-0.03, -0.07, -0.08), (0.03, 0.07, -0.04), 'steel')
    return p


def lod2_gantry():
    p = Part()
    for sx in (-1, 1):
        cx = sx * RX
        p.box((cx - 0.5, -SILL_HALF, SILL_Z0), (cx + 0.5, SILL_HALF, SILL_Z1), 'blue_dark', ('+x', '-x', '+y', '-y', '+z'))
        for sy in (-1, 1):
            p.box((cx - LEG_W / 2, sy * LEG_C - LEG_D / 2, SILL_Z1), (cx + LEG_W / 2, sy * LEG_C + LEG_D / 2, BRIDGE_UNDER), 'blue', ('+x', '-x', '+y', '-y'))
        p.box((cx - 0.7, -HEAD_HALF_Y, BRIDGE_UNDER), (cx + 0.7, HEAD_HALF_Y, BRIDGE_TOP), 'blue_dark', ('+x', '-x', '+y', '-y', '+z'))
    for sy in (-1, 1):
        gc = sy * GIRDER_C
        p.box((-RX, gc - GIRDER_W / 2, BRIDGE_UNDER), (RX, gc + GIRDER_W / 2, BRIDGE_TOP), 'blue', ('+y', '-y', '+z', '-z'))
    p.box((EHOUSE_X[0], -3.0, BRIDGE_TOP), (EHOUSE_X[1], 3.0, BRIDGE_TOP + 2.4), 'blue_light', ('+x', '-x', '+y', '-y', '+z'))
    for sx in (-1, 1):
        cx = sx * RX
        p.beam((cx, -LEG_C, 2.4), (cx, LEG_C, 15.5), 0.3, 0.3, 'blue_dark')
        p.beam((cx, LEG_C, 2.4), (cx, -LEG_C, 15.5), 0.3, 0.3, 'blue_dark')
        for sy in (-1, 1):
            p.revolve((cx, sy * LEG_C, WHEEL_R), 'x', wheel_profile(1), 6, lambda k, e: 'dark')
            p.box((cx - LEG_W / 2 - 0.08, sy * LEG_C - LEG_D / 2 - 0.08, SILL_Z1), (cx + LEG_W / 2 + 0.08, sy * LEG_C + LEG_D / 2 + 0.08, SILL_Z1 + 0.18), 'steel', ('+x', '-x', '+y', '-y'))
            p.box((cx - 0.42, sy * LEG_C - 1.3, 0.45), (cx + 0.42, sy * LEG_C + 1.3, SILL_Z0), 'dark', ('+x', '-x', '+y', '-y'))
            p.box((cx - LEG_W / 2 - 0.04, sy * LEG_C - LEG_D / 2 - 0.04, 13.0), (cx + LEG_W / 2 + 0.04, sy * LEG_C + LEG_D / 2 + 0.04, 13.1), 'blue_dark', ('+x', '-x', '+y', '-y'))
    outer = GIRDER_C + GIRDER_W / 2
    for sy in (-1, 1):
        y0, y1 = (outer, outer + 0.85) if sy > 0 else (-outer - 0.85, -outer)
        p.box((-RX + 0.7, y0, BRIDGE_TOP - 0.1), (RX - 0.7, y1, BRIDGE_TOP), 'zinc', ('+z', '+y', '-y'))
        p.box((-RX + 0.9, sy * (outer + 0.82) - 0.03, BRIDGE_TOP + 1.0), (RX - 0.9, sy * (outer + 0.82) + 0.03, BRIDGE_TOP + 1.1), 'yellow', ('+y', '-y', '+z'))
        p.plate((sy * 4.2, sy * outer + sy * 0.015, BRIDGE_UNDER + 1.25), (-sy, 0, 0), (0, 0, 1), 8.4, 0.85, 'zpmc', normal=(0, sy, 0))
    return p


def lod2_trolley():
    p = Part()
    h = TROLLEY_HALF_X
    for sy in (-1, 1):
        lo, hi = (1.9, 3.3) if sy > 0 else (-3.3, -1.9)
        p.box((-h, lo, 0.18), (h, hi, 2.6), 'blue_light', ('+x', '-x', '+y', '-y', '+z'))
        for x in (-h + 0.1, h - 0.1):
            p.box((x - 0.025, hi - 0.025, 2.6), (x + 0.025, hi + 0.025, 3.2), 'yellow', ('+x', '-x', '+y', '-y'))
    for sx in (-1, 1):
        p.box((sx * h - 0.12, -3.45, 0.18), (sx * h + 0.12, 3.45, 0.7), 'blue_dark', ('+x', '-x', '+y', '-y'))
    return p


def lod2_hoist():
    p = Part()
    p.box((-1.2, -1.5, HEADBLOCK_Z0), (1.2, 1.5, HEADBLOCK_Z1), 'steel', ('+x', '-x', '+y', '-y', '+z'))
    p.box((-1.4, -SPREADER_HALF_Y - 0.3, 0.04), (1.4, SPREADER_HALF_Y + 0.3, 0.7), 'yellow', ('+x', '-x', '+y', '-y', '+z', '-z'))
    p.box((-0.04, -1.2, 0.7), (0.04, 1.2, HEADBLOCK_Z0), 'rope', ('+x', '-x'))
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.revolve((sx * 0.9, sy * 1.2, HEADBLOCK_Z1 + 0.28), 'y', [(0.0, -0.07, 'a-', 'zinc'), (0.32, -0.07, 'r', 'zinc'), (0.32, 0.07, 'a+', 'zinc'), (0.0, 0.07, 'a+', 'zinc')], 6, lambda k, e: 'zinc')
    return p


# ---- the asset ---------------------------------------------------------------
def _obj(part, name, material, parent, location=(0, 0, 0)):
    obj = part.m.to_object(name, material, parent)
    obj.location = location
    return obj


def build_lod(root, level, material):
    """Builds one LOD subtree; returns (lod empty, triangles, {node: triangles})."""
    suffix = f'@LOD{level}'
    lod = empty(f'LOD{level}', root)
    tris = 0
    parts = {}

    def add(part, name, parent, loc=(0, 0, 0)):
        nonlocal tris
        tris += part.triangles
        parts[name] = part.triangles
        return _obj(part, name + suffix, material, parent, loc)

    def node(name, parent, loc):
        return empty(name + suffix, parent, loc)

    if level == 2:
        gantry = add(lod2_gantry(), 'gantry', lod)
        trolley = add(lod2_trolley(), 'trolley', gantry, (0, 0, TROLLEY_Z))
        hoist = add(lod2_hoist(), 'hoist', trolley, (0, 0, REST_PLANE - TROLLEY_Z))
        node('spreader', hoist, (0, 0, 0))
        return lod, tris, parts

    gantry = add(gantry_mesh(level), 'gantry', lod)
    trolley = add(trolley_mesh(level), 'trolley', gantry, (0, 0, TROLLEY_Z))
    add(ropes_mesh(), 'ropes', trolley, (0, 0, ROPE_TOP_Z - TROLLEY_Z))
    hoist = add(hoist_mesh(level), 'hoist', trolley, (0, 0, REST_PLANE - TROLLEY_Z))
    spreader = add(spreader_mesh(level), 'spreader', hoist, (0, 0, 0))
    if level == 0:
        for name, sy, sx in CORNERS:
            add(twistlock_mesh(), f'twistlock_{name}', spreader, (sx * TWIST_X, sy * TWIST_Y, 0.0))
    return lod, tris, parts


def build_asc(atlas_image):
    material = textured_material('asc_atlas', atlas_image, roughness=0.6, metallic=0.1)
    root = empty('asc')
    triangles = {}
    for level in (0, 1, 2):
        _, tris, _ = build_lod(root, level, material)
        triangles[f'LOD{level}'] = tris
    return root, {'name': 'asc', 'triangles': triangles}
