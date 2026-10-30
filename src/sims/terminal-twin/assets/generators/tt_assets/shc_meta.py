"""SHC atlas rendering and rig sidecar (TT-25). Geometry lives in shc.py."""
import bpy

from .shc import (
    ATLAS, ATTACH_Z, AXLE_Z, CELL, CORNERS, FRAME_HALF_LEN, HOIST_TRAVEL, LEG_X, LEG_Y, PLATE_ATLAS, PLATE_COLS, PLATE_COUNT,
    PLATE_FIRST, PLATE_ROWS, PLATE_TILE_H, PLATE_TILE_W, REGIONS, SPREADER_FLOAT, SWATCHES, SWATCH_ORDER, TOP_UNDER, TWIST_DEG,
    TYRE_GAP, TYRE_R, TYRE_W,
)

TWISTLOCK_X, TWISTLOCK_Y = 6.0, 1.138  # ISO 1161 casting centres of a 40 ft box (m)


def _canvas_class():
    from .liveries import _Canvas

    class Canvas(_Canvas):
        def poly(self, pts, colour):
            z = self._next_z()
            mesh = bpy.data.meshes.new('poly')
            mesh.from_pydata([(x, -y, z) for x, y in pts], [], [tuple(range(len(pts)))])
            mesh.materials.append(self._mat(colour))
            obj = bpy.data.objects.new('poly', mesh)
            bpy.context.scene.collection.objects.link(obj)

    return Canvas


def _render_canvas(scene, path, size, samples):
    """Renders the flat drawing in the scene (emission only) with an orthographic camera into a size x size PNG."""
    from .blender import hex_to_linear

    cam = bpy.data.objects.new('atlas-camera', bpy.data.cameras.new('atlas-camera'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = size
    cam.data.clip_start = 0.1
    cam.data.clip_end = 100
    cam.location = (size / 2, -size / 2, 50)
    scene.collection.objects.link(cam)
    scene.camera = cam
    world = bpy.data.worlds.new('none')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = hex_to_linear('#000000')
    scene.world = world
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.cycles.samples = samples
    scene.cycles.max_bounces = 0
    scene.cycles.filter_width = 1.2
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.color_depth = '8'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def render_atlas(path, fonts_dir, samples=16):
    """Swatch grid + hazard stripes + KALMAR and TTI ALGECIRAS wordmarks (Cycles, emission only)."""
    from .blender import reset_scene

    scene = reset_scene()
    c = _canvas_class()(fonts_dir)
    c.rect(0, 0, ATLAS, ATLAS, '#808080')
    for i, name in enumerate(SWATCH_ORDER):
        x, y = (i % 4) * CELL, (i // 4) * CELL
        c.rect(x, y, x + CELL, y + CELL, SWATCHES[name])
    x0, y0, x1, y1 = REGIONS['hazard']
    c.rect(x0, y0, x1, y1, SWATCHES['red'])
    pitch, width, h = 64, 28, y1 - y0
    for i in range(-3, 9):
        sx = x0 + i * pitch
        c.poly([(sx, y1), (sx + width, y1), (sx + width + h, y0), (sx + h, y0)], SWATCHES['white'])
    # Regions drawn after the stripes cover any stripe overflow into their neighbours.
    x0, y0, x1, y1 = REGIONS['plate']
    c.rect(x0, y0, x1, y1, SWATCHES['dark'])
    c.text('SHUTTLE CARRIER  40 t', 'Archivo-ExtraBold.ttf', '#d9d9d9', (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.86, (y1 - y0) * 0.4)
    x0, y0, x1, y1 = REGIONS['wordmark']
    c.rect(x0, y0, x1, y1, SWATCHES['red'])
    c.text('KALMAR', 'Montserrat-ExtraBold.ttf', '#ffffff', (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.8, (y1 - y0) * 0.62, 1.12)
    x0, y0, x1, y1 = REGIONS['livery']
    c.rect(x0, y0, x1, y1, SWATCHES['red'])
    c.text('TTI ALGECIRAS', 'Archivo-ExtraBold.ttf', '#ffffff', (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.9, (y1 - y0) * 0.62)
    _render_canvas(scene, path, ATLAS, samples)


def plate_text(index):
    return f'SHC {PLATE_FIRST + index:02d}'


def render_plate_atlas(path, fonts_dir, samples=16):
    """Fleet-number plates: PLATE_COUNT tiles of "SHC nn" (white on dark), PLATE_COLS x PLATE_ROWS from the top-left."""
    from .blender import reset_scene

    scene = reset_scene()
    c = _canvas_class()(fonts_dir)
    c.rect(0, 0, PLATE_ATLAS, PLATE_ATLAS, '#1c1f24')
    for i in range(PLATE_COUNT):
        x0, y0 = (i % PLATE_COLS) * PLATE_TILE_W, (i // PLATE_COLS) * PLATE_TILE_H
        c.rect(x0, y0, x0 + PLATE_TILE_W, y0 + PLATE_TILE_H, '#1c1f24')
        c.text(plate_text(i), 'Archivo-ExtraBold.ttf', '#f1f1ef', x0 + PLATE_TILE_W / 2, y0 + PLATE_TILE_H / 2, PLATE_TILE_W * 0.86, PLATE_TILE_H * 0.5)
    _render_canvas(scene, path, PLATE_ATLAS, samples)


def _gl(p):
    """Blender (x, y, z) -> glTF (x, z, -y), rounded to mm."""
    x, y, z = p
    return [round(x, 4), round(z, 4), round(-y + 0.0, 4)]


def sidecar(info):
    twist = [{'name': f'twistlock_{n}', 'position': _gl((sx * TWISTLOCK_X, sy * TWISTLOCK_Y, ATTACH_Z)), 'parent': 'hoist', 'tag': 'V',
              'source': 'ISO 1161 casting centres of a 40 ft box (twist-lock positions at hoist rest)'} for n, sx, sy in CORNERS]
    nodes = [
        {'name': 'LOD0', 'parent': 'shc', 'role': 'lod', 'description': 'full detail, nearest SHCs'},
        {'name': 'LOD1', 'parent': 'shc', 'role': 'lod', 'description': 'simplified, rig kept (wheels, steering, hoist, spreader)'},
        {'name': 'LOD2', 'parent': 'shc', 'role': 'lod', 'description': 'silhouette boxes plus a static spreader plate at the raised position'},
        {'name': 'frame', 'parent': 'LOD*', 'role': 'mesh', 'description': 'static welded gantry, chassis sills, TTI livery panel, engine/hoist assembly, cab, ladders, rails, hazard stripes, wordmarks'},
        {'name': 'plates', 'parent': 'LOD0|LOD1', 'role': 'mesh', 'description': 'fleet-number plates (SHC nn) in the second material shc_plate; LOD2 has none'},
    ]
    for n, sx, sy in CORNERS:
        piv = _gl((sx * LEG_X, sy * LEG_Y, AXLE_Z))
        nodes.append({'name': f'steer_{n}', 'parent': 'LOD*', 'role': 'rig', 'pivot': piv, 'axis': '+Y',
                      'description': 'steering knuckle and fork; pivot on the steer axis at axle height'})
        nodes.append({'name': f'wheel_{n}', 'parent': f'steer_{n}', 'role': 'rig', 'pivot': piv, 'axis': '+Z',
                      'description': 'one large single tyre on a white rim; pivot on the axle. Travelling towards +X is a negative rotation about +Z'})
    nodes.append({'name': 'hoist', 'parent': 'LOD*', 'role': 'rig', 'pivot': _gl((0, 0, ATTACH_Z)), 'axis': '+Y',
                  'description': 'lifting frame on the leg guides; pivot = container attach plane at rest (raised); travels down (negative)'})
    nodes.append({'name': 'spreader', 'parent': 'hoist', 'role': 'rig', 'pivot': _gl((0, 0, ATTACH_Z)), 'axis': '+Y',
                  'description': 'telescopic 40 ft spreader hung from the hoist frame; small float travel'})
    for n, sx, sy in CORNERS:
        nodes.append({'name': f'twistlock_{n}', 'parent': 'spreader', 'role': 'rig',
                      'pivot': _gl((sx * TWISTLOCK_X, sy * TWISTLOCK_Y, ATTACH_Z)), 'axis': '+Y',
                      'description': 'twist-lock; 0 = unlocked, 90 degrees = locked'})
    # Every rig node is an empty at its pivot; the mesh is its `<name>_geo` child (LOD2 keeps only a bare spreader plate).
    for rig in [n for n in nodes if n['role'] == 'rig']:
        nodes.append({'name': rig['name'] + '_geo', 'parent': rig['name'], 'role': 'mesh', 'description': 'mesh of ' + rig['name']})
    limits = {}
    for n, _, _ in CORNERS:
        limits[f'steer_{n}'] = {'type': 'rotation', 'axis': '+Y', 'minDeg': -35, 'maxDeg': 35, 'rest': 0, 'tag': 'A'}
        limits[f'wheel_{n}'] = {'type': 'rotation', 'axis': '+Z', 'minDeg': -360, 'maxDeg': 360, 'rest': 0, 'continuous': True, 'tag': 'A'}
        limits[f'twistlock_{n}'] = {'type': 'rotation', 'axis': '+Y', 'minDeg': 0, 'maxDeg': TWIST_DEG, 'rest': 0, 'tag': 'A'}
    limits['hoist'] = {'type': 'translation', 'axis': '+Y', 'minM': -HOIST_TRAVEL, 'maxM': 0, 'rest': 0, 'tag': 'A'}
    limits['spreader'] = {'type': 'translation', 'axis': '+Y', 'minM': 0, 'maxM': SPREADER_FLOAT, 'rest': 0, 'tag': 'A'}
    return {
        'asset': 'shc',
        'kind': 'shc',
        'version': 1,
        'generator': 'src/sims/terminal-twin/assets/generators/build.py --only shc',
        'units': 'm',
        'dimensions': {
            'lengthM': round(2 * (LEG_X + TYRE_R), 3), 'widthM': round(2 * (LEG_Y + TYRE_GAP + TYRE_W / 2), 3), 'heightM': info['height'],
            'wheelbaseM': 2 * LEG_X, 'trackM': 2 * LEG_Y, 'tag': 'A',
            'reason': 'proportions of the TTI Algeciras Kalmar shuttle carriers from reference photographs (not committed); no manufacturer drawing was available'},
        'axes': {'up': '+Y', 'length': '+X (front, cab end)', 'width': '+Z', 'origin': 'ground contact below the frame centre', 'handedness': 'right-handed, glTF'},
        'nodes': nodes,
        'travelLimits': limits,
        'attachPoints': [{'name': 'container_attach', 'parent': 'hoist', 'position': _gl((0, 0, ATTACH_Z)),
                          'description': 'centre of the twist-lock plane, i.e. the TOP of the carried box. At hoist 0 it is 6.0 m above the ground; '
                                         'hoist = (box bottom + box height) - 6.0', 'tag': 'A'}] + twist,
        'groundContact': {'y': 0, 'points': [f'wheel_{n}' for n, _, _ in CORNERS], 'tag': 'V'},
        'wheel': {'radiusM': TYRE_R, 'tyreWidthM': TYRE_W, 'tyresPerCorner': 1, 'steeredCorners': 4, 'tag': 'A',
                  'note': 'roll angle = distance / radius; the rear corners steer opposite to the front'},
        'tunnel': {'clearWidthM': round(2 * (LEG_Y - TYRE_GAP - TYRE_W / 2), 3), 'clearHeightM': TOP_UNDER,
                   'frameLengthM': round(2 * FRAME_HALF_LEN, 3), 'openEnds': True, 'tag': 'A',
                   'note': 'a 40 ft box (12.19 m) is longer than the frame and overhangs it fore and aft, as on a real shuttle carrier; '
                           'width clearance is measured between the inner tyre faces'},
        'branding': {'wordmark': 'KALMAR', 'livery': 'TTI ALGECIRAS', 'operatorBranding': True, 'tag': 'P',
                     'note': 'KALMAR and TTI ALGECIRAS set as text (Montserrat / Archivo ExtraBold) on the red atlas, as on the real SHCs; no logo artwork. '
                             'The fleet number "SHC nn" is a plate in its own material (shc_plate): the GLB authors its UVs for tile 0 and the renderer offsets them per SHC id.',
                     'fleetNumbers': {
                         'first': PLATE_FIRST, 'count': PLATE_COUNT, 'cols': PLATE_COLS, 'rows': PLATE_ROWS,
                         'tileSizeUv': [PLATE_TILE_W / PLATE_ATLAS, PLATE_TILE_H / PLATE_ATLAS], 'material': 'shc_plate',
                         'uvConvention': 'TEXCOORD_0 of material shc_plate is authored for tile 0 (SHC 01); add (index % cols, floor(index / cols)) * tileSizeUv, index = number - first'}},
        'materials': {'shc_atlas': 'palette + hazard stripes + KALMAR and TTI ALGECIRAS wordmarks', 'shc_plate': 'fleet-number plates (LOD0 and LOD1)'},
        'lods': {f'LOD{i}': {'triangles': info['triangles'][f'LOD{i}'], 'material': 'shc_atlas'} for i in range(3)},
        'provenance': [
            {'fact': 'red Kalmar shuttle carrier of TTI Algeciras: tall red box-section legs, open tunnel, deep chassis sills, one large single tyre on a white rim per leg, four steered corners', 'tag': 'P',
             'source': 'TTI Algeciras reference photographs of the Kalmar SHC fleet (git-ignored, not committed)'},
            {'fact': 'TTI Algeciras livery: red panel on the front end beam with TTI ALGECIRAS and the fleet number, KALMAR and TTI ALGECIRAS wordmarks and the fleet number on the sill, hazard-striped sill ends and lower legs, white cab', 'tag': 'P',
             'source': 'the same reference photographs'},
            {'fact': 'elevated glazed cab offset to the +Z side at the front, caged ladder, black handrails and walkways, engine housing and exhaust at the rear', 'tag': 'P',
             'source': 'the same reference photographs'},
            {'fact': 'frame, tyre, cab, engine and ladder proportions', 'tag': 'A', 'reason': 'no manufacturer drawing; sized from the photographs so a 40 ft HC box fits the tunnel with margin'},
            {'fact': 'clear height 6.4 m (one box over a stacked box), clear width about 4.0 m between tyres', 'tag': 'A'},
            {'fact': '40 ft spreader with end beams, telescopic tubes and four twist-locks at the ISO 1161 casting centres', 'tag': 'V',
             'source': 'ISO 1161 / ISO 668'},
            {'fact': 'all-wheel steering at +-35 degrees (rear opposite to front)', 'tag': 'A'},
            {'fact': 'fleet numbers SHC 01 to SHC 120 follow the sim SHC ids (SHC01...)', 'tag': 'A'},
            {'fact': 'tyre tread as 52-segment lugs, weld seams as flat strips, wordmarks as text, no logo artwork', 'tag': 'M', 'reason': 'triangle budget; no logo artwork'},
        ],
    }
