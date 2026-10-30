"""Terminal Twin asset generator (Blender bpy, headless).

Normally run through `pnpm run tt:assets` (which also compresses the GLBs and
copies everything into assets/models/). Direct use:

    python build.py --out <staging dir> [--only containers] [--no-previews]
    blender --background --python build.py -- --out <staging dir>

Groups: containers, shc, asc, sts, trucks, vessels, infrastructure (needs --vessel-classes <json>: the engine class table + bay grid). Writes, under <staging>/shc/: shc.glb, shc.meta.json, previews/shc-<view>.webp.
Writes, under <staging>/sts/:
    sts-malaccamax.glb / .meta.json   rigged Malaccamax quay crane (LOD0-2)
    sts-atlas.json                    paint/branding atlas layout (crane-number plates)
    previews/*.webp                   front, side, rear, three-quarter, trolley/spreader close-up

Writes, under <staging>/containers/:
    container-<size>.glb        raw export (uncompressed; the Node step adds meshopt)
    container-<size>.meta.json  rig/metadata sidecar
    livery-atlas.json           atlas layout and livery index table
    previews/*.webp             Cycles CPU previews (front, side, rear, three-quarter) + atlas
"""
import argparse
import json
import math
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True  # keep __pycache__ out of the sim folder

import bpy  # noqa: E402

from tt_assets import blender as B  # noqa: E402
from tt_assets import containers as C  # noqa: E402
from tt_assets import liveries as LV  # noqa: E402
from tt_assets import asc as A  # noqa: E402
from tt_assets import asc_meta as AM  # noqa: E402
from tt_assets import shc as S  # noqa: E402
from tt_assets import shc_meta as SM  # noqa: E402
from tt_assets import vessel_liveries as VLV  # noqa: E402
from tt_assets import vessels as VS  # noqa: E402
from tt_assets import truck as TR  # noqa: E402
from tt_assets import truck_meta as TM  # noqa: E402
from tt_assets import infrastructure as INF  # noqa: E402
from tt_assets import infrastructure_meta as INFM  # noqa: E402

FONTS = os.path.join(HERE, 'fonts')
GROUPS = ('containers', 'shc', 'asc', 'sts', 'vessels', 'trucks', 'infrastructure')
from tt_assets import sts as STS  # noqa: E402
from tt_assets import sts_atlas as STSA  # noqa: E402

# Where the twin mounts the STS root (scene Z of the waterside rail); see modules/stsAssets.ts.
SCENE_WATER_RAIL_Z = 3.0


def write_json(path, data):
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write('\n')


def build_containers(out_dir, previews=True, samples=48):
    os.makedirs(out_dir, exist_ok=True)
    preview_dir = os.path.join(out_dir, 'previews')
    os.makedirs(preview_dir, exist_ok=True)
    tmp = os.path.join(out_dir, '.work')
    os.makedirs(tmp, exist_ok=True)

    atlas_png = os.path.join(tmp, 'livery-atlas.png')
    normal_png = os.path.join(tmp, 'corrugation-normal.png')
    print('[containers] rendering livery atlas', flush=True)
    LV.render_atlas(atlas_png, FONTS)
    write_json(os.path.join(out_dir, 'livery-atlas.json'), LV.atlas_manifest())
    if previews:
        B.reset_scene()
        img = B.load_image(atlas_png)
        img.scale(1024, 1024)
        scene = bpy.context.scene
        scene.render.image_settings.file_format = 'WEBP'
        scene.render.image_settings.quality = 85
        scene.render.image_settings.color_mode = 'RGB'
        img.save_render(os.path.join(preview_dir, 'livery-atlas.webp'), scene=scene)

    B.reset_scene()
    LV.write_corrugation_normal_map(normal_png, C.TARGET_PITCH_M)

    for size in C.SIZES:
        B.reset_scene()
        atlas = B.load_image(atlas_png, name='livery-atlas')
        normal = B.load_image(normal_png, non_color=True, name='corrugation-normal')
        root, info = C.build_container(size, atlas, normal)
        name = info['name']
        print(f'[containers] {name}: LOD0 {info["triangles"]["LOD0"]} tris, LOD1 {info["triangles"]["LOD1"]} tris', flush=True)
        B.export_glb(root, os.path.join(out_dir, f'{name}.glb'))
        write_json(os.path.join(out_dir, f'{name}.meta.json'), C.sidecar(size, info))
        if not previews:
            continue
        # Previews show LOD0 with closed doors in the tile-0 (HMM) livery.
        bpy.data.objects['LOD1'].hide_render = True
        cam, _ = B.setup_preview_stage()
        L, H = info['dims']['length'], info['dims']['height']
        reach = max(L, 6.0)
        target = (0, 0, H * 0.45)
        views = {
            'front': ((-(L / 2 + reach * 1.15), 0, H * 0.55), target),
            'side': ((0, -(reach * 1.55), H * 0.55), target),
            'rear': (((L / 2 + reach * 1.15), 0, H * 0.55), target),
            'three-quarter': (((L / 2 + reach * 0.75), -(reach * 1.05), H + reach * 0.55), target),
        }
        for view, (loc, tgt) in views.items():
            B.render_preview(cam, loc, tgt, os.path.join(preview_dir, f'{name}-{view}.webp'), samples=samples)


def strip_lod_suffix(path):
    """Renames `name@LODn` nodes/meshes to `name` in a GLB's JSON chunk (Blender object names must be
    unique, glTF node names need not be: every LOD repeats the rig node names)."""
    with open(path, 'rb') as f:
        data = f.read()
    magic, version, _ = struct.unpack_from('<III', data, 0)
    jlen, jtype = struct.unpack_from('<II', data, 12)
    assert magic == 0x46546C67 and jtype == 0x4E4F534A
    doc = json.loads(data[20:20 + jlen].decode('utf-8'))
    for key in ('nodes', 'meshes'):
        for item in doc.get(key, []):
            if 'name' in item:
                item['name'] = re.sub(r'@LOD\d$', '', item['name'])
    text = json.dumps(doc, separators=(',', ':')).encode('utf-8')
    text += b' ' * (-len(text) % 4)
    rest = data[20 + jlen:]
    out = struct.pack('<III', magic, version, 12 + 8 + len(text) + len(rest)) + struct.pack('<II', len(text), jtype) + text + rest
    with open(path, 'wb') as f:
        f.write(out)


def build_shc(out_dir, previews=True, samples=48):
    os.makedirs(out_dir, exist_ok=True)
    preview_dir = os.path.join(out_dir, 'previews')
    os.makedirs(preview_dir, exist_ok=True)
    tmp = os.path.join(out_dir, '.work')
    os.makedirs(tmp, exist_ok=True)
    atlas_png = os.path.join(tmp, 'shc-atlas.png')
    print('[shc] rendering atlas', flush=True)
    SM.render_atlas(atlas_png, FONTS)
    B.reset_scene()
    atlas = B.load_image(atlas_png, name='shc-atlas')
    root, info = S.build_shc(atlas)
    info['height'] = 9.7
    print(f'[shc] LOD0 {info["triangles"]["LOD0"]} tris, LOD1 {info["triangles"]["LOD1"]}, LOD2 {info["triangles"]["LOD2"]}', flush=True)
    glb = os.path.join(out_dir, 'shc.glb')
    B.export_glb(root, glb)
    strip_lod_suffix(glb)
    write_json(os.path.join(out_dir, 'shc.meta.json'), SM.sidecar(info))
    if not previews:
        return
    S.hide_lods_for_preview('LOD0')
    cam, _ = B.setup_preview_stage(ground_size=120.0)
    # Camera positions in Blender axes (front = +X, cab side = +Y); the spreader rests raised.
    views = {
        'front': ((34.0, 0, 6.0), (0, 0, 4.2)),
        'side': ((0, -30.0, 5.0), (0, 0, 4.2)),
        'rear': ((-34.0, 0, 6.0), (0, 0, 4.2)),
        'three-quarter': ((15.0, -17.0, 13.0), (0, 0, 3.8)),
    }
    for view, (loc, tgt) in views.items():
        B.render_preview(cam, loc, tgt, os.path.join(preview_dir, f'shc-{view}.webp'), samples=samples)


def _gl_to_blender(p):
    return (p[0], -p[2], p[1])


def pose_sts(objects, trolley_z, hoist_y, mode='40', boom_deg=0.0):
    """Poses LOD0 like the renderer does (rig values in the sidecar's units)."""
    import math
    o = {name: obj for name, (obj, _) in objects.items()}
    o['trolley'].location = _gl_to_blender((0, STS.TROLLEY_RAIL_Y, trolley_z))
    o['hoist'].location = _gl_to_blender((0, hoist_y - STS.TROLLEY_RAIL_Y, 0))
    o['ropes'].scale = (1, 1, STS.TROLLEY_RAIL_Y - (hoist_y + STS.HEADBLOCK_SHEAVE_Y))
    modes = STS.SPREADER_MODES[mode]
    o['spreader_tele_fore'].location = _gl_to_blender((STS.TELE_X + modes['spreader_tele_fore'], 0, 0))
    o['spreader_tele_aft'].location = _gl_to_blender((-STS.TELE_X - modes['spreader_tele_aft'], 0, 0))
    o['twin_locks'].location = _gl_to_blender((0, STS.TWIN_DROP - modes['twin_locks'], 0))
    o['boom'].rotation_euler = (math.radians(boom_deg), 0, 0)


def build_sts(out_dir, previews=True, samples=48):
    os.makedirs(out_dir, exist_ok=True)
    preview_dir = os.path.join(out_dir, 'previews')
    os.makedirs(preview_dir, exist_ok=True)
    tmp = os.path.join(out_dir, '.work')
    os.makedirs(tmp, exist_ok=True)
    atlas_png = os.path.join(tmp, 'sts-atlas.png')
    print('[sts] rendering paint/branding atlas', flush=True)
    STSA.render_atlas(atlas_png, FONTS)
    write_json(os.path.join(out_dir, 'sts-atlas.json'), STSA.manifest())

    B.reset_scene()
    atlas = B.load_image(atlas_png, name='sts-atlas')
    root, info = STS.build_sts(atlas)
    t = info['triangles']
    print(f'[sts] {STS.NAME}: LOD0 {t["LOD0"]} tris, LOD1 {t["LOD1"]} tris, LOD2 {t["LOD2"]} tris', flush=True)
    B.export_glb(root, os.path.join(out_dir, f'{STS.NAME}.glb'))
    write_json(os.path.join(out_dir, f'{STS.NAME}.meta.json'), STS.sidecar(info, SCENE_WATER_RAIL_Z))
    if not previews:
        return
    for lod in ('LOD1', 'LOD2'):
        for obj in [bpy.data.objects[lod]] + list(bpy.data.objects[lod].children_recursive):
            obj.hide_render = True
    cam, ground = B.setup_preview_stage(ground_size=700.0)
    cam.data.clip_end = 3000.0
    # Preview-only props: the two crane rails and a 40 ft box on the spreader (not exported).
    props = bpy.data.materials.new('preview-props')
    props.use_nodes = True
    props.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = B.hex_to_linear('#3b4148')
    box_mat = bpy.data.materials.new('preview-box')
    box_mat.use_nodes = True
    box_mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = B.hex_to_linear('#2f5fae')

    def slab(name, lo, hi, mat, parent=None):
        lo_b, hi_b = _gl_to_blender(lo), _gl_to_blender(hi)
        x0, x1 = sorted((lo_b[0], hi_b[0]))
        y0, y1 = sorted((lo_b[1], hi_b[1]))
        z0, z1 = sorted((lo_b[2], hi_b[2]))
        mesh = bpy.data.meshes.new(name)
        v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        mesh.from_pydata(v, [], f)
        mesh.materials.append(mat)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        if parent is not None:
            obj.parent = parent
        return obj
    for z in (0.0, STS.RAIL_GAUGE):
        slab(f'rail-{z}', (-300, 0.0, z - 0.2), (300, 0.12, z + 0.2), props)
    slab('quay-edge', (-300, 0.0, -3.0), (300, 0.02, -2.6), props)
    spreader = info['objects']['spreader'][0]
    slab('box-40', (-6.096, -2.591, -1.219), (6.096, 0.0, 1.219), box_mat, parent=spreader)

    pose_sts(info['objects'], trolley_z=-34.0, hoist_y=24.0, mode='40')
    target = _gl_to_blender((0, 38, -4))
    views = {
        'side': (_gl_to_blender((290, 42, -6)), target),
        'front': (_gl_to_blender((30, 34, -185)), _gl_to_blender((0, 42, 8))),
        'rear': (_gl_to_blender((-36, 30, 180)), _gl_to_blender((0, 42, 12))),
        'three-quarter': (_gl_to_blender((185, 125, -175)), target),
    }
    for view, (loc, tgt) in views.items():
        B.render_preview(cam, loc, tgt, os.path.join(preview_dir, f'{STS.NAME}-{view}.webp'), samples=samples)
    # Close-up: trolley and spreader near the top, twin-20 configuration.
    pose_sts(info['objects'], trolley_z=-30.0, hoist_y=44.0, mode='twin-20')
    bpy.data.objects['box-40'].hide_render = True
    for i, cx in enumerate((-STS.HALF_OFFSET, STS.HALF_OFFSET)):
        b = slab(f'box-20-{i}', (cx - 3.029, -2.591, -1.219), (cx + 3.029, 0.0, 1.219), box_mat, parent=spreader)
        del b
    B.render_preview(cam, _gl_to_blender((27, 53, -52)), _gl_to_blender((0, 50.5, -30)),
                     os.path.join(preview_dir, f'{STS.NAME}-closeup.webp'), samples=samples)


def save_atlas_preview(png, path, size=1024):
    B.reset_scene()
    img = B.load_image(png)
    img.scale(size, size)
    scene = bpy.context.scene
    scene.render.image_settings.file_format = 'WEBP'
    scene.render.image_settings.quality = 85
    scene.render.image_settings.color_mode = 'RGB'
    img.save_render(path, scene=scene)


def build_vessels(out_dir, classes_file, previews=True, samples=48):
    with open(classes_file, encoding='utf-8') as f:
        table = json.load(f)
    os.makedirs(out_dir, exist_ok=True)
    preview_dir = os.path.join(out_dir, 'previews')
    os.makedirs(preview_dir, exist_ok=True)
    tmp = os.path.join(out_dir, '.work')
    os.makedirs(tmp, exist_ok=True)
    atlas_png = os.path.join(tmp, 'vessel-livery-atlas.png')
    print('[vessels] rendering vessel livery atlas', flush=True)
    VLV.render_atlas(atlas_png, FONTS)
    write_json(os.path.join(out_dir, 'vessel-livery-atlas.json'), VLV.manifest())
    if previews:
        save_atlas_preview(atlas_png, os.path.join(preview_dir, 'vessel-livery-atlas.webp'))

    for key, cls in table['classes'].items():
        B.reset_scene()
        atlas = B.load_image(atlas_png, name='vessel-livery-atlas')
        root, info = VS.build_vessel(key, cls, table['grid'], atlas)
        name = info['name']
        t = info['triangles']
        print(f'[vessels] {name}: LOD0 {t["LOD0"]} tris, LOD1 {t["LOD1"]} tris, LOD2 {t["LOD2"]} tris', flush=True)
        B.export_glb(root, os.path.join(out_dir, f'{name}.glb'))
        write_json(os.path.join(out_dir, f'{name}.meta.json'), VS.sidecar(key, cls, table['grid'], info))
        if not previews:
            continue
        # Previews show LOD0 in the tile-0 (HMM) livery, on water.
        for lod in ('LOD1', 'LOD2'):
            for child in bpy.data.objects[lod].children:
                child.hide_render = True
        L = cls['loaM']
        cam, ground = B.setup_preview_stage(ground_size=L * 8)
        ground.location = (L / 2, 0, 0)
        ground.data.materials[0].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = B.hex_to_linear('#2d5873')
        ground.data.materials[0].node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.3
        cam.data.clip_end = L * 10
        h = info['hull']
        top = h.z_bridge
        views = {
            'side': ((L * 0.5, -L * 1.25, top * 0.9), (L * 0.5, 0, top * 0.35)),
            'three-quarter': ((L * 1.1, -L * 0.75, L * 0.38), (L * 0.5, 0, top * 0.25)),
            'bow': ((L + L * 0.32, -L * 0.2, top * 0.75), (L * 0.75, 0, top * 0.4)),
        }
        for view, (loc, tgt) in views.items():
            B.render_preview(cam, loc, tgt, os.path.join(preview_dir, f'{name}-{view}.webp'), samples=samples)
    os.makedirs(out_dir, exist_ok=True)
    preview_dir = os.path.join(out_dir, 'previews')
    os.makedirs(preview_dir, exist_ok=True)
    tmp = os.path.join(out_dir, '.work')
    os.makedirs(tmp, exist_ok=True)


def build_asc(out_dir, previews=True, samples=48):
    os.makedirs(out_dir, exist_ok=True)
    preview_dir = os.path.join(out_dir, 'previews')
    os.makedirs(preview_dir, exist_ok=True)
    tmp = os.path.join(out_dir, '.work')
    os.makedirs(tmp, exist_ok=True)
    atlas_png = os.path.join(tmp, 'asc-atlas.png')
    print('[asc] rendering atlas', flush=True)
    AM.render_atlas(atlas_png, FONTS)
    B.reset_scene()
    atlas = B.load_image(atlas_png, name='asc-atlas')
    root, info = A.build_asc(atlas)
    info['height'] = A.TOTAL_HEIGHT
    print(f'[asc] LOD0 {info["triangles"]["LOD0"]} tris, LOD1 {info["triangles"]["LOD1"]}, LOD2 {info["triangles"]["LOD2"]}', flush=True)
    glb = os.path.join(out_dir, 'asc.glb')
    B.export_glb(root, glb)
    strip_lod_suffix(glb)
    write_json(os.path.join(out_dir, 'asc.meta.json'), AM.sidecar(info))
    if not previews:
        return
    S.hide_lods_for_preview('LOD0')
    cam, _ = B.setup_preview_stage(ground_size=260.0)
    # Blender axes: X across the rows, Y along the rails (front = -Y), Z up; the hoist rests raised.
    views = {
        'front': ((0, -78.0, 13.0), (0, 0, 12.0)),
        'side': ((72.0, 0, 13.0), (0, 0, 11.5)),
        'rear': ((0, 78.0, 13.0), (0, 0, 12.0)),
        'three-quarter': ((46.0, -50.0, 27.0), (0, 0, 11.0)),
    }
    for view, (loc, tgt) in views.items():
        B.render_preview(cam, loc, tgt, os.path.join(preview_dir, f'asc-{view}.webp'), samples=samples)


def build_trucks(out_dir, previews=True, samples=48):
    """Three tractor cab variants (each with the chassis) and the standalone chassis; one livery atlas for all."""
    os.makedirs(out_dir, exist_ok=True)
    preview_dir = os.path.join(out_dir, 'previews')
    os.makedirs(preview_dir, exist_ok=True)
    tmp = os.path.join(out_dir, '.work')
    os.makedirs(tmp, exist_ok=True)
    atlas_png = os.path.join(tmp, 'truck-atlas.png')
    print('[trucks] rendering livery atlas', flush=True)
    TM.render_atlas(atlas_png, FONTS)
    if previews:
        save_atlas_preview(atlas_png, os.path.join(preview_dir, 'truck-livery-atlas.webp'))
    for cab in list(TR.CABS) + [None]:
        B.reset_scene()
        atlas = B.load_image(atlas_png, name='truck-atlas')
        root, info = TR.build_truck(atlas, cab)
        name = info['name']
        t = info['triangles']
        print(f'[trucks] {name}: LOD0 {t["LOD0"]} tris, LOD1 {t["LOD1"]} tris, LOD2 {t["LOD2"]} tris', flush=True)
        glb = os.path.join(out_dir, f'{name}.glb')
        B.export_glb(root, glb)
        strip_lod_suffix(glb)
        write_json(os.path.join(out_dir, f'{name}.meta.json'), TM.sidecar(info))
        if not previews:
            continue
        S.hide_lods_for_preview('LOD0')
        cam, _ = B.setup_preview_stage(ground_size=80.0)
        # Blender axes: cab end +X, left side +Y. The tractor is steered so the articulation shows.
        if cab:
            for o in bpy.data.objects:
                if o.name == 'fifth_wheel@LOD0':
                    o.rotation_euler = (0, 0, math.radians(18))
        views = {
            'side': ((1.5, -32.0, 2.6), (1.5, 0, 1.9)),
            'three-quarter': ((19.0, -17.0, 6.0), (0.5, 0, 1.5)),
            'front': ((24.0, -5.0, 2.8), (3, 0, 1.8)),
            'rear': ((-20.0, -9.0, 3.0), (0, 0, 1.4)),
        }
        for view, (loc, tgt) in views.items():
            B.render_preview(cam, loc, tgt, os.path.join(preview_dir, f'{name}-{view}.webp'), samples=samples)


def build_infrastructure(out_dir, previews=True, samples=24):
    """Gate modules, quay furniture, yard infrastructure, buildings and backdrop meshes (TT-28); one shared atlas."""
    os.makedirs(out_dir, exist_ok=True)
    preview_dir = os.path.join(out_dir, 'previews')
    os.makedirs(preview_dir, exist_ok=True)
    tmp = os.path.join(out_dir, '.work')
    os.makedirs(tmp, exist_ok=True)
    atlas_png = os.path.join(tmp, 'infra-atlas.png')
    print('[infrastructure] rendering atlas', flush=True)
    INFM.render_atlas(atlas_png, FONTS)
    write_json(os.path.join(out_dir, 'infra-atlas.json'), INFM.atlas_manifest())
    if previews:
        save_atlas_preview(atlas_png, os.path.join(preview_dir, 'infra-atlas.webp'))
    for name, builder, views, ground in INF.ASSETS:
        B.reset_scene()
        atlas = B.load_image(atlas_png, name='infra-atlas')
        root, info = builder(atlas)
        print(f'[infrastructure] {name}: {info["triangles"]["LOD0"]} tris', flush=True)
        glb = os.path.join(out_dir, f'{name}.glb')
        B.export_glb(root, glb)
        strip_lod_suffix(glb)
        write_json(os.path.join(out_dir, f'{name}.meta.json'), INFM.sidecar(info))
        if not previews:
            continue
        cam, _ = B.setup_preview_stage(ground_size=ground)
        cam.data.clip_end = max(500.0, ground * 1.5)
        for i, (loc, tgt) in enumerate(views):
            B.render_preview(cam, INF.gv(loc), INF.gv(tgt), os.path.join(preview_dir, f'{name}-{i + 1}.webp'), samples=samples)


def main(argv):
    p = argparse.ArgumentParser(description='Generate Terminal Twin assets with Blender (bpy).')
    p.add_argument('--out', required=True, help='staging directory')
    p.add_argument('--only', choices=GROUPS, action='append', help='asset group(s); default all')
    p.add_argument('--vessel-classes', help='JSON with the engine vessel class table + bay grid (vessels group)')
    p.add_argument('--no-previews', action='store_true', help='skip Cycles previews (fast iteration)')
    p.add_argument('--samples', type=int, default=48, help='Cycles samples per preview')
    args = p.parse_args(argv)
    groups = args.only or list(GROUPS)
    print(f'bpy {bpy.app.version_string}', flush=True)
    if 'containers' in groups:
        build_containers(os.path.join(args.out, 'containers'), previews=not args.no_previews, samples=args.samples)
    if 'shc' in groups:
        build_shc(os.path.join(args.out, 'shc'), previews=not args.no_previews, samples=args.samples)
    if 'asc' in groups:
        build_asc(os.path.join(args.out, 'asc'), previews=not args.no_previews, samples=args.samples)
    if 'sts' in groups:
        build_sts(os.path.join(args.out, 'sts'), previews=not args.no_previews, samples=args.samples)
    if 'trucks' in groups:
        build_trucks(os.path.join(args.out, 'trucks'), previews=not args.no_previews, samples=args.samples)
    if 'infrastructure' in groups:
        build_infrastructure(os.path.join(args.out, 'infrastructure'), previews=not args.no_previews, samples=min(args.samples, 32))
    if 'vessels' in groups:
        if not args.vessel_classes:
            p.error('--vessel-classes is required for the vessels group')
        build_vessels(os.path.join(args.out, 'vessels'), args.vessel_classes, previews=not args.no_previews, samples=args.samples)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    main(argv)
