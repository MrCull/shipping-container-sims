"""Truck atlas rendering and rig sidecars (TT-26). Geometry lives in truck.py."""
import bpy

from . import truck as T


def render_atlas(path, fonts_dir, samples=16):
    """8 livery tiles (4 x 2): swatch grid, maker wordmark and a licence plate each (Cycles, emission only)."""
    from .blender import hex_to_linear, reset_scene
    from .liveries import _Canvas

    scene = reset_scene()
    c = _Canvas(fonts_dir)
    c.rect(0, 0, T.ATLAS_W, T.ATLAS_H, '#808080')
    for index, liv in enumerate(T.LIVERIES):
        ox, oy = (index % T.TILE_COLS) * T.TILE, (index // T.TILE_COLS) * T.TILE
        sw = T.tile_swatches(index)
        for i, name in enumerate(T.SWATCH_NAMES):
            x, y = ox + (i % 8) * T.CELL, oy + (i // 8) * T.CELL
            c.rect(x, y, x + T.CELL, y + T.CELL, sw[name])
        x0, y0, x1, y1 = T.REGIONS['wordmark']
        c.rect(ox + x0, oy + y0, ox + x1, oy + y1, sw['dark'])
        c.text(liv['maker'].upper(), liv['font'], '#f1f1ef', ox + (x0 + x1) / 2, oy + (y0 + y1) / 2, (x1 - x0) * 0.86, (y1 - y0) * 0.62, liv['spacing'])
        x0, y0, x1, y1 = T.REGIONS['plate']
        c.rect(ox + x0, oy + y0, ox + x1, oy + y1, '#f1f1ef')
        c.rect(ox + x0, oy + y0, ox + x0 + 22, oy + y1, '#1f4e9c')
        c.text(f'TT {26 + index:02d} HAU', 'Archivo-ExtraBold.ttf', '#14161a', ox + x0 + 22 + (x1 - x0 - 22) / 2, oy + (y0 + y1) / 2, (x1 - x0) * 0.7, (y1 - y0) * 0.6)
    cam = bpy.data.objects.new('atlas-camera', bpy.data.cameras.new('atlas-camera'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = T.ATLAS_W
    cam.data.clip_start = 0.1
    cam.data.clip_end = 100
    cam.location = (T.ATLAS_W / 2, -T.ATLAS_H / 2, 50)
    scene.collection.objects.link(cam)
    scene.camera = cam
    world = bpy.data.worlds.new('none')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = hex_to_linear('#000000')
    scene.world = world
    scene.render.resolution_x = T.ATLAS_W
    scene.render.resolution_y = T.ATLAS_H
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
    """Blender (x, y, z) -> glTF (x, z, -y), rounded to 0.1 mm."""
    x, y, z = p
    return [round(x, 4), round(z, 4), round(-y + 0.0, 4)]


def atlas_manifest():
    return {
        'image': 'embedded in each truck GLB (material truck_atlas baseColorTexture)',
        'size': [T.ATLAS_W, T.ATLAS_H],
        'tileCols': T.TILE_COLS,
        'tileRows': T.TILE_ROWS,
        'tileSizeUv': [T.TILE / T.ATLAS_W, T.TILE / T.ATLAS_H],
        'uvConvention': 'glTF TEXCOORD_0 is authored for tile 0; shift by (index % tileCols, floor(index / tileCols)) * tileSizeUv',
    }


def sidecar(info):
    cab = info['cab']
    name = info['name']
    truck = cab is not None
    pins = []
    for tag, xs, label in (('40', (T.PIN_X_END, -T.PIN_X_END), 'ISO 1161 corner casting centres of a 40 ft box'),
                           ('20_mid', (T.PIN_X_MID, -T.PIN_X_MID), 'inner castings of two 20 ft boxes standing end to end (76 mm gap)')):
        for x in xs:
            for sy, side in ((1, 'l'), (-1, 'r')):
                pos = 'f' if x > 0 else 'r'
                pins.append({'name': f'pin_{tag}_{pos}{side}', 'position': _gl((x, sy * T.PIN_Y, T.DECK)), 'parent': 'chassis', 'tag': 'V', 'source': label})
    loads = [
        {'name': 'load_40', 'position': _gl((0, 0, T.DECK)), 'parent': 'chassis', 'tag': 'V',
         'description': 'bottom centre of a 40 ft box (20 ft + 20 ft pairs use load_20_twin_*); the model origin is directly below it'},
        {'name': 'load_20_front', 'position': _gl((T.BOX20_X, 0, T.DECK)), 'parent': 'chassis', 'tag': 'V',
         'description': 'bottom centre of a single 20 ft box on the front pins (the pin at the centre line plus the front end pins)'},
        {'name': 'load_20_rear', 'position': _gl((-T.BOX20_X, 0, T.DECK)), 'parent': 'chassis', 'tag': 'V', 'description': 'a single 20 ft box on the rear pins'},
        {'name': 'load_20_twin_a', 'position': _gl((T.BOX20_X, 0, T.DECK)), 'parent': 'chassis', 'tag': 'V', 'description': 'front 20 ft box of a twin pair'},
        {'name': 'load_20_twin_b', 'position': _gl((-T.BOX20_X, 0, T.DECK)), 'parent': 'chassis', 'tag': 'V', 'description': 'rear 20 ft box of a twin pair'},
    ]
    nodes = [
        {'name': 'LOD0', 'parent': name, 'role': 'lod', 'description': 'full detail'},
        {'name': 'LOD1', 'parent': name, 'role': 'lod', 'description': 'simplified, rig kept (wheels, steering, fifth wheel)'},
        {'name': 'LOD2', 'parent': name, 'role': 'lod', 'description': 'silhouette: chassis (wheels merged in) and tractor on the fifth wheel pivot' if truck else 'silhouette: chassis with the wheels merged in'},
        {'name': 'chassis', 'parent': 'LOD*', 'role': 'mesh', 'description': 'rails, gooseneck, cross members, twist-lock housings, landing legs, lights'},
    ]
    limits = {}
    axle_note = 'pivot on the axle; travelling towards +X is a negative rotation about +Z'
    for i, ax in enumerate(T.TRAILER_X):
        piv = _gl((ax, 0, T.R))
        nodes.append({'name': f'wheel_t{i + 1}', 'parent': 'LOD*', 'role': 'rig', 'pivot': piv, 'axis': '+Z', 'description': 'trailer axle, tyres both sides; ' + axle_note})
        limits[f'wheel_t{i + 1}'] = {'type': 'rotation', 'axis': '+Z', 'minDeg': -360, 'maxDeg': 360, 'rest': 0, 'continuous': True, 'tag': 'A'}
    if truck:
        king = _gl((T.KING_X, 0, 0))
        nodes.append({'name': 'fifth_wheel', 'parent': 'LOD*', 'role': 'rig', 'pivot': king, 'axis': '+Y',
                      'description': 'articulation pivot: vertical axis through the kingpin; the tractor turns about it relative to the chassis. Positive = the tractor yaws to the left'})
        limits['fifth_wheel'] = {'type': 'rotation', 'axis': '+Y', 'minDeg': -T.MAX_ARTIC_DEG, 'maxDeg': T.MAX_ARTIC_DEG, 'rest': 0, 'tag': 'A'}
        nodes.append({'name': 'tractor', 'parent': 'fifth_wheel', 'role': 'mesh', 'description': 'frame, fifth wheel, tanks, cab, mirrors, lights, bumper'})
        for n, sy in T.CORNERS:
            piv = _gl((T.FRONT_X, sy * T.FRONT_STEER_Y, T.R))
            nodes.append({'name': f'steer_{n}', 'parent': 'fifth_wheel', 'role': 'rig', 'pivot': piv, 'axis': '+Y',
                          'description': 'steering knuckle, vertical axis at the wheel centre; positive = turns left'})
            nodes.append({'name': f'wheel_{n}', 'parent': f'steer_{n}', 'role': 'rig', 'pivot': piv, 'axis': '+Z', 'description': 'front tyre; ' + axle_note})
            limits[f'steer_{n}'] = {'type': 'rotation', 'axis': '+Y', 'minDeg': -T.MAX_STEER_DEG, 'maxDeg': T.MAX_STEER_DEG, 'rest': 0, 'tag': 'A'}
            limits[f'wheel_{n}'] = {'type': 'rotation', 'axis': '+Z', 'minDeg': -360, 'maxDeg': 360, 'rest': 0, 'continuous': True, 'tag': 'A'}
        nodes.append({'name': 'wheel_r', 'parent': 'fifth_wheel', 'role': 'rig', 'pivot': _gl((T.DRIVE_X, 0, T.R)), 'axis': '+Z',
                      'description': 'drive axle, dual tyres both sides; ' + axle_note})
        limits['wheel_r'] = {'type': 'rotation', 'axis': '+Z', 'minDeg': -360, 'maxDeg': 360, 'rest': 0, 'continuous': True, 'tag': 'A'}
    front_x = T.CAB_X1 + 0.12 if truck else T.PIN_X_END + 0.12
    length = front_x - T.REAR_X
    meta = {
        'asset': name,
        'kind': 'truck' if truck else 'chassis',
        'version': 1,
        'generator': 'src/sims/terminal-twin/assets/generators/build.py --only trucks',
        'units': 'm',
        'dimensions': {'lengthM': round(length, 3), 'widthM': 2.55, 'heightM': info['height'], 'tag': 'A',
                       'reason': 'generic European tractor and 3-axle 40 ft skeletal chassis; no manufacturer drawing (rear of chassis to cab bumper, within the 16.5 m EU limit)'},
        'axes': {'up': '+Y', 'length': '+X (cab end)', 'width': '+Z', 'origin': 'ground contact below the centre of a 40 ft box on the chassis', 'handedness': 'right-handed, glTF'},
        'nodes': nodes,
        'travelLimits': limits,
        'attachPoints': loads + pins,
        'loadConfigurations': [
            {'mode': '40', 'seats': ['load_40'], 'pins': ['pin_40_fl', 'pin_40_fr', 'pin_40_rl', 'pin_40_rr'], 'tag': 'V',
             'description': 'one 40 ft box (also 40 ft high-cube) on the four end castings'},
            {'mode': '20', 'seats': ['load_20_front', 'load_20_rear'], 'pins': ['pin_40_fl', 'pin_40_fr', 'pin_20_mid_fl', 'pin_20_mid_fr'], 'tag': 'V',
             'description': 'one 20 ft box on the front pins (load_20_front) or the rear pins (load_20_rear)'},
            {'mode': 'twin-20', 'seats': ['load_20_twin_a', 'load_20_twin_b'], 'pins': ['pin_40_fl', 'pin_40_fr', 'pin_20_mid_fl', 'pin_20_mid_fr', 'pin_20_mid_rl', 'pin_20_mid_rr', 'pin_40_rl', 'pin_40_rr'], 'tag': 'V',
             'description': 'two 20 ft boxes end to end, meeting at the middle castings'},
        ],
        'chassisDetail': ['mudguards', 'landing legs', 'twist-lock levers', 'mud flaps', 'under-run bar'] + (['air lines'] if truck else []),
        'groundContact': {'y': 0, 'points': sorted(k for k in limits if k.startswith('wheel_')), 'tag': 'V'},
        'wheel': {'radiusM': T.R, 'tyreWidthM': T.TYRE_W, 'tag': 'A', 'note': 'roll angle = -distance / radius about +Z'},
        'chassis': {'deckY': T.DECK, 'kingpin': _gl((T.KING_X, 0, T.DECK)), 'axlesX': list(T.TRAILER_X), 'rearX': T.REAR_X, 'frontPinX': T.PIN_X_END, 'tag': 'A',
                    'note': 'box bottom sits on the twist-lock housings at deckY; a 20 ft box on the front pins has its centre 3.0675 m ahead of the model origin'},
        'lods': {f'LOD{i}': {'triangles': info['triangles'][f'LOD{i}'], 'material': 'truck_atlas'} for i in range(3)},
        'provenance': [
            {'fact': 'twist-lock housings at the ISO 1161 casting centres: 11.985 m x 2.259 m for a 40 ft box, 5.853 m for a 20 ft box', 'tag': 'V', 'source': 'ISO 1161 / ISO 668'},
            {'fact': 'deck height 1.3 m, tyre radius 0.5 m, tri-axle trailer group, 3.7 m tractor wheelbase', 'tag': 'A', 'reason': 'typical European 40 ft skeletal chassis and 4x2 tractor; engine TRUCK_DECK_M = 1.3'},
            {'fact': 'gooseneck chassis with a kingpin 1.1 m behind the front pins', 'tag': 'A'},
            {'fact': 'grey skeletal tri-axle chassis with wing guards over the tyres, landing legs with gearbox, twist-lock levers and a rear under-run bar',
             'tag': 'P', 'source': 'reference photo container-20ft-side-and-door-on-chassis (ignored by version control, never committed; the generator does not read it)'},
            {'fact': 'rigid tyre tread lugs and rim details are low-poly', 'tag': 'M', 'reason': 'triangle budget'},
        ],
    }
    if truck:
        meta['liveries'] = [{'index': i, 'maker': l['maker'], 'cabColour': l['cab'], 'chassisColour': l['chassis'], 'typeface': l['font'].replace('.ttf', ''), 'tag': 'A'}
                            for i, l in enumerate(T.LIVERIES)]
        meta['atlas'] = atlas_manifest()
        meta['fifthWheel'] = {'node': 'fifth_wheel', 'pivot': _gl((T.KING_X, 0, 0)), 'maxArticulationDeg': T.MAX_ARTIC_DEG, 'tag': 'A'}
        meta['branding'] = {'wordmarks': sorted({l['maker'] for l in T.LIVERIES}), 'operatorBranding': False, 'tag': 'A',
                            'note': 'truck maker names set in open-licence typefaces on the grille and doors; no logo artwork; no haulier names'}
        meta['cab'] = {'shape': cab, 'heightM': T.CABS[cab]['height'], 'tag': 'A'}
        meta['provenance'].append({'fact': 'cab-over cab shapes (high sleeper, mid sleeper, day cab) with maker wordmarks', 'tag': 'P', 'source': 'public photographs of Volvo, Scania, DAF, MAN and Mercedes-Benz tractors (not committed)'})
        meta['provenance'].append({'fact': 'steering to 35 degrees, articulation up to 40 degrees', 'tag': 'A'})
    return meta
