"""SHC atlas rendering and rig sidecar (TT-25). Geometry lives in shc.py."""
import bpy

from .shc import (
    ATLAS, ATTACH_Z, AXLE_Z, CELL, CORNERS, FRAME_HALF_LEN, HOIST_TRAVEL, LEG_X, LEG_Y, REGIONS, SPREADER_FLOAT,
    SWATCHES, SWATCH_ORDER, TOP_UNDER, TWIST_DEG, TYRE_GAP, TYRE_R, TYRE_W,
)

TWISTLOCK_X, TWISTLOCK_Y = 6.0, 1.138  # ISO 1161 casting centres of a 40 ft box (m)


def render_atlas(path, fonts_dir, samples=16):
    """Swatch grid + hazard stripes + KALMAR wordmark + unit number plate (Cycles, emission only)."""
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
    x0, y0, x1, y1 = REGIONS['number']
    c.rect(x0, y0, x1, y1, SWATCHES['white'])
    c.text('SC 108', 'Archivo-ExtraBold.ttf', '#14161a', (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.8, (y1 - y0) * 0.62)
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
        {'name': 'frame', 'parent': 'LOD*', 'role': 'mesh', 'description': 'static welded gantry, engine/hoist assembly, cab, ladder, rails, stripes, branding'},
    ]
    for n, sx, sy in CORNERS:
        piv = _gl((sx * LEG_X, sy * LEG_Y, AXLE_Z))
        nodes.append({'name': f'steer_{n}', 'parent': 'LOD*', 'role': 'rig', 'pivot': piv, 'axis': '+Y',
                      'description': 'steering knuckle and fork; pivot on the steer axis at axle height'})
        nodes.append({'name': f'wheel_{n}', 'parent': f'steer_{n}', 'role': 'rig', 'pivot': piv, 'axis': '+Z',
                      'description': 'dual tyres; pivot on the axle. Travelling towards +X is a negative rotation about +Z'})
    nodes.append({'name': 'hoist', 'parent': 'LOD*', 'role': 'rig', 'pivot': _gl((0, 0, ATTACH_Z)), 'axis': '+Y',
                  'description': 'lifting frame on the leg guides; pivot = container attach plane at rest (raised); travels down (negative)'})
    nodes.append({'name': 'spreader', 'parent': 'hoist', 'role': 'rig', 'pivot': _gl((0, 0, ATTACH_Z)), 'axis': '+Y',
                  'description': 'telescopic 40 ft spreader hung from the hoist frame; small float travel'})
    for n, sx, sy in CORNERS:
        nodes.append({'name': f'twistlock_{n}', 'parent': 'spreader', 'role': 'rig',
                      'pivot': _gl((sx * TWISTLOCK_X, sy * TWISTLOCK_Y, ATTACH_Z)), 'axis': '+Y',
                      'description': 'twist-lock; 0 = unlocked, 90 degrees = locked'})
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
            'reason': 'proportions of a Kalmar shuttle carrier from public photographs (not committed); no manufacturer drawing was available'},
        'axes': {'up': '+Y', 'length': '+X (front, cab end)', 'width': '+Z', 'origin': 'ground contact below the frame centre', 'handedness': 'right-handed, glTF'},
        'nodes': nodes,
        'travelLimits': limits,
        'attachPoints': [{'name': 'container_attach', 'parent': 'hoist', 'position': _gl((0, 0, ATTACH_Z)),
                          'description': 'centre of the twist-lock plane, i.e. the TOP of the carried box. At hoist 0 it is 6.0 m above the ground; '
                                         'hoist = (box bottom + box height) - 6.0', 'tag': 'A'}] + twist,
        'groundContact': {'y': 0, 'points': [f'wheel_{n}' for n, _, _ in CORNERS], 'tag': 'V'},
        'wheel': {'radiusM': TYRE_R, 'tyreWidthM': TYRE_W, 'tyresPerCorner': 2, 'steeredCorners': 4, 'tag': 'A',
                  'note': 'roll angle = distance / radius; the rear corners steer opposite to the front'},
        'tunnel': {'clearWidthM': round(2 * (LEG_Y - TYRE_GAP - TYRE_W / 2), 3), 'clearHeightM': TOP_UNDER,
                   'frameLengthM': round(2 * FRAME_HALF_LEN, 3), 'openEnds': True, 'tag': 'A',
                   'note': 'a 40 ft box (12.19 m) is longer than the frame and overhangs it fore and aft, as on a real shuttle carrier; '
                           'width clearance is measured between the inner tyre faces'},
        'branding': {'wordmark': 'KALMAR', 'unitNumber': 'SC 108', 'operatorBranding': False, 'tag': 'A',
                     'note': 'wordmark set in Montserrat ExtraBold on the red atlas; no official logo artwork; no operator branding'},
        'lods': {f'LOD{i}': {'triangles': info['triangles'][f'LOD{i}'], 'material': 'shc_atlas'} for i in range(3)},
        'provenance': [
            {'fact': 'red Kalmar-style shuttle carrier: tall welded gantry, open tunnel, dual tyres on four steered legs', 'tag': 'P',
             'source': 'public Kalmar shuttle-carrier photographs (not committed)'},
            {'fact': 'frame, tyre, cab, engine and ladder proportions', 'tag': 'A', 'reason': 'no manufacturer drawing; sized so a 40 ft HC box fits the tunnel with margin'},
            {'fact': 'clear height 6.4 m (one box over a stacked box), clear width 3.6 m between tyres', 'tag': 'A'},
            {'fact': '40 ft spreader with end beams, telescopic tubes and four twist-locks at the ISO 1161 casting centres', 'tag': 'V',
             'source': 'ISO 1161 / ISO 668'},
            {'fact': 'white diagonal warning stripes on the lower legs, glazed cab offset to the -Z side at the front, ladder and handrails', 'tag': 'P'},
            {'fact': 'all-wheel steering at +-35 degrees (rear opposite to front)', 'tag': 'A'},
            {'fact': 'KALMAR wordmark and unit number baked into the atlas; no operator branding', 'tag': 'A'},
            {'fact': 'tyre tread as 32-segment lugs, weld seams as flat strips', 'tag': 'M', 'reason': 'triangle budget'},
        ],
    }
