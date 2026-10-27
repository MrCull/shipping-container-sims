"""Container livery atlas: one tile per shipping line, plus the corrugation normal map.

Each tile holds the regions a container face samples (pixel rects, origin at
the tile's top-left):
  side40  long side of a 40 ft box (wordmark + owner code)
  side20  long side of a 20 ft box
  door    door end (seam, locking bars, owner code, small wordmark)
  front   front end wall (owner code)
  solid   flat body colour (frame, rails, roof)
  dark    shaded body colour (corner castings, interior)
  metal   galvanised grey (locking bars, handles)

Wordmarks are the line's name set in a close open-licence typeface and the
line's colours [A]. Official logo files can replace them later: draw them into
the same regions (keep the layout) and re-run the generator.
"""
import os

import bpy
import mathutils

from .blender import emission_material, hex_to_linear

ATLAS_SIZE = 2048
TILE_COLS = 2
TILE_ROWS = 6
TILE_W = ATLAS_SIZE // TILE_COLS          # 1024
TILE_H = ATLAS_SIZE / TILE_ROWS           # 341.33

REGIONS = {
    'side40': (8, 8, 1016, 222),
    'side20': (8, 232, 244, 333),
    'door': (254, 232, 349, 333),
    'front': (359, 232, 454, 333),
    'solid': (470, 240, 530, 325),
    'dark': (546, 240, 606, 325),
    'metal': (622, 240, 682, 325),
}

METAL = '#b4b9bf'

# Order = atlas tile index = the renderer's per-instance livery index.
# Lines and owner prefixes match scenario/builder.ts LINE_OWNER_PREFIX.
LIVERIES = [
    {'line': 'HMM', 'owner': 'HDMU', 'body': '#f47b20', 'text': '#ffffff', 'wordmark': 'HMM',
     'font': 'Montserrat-ExtraBold.ttf', 'spacing': 1.05, 'shear': 0.0},
    {'line': 'MSC', 'owner': 'MSCU', 'body': '#d8c9a3', 'text': '#1d1d1b', 'wordmark': 'MSC',
     'font': 'LibreBaskerville-Bold.ttf', 'spacing': 1.0, 'shear': 0.18},
    {'line': 'Maersk', 'owner': 'MAEU', 'body': '#42b0d5', 'text': '#ffffff', 'wordmark': 'MAERSK',
     'font': 'Montserrat-SemiBold.ttf', 'spacing': 1.25, 'shear': 0.0},
    {'line': 'CMA CGM', 'owner': 'CMAU', 'body': '#1f3f8f', 'text': '#ffffff', 'wordmark': 'CMA CGM',
     'font': 'Archivo-ExtraBold.ttf', 'spacing': 1.0, 'shear': 0.0, 'accent': '#e2001a'},
    {'line': 'Hapag-Lloyd', 'owner': 'HLXU', 'body': '#ef7d00', 'text': '#002b5c', 'wordmark': 'Hapag-Lloyd',
     'font': 'Archivo-ExtraBold.ttf', 'spacing': 1.0, 'shear': 0.0},
    {'line': 'ONE', 'owner': 'ONEU', 'body': '#d6007f', 'text': '#ffffff', 'wordmark': 'ONE',
     'font': 'Montserrat-ExtraBold.ttf', 'spacing': 1.3, 'shear': 0.0},
    {'line': 'Evergreen', 'owner': 'EGHU', 'body': '#00843d', 'text': '#ffffff', 'wordmark': 'EVERGREEN',
     'font': 'Archivo-ExtraBold.ttf', 'spacing': 1.1, 'shear': 0.0},
    {'line': 'COSCO', 'owner': 'CSNU', 'body': '#2f5fae', 'text': '#ffffff', 'wordmark': 'COSCO SHIPPING',
     'font': 'Archivo-ExtraBold.ttf', 'spacing': 1.0, 'shear': 0.0},
    {'line': 'ZIM', 'owner': 'ZIMU', 'body': '#c9ccd1', 'text': '#1b2a6b', 'wordmark': 'ZIM',
     'font': 'Montserrat-ExtraBold.ttf', 'spacing': 1.1, 'shear': 0.0},
    {'line': 'Yang Ming', 'owner': 'YMLU', 'body': '#f2c318', 'text': '#1d1d1b', 'wordmark': 'YANG MING',
     'font': 'Archivo-ExtraBold.ttf', 'spacing': 1.05, 'shear': 0.0},
    {'line': None, 'owner': '', 'body': '#8a95a5', 'text': '#ffffff', 'wordmark': '',
     'font': 'Archivo-ExtraBold.ttf', 'spacing': 1.0, 'shear': 0.0},
]
GENERIC_INDEX = len(LIVERIES) - 1


def tile_origin(index):
    """Top-left pixel of tile `index`."""
    return (index % TILE_COLS) * TILE_W, (index // TILE_COLS) * TILE_H


def region_uv_rect(name, index=0):
    """Blender UV rect (u0, v0, u1, v1) of a region in tile `index` (v up)."""
    ox, oy = tile_origin(index)
    x0, y0, x1, y1 = REGIONS[name]
    s = ATLAS_SIZE
    return (ox + x0) / s, 1 - (oy + y1) / s, (ox + x1) / s, 1 - (oy + y0) / s


def region_uv_point(name, index=0):
    u0, v0, u1, v1 = region_uv_rect(name, index)
    return (u0 + u1) / 2, (v0 + v1) / 2


def shade(hex_colour, factor):
    h = hex_colour.lstrip('#')
    return '#' + ''.join(f'{min(255, round(int(h[i:i + 2], 16) * factor)):02x}' for i in (0, 2, 4))


def atlas_manifest():
    """JSON-safe description of the atlas for the renderer (livery-atlas.json)."""
    return {
        'image': 'embedded in each container GLB (material container_lod0 / container_lod1 baseColorTexture)',
        'size': [ATLAS_SIZE, ATLAS_SIZE],
        'tileCols': TILE_COLS,
        'tileRows': TILE_ROWS,
        'tileSizeUv': [TILE_W / ATLAS_SIZE, TILE_H / ATLAS_SIZE],
        'uvConvention': 'glTF TEXCOORD_0 is authored for tile 0; add (index % tileCols, floor(index / tileCols)) * tileSizeUv per instance',
        'genericIndex': GENERIC_INDEX,
        'liveries': [
            {'index': i, 'line': l['line'], 'ownerPrefix': l['owner'], 'body': l['body'], 'text': l['text'],
             'wordmark': l['wordmark'], 'typeface': l['font'].replace('.ttf', ''), 'tag': 'A'}
            for i, l in enumerate(LIVERIES)
        ],
        'regions': {k: list(v) for k, v in REGIONS.items()},
        'provenance': [
            {'fact': 'line wordmarks are the brand name set in an open-licence typeface close to the brand typeface, in brand colours', 'tag': 'A'},
            {'fact': 'livery body colours are approximations of each line\'s container colour', 'tag': 'A'},
            {'fact': 'owner prefixes (BIC codes) as used by scenario/builder.ts', 'tag': 'A'},
            {'fact': 'no official logo artwork is included; draw it into the same regions to replace a wordmark', 'tag': 'M'},
        ],
    }


class _Canvas:
    """Draws flat rectangles and text in pixel coordinates (origin top-left)."""

    def __init__(self, fonts_dir):
        self.fonts_dir = fonts_dir
        self.fonts = {}
        self.materials = {}
        self.z = 0.0

    def _mat(self, hex_colour):
        if hex_colour not in self.materials:
            self.materials[hex_colour] = emission_material(f'em-{hex_colour}', hex_colour)
        return self.materials[hex_colour]

    def _next_z(self):
        self.z += 0.01
        return self.z

    def rect(self, x0, y0, x1, y1, colour):
        z = self._next_z()
        mesh = bpy.data.meshes.new('rect')
        mesh.from_pydata([(x0, -y1, z), (x1, -y1, z), (x1, -y0, z), (x0, -y0, z)], [], [(0, 1, 2, 3)])
        mesh.materials.append(self._mat(colour))
        obj = bpy.data.objects.new('rect', mesh)
        bpy.context.scene.collection.objects.link(obj)

    def text(self, body, font_file, colour, cx, cy, max_w, max_h, spacing=1.0, shear=0.0):
        if not body:
            return
        if font_file not in self.fonts:
            self.fonts[font_file] = bpy.data.fonts.load(os.path.join(self.fonts_dir, font_file))
        curve = bpy.data.curves.new('text', type='FONT')
        curve.body = body
        curve.font = self.fonts[font_file]
        curve.size = 100
        curve.space_character = spacing
        curve.shear = shear
        curve.align_x = 'CENTER'
        curve.align_y = 'CENTER'
        obj = bpy.data.objects.new('text', curve)
        obj.data.materials.append(self._mat(colour))
        bpy.context.scene.collection.objects.link(obj)
        bpy.context.view_layer.update()
        w, h = obj.dimensions.x, obj.dimensions.y
        scale = min(max_w / w, max_h / h)
        obj.scale = (scale, scale, 1)
        obj.location = (0, 0, self._next_z())
        bpy.context.view_layer.update()
        xs = [(obj.matrix_world @ mathutils.Vector(c)).x for c in obj.bound_box]
        ys = [(obj.matrix_world @ mathutils.Vector(c)).y for c in obj.bound_box]
        obj.location.x = cx - (min(xs) + max(xs)) / 2
        obj.location.y = -cy - (min(ys) + max(ys)) / 2


def _draw_tile(canvas, index, liv):
    ox, oy = tile_origin(index)
    body, text = liv['body'], liv['text']

    def r(name):
        x0, y0, x1, y1 = REGIONS[name]
        return ox + x0, oy + y0, ox + x1, oy + y1

    canvas.rect(ox, oy, ox + TILE_W, oy + TILE_H, body)
    # Long sides: big wordmark, owner code top right (as painted on real boxes).
    for name in ('side40', 'side20'):
        x0, y0, x1, y1 = r(name)
        w, h = x1 - x0, y1 - y0
        canvas.text(liv['wordmark'], liv['font'], text, (x0 + x1) / 2, (y0 + y1) / 2 + h * 0.02,
                    w * (0.62 if name == 'side40' else 0.78), h * 0.36, liv['spacing'], liv['shear'])
        if liv.get('accent'):
            canvas.rect(x0 + w * 0.2, y0 + h * 0.74, x1 - w * 0.2, y0 + h * 0.77, liv['accent'])
        canvas.text(liv['owner'], 'Archivo-ExtraBold.ttf', text, x1 - w * 0.08, y0 + h * 0.1, w * 0.1, h * 0.07)
    # Door end: two leaves, centre seam, four locking bars, owner code + small wordmark.
    x0, y0, x1, y1 = r('door')
    w, h = x1 - x0, y1 - y0
    canvas.rect(x0, y0, x1, y1, shade(body, 0.94))
    canvas.rect((x0 + x1) / 2 - 0.6, y0, (x0 + x1) / 2 + 0.6, y1, shade(body, 0.55))
    for fx in (0.14, 0.38, 0.62, 0.86):
        bx = x0 + w * fx
        canvas.rect(bx - 1.0, y0 + h * 0.04, bx + 1.0, y1 - h * 0.04, METAL)
    canvas.text(liv['owner'], 'Archivo-ExtraBold.ttf', text, x0 + w * 0.75, y0 + h * 0.12, w * 0.3, h * 0.06)
    canvas.text(liv['wordmark'], liv['font'], text, x0 + w * 0.25, y0 + h * 0.16, w * 0.32, h * 0.1, liv['spacing'], liv['shear'])
    # Front end wall: owner code.
    x0, y0, x1, y1 = r('front')
    w, h = x1 - x0, y1 - y0
    canvas.rect(x0, y0, x1, y1, shade(body, 0.97))
    canvas.text(liv['owner'], 'Archivo-ExtraBold.ttf', text, x0 + w * 0.5, y0 + h * 0.12, w * 0.4, h * 0.07)
    canvas.rect(*r('solid'), body)
    canvas.rect(*r('dark'), shade(body, 0.45))
    canvas.rect(*r('metal'), METAL)


def render_atlas(path, fonts_dir, samples=16):
    """Renders the livery atlas PNG (Cycles, emission only, orthographic)."""
    from .blender import reset_scene
    scene = reset_scene()
    canvas = _Canvas(fonts_dir)
    canvas.rect(0, 0, ATLAS_SIZE, ATLAS_SIZE, '#808080')
    for i, liv in enumerate(LIVERIES):
        _draw_tile(canvas, i, liv)
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


# Corrugation profile over one pitch (u in [0, 1)): valley, slope, rib top, slope, valley.
# Shared with the LOD0 geometry so LOD1's normal map lines up with LOD0's ribs.
RIB_BASE_HALF = 0.30   # fraction of the pitch
RIB_TOP_HALF = 0.175
RIB_DEPTH_M = 0.038


def write_corrugation_normal_map(path, pitch_m, width=128, height=4):
    """Tangent-space normal map of the side-wall corrugation (tiles along u)."""
    import math
    slope_w = (RIB_BASE_HALF - RIB_TOP_HALF) * pitch_m
    a = math.atan2(RIB_DEPTH_M, slope_w)
    sx, cz = math.sin(a), math.cos(a)
    row = []
    for i in range(width):
        u = (i + 0.5) / width
        d = abs(u - 0.5)
        if RIB_TOP_HALF < d < RIB_BASE_HALF:
            nx = -sx if u < 0.5 else sx   # rising flank faces -u, falling flank +u
            n = (nx, 0.0, cz)
        else:
            n = (0.0, 0.0, 1.0)
        row.append((n[0] * 0.5 + 0.5, n[1] * 0.5 + 0.5, n[2] * 0.5 + 0.5, 1.0))
    img = bpy.data.images.new('corrugation-normal', width, height, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    pixels = [c for _ in range(height) for px in row for c in px]
    img.pixels.foreach_set(pixels)
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
