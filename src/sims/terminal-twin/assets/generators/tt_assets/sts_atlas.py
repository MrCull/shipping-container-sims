"""STS paint and branding atlas (1024 x 1024 px).

Regions (pixel rects, origin top-left):
  palette        16 flat swatches of 64 px in one row: steel blue, shaded blue,
                 white, galvanised grey, dark, spreader yellow, buffer red,
                 lamp, beacon amber, window glass
  tti_on_blue    TTI ALGECIRAS in white on blue (main girder outer faces)
  zpmc_on_white  ZPMC in blue on white (builder plates on the legs)
  tti_on_white   TTI over ALGECIRAS in blue on white, two lines (machinery house)
  plates         crane-number plates 101..124: 6 columns x 4 rows; plate
                 faces are UV-mapped to tile 0 and the renderer shifts the UVs
                 by the crane's index (like the container livery tiles)

The wordmarks are text in an open-licence typeface (TT-124): the operator's
name as painted on the TTI Algeciras cranes [P] and the builder's name [A].
No logo artwork.
"""
import bpy

from .blender import hex_to_linear
from .liveries import _Canvas

ATLAS_SIZE = 1024
SWATCH = 64
PALETTE = {
    'blue': '#2150b0',        # [P] TTI cobalt blue steelwork
    'blue_dark': '#183b86',   # shaded blue (undersides, stiffeners)
    'white': '#eef1f4',       # [P] machinery house, trolley, headblock
    'grey': '#a9b0b8',        # galvanised walkways, handrails, wheels
    'dark': '#24282e',        # ropes, cables, rubber, glass frames
    'yellow': '#f2b705',      # [P] spreader
    'red': '#c0392b',         # buffers, warning bands
    'lamp': '#fff1c2',        # floodlight lenses
    'amber': '#ffa000',       # [P] gantry-alarm beacons
    'glass': '#2b3a47',       # cab and house windows
}
PALETTE_ORDER = list(PALETTE)
WORDMARK = 'ZPMC'
OPERATOR_NAME = 'TTI ALGECIRAS'
WORDMARK_FONT = 'Archivo-ExtraBold.ttf'
ZPMC_BLUE = '#2150b0'
REGIONS = {
    'tti_on_blue': (0, 64, 1024, 192),      # 8:1
    'zpmc_on_white': (0, 192, 1024, 448),   # 4:1
    'tti_on_white': (0, 448, 512, 640),     # 8:3, two lines
}
PLATE_COLS = 6
PLATE_ROWS = 4
PLATE_FIRST = 101                      # [V] TTI numbers its cranes STS 101-108
PLATE_COUNT = PLATE_COLS * PLATE_ROWS  # 101..124 (the setup dialog allows up to 24 STS)
PLATE_TOP = 640
PLATE_W = ATLAS_SIZE / PLATE_COLS
PLATE_H = (ATLAS_SIZE - PLATE_TOP) / PLATE_ROWS


def _uv_rect(x0, y0, x1, y1, inset=0.0):
    s = ATLAS_SIZE
    return (x0 + inset) / s, 1 - (y1 - inset) / s, (x1 - inset) / s, 1 - (y0 + inset) / s


def palette_uv(name):
    i = PALETTE_ORDER.index(name)
    return ((i + 0.5) * SWATCH / ATLAS_SIZE, 1 - (SWATCH / 2) / ATLAS_SIZE)


def region_uv(name):
    return _uv_rect(*REGIONS[name], inset=2)


def plate_tile_rect(index):
    col, row = index % PLATE_COLS, index // PLATE_COLS
    x0 = col * PLATE_W
    y0 = PLATE_TOP + row * PLATE_H
    return x0, y0, x0 + PLATE_W, y0 + PLATE_H


def plate_uv():
    """UV rect of plate tile 0 (crane 101); the renderer offsets it per crane."""
    return _uv_rect(*plate_tile_rect(0), inset=3)


def manifest():
    return {
        'size': [ATLAS_SIZE, ATLAS_SIZE],
        'palette': {k: {'colour': v, 'tag': 'A' if k not in ('blue', 'white', 'yellow', 'amber') else 'P'} for k, v in PALETTE.items()},
        'wordmark': WORDMARK,
        'operator': OPERATOR_NAME,
        'plates': {
            'first': PLATE_FIRST,
            'count': PLATE_COUNT,
            'cols': PLATE_COLS,
            'rows': PLATE_ROWS,
            'tileSizeUv': [PLATE_W / ATLAS_SIZE, PLATE_H / ATLAS_SIZE],
            'material': 'sts_plate',
            'uvConvention': 'TEXCOORD_0 of material sts_plate is authored for tile 0 (crane 101); add (index % cols, floor(index / cols)) * tileSizeUv',
        },
    }


def render_atlas(path, fonts_dir, samples=16):
    """Renders the STS atlas PNG (Cycles, emission only, orthographic)."""
    from .blender import reset_scene
    scene = reset_scene()
    c = _Canvas(fonts_dir)
    c.rect(0, 0, ATLAS_SIZE, ATLAS_SIZE, '#808080')
    for i, name in enumerate(PALETTE_ORDER):
        c.rect(i * SWATCH, 0, (i + 1) * SWATCH, SWATCH, PALETTE[name])
    x0, y0, x1, y1 = REGIONS['tti_on_blue']
    c.rect(x0, y0, x1, y1, PALETTE['blue'])
    c.text(OPERATOR_NAME, WORDMARK_FONT, '#ffffff', (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.94, (y1 - y0) * 0.7, spacing=1.08)
    x0, y0, x1, y1 = REGIONS['zpmc_on_white']
    c.rect(x0, y0, x1, y1, PALETTE['white'])
    c.text(WORDMARK, WORDMARK_FONT, ZPMC_BLUE, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.82, (y1 - y0) * 0.7, spacing=1.08)
    x0, y0, x1, y1 = REGIONS['tti_on_white']
    c.rect(x0, y0, x1, y1, PALETTE['white'])
    c.text('TTI', WORDMARK_FONT, ZPMC_BLUE, (x0 + x1) / 2, y0 + (y1 - y0) * 0.34, (x1 - x0) * 0.5, (y1 - y0) * 0.5, spacing=1.1)
    c.text('ALGECIRAS', WORDMARK_FONT, ZPMC_BLUE, (x0 + x1) / 2, y0 + (y1 - y0) * 0.76, (x1 - x0) * 0.86, (y1 - y0) * 0.26, spacing=1.08)
    for i in range(PLATE_COUNT):
        x0, y0, x1, y1 = plate_tile_rect(i)
        c.rect(x0, y0, x1, y1, '#1b2a4a')
        c.rect(x0 + 7, y0 + 7, x1 - 7, y1 - 7, '#f7f7f2')
        c.text(str(PLATE_FIRST + i), WORDMARK_FONT, '#111418', (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.74, (y1 - y0) * 0.62, spacing=1.05)
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
