"""Container-ship hulls for the five vessel size classes (Feeder -> ULCV), each
with three LODs, built on the engine's bay grid.

The class table (LOA, beam, bays, rows, tiers, deck height) and the bay-plan
pitches come from `scenario/vesselClasses.ts`: `pnpm run tt:assets` writes them
to a JSON file and passes `--vessel-classes`. So the hatch covers, lashing
bridges and the `bay_grid` marker sit exactly where the engine puts the slots.

Hierarchy (glTF names):
  vessel-<class>          root; origin = stern (aft end of LOA), centreline, waterline
    LOD0                  ~10-20k triangles
      hull                hull (lofted, bulbous bow, transom), deck, topside band,
                          wordmark decals, breakwater, accommodation, bridge and
                          wings, funnel, lifeboats, mooring gear, anchors
      hatch_covers        coamings + hatch-cover pontoons, one hatch per 40 ft bay
      lashing_bridges     between bays, 1-3 levels by deck tiers
    LOD1                  ~2-5k
      hull_lod1
    LOD2                  <800
      hull_lod2
    bay_grid              empty at the bay-grid origin (aft edge of bay 0,
                          quay-side edge of row 0, deck-stack base)

Blender axes: X = length (stern 0 -> bow +X), Y = beam (row 0 at -Y), Z = up (0 = waterline).
glTF axes:    X = length, Y = up, Z = beam (row 0 at +Z = the quay side).
One material (`vessel_livery`, the vessel livery atlas); every UV is authored
for atlas tile 0 and the renderer shifts it to the vessel's line.
"""
import math

from .blender import MeshBuilder, empty, textured_material
from . import vessel_liveries as VL

# [A] Design draft per class (m): keel below the waterline.
DRAFT_M = {'feeder': 8.0, 'feedermax': 9.5, 'panamax': 12.0, 'neo-panamax': 15.2, 'ulcv': 16.0}
COVER_T = 0.5            # hatch-cover thickness = engine's hold offset under the deck stack
COAMING_M = 1.7          # main deck below the coaming top
FORECASTLE_RISE = 2.6
HATCH_GAP = 1.4          # between hatch covers of adjacent bays (lashing bridge)
LASHING_W = 1.0
DECAL_OFFSET = 0.03      # hull plating sits this far inside the beam; decals sit on the beam line


def smoothstep(a, b, x):
    if b <= a:
        return 1.0 if x >= b else 0.0
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


class Hull:
    """Derived dimensions and the hull's shape functions for one class."""

    def __init__(self, key, cls, grid):
        self.key = key
        self.L = cls['loaM']
        self.B = cls['beamM']
        self.HB = self.B / 2
        self.bays, self.rows = cls['bays'], cls['rows']
        self.hold_tiers, self.deck_tiers = cls['holdTiers'], cls['deckTiers']
        self.BP, self.RP, self.TP = grid['bayPitchM'], grid['rowPitchM'], grid['tierPitchM']
        self.half_offset = grid['halfOffsetM']
        self.q = grid['quayAboveWaterM']
        self.T = DRAFT_M[key]
        self.gx0 = self.L - self.bays * self.BP - grid['bowM']       # aft edge of bay 0
        self.gx1 = self.gx0 + self.bays * self.BP                    # fore edge of the last bay
        self.rows_half = self.rows * self.RP / 2
        self.zH = cls['deckHeightM'] + self.q                        # deck-stack base (hatch top)
        self.hold_top = self.zH - COVER_T
        self.zD = self.hold_top - COAMING_M                          # main deck
        self.zF = self.zD + FORECASTLE_RISE                          # forecastle deck
        self.hold_bottom = self.hold_top - self.hold_tiers * self.TP
        self.band = min(3.5, max(1.5, 0.16 * self.zD))               # topside band under the deck edge
        self.lash_levels = 1 if self.deck_tiers <= 4 else 2 if self.deck_tiers <= 7 else 3
        self.z_bridge = self.zH + self.deck_tiers * self.TP + 2.0    # wheelhouse floor: sees over the stack
        self.bilge_r = min(2.5, 0.08 * self.B)

    # --- shape ---------------------------------------------------------
    def z_top(self, x):
        return self.zD + (self.zF - self.zD) * smoothstep(self.gx1 + 1.5, self.gx1 + 4.5, x)

    def stem_x(self, z):
        """Forward end of the hull at height z (raked stem, bulbous bow, forefoot)."""
        L, T = self.L, self.T
        top = self.zF
        if z >= 0:
            base = L - 6.0 * (1 - min(1.0, z / top)) ** 1.5
        else:
            base = L - 6.0 - 4.0 * min(1.0, -z / T)
        zb, rb = -0.55 * T, 0.27 * T
        d = (z - zb) / rb
        if abs(d) < 1:
            base = max(base, L - 2.5 - 7.0 * (1 - math.sqrt(1 - d * d)))
        return base

    def stern_start(self, z):
        """Aft end of the hull at height z (transom above, cut-up for the propeller below)."""
        cut = -0.3 * self.T
        if z >= cut:
            return 0.0
        return (cut - z) / (self.T + cut) * 0.07 * self.L

    def plan_half(self, x, z):
        """Half-breadth of the hull outline at x for height z (before depth shaping)."""
        HB = self.HB
        b = HB * (0.84 + 0.16 * smoothstep(0, min(self.gx0, 30) * 0.8, x))
        lead = self.stem_x(z)
        if x > self.gx1:
            u = (x - self.gx1) / max(1e-6, lead - self.gx1)
            b *= math.sqrt(max(0.0, 1 - min(1.0, u) ** 2.2)) if u < 1 else 0.0
        start = self.stern_start(z)
        if start > 0:
            b *= math.sqrt(smoothstep(start, start + 0.06 * self.L, x))
        return b

    def half_breadth(self, x, z):
        T = self.T
        h = z + T
        r = self.bilge_r
        g = 1.0 if h >= r else (self.HB - r + math.sqrt(max(0.0, r * r - (r - h) ** 2))) / self.HB
        top = self.z_top(x)
        v = max(0.0, min(1.0, h / (top + T))) ** 0.8
        fine = min(1 - smoothstep(self.gx1 - 2 * self.BP, self.L, x) ** 0.7, smoothstep(0, self.gx0 + 0.5 * self.BP, x))
        w = self.plan_half(x, z) * g * (fine + (1 - fine) * v)
        # Hold stacks stay inside the hull for the whole bay grid.
        if self.gx0 - 0.5 <= x <= self.gx1 + 0.5 and z >= self.hold_bottom - 0.5:
            w = max(w, self.rows_half + 0.3)
        return min(w, self.HB - DECAL_OFFSET)

    def stations(self, lod):
        """Hull sections, aft to fore, as ('stern', q) | ('x', x) | ('bow', q). Stern and bow
        sections follow each height's own stern / stem line (`section_x`), so the run and the
        stem close cleanly; parallel mid-body sections are plain x positions."""
        step_stern, step_bow, mid = {0: (1.6, 1.0, 8), 1: (3.5, 2.0, 3), 2: (9.0, 5.0, 1)}[lod]
        a = self.stern_end
        b = self.gx1 - 2 * self.BP
        out = []
        n = max(1, math.ceil(a / step_stern))
        out += [('stern', i / n) for i in range(n)]
        xs = [a + (b - a) * i / (mid + 1) for i in range(mid + 2)]
        n = max(1, math.ceil((self.gx1 - b) / (2 * step_bow)))
        xs += [b + (self.gx1 - b) * i / n for i in range(1, n)]
        out += [('x', round(x, 5)) for x in xs]
        n = max(2, math.ceil((self.L - self.gx1) / step_bow))
        out += [('bow', i / n) for i in range(n + 1)]
        return out

    @property
    def stern_end(self):
        return self.gx0 + 0.5 * self.BP

    def section_x(self, station, z):
        kind, v = station
        if kind == 'x':
            return v
        if kind == 'bow':
            return self.gx1 + v * (self.stem_x(z) - self.gx1)
        start = self.stern_start(z)
        return start + v * (self.stern_end - start)

    def deck_x(self, station):
        kind, v = station
        if kind == 'x':
            return v
        if kind == 'bow':
            return self.gx1 + v * (self.L - self.gx1)
        return v * self.stern_end


# --- helpers ---------------------------------------------------------------

def sw(name):
    return VL.swatch_uv(name)


def box(m, lo, hi, swatch, faces=('+x', '-x', '+y', '-y', '+z')):
    uv = sw(swatch)
    m.box_faces(lo, hi, list(faces), lambda f, pts: [uv] * 4)


def window_band(m, x0, x1, y, z0, z1, side):
    """Glass band on a ±Y face (`side` = +1 / -1)."""
    uv = sw('glass')
    yy = y + side * 0.03
    m.quad([(x0, yy, z0), (x1, yy, z0), (x1, yy, z1), (x0, yy, z1)], [uv] * 4, outward=(0, side, 0))


def window_band_x(m, x, y0, y1, z0, z1, side):
    uv = sw('glass')
    xx = x + side * 0.03
    m.quad([(xx, y0, z0), (xx, y1, z0), (xx, y1, z1), (xx, y0, z1)], [uv] * 4, outward=(side, 0, 0))


# --- hull -------------------------------------------------------------------

def build_hull_surface(h, lod, m):
    stations = h.stations(lod)
    n_low = {0: 20, 1: 10, 2: 5}[lod]
    n_band = {0: 2, 1: 1, 2: 1}[lod]
    # Depth samples: denser at the bilge and towards the waterline.
    s_low = [(1 - math.cos(math.pi * i / n_low)) / 2 if lod < 2 else i / n_low for i in range(n_low + 1)]
    low, band, xs = [], [], []

    def point(st, z):
        x = h.section_x(st, z)
        return (x, -h.half_breadth(x, z), z)

    for st in stations:
        xd = h.deck_x(st)
        xs.append(xd)
        top = h.z_top(xd)
        band_bottom = top - h.band
        zs = [-h.T + s * (band_bottom + h.T) for s in s_low]
        low.append([point(st, z) for z in zs])
        zb = [band_bottom + (top - band_bottom) * i / n_band for i in range(n_band + 1)]
        band.append([point(st, z) for z in zb])

    def mirror(rings):
        return [[(x, -y, z) for (x, y, z) in ring] for ring in rings]

    hull_uv = lambda p: VL.hull_uv(p[2])  # noqa: E731
    top_uv = lambda p: sw('topside')  # noqa: E731
    # A grid's faces point -Y (quay side); the +Y side is the mirror image with the winding flipped.
    m.grid(low, hull_uv)
    m.grid(mirror(low), hull_uv, flip=True)
    m.grid(band, top_uv)
    m.grid(mirror(band), top_uv, flip=True)
    # Flat bottom, transom, deck.
    red = VL.hull_uv(-h.T)
    for i in range(len(xs) - 1):
        a, b = low[i][0], low[i + 1][0]
        m.quad([a, b, (b[0], -b[1], b[2]), (a[0], -a[1], a[2])], [red] * 4, outward=(0, 0, -1))
    stern = low[0] + band[0][1:]
    for j in range(len(stern) - 1):
        p, q = stern[j], stern[j + 1]
        if abs(p[1]) < 1e-4 and abs(q[1]) < 1e-4:
            continue
        uv = [VL.hull_uv(p[2]), VL.hull_uv(q[2]), VL.hull_uv(q[2]), VL.hull_uv(p[2])]
        if j >= len(low[0]) - 1:
            uv = [sw('topside')] * 4
        m.quad([p, q, (q[0], -q[1], q[2]), (p[0], -p[1], p[2])], uv, outward=(-1, 0, 0))
    deck_uv = sw('deck')
    for i in range(len(xs) - 1):
        a, b = band[i][-1], band[i + 1][-1]
        m.quad([a, b, (b[0], -b[1], b[2]), (a[0], -a[1], a[2])], [deck_uv] * 4, outward=(0, 0, 1))
    return xs


def build_railings(h, m, xs):
    """LOD0: deck-edge railings (posts + top rail) on the main deck, and a solid
    bulwark around the forecastle."""
    uv_rail = sw('light')
    for side in (-1, 1):
        # Bulwark: inner face of the hull side extended 1.2 m up over the forecastle.
        bow = [x for x in xs if x >= h.gx1 + 4.5]
        for a, b in zip(bow, bow[1:]):
            za, zb = h.z_top(a), h.z_top(b)
            ya, yb = side * h.half_breadth(a, za - 1e-3), side * h.half_breadth(b, zb - 1e-3)
            quad = [(a, ya, za), (b, yb, zb), (b, yb, zb + 1.2), (a, ya, za + 1.2)]
            m.quad(quad, [sw('topside')] * 4, outward=(0, side, 0))
            m.quad(quad, [sw('white')] * 4, outward=(0, -side, 0))
            m.quad([(a, ya, za + 1.2), (b, yb, zb + 1.2), (b, yb * 0.985, zb + 1.2), (a, ya * 0.985, za + 1.2)], [uv_rail] * 4,
                   outward=(0, 0, 1))
        # Railing posts every ~3 m along the main deck, from the stern to the forecastle.
        n = max(2, round((h.gx1 + 1.5) / 3.0))
        for i in range(n + 1):
            x = (h.gx1 + 1.5) * i / n
            z = h.z_top(x)
            y = side * (h.half_breadth(x, z - 1e-3) - 0.15)
            box(m, (x - 0.04, y - 0.04, z), (x + 0.04, y + 0.04, z + 1.1), 'light', faces=('+x', '-x', '+y', '-y'))
        y = side * (h.HB - DECAL_OFFSET - 0.15)
        box(m, (h.gx0 - 2, y - 0.03, h.zD + 1.05), (h.gx1 + 1.5, y + 0.03, h.zD + 1.12), 'light', faces=('+y', '-y', '+z', '-z'))


def build_wordmarks(h, m):
    """Hull-side wordmark decals (both sides), on the parallel mid-body."""
    aspect = VL.wordmark_aspect()
    span = h.bays * h.BP
    hw = min(12.0, max(2.5, 0.6 * (h.zD - h.band - 3.0)), 0.6 * span / aspect)
    ww = hw * aspect
    cx = h.gx0 + 0.52 * span
    z1 = h.zD - h.band - 0.5
    z0 = z1 - hw
    u0, v0, u1, v1 = VL.region_uv_rect('wordmark')
    x0, x1 = cx - ww / 2, cx + ww / 2
    y = h.HB
    # Quay side (-Y) reads along +X; sea side (+Y) along -X.
    m.quad([(x0, -y, z0), (x1, -y, z0), (x1, -y, z1), (x0, -y, z1)], [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], outward=(0, -1, 0))
    m.quad([(x1, y, z0), (x0, y, z0), (x0, y, z1), (x1, y, z1)], [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], outward=(0, 1, 0))
    return {'centreX': cx, 'widthM': ww, 'heightM': hw, 'z0': z0}


def build_breakwater(h, m, lod):
    """V-shaped breakwater on the forecastle, ahead of the first deck tiers (two plates, 0.25 m thick)."""
    x = h.gx1 + 2.2
    ht = min(2, h.deck_tiers) * h.TP
    yw = h.rows_half + 0.2
    z0, z1 = h.zF, h.zF + ht
    uv = sw('light')
    tip = x + 3.0
    for side in (-1, 1):
        for off, out_sign in ((0.0, 1), (-0.25, -1)):
            a, b = (x + off, side * yw), (tip + off, 0.0)
            pts = [(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)]
            m.quad(pts, [uv] * 4, outward=(out_sign, out_sign * side * 0.3, 0))
        if lod == 0:
            m.quad([(x, side * yw, z1), (tip, 0.0, z1), (tip - 0.25, 0.0, z1), (x - 0.25, side * yw, z1)], [uv] * 4, outward=(0, 0, 1))


def build_superstructure(h, m, lod):
    """Accommodation (stepped), wheelhouse with wings, mast, funnel, lifeboats."""
    L_acc = min(16.0, max(8.0, 0.4 * h.gx0))
    hx1 = h.gx0 - 1.5
    hx0 = hx1 - L_acc
    zD, zb = h.zD, h.z_bridge
    z_mid = zD + (zb - zD) * 0.5
    w_low = h.HB - 2.0
    w_up = h.HB - 4.5
    box(m, (hx0, -w_low, zD), (hx1, w_low, z_mid), 'white')
    box(m, (hx0 + 1.5, -w_up, z_mid), (hx1, w_up, zb), 'white')
    # Wheelhouse at the front of the house, wings across the beam.
    wh0 = hx1 - 6.0
    box(m, (wh0, -w_up, zb), (hx1, w_up, zb + 3.2), 'white')
    if lod < 2:
        box(m, (hx1 - 4.0, -(h.HB - 0.05), zb - 0.4), (hx1, h.HB - 0.05, zb), 'white', faces=('+x', '-x', '+y', '-y', '+z', '-z'))
        window_band_x(m, hx1, -w_up + 0.3, w_up - 0.3, zb + 1.2, zb + 2.6, 1)
        for side in (-1, 1):
            window_band(m, wh0 + 0.4, hx1 - 0.4, side * w_up, zb + 1.2, zb + 2.6, side)
        # Mast and radar on the monkey island.
        mx = wh0 + 2.5
        box(m, (mx - 0.25, -0.25, zb + 3.2), (mx + 0.25, 0.25, zb + 9.0), 'light')
        box(m, (mx - 0.15, -2.2, zb + 7.4), (mx + 0.15, 2.2, zb + 7.7), 'light')
    if lod == 0:
        decks = max(3, round((zb - zD) / 2.8))
        dh = (zb - zD) / decks
        for i in range(decks):
            z0 = zD + i * dh + dh * 0.45
            z1 = z0 + dh * 0.32
            upper = z0 >= z_mid
            half = w_up if upper else w_low
            window_band_x(m, hx1, -half + 0.6, half - 0.6, z0, z1, 1)
            for side in (-1, 1):
                window_band(m, (hx0 + 1.5 if upper else hx0) + 0.6, hx1 - 0.6, side * half, z0, z1, side)
        # Davit lifeboats on the lower block's roof, outboard of the upper block.
        for side in (-1, 1):
            y0, y1 = sorted((side * (w_up + 0.2), side * (w_up + 2.3)))
            box(m, (hx0 + 2.5, y0, z_mid), (hx0 + 9.0, y1, z_mid + 2.2), 'lifeboat', faces=('+x', '-x', '+y', '-y', '+z'))
    # Funnel just aft of the house.
    fl = min(9.0, max(4.0, 0.16 * h.B))
    fw = fl * 0.7
    fc = max(fl / 2 + 1.5, hx0 - fl / 2 - 2.0)
    build_funnel(h, m, lod, fc, fl, fw, zD, zb + 4.5)
    return {'house': (hx0, hx1), 'wheelhouseTop': zb + 3.2, 'mastTop': zb + 9.0, 'funnel': (fc, fl, fw)}


def build_funnel(h, m, lod, cx, fl, fw, z0, z1):
    sides = {0: 12, 1: 8, 2: 4}[lod]
    u0, v0, u1, v1 = VL.region_uv_rect('funnel')
    taper = 0.9

    def pt(a, z):
        t = (z - z0) / (z1 - z0)
        s = 1 - (1 - taper) * t
        return (cx + s * fl / 2 * math.cos(a) - 0.6 * t, s * fw / 2 * math.sin(a), z)

    for k in range(sides):
        a0 = 2 * math.pi * k / sides + (math.pi / sides if sides == 4 else 0)
        a1 = a0 + 2 * math.pi / sides
        ua = u0 + (u1 - u0) * (k / sides)
        ub = u0 + (u1 - u0) * ((k + 1) / sides)
        if sides == 4:
            ua, ub = u0 + (u1 - u0) * ((k + 0.5) / sides - 0.125), u0 + (u1 - u0) * ((k + 1.5) / sides - 0.125)
        mid_a = (a0 + a1) / 2
        m.quad([pt(a0, z0), pt(a1, z0), pt(a1, z1), pt(a0, z1)], [(ua, v0), (ub, v0), (ub, v1), (ua, v1)],
               outward=(math.cos(mid_a), math.sin(mid_a), 0))
    m.quad([pt(2 * math.pi * k / sides + (math.pi / sides if sides == 4 else 0), z1) for k in range(sides)], [sw('soot')] * sides,
           outward=(0, 0, 1))
    if lod == 0:
        for dy in (-0.25 * fw, 0.25 * fw):
            m.cylinder((cx - 0.6, dy, z1), 0.35, 1.6, 8, sw('machinery'), caps=True)


def bollard_pair(m, x, y, z, segments):
    for dx in (-0.45, 0.45):
        m.cylinder((x + dx, y, z), 0.28, 0.75, segments, sw('machinery'))


def winch(m, x, y, z, lod):
    box(m, (x - 1.0, y - 0.9, z), (x + 1.0, y + 0.9, z + 1.1), 'machinery')
    if lod == 0:
        for dy in (-1.6, 1.0):
            m.cylinder((x, y + dy, z + 0.9), 0.75, 0.6, 12, sw('rope'), axis='y')


def build_mooring(h, m, lod):
    """Windlasses, winches and bollards fore and aft; anchors in the hawse. Returns attach points."""
    seg = 8
    points = []
    zF, zD = h.zF, h.zD
    for i, x in enumerate((h.L - 9.0, h.L - 15.0, h.gx1 + 6.5)):
        for side, label in ((-1, 'quay'), (1, 'sea')):
            y = side * max(1.0, h.half_breadth(x, zF - 0.01) - 1.4)
            bollard_pair(m, x, y, zF, seg)
            points.append((f'bollard_fwd_{i + 1}_{label}', (x, y, zF + 0.75)))
    for side in (-1, 1):
        winch(m, h.L - 13.0, side * 0.3 * h.HB, zF, lod)
        winch(m, h.gx1 + 9.0, side * 0.55 * h.HB, zF, lod)
        winch(m, 5.0, side * 0.45 * h.HB, zD, lod)
    for i, x in enumerate((1.6, 7.5)):
        for side, label in ((-1, 'quay'), (1, 'sea')):
            y = side * max(1.0, h.half_breadth(x, zD - 0.01) - 1.4)
            bollard_pair(m, x, y, zD, seg)
            points.append((f'bollard_aft_{i + 1}_{label}', (x, y, zD + 0.75)))
    # Anchors housed in the hawse pockets on both bow flanks.
    xa = h.L - 10.0
    za = zF - 4.0
    for side in (-1, 1):
        y = side * (h.half_breadth(xa, za) + 0.05)
        y0, y1 = sorted((y, y + side * 0.45))
        box(m, (xa - 1.2, y0, za - 1.4), (xa + 1.2, y1, za + 1.2), 'machinery', faces=('+x', '-x', '+y', '-y', '+z', '-z'))
    return points


def build_hatches(h, m, lod):
    """Coamings and hatch-cover pontoons; cover tops = the deck-stack base."""
    yw = h.rows_half + 0.25
    panels = max(1, round(h.rows / 6))
    gap = 0.06
    for bay in range(h.bays):
        x0 = h.gx0 + bay * h.BP + HATCH_GAP / 2
        x1 = x0 + h.BP - HATCH_GAP
        if lod == 0:
            box(m, (x0 + 0.1, -(yw - 0.1), h.zD), (x1 - 0.1, yw - 0.1, h.hold_top), 'hatch', faces=('+x', '-x', '+y', '-y'))
        for p in range(panels):
            ya = -yw + 2 * yw * p / panels + (gap / 2 if p > 0 else 0)
            yb = -yw + 2 * yw * (p + 1) / panels - (gap / 2 if p < panels - 1 else 0)
            box(m, (x0, ya, h.hold_top if lod == 0 else h.zD), (x1, yb, h.zH), 'hatch')


def build_lashing_bridges(h, m, lod):
    yw = h.rows_half + 0.1
    top = h.zH + h.lash_levels * h.TP
    for k in range(1, h.bays):
        x = h.gx0 + k * h.BP
        x0, x1 = x - LASHING_W / 2, x + LASHING_W / 2
        if lod > 0:
            posts = max(2, round(h.rows / 8)) + 1
            for i in range(posts):
                y = -yw + 2 * yw * i / (posts - 1)
                box(m, (x0, y - 0.2, h.zD), (x1, y + 0.2, top - 1.0), 'lashing', faces=('+x', '-x', '+y', '-y', '+z'))
            for lvl in range(1, h.lash_levels + 1):
                z = h.zH + lvl * h.TP - 1.0
                box(m, (x0, -yw, z - 0.2), (x1, yw, z), 'lashing', faces=('+x', '-x', '+z', '-z'))
            continue
        posts = max(2, round(h.rows / 2)) + 1
        for i in range(posts):
            y = -yw + 2 * yw * i / (posts - 1)
            box(m, (x0, y - 0.15, h.zD), (x1, y + 0.15, top - 1.0), 'lashing', faces=('+x', '-x', '+y', '-y', '+z'))
        for lvl in range(1, h.lash_levels + 1):
            z = h.zH + lvl * h.TP - 1.0
            box(m, (x0, -yw, z - 0.15), (x1, yw, z), 'lashing', faces=('+x', '-x', '+y', '-y', '+z', '-z'))
            box(m, (x0 + 0.05, -yw, z + 0.95), (x0 + 0.12, yw, z + 1.0), 'lashing', faces=('+x', '-x', '+z', '-z'))


def nameboards(h):
    """Name boards (centre, outward normal, max width, letter height): bow flanks on the flat
    side just aft of the bow, below the topside band, and on the transom."""
    hh = min(2.8, max(1.2, 0.1 * h.zD))
    wmax = min(30.0, 0.25 * h.L)
    xb = h.gx1 - 2.0 - wmax / 2
    zb = h.zD - h.band - 0.4 - hh / 2
    stern_w = h.half_breadth(0.0, zb) * 1.4
    return [
        ('nameboard_bow_quay', (xb, -h.HB, zb), (0, -1, 0), wmax, hh),
        ('nameboard_bow_sea', (xb, h.HB, zb), (0, 1, 0), wmax, hh),
        ('nameboard_stern', (-0.03, 0.0, zb), (-1, 0, 0), stern_w, hh),
    ]


# --- assembly ---------------------------------------------------------------

def gl(p):
    """Blender (x, y, z) -> glTF (x, z, -y), rounded to 0.1 mm."""
    x, y, z = p
    return [round(x, 4), round(z, 4), round(-y + 0.0, 4)]


def build_vessel(key, cls, grid, atlas_image):
    h = Hull(key, cls, grid)
    name = f'vessel-{key}'
    mat = textured_material('vessel_livery', atlas_image, roughness=0.62)
    # Single-sided: bulwark and breakwater plates have separate inner/outer faces.
    mat.use_backface_culling = True
    root = empty(name)
    tris = {}
    info = {}

    # LOD0: hull (+ everything except covers and bridges), hatch_covers, lashing_bridges.
    lod0 = empty('LOD0', root)
    hull = MeshBuilder()
    xs0 = build_hull_surface(h, 0, hull)
    build_railings(h, hull, xs0)
    info['wordmark'] = build_wordmarks(h, hull)
    build_breakwater(h, hull, 0)
    info['superstructure'] = build_superstructure(h, hull, 0)
    mooring = build_mooring(h, hull, 0)
    hatch = MeshBuilder()
    build_hatches(h, hatch, 0)
    lash = MeshBuilder()
    build_lashing_bridges(h, lash, 0)
    hull.to_object('hull', mat, lod0)
    hatch.to_object('hatch_covers', mat, lod0)
    lash.to_object('lashing_bridges', mat, lod0)
    tris['LOD0'] = hull.triangles + hatch.triangles + lash.triangles

    for lod in (1, 2):
        parent = empty(f'LOD{lod}', root)
        m = MeshBuilder()
        build_hull_surface(h, lod, m)
        build_wordmarks(h, m)
        build_breakwater(h, m, lod)
        build_superstructure(h, m, lod)
        if lod == 1:
            for side in (-1, 1):
                winch(m, h.L - 13.0, side * 0.3 * h.HB, h.zF, 1)
                winch(m, 5.0, side * 0.45 * h.HB, h.zD, 1)
            build_hatches(h, m, 1)
            build_lashing_bridges(h, m, 1)
        else:
            yw = h.rows_half + 0.25
            box(m, (h.gx0 + HATCH_GAP / 2, -yw, h.zD), (h.gx1 - HATCH_GAP / 2, yw, h.zH), 'hatch')
        m.to_object(f'hull_lod{lod}', mat, parent)
        tris[f'LOD{lod}'] = m.triangles

    origin = (h.gx0, -h.rows_half, h.zH)   # Blender: row 0 at -Y
    empty('bay_grid', root, location=origin)
    info.update({'hull': h, 'triangles': tris, 'mooring': mooring, 'origin': origin, 'name': name})
    return root, info


def sidecar(key, cls, grid, info):
    h = info['hull']
    s = info['superstructure']
    attach = [{'name': n, 'position': gl(p), 'tag': 'A'} for n, p in info['mooring']]
    for n, p, normal, w, hh in nameboards(h):
        attach.append({'name': n, 'position': gl(p), 'normal': gl(normal), 'widthM': round(w, 3), 'heightM': round(hh, 3),
                       'tag': 'A', 'description': 'runtime name board: the renderer draws the vessel name here'})
    origin = gl(info['origin'])
    return {
        'asset': info['name'],
        'kind': 'vessel',
        'sizeClass': key,
        'label': cls['label'],
        'version': 1,
        'generator': 'src/sims/terminal-twin/assets/generators/build.py --only vessels',
        'units': 'm',
        'dimensions': {
            'loaM': h.L, 'beamM': h.B, 'draftM': h.T,
            'depthM': round(h.zD + h.T, 3),
            'airDraftM': round(s['mastTop'], 3),
            'tag': 'A', 'source': 'scenario/vesselClasses.ts (LOA, beam); draft per class [A]',
        },
        'axes': {
            'up': '+Y',
            'length': '+X (stern at x = 0, bow at x = LOA)',
            'width': '+Z is the quay side (row 0); rows run towards -Z',
            'origin': 'stern (aft end of LOA), on the centreline, on the waterline',
            'handedness': 'right-handed, glTF',
        },
        'waterline': {'y': 0, 'quayLevelAboveWaterlineM': h.q, 'tag': 'A',
                      'description': 'the twin places the waterline this far below quay level (y = 0)'},
        'bayGrid': {
            'origin': origin,
            'holdTopY': round(h.hold_top, 4),
            'bays': h.bays, 'rows': h.rows, 'holdTiers': h.hold_tiers, 'deckTiers': h.deck_tiers,
            'bayPitchM': h.BP, 'rowPitchM': h.RP, 'tierPitchM': h.TP, 'halfOffsetM': h.half_offset,
            'axes': {'bay': '+X', 'row': '-Z', 'tier': '+Y'},
            'description': 'origin = aft edge of bay 0, quay-side edge of row 0, deck-stack base (hatch-cover top); '
                           'deck tier t stacks from origin.y + (t - holdTiers) * tierPitch, hold tier t from '
                           'holdTopY - (holdTiers - t) * tierPitch; same grid as scenario/vesselClasses.ts',
        },
        'nodes': [
            {'name': 'LOD0', 'parent': info['name'], 'role': 'lod', 'description': 'detailed, near the camera'},
            {'name': 'hull', 'parent': 'LOD0', 'role': 'mesh',
             'description': 'hull, deck, wordmarks, breakwater, accommodation, bridge, funnel, lifeboats, mooring gear, anchors'},
            {'name': 'hatch_covers', 'parent': 'LOD0', 'role': 'mesh', 'description': 'coamings and hatch-cover pontoons, one hatch per 40 ft bay'},
            {'name': 'lashing_bridges', 'parent': 'LOD0', 'role': 'mesh', 'description': f'{h.lash_levels}-level lashing bridges between bays'},
            {'name': 'LOD1', 'parent': info['name'], 'role': 'lod', 'description': 'mid distance'},
            {'name': 'hull_lod1', 'parent': 'LOD1', 'role': 'mesh', 'description': 'everything merged, simplified'},
            {'name': 'LOD2', 'parent': info['name'], 'role': 'lod', 'description': 'far / anchorage'},
            {'name': 'hull_lod2', 'parent': 'LOD2', 'role': 'mesh', 'description': 'silhouette'},
            {'name': 'bay_grid', 'parent': info['name'], 'role': 'marker', 'description': 'bay-grid origin (see bayGrid)'},
        ],
        'travelLimits': {},
        'attachPoints': attach,
        'groundContact': {'y': 0, 'description': 'floats: y = 0 is the waterline', 'tag': 'A'},
        'lods': {k: {'triangles': v, 'material': 'vessel_livery'} for k, v in info['triangles'].items()},
        'liveries': {
            'atlas': 'vessel-livery-atlas.json',
            'uv': 'TEXCOORD_0 is authored for atlas tile 0 (HMM); offset by the tile of the vessel\'s line',
            'wordmark': {k: round(v, 3) for k, v in info['wordmark'].items()},
        },
        'provenance': [
            {'fact': f'LOA {h.L} m, beam {h.B} m, {h.bays} bays x {h.rows} rows x {h.hold_tiers}+{h.deck_tiers} tiers', 'tag': 'A',
             'source': 'scenario/vesselClasses.ts'},
            {'fact': 'bay grid (pitches, aft offset, row margins, tier heights) is the engine bay plan', 'tag': 'V',
             'source': 'scenario/vesselClasses.ts slotX/slotZ/tierBaseY'},
            {'fact': f'draft {h.T} m, bilge radius, bulbous bow, raked stem and transom stern', 'tag': 'A'},
            {'fact': 'aft accommodation and funnel (the bay grid leaves no room for a forward bridge)', 'tag': 'M',
             'reason': 'the engine bay plan is contiguous from the aft offset to 20 m from the bow'},
            {'fact': 'wheelhouse floor 2 m above the top of a full deck stack (line of sight)', 'tag': 'A'},
            {'fact': 'hatch covers 0.5 m thick, coaming 1.7 m, 1.4 m gap between hatches for lashing bridges', 'tag': 'A'},
            {'fact': 'hull form does not narrow inside the bay grid', 'tag': 'M', 'reason': 'every bay has the full row count in the engine'},
            {'fact': 'line hull colours, funnel marks, wordmarks', 'tag': 'A', 'source': 'vessel-livery-atlas.json'},
            {'fact': 'vessel names are drawn at runtime on the name boards (attachPoints nameboard_*)', 'tag': 'A'},
        ],
    }
