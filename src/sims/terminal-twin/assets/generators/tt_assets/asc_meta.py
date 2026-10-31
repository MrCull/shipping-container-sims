"""ASC atlas rendering and rig sidecar (TT-24). Geometry lives in asc.py."""
import bpy

from .asc import (
    ATLAS, BEACONS, BRIDGE_TOP, BRIDGE_UNDER, CELL, CORNERS, DESIGN_TIERS, GANTRY_TRAVEL, HC_H, REGIONS, REST_PLANE, ROPE_REST_LEN,
    ROPE_TOP_Z, ROW_PITCH, ROWS, RX, SPAN, SPREADER_FLOAT, SWATCHES, SWATCH_ORDER, TIER_PITCH, TROLLEY_TRAVEL, TROLLEY_Z, TWIST_DEG,
    TWIST_X, TWIST_Y, UNIT_LABEL, BEACON_Z, HEADBLOCK_Z1, LEG_W, SILL_HALF,
)


# [A] camera distances (m) up to which LOD0 and LOD1 are drawn; the twin's renderer and the viewer's auto LOD read them from the sidecar.
LOD_MAX_DISTANCE_M = (90, 300)


def render_atlas(path, fonts_dir, samples=16):
    """Swatch grid + TTI ALGECIRAS sign + ZPMC plate + numbered panel cells + "40 t" + unit number + warning stripes + spec plate (Cycles, emission only)."""
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
    # Warning stripes first: they overflow into neighbours that are drawn afterwards.
    x0, y0, x1, y1 = REGIONS['hazard']
    c.rect(x0, y0, x1, y1, SWATCHES['yellow'])
    pitch, width, h = 64, 32, y1 - y0
    for i in range(-3, 9):
        sx = x0 + i * pitch
        c.poly([(sx, y1), (sx + width, y1), (sx + width + h, y0), (sx + h, y0)], SWATCHES['black'])
    x0, y0, x1, y1 = REGIONS['plate']
    c.rect(x0, y0, x1, y1, SWATCHES['dark'])
    c.text('AUTOMATED STACKING CRANE  40 t', 'Archivo-ExtraBold.ttf', '#d9d9d9', (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.9, (y1 - y0) * 0.38)
    NAVY = '#17345a'
    x0, y0, x1, y1 = REGIONS['tti']
    c.rect(x0, y0, x1, y1, SWATCHES['white'])
    c.text('TTI ALGECIRAS', 'Archivo-ExtraBold.ttf', '#1b4f93', (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.9, (y1 - y0) * 0.6, 1.08)
    x0, y0, x1, y1 = REGIONS['zpmc']
    c.rect(x0, y0, x1, y1, SWATCHES['white'])
    c.text('ZPMC', 'Montserrat-ExtraBold.ttf', '#14161a', (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.62, (y1 - y0) * 0.58, 1.12)
    x0, y0, x1, y1 = REGIONS['panels']
    cw = (x1 - x0) / ROWS
    for i in range(ROWS):
        cx0 = x0 + i * cw
        c.rect(cx0, y0, cx0 + cw, y1, SWATCHES['white'])
        c.rect(cx0 + 6, y0 + 6, cx0 + cw - 6, y1 - 6, SWATCHES['blue_dark'])
        c.text(str(i + 1), 'Archivo-ExtraBold.ttf', '#ffffff', cx0 + cw / 2, (y0 + y1) / 2, cw * 0.5, (y1 - y0) * 0.6)
    x0, y0, x1, y1 = REGIONS['swl']
    c.rect(x0, y0, x1, y1, SWATCHES['white'])
    c.text('40 t', 'Archivo-ExtraBold.ttf', '#14161a', (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.6, (y1 - y0) * 0.62)
    x0, y0, x1, y1 = REGIONS['number']
    c.rect(x0, y0, x1, y1, SWATCHES['white'])
    c.text(UNIT_LABEL, 'Archivo-ExtraBold.ttf', '#14161a', (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.8, (y1 - y0) * 0.62)
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
    hoist_min = round(HC_H - REST_PLANE, 3)
    stack_top = DESIGN_TIERS * TIER_PITCH
    nodes = [
        {'name': 'LOD0', 'parent': 'asc', 'role': 'lod', 'description': 'full detail, nearest ASCs'},
        {'name': 'LOD1', 'parent': 'asc', 'role': 'lod', 'description': 'simplified, rig kept (gantry, trolley, ropes, hoist, spreader)'},
        {'name': 'LOD2', 'parent': 'asc', 'role': 'lod', 'description': 'silhouette boxes; gantry, trolley, hoist and spreader nodes kept so far cranes still move (spreader has no mesh: merged into hoist)'},
        {'name': 'gantry', 'parent': 'LOD*', 'role': 'rig', 'pivot': _gl((0, 0, 0)), 'axis': '+Z',
         'description': 'portal on the two rails (legs with knees into the girders, sills, violet rail bogies, head beams, bridge with its TTI ALGECIRAS sign band, walkways, stairs, e-house, amber beacons); translates along the block rails; pivot at the ground on the span and gantry centre'},
        {'name': 'trolley', 'parent': 'gantry', 'role': 'rig', 'pivot': _gl((0, 0, TROLLEY_Z)), 'axis': '+X',
         'description': 'trolley frame and hoist machinery on the bridge rails; translates across the rows; pivot at the top of the bridge rails on the centre line'},
        {'name': 'ropes', 'parent': 'trolley', 'role': 'rig', 'pivot': _gl((0, 0, ROPE_TOP_Z)), 'axis': '+Y',
         'description': 'four rope strands hanging from the drums, 1 m long at scale 1; no travel limit of its own: the sidecar `stretch` rule scales Y so they reach the head block (2.2 m at rest)'},
        {'name': 'hoist', 'parent': 'trolley', 'role': 'rig', 'pivot': _gl((0, 0, REST_PLANE)), 'axis': '+Y',
         'description': 'head block with sheaves and hangers; pivot = container attach plane at rest (raised); travels down (negative)'},
        {'name': 'spreader', 'parent': 'hoist', 'role': 'rig', 'pivot': _gl((0, 0, REST_PLANE)), 'axis': '+Y',
         'description': 'telescopic 40 ft spreader hung from the head block, long axis along the rails; small float travel'},
    ]
    twist = []
    limits = {
        'gantry': {'type': 'translation', 'axis': '+Z', 'minM': -GANTRY_TRAVEL, 'maxM': GANTRY_TRAVEL, 'rest': 0, 'tag': 'A',
                   'note': 'the rail run is per block (engine owns the real limits); +Z is the engine gantry axis'},
        'trolley': {'type': 'translation', 'axis': '+X', 'minM': -TROLLEY_TRAVEL, 'maxM': TROLLEY_TRAVEL, 'rest': 0, 'tag': 'A',
                    'note': 'reaches the outer rows (row centres at +-10.15 m) and the outer WTP pads (about +-10.8 m)'},
        'hoist': {'type': 'translation', 'axis': '+Y', 'minM': hoist_min, 'maxM': 0, 'rest': 0, 'tag': 'A'},
        'spreader': {'type': 'translation', 'axis': '+Y', 'minM': 0, 'maxM': SPREADER_FLOAT, 'rest': 0, 'tag': 'A'},
    }
    for n, sy, sx in CORNERS:
        pos = _gl((sx * TWIST_X, sy * TWIST_Y, REST_PLANE))
        nodes.append({'name': f'twistlock_{n}', 'parent': 'spreader', 'role': 'rig', 'pivot': pos, 'axis': '+Y',
                      'description': 'twist-lock; 0 = unlocked, 90 degrees = locked'})
        twist.append({'name': f'twistlock_{n}', 'node': 'spreader', 'position': [round(sx * TWIST_X, 4), 0, round(-sy * TWIST_Y, 4)], 'tag': 'V',
                      'source': 'ISO 1161 casting centres of a 40 ft box (twist-lock positions at hoist rest)'})
        limits[f'twistlock_{n}'] = {'type': 'rotation', 'axis': '+Y', 'minDeg': 0, 'maxDeg': TWIST_DEG, 'rest': 0, 'tag': 'A'}
    # Every rig node is an empty at its pivot; the mesh is its `<name>_geo` child (LOD2 has no spreader mesh: it is merged into hoist_geo).
    geo_text = {
        'gantry': 'legs, knees, sills, bogies, head beams, bridge girders, sign band, walkways, stairs, e-house, beacons',
        'trolley': 'trolley frame, wheels, machinery houses, drums and motors',
        'ropes': 'four rope strands (1 m, scaled by the stretch rule)',
        'hoist': 'head block with sheaves and hangers (LOD2: with the spreader box)',
        'spreader': 'telescopic 40 ft spreader',
    }
    for n, text in geo_text.items():
        nodes.append({'name': f'{n}_geo', 'parent': n, 'role': 'mesh', 'description': text})
    for n, _, _ in CORNERS:
        nodes.append({'name': f'twistlock_{n}_geo', 'parent': f'twistlock_{n}', 'role': 'mesh', 'description': 'twist-lock stem and cone'})
    return {
        'asset': 'asc',
        'kind': 'asc',
        'version': 1,
        'generator': 'src/sims/terminal-twin/assets/generators/build.py --only asc',
        'units': 'm',
        'dimensions': {
            'lengthM': round(2 * (SILL_HALF + 0.35), 3), 'widthM': round(2 * (RX + 1.9), 3), 'heightM': info['height'],
            'spanM': SPAN, 'railGaugeM': SPAN, 'tag': 'A',
            'reason': 'rail span 25.4 m over 8 rows is the spec figure (V); length, width over the head-beam decks and height are approximations of a ZPMC rail-mounted ASC'},
        'axes': {'up': '+Y', 'gantryTravel': '+Z (along the block rails)', 'trolleyTravel': '+X (across the rows)', 'spreaderLength': '+Z',
                 'origin': 'ground contact at the span centre and the gantry centre', 'handedness': 'right-handed, glTF'},
        'nodes': nodes,
        'travelLimits': limits,
        'attachPoints': [{'name': 'container', 'node': 'spreader', 'position': [0, 0, 0], 'yawDeg': 90, 'referenceBox': '40HC', 'tag': 'A',
                          'description': 'centre of the twist-lock plane, i.e. the TOP of the carried box (long axis along the rails, hence yawDeg 90 for a box modelled along X). '
                                         'The plane is 18.0 m above the ground at hoist 0: hoist = (box bottom + box height) - 18.0'}] + twist,
        'stretch': [{'node': 'ropes', 'to': 'hoist', 'axis': 'Y', 'offsetM': HEADBLOCK_Z1, 'unitLengthM': 1.0,
                     'note': 'ropes scale Y = (ropes.y - (hoist.y + offsetM)) / unitLengthM, both children of the trolley; 2.2 at rest'}],
        'beaconMounts': [
            {'name': name, 'node': 'gantry', 'position': _gl(pos), 'colour': SWATCHES['amber'], 'lens': 'amber', 'tag': 'A',
             'description': f'on the rail-end face of a leg at gantry-alarm height ({BEACON_Z} m), {"+Z" if pos[1] < 0 else "-Z"} end; rides with the gantry'}
            for name, pos in BEACONS.items()
        ],
        'groundContact': {'y': 0, 'points': ['gantry'], 'rails': [{'x': -RX}, {'x': RX}], 'tag': 'V'},
        'hoist': {'restAttachM': REST_PLANE, 'lowestAttachM': HC_H, 'spreaderFloatM': SPREADER_FLOAT, 'tag': 'A',
                  'note': 'lowest plane = top of a 40 ft high-cube box standing on the ground; restAttachM suits a 5-high stack plus the engine travel clearance; '
                          'taller blocks scale the model vertically (see ascAssets.ts)'},
        'stack': {'rows': ROWS, 'rowPitchM': ROW_PITCH, 'designTiers': DESIGN_TIERS, 'stackTopM': round(stack_top, 3),
                  'clearSpanM': round(SPAN - LEG_W, 3), 'underBridgeM': BRIDGE_UNDER, 'bridgeTopM': BRIDGE_TOP,
                  'carryClearanceM': round(REST_PLANE - HC_H - stack_top, 3), 'referenceContainer': '40HC', 'tag': 'V',
                  'note': '8 rows at 2.9 m pitch inside the 25.4 m span (the engine row pitch); a carried box clears a 5-high stack by the engine travel clearance'},
        'branding': {'manufacturerWordmark': 'ZPMC', 'livery': 'TTI ALGECIRAS', 'swlMark': '40 t', 'unitNumber': UNIT_LABEL, 'bridgePanelNumbers': f'1..{ROWS}',
                     'signBand': ['unit number', 'TTI ALGECIRAS', 'ZPMC', '40 t'], 'operatorBranding': True, 'tag': 'P',
                     'placement': 'a white sign band along the outer face of both girders, left to right: unit number, TTI ALGECIRAS, ZPMC builder plate, 40 t (dark text on white, as on the real cranes); numbered row panels below it',
                     'note': 'text only, set in open-licence typefaces (Archivo ExtraBold, Montserrat ExtraBold): no logo artwork'},
        'lods': {f'LOD{i}': dict({'triangles': info['triangles'][f'LOD{i}'], 'material': 'asc_atlas'}, **({'maxDistanceM': LOD_MAX_DISTANCE_M[i]} if i < 2 else {})) for i in range(3)},
        'provenance': [
            {'fact': '25.4 m rail span over 8 container rows, 40 t rated load', 'tag': 'V', 'source': 'spec #24 (rails, rows and ASC rating)'},
            {'fact': 'cobalt-blue rail-mounted gantry: twin box-beam bridge, legs flaring into the girders, violet rail bogies, stairs on two legs, white sign band along the girders, trolley with hoist machinery, yellow spreader',
             'tag': 'P', 'source': 'TTI Algeciras reference photos asc-* (ignored by version control, never committed; the generator does not read them)'},
            {'fact': 'leg, girder, trolley and e-house proportions; 24.7 m overall height; bridge underside 20.0 m', 'tag': 'A',
             'reason': 'no manufacturer drawing in the repo; sized so a 5-high stack plus a carried box fits under the bridge'},
            {'fact': 'portal length 9.4 m (sill) plus buffers, so two ASCs fit the engine 12 m minimum centre separation', 'tag': 'A'},
            {'fact': '40 ft spreader with end beams, telescopic tubes and four twist-locks at the ISO 1161 casting centres', 'tag': 'V', 'source': 'ISO 1161 / ISO 668'},
            {'fact': 'TTI ALGECIRAS, ZPMC and "40 t" plates baked into the atlas (text only), numbered bridge panels 1..8 over the rows', 'tag': 'P', 'source': 'asc-* reference photos'},
            {'fact': 'beacon positions: one amber gantry-alarm lamp on the rail-end face of each leg', 'tag': 'A', 'reason': 'no beacons are visible in the photos'},
            {'fact': 'rope strands are a scaled node (rest length follows the hoist); stiffener ribs, grating and rungs as boxes', 'tag': 'M', 'reason': 'triangle budget'},
        ],
    }
