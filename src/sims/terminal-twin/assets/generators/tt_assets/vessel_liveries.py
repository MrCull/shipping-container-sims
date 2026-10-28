"""Vessel hull livery atlas: one tile per shipping line (same order as the
container atlas, see liveries.LIVERIES), plus a generic tile.

Each tile holds (pixel rects, origin at the tile's top-left):
  wordmark  hull-side wordmark on the hull colour (a decal quad on each side)
  hull      vertical strip: antifouling below the waterline, boot-top band,
            hull colour above; v maps to height above the waterline
            (HULL_Z_MIN..HULL_Z_MAX m) so every class shares it
  funnel    funnel casing: colour, bands and the funnel mark, wrapped around
            the funnel (u = 0.25 and 0.75 are the port and starboard faces)
  swatches  flat colours for everything else (superstructure, deck, hatch
            covers, lashing bridges, glass, lifeboat, winches, ...); `topside`
            is the band under the deck edge (white on two-tone hulls, else the hull colour)

Hull geometry UVs are authored for tile 0; the renderer shifts them to the
vessel's line tile, exactly like the container atlas. Colours, wordmarks and
funnel marks are approximations [A] of each line's fleet livery; names and
marks are drawn in open-licence typefaces, no official artwork.
"""
import math

import bpy

from .blender import hex_to_linear
from .liveries import LIVERIES, _Canvas, shade

ATLAS_SIZE = 2048
TILE_COLS = 2
TILE_ROWS = 6
TILE_W = ATLAS_SIZE // TILE_COLS          # 1024
TILE_H = ATLAS_SIZE / TILE_ROWS           # 341.33

REGIONS = {
    'wordmark': (8, 8, 1016, 150),
    'hull': (8, 162, 48, 333),
    'funnel': (108, 162, 428, 333),
}
SWATCH = 36
SWATCH_ORIGIN = (440, 166)
SWATCH_COLS = 12
SWATCH_NAMES = ['white', 'deck', 'hatch', 'steel', 'lashing', 'glass', 'lifeboat', 'machinery', 'red', 'hull',
                'soot', 'light', 'boot', 'topside', 'funnel', 'mark', 'yellow', 'rope']

# Hull strip height mapping (m above the waterline).
HULL_Z_MIN = -20.0
HULL_Z_MAX = 36.0
BOOT_TOP = (-1.2, 1.6)   # [A] boot-top band around the design waterline
ANTIFOULING = '#8c2f2f'
BOOT = '#24272b'

# [A] Per-line hull liveries. `hull` hull colour, `text` wordmark colour,
# `topside` optional colour of the band under the deck edge,
# funnel: colour, band(s) and mark. Order follows liveries.LIVERIES.
HULLS = {
    'HMM': {'hull': '#1f3260', 'text': '#ffffff', 'wordmark_accent': '#f47b20',
            'funnel': '#f47b20', 'funnel_bands': [('#ffffff', 0.62, 0.66)], 'mark': 'HMM', 'mark_colour': '#ffffff',
            'hatch': '#5f6b7a', 'deck': '#6a7a5c'},
    'MSC': {'hull': '#1c1c1e', 'text': '#ffffff',
            'funnel': '#f2c200', 'funnel_bands': [], 'mark': 'MSC', 'mark_colour': '#1c1c1e', 'mark_font': 'LibreBaskerville-Bold.ttf',
            'hatch': '#4d5560', 'deck': '#5f6b52'},
    'Maersk': {'hull': '#3a93c3', 'text': '#ffffff',
               'funnel': '#3a93c3', 'funnel_bands': [], 'mark': '*star', 'mark_colour': '#ffffff',
               'hatch': '#3a93c3', 'deck': '#7d4a3a'},
    'CMA CGM': {'hull': '#16306b', 'text': '#ffffff', 'topside': '#f4f5f6',
                'funnel': '#16306b', 'funnel_bands': [('#e2001a', 0.3, 0.36), ('#ffffff', 0.36, 0.4)], 'mark': 'CMA CGM', 'mark_colour': '#ffffff',
                'hatch': '#56606c', 'deck': '#6a7a5c'},
    'Hapag-Lloyd': {'hull': '#0d2b52', 'text': '#ffffff',
                    'funnel': '#ef7d00', 'funnel_bands': [('#0d2b52', 0.72, 0.8)], 'mark': 'HL', 'mark_colour': '#0d2b52',
                    'hatch': '#ef7d00', 'deck': '#6a7a5c'},
    'ONE': {'hull': '#c4006f', 'text': '#ffffff',
            'funnel': '#c4006f', 'funnel_bands': [], 'mark': 'ONE', 'mark_colour': '#ffffff',
            'hatch': '#c4006f', 'deck': '#5f6b52'},
    'Evergreen': {'hull': '#00733a', 'text': '#ffffff',
                  'funnel': '#f4f5f6', 'funnel_bands': [], 'mark': '*ring', 'mark_colour': '#00733a',
                  'hatch': '#00733a', 'deck': '#7d4a3a'},
    'COSCO': {'hull': '#1d4f91', 'text': '#ffffff',
              'funnel': '#1d4f91', 'funnel_bands': [('#e2001a', 0.66, 0.74)], 'mark': 'COSCO', 'mark_colour': '#ffffff',
              'hatch': '#56606c', 'deck': '#6a7a5c'},
    'ZIM': {'hull': '#1d2a5e', 'text': '#ffffff',
            'funnel': '#f4f5f6', 'funnel_bands': [('#1d2a5e', 0.82, 0.9)], 'mark': 'ZIM', 'mark_colour': '#1d2a5e',
            'hatch': '#5f6b7a', 'deck': '#6a7a5c'},
    'Yang Ming': {'hull': '#2b2f36', 'text': '#ffffff',
                  'funnel': '#f2c318', 'funnel_bands': [], 'mark': 'YM', 'mark_colour': '#1d1d1b',
                  'hatch': '#56606c', 'deck': '#6a7a5c'},
    None: {'hull': '#45556b', 'text': '#ffffff',
           'funnel': '#1f2328', 'funnel_bands': [('#f4f5f6', 0.6, 0.68)], 'mark': '', 'mark_colour': '#ffffff',
           'hatch': '#5f6b7a', 'deck': '#6a7a5c'},
}

COMMON_SWATCHES = {
    'white': '#eef0f2', 'steel': '#8e979f', 'lashing': '#c8ccd0', 'glass': '#1b2633', 'lifeboat': '#f26b1d',
    'machinery': '#2f3438', 'red': ANTIFOULING, 'soot': '#151719', 'light': '#c9ced3', 'boot': BOOT,
    'yellow': '#e5b80b', 'rope': '#d8c9a3',
}


def tile_origin(index):
    return (index % TILE_COLS) * TILE_W, (index // TILE_COLS) * TILE_H


def _uv(px, py):
    """Atlas pixel (origin top-left) -> Blender UV (v up)."""
    return px / ATLAS_SIZE, 1 - py / ATLAS_SIZE


def region_uv_rect(name, index=0):
    ox, oy = tile_origin(index)
    x0, y0, x1, y1 = REGIONS[name]
    u0, v1 = _uv(ox + x0, oy + y0)
    u1, v0 = _uv(ox + x1, oy + y1)
    return u0, v0, u1, v1


def swatch_rect(name, index=0):
    i = SWATCH_NAMES.index(name)
    ox, oy = tile_origin(index)
    x0 = SWATCH_ORIGIN[0] + (i % SWATCH_COLS) * (SWATCH + 6)
    y0 = SWATCH_ORIGIN[1] + (i // SWATCH_COLS) * (SWATCH + 6)
    return ox + x0, oy + y0, ox + x0 + SWATCH, oy + y0 + SWATCH


def swatch_uv(name, index=0):
    x0, y0, x1, y1 = swatch_rect(name, index)
    return _uv((x0 + x1) / 2, (y0 + y1) / 2)


def hull_uv(z):
    """UV on the hull strip for a point `z` m above the waterline."""
    u0, v0, u1, v1 = region_uv_rect('hull')
    t = min(1.0, max(0.0, (z - HULL_Z_MIN) / (HULL_Z_MAX - HULL_Z_MIN)))
    return (u0 + u1) / 2, v0 + t * (v1 - v0)


def wordmark_aspect():
    x0, y0, x1, y1 = REGIONS['wordmark']
    return (x1 - x0) / (y1 - y0)


def _livery(line):
    return HULLS.get(line, HULLS[None])


def _swatch_colour(name, h):
    if name in COMMON_SWATCHES:
        return COMMON_SWATCHES[name]
    return {
        'deck': h['deck'], 'hatch': h['hatch'], 'hull': h['hull'], 'topside': h.get('topside') or h['hull'],
        'funnel': h['funnel'], 'mark': h['mark_colour'],
    }[name]


def _polygon(canvas, points, colour):
    z = canvas._next_z()
    mesh = bpy.data.meshes.new('poly')
    mesh.from_pydata([(x, -y, z) for x, y in points], [], [tuple(range(len(points)))])
    mesh.materials.append(canvas._mat(colour))
    obj = bpy.data.objects.new('poly', mesh)
    bpy.context.scene.collection.objects.link(obj)


def _star(canvas, cx, cy, r, colour, points=7):
    """Seven-pointed star (Maersk-style funnel mark [A])."""
    pts = []
    for k in range(points * 2):
        a = -math.pi / 2 + k * math.pi / points
        rr = r if k % 2 == 0 else r * 0.45
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    _polygon(canvas, pts, colour)


def _ring(canvas, cx, cy, r, colour, bg, n=32):
    circle = lambda rad: [(cx + rad * math.cos(2 * math.pi * k / n), cy + rad * math.sin(2 * math.pi * k / n)) for k in range(n)]  # noqa: E731
    _polygon(canvas, circle(r), colour)
    _polygon(canvas, circle(r * 0.72), bg)
    _polygon(canvas, circle(r * 0.42), colour)


def _hull_strip(canvas, ox, oy, h):
    x0, y0, x1, y1 = REGIONS['hull']

    def y_of(z):
        t = (z - HULL_Z_MIN) / (HULL_Z_MAX - HULL_Z_MIN)
        return oy + y1 - t * (y1 - y0)

    canvas.rect(ox + x0, oy + y0, ox + x1, oy + y1, h['hull'])
    canvas.rect(ox + x0, y_of(BOOT_TOP[0]), ox + x1, oy + y1, ANTIFOULING)
    canvas.rect(ox + x0, y_of(BOOT_TOP[1]), ox + x1, y_of(BOOT_TOP[0]), BOOT)


def _draw_tile(canvas, index, base):
    ox, oy = tile_origin(index)
    h = _livery(base['line'])
    canvas.rect(ox, oy, ox + TILE_W, oy + TILE_H, '#808080')
    # Wordmark decal: the line's wordmark (container-atlas typeface) on the hull colour.
    x0, y0, x1, y1 = REGIONS['wordmark']
    w, hh = x1 - x0, y1 - y0
    canvas.rect(ox + x0, oy + y0, ox + x1, oy + y1, h['hull'])
    if base['wordmark']:
        canvas.text(base['wordmark'], base['font'], h['text'], ox + x0 + w / 2, oy + y0 + hh / 2,
                    w * 0.9, hh * 0.8, base['spacing'], base['shear'])
    if h.get('wordmark_accent'):
        canvas.rect(ox + x0 + w * 0.2, oy + y0 + hh * 0.91, ox + x1 - w * 0.2, oy + y0 + hh * 0.95, h['wordmark_accent'])
    _hull_strip(canvas, ox, oy, h)
    # Funnel: colour, bands (fractions of the height from the top), mark on both side faces.
    x0, y0, x1, y1 = REGIONS['funnel']
    w, hh = x1 - x0, y1 - y0
    canvas.rect(ox + x0, oy + y0, ox + x1, oy + y1, h['funnel'])
    canvas.rect(ox + x0, oy + y0, ox + x1, oy + y0 + hh * 0.07, COMMON_SWATCHES['soot'])
    for colour, a, b in h['funnel_bands']:
        canvas.rect(ox + x0, oy + y0 + hh * a, ox + x1, oy + y0 + hh * b, colour)
    for fu in (0.25, 0.75):
        cx, cy = ox + x0 + w * fu, oy + y0 + hh * 0.38
        mark = h['mark']
        if mark == '*star':
            _star(canvas, cx, cy, hh * 0.2, h['mark_colour'])
        elif mark == '*ring':
            _ring(canvas, cx, cy, hh * 0.2, h['mark_colour'], h['funnel'])
        elif mark:
            canvas.text(mark, h.get('mark_font', 'Archivo-ExtraBold.ttf'), h['mark_colour'], cx, cy, w * 0.22, hh * 0.2)
    for name in SWATCH_NAMES:
        canvas.rect(*swatch_rect(name, index), _swatch_colour(name, h))


def manifest():
    return {
        'image': 'embedded in each vessel GLB (material vessel_livery baseColorTexture)',
        'size': [ATLAS_SIZE, ATLAS_SIZE],
        'tileCols': TILE_COLS,
        'tileRows': TILE_ROWS,
        'tileSizeUv': [TILE_W / ATLAS_SIZE, TILE_H / ATLAS_SIZE],
        'uvConvention': 'glTF TEXCOORD_0 is authored for tile 0; add (index % tileCols, floor(index / tileCols)) * tileSizeUv per vessel',
        'genericIndex': len(LIVERIES) - 1,
        'liveries': [
            {'index': i, 'line': l['line'], 'hull': _livery(l['line'])['hull'], 'funnel': _livery(l['line'])['funnel'],
             'wordmark': l['wordmark'], 'tag': 'A'}
            for i, l in enumerate(LIVERIES)
        ],
        'regions': {k: list(v) for k, v in REGIONS.items()},
        'hullStripM': [HULL_Z_MIN, HULL_Z_MAX],
        'provenance': [
            {'fact': 'hull, boot-top, funnel colours and funnel marks approximate each line\'s fleet livery', 'tag': 'A'},
            {'fact': 'hull-side wordmarks reuse the container atlas wordmark typefaces (open licence)', 'tag': 'A'},
            {'fact': 'no official logo artwork; the Maersk-style star and Evergreen-style ring are simple geometric marks', 'tag': 'M'},
        ],
    }


def render_atlas(path, fonts_dir, samples=16):
    """Renders the vessel livery atlas PNG (Cycles, emission only, orthographic)."""
    from .blender import reset_scene
    scene = reset_scene()
    canvas = _Canvas(fonts_dir)
    canvas.rect(0, 0, ATLAS_SIZE, ATLAS_SIZE, '#808080')
    for i, base in enumerate(LIVERIES):
        _draw_tile(canvas, i, base)
    cam = bpy.data.objects.new('atlas-camera', bpy.data.cameras.new('atlas-camera'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = ATLAS_SIZE
    cam.data.clip_start = 0.1
    cam.data.clip_end = 100
    cam.location = (ATLAS_SIZE / 2, -ATLAS_SIZE / 2, 50)
    scene.collection.objects.link(cam)
    scene.camera = cam
    world = bpy.data.worlds.new('none')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = hex_to_linear('#000000')
    scene.world = world
    scene.render.resolution_x = ATLAS_SIZE
    scene.render.resolution_y = ATLAS_SIZE
    scene.render.resolution_percentage = 100
    scene.cycles.samples = samples
    scene.cycles.max_bounces = 0
    scene.cycles.filter_width = 1.2
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.color_depth = '8'
    scene.render.image_settings.compression = 90
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


__all__ = ['render_atlas', 'manifest', 'region_uv_rect', 'swatch_uv', 'hull_uv', 'wordmark_aspect', 'shade']
