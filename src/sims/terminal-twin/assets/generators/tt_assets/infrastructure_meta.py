"""Infrastructure atlas rendering and sidecars (TT-28). Geometry lives in infrastructure.py."""
import bpy

from .infrastructure import ATLAS, CELL, REGIONS, SWATCHES, SWATCH_ORDER

KIND_NOTES = {
    'gate': 'gate complex module (lane, island, office)',
    'quay': 'quay furniture (instanced)',
    'yard': 'yard infrastructure (instanced)',
    'building': 'generic building',
    'backdrop': 'distant low-poly backdrop',
}


def render_atlas(path, fonts_dir, samples=16):
    """Swatch grid + hazard stripes + lane arrow/cross signs + gate signs (Cycles, emission only)."""
    from .blender import hex_to_linear, reset_scene
    from .liveries import _Canvas

    class Canvas(_Canvas):
        def poly(self, pts, colour):
            z = self._next_z()
            mesh = bpy.data.meshes.new('poly')
            mesh.from_pydata([(x, -y, z) for x, y in pts], [], [tuple(range(len(pts)))])
            mesh.materials.append(self._mat(colour))
            obj = bpy.data.objects.new('poly', mesh)
            bpy.context.scene.collection.objects.link(obj)

    scene = reset_scene()
    c = Canvas(fonts_dir)
    c.rect(0, 0, ATLAS, ATLAS, '#808080')
    for i, name in enumerate(SWATCH_ORDER):
        x, y = (i % 4) * CELL, (i // 4) * CELL
        c.rect(x, y, x + CELL, y + CELL, SWATCHES[name])
    # black and yellow hazard stripes
    x0, y0, x1, y1 = REGIONS['hazard']
    c.rect(x0, y0, x1, y1, SWATCHES['yellow'])
    pitch, width, h = 64, 32, y1 - y0
    for i in range(-3, 18):
        sx = x0 + i * pitch
        pts = [(sx, y1), (sx + width, y1), (sx + width + h, y0), (sx + h, y0)]
        c.poly([(min(max(px, x0), x1), py) for px, py in pts], SWATCHES['black'])
    # lane arrow painted on the road (points up)
    x0, y0, x1, y1 = REGIONS['road_arrow']
    c.rect(x0, y0, x1, y1, SWATCHES['asphalt'])
    cx, w = (x0 + x1) / 2, x1 - x0
    c.rect(cx - w * 0.11, y0 + (y1 - y0) * 0.38, cx + w * 0.11, y1 - (y1 - y0) * 0.04, SWATCHES['white'])
    c.poly([(cx - w * 0.34, y0 + (y1 - y0) * 0.38), (cx + w * 0.34, y0 + (y1 - y0) * 0.38), (cx, y0 + (y1 - y0) * 0.04)], SWATCHES['white'])
    # overhead signs: green down arrow, red cross
    x0, y0, x1, y1 = REGIONS['sign_arrow']
    c.rect(x0, y0, x1, y1, SWATCHES['black'])
    cx, cy, s = (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0
    c.rect(cx - s * 0.1, cy - s * 0.38, cx + s * 0.1, cy + s * 0.05, '#2fd070')
    c.poly([(cx - s * 0.3, cy + s * 0.05), (cx + s * 0.3, cy + s * 0.05), (cx, cy + s * 0.38)], '#2fd070')
    x0, y0, x1, y1 = REGIONS['sign_cross']
    c.rect(x0, y0, x1, y1, SWATCHES['black'])
    cx, cy, s = (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0
    t, r = s * 0.07, s * 0.32
    for sgn in (1, -1):
        # one diagonal bar from (-r, -sgn*r) to (r, sgn*r), t thick (perpendicular offset n = t/sqrt2 * (sgn, -1))
        n = (t * 0.7071 * sgn, -t * 0.7071)
        a0, a1 = (cx - r, cy - sgn * r), (cx + r, cy + sgn * r)
        c.poly([(a0[0] + n[0], a0[1] + n[1]), (a1[0] + n[0], a1[1] + n[1]), (a1[0] - n[0], a1[1] - n[1]), (a0[0] - n[0], a0[1] - n[1])], '#ee2a24')
    x0, y0, x1, y1 = REGIONS['sign_gate']
    c.rect(x0, y0, x1, y1, SWATCHES['blue'])
    c.text('TERMINAL GATE', 'Archivo-ExtraBold.ttf', '#ffffff', (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.86, (y1 - y0) * 0.5)
    x0, y0, x1, y1 = REGIONS['sign_oog']
    c.rect(x0, y0, x1, y1, SWATCHES['yellow'])
    c.text('OVERSIZE LANE', 'Archivo-ExtraBold.ttf', '#101113', (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.86, (y1 - y0) * 0.5)
    cam = bpy.data.objects.new('atlas-camera', bpy.data.cameras.new('atlas-camera'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = ATLAS
    cam.data.clip_start = 0.1
    cam.data.clip_end = 100
    cam.location = (ATLAS / 2, -ATLAS / 2, 50)
    scene.collection.objects.link(cam)
    scene.camera = cam
    world = bpy.data.worlds.new('none')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = hex_to_linear('#000000')
    scene.world = world
    scene.render.resolution_x = ATLAS
    scene.render.resolution_y = ATLAS
    scene.render.resolution_percentage = 100
    scene.cycles.samples = samples
    scene.cycles.max_bounces = 0
    scene.cycles.filter_width = 1.2
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.color_depth = '8'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def atlas_manifest():
    return {
        'asset': 'infra-atlas',
        'sizePx': ATLAS,
        'cellPx': CELL,
        'swatches': {name: {'index': i, 'colour': SWATCHES[name]} for i, name in enumerate(SWATCH_ORDER)},
        'regions': {name: list(box) for name, box in REGIONS.items()},
        'note': 'one atlas shared by every infrastructure asset (flat swatches plus hazard stripes, lane arrows and gate signs)',
    }


def sidecar(info):
    extra = {k: v for k, v in info.items() if k not in ('name', 'kind', 'triangles', 'nodes', 'dimensions', 'provenance', 'limits', 'attach')}
    dims = dict(info['dimensions'])
    out = {
        'asset': info['name'],
        'kind': info['kind'],
        'version': 1,
        'generator': 'src/sims/terminal-twin/assets/generators/build.py --only infrastructure',
        'units': 'm',
        'dimensions': dims,
        'axes': {'up': '+Y', 'origin': 'ground contact at the module centre (see the node list)', 'handedness': 'right-handed, glTF',
                 'travel': '+Z (gate modules face the direction a truck drives)'},
        'nodes': info['nodes'],
        'travelLimits': info.get('limits', {}),
        'attachPoints': info.get('attach', []),
        'groundContact': {'y': 0, 'points': ['LOD0']},
        'lods': {'LOD0': {'triangles': info['triangles']['LOD0'], 'material': 'infra_atlas'}},
        'provenance': info['provenance'] + [
            {'fact': 'one shared swatch atlas; faceted flat shading; no LODs (repeated items are instanced by the renderer)', 'tag': 'M', 'reason': 'budget (TT-28)'},
        ],
    }
    out.update(extra)
    return out
