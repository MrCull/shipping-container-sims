"""Terminal Twin asset generator (Blender bpy, headless).

Normally run through `npm run tt:assets` (which also compresses the GLBs and
copies everything into assets/models/). Direct use:

    python build.py --out <staging dir> [--only containers] [--no-previews]
    blender --background --python build.py -- --out <staging dir>

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
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True  # keep __pycache__ out of the sim folder

import bpy  # noqa: E402

from tt_assets import blender as B  # noqa: E402
from tt_assets import containers as C  # noqa: E402
from tt_assets import liveries as LV  # noqa: E402
from tt_assets import sts as STS  # noqa: E402
from tt_assets import sts_atlas as STSA  # noqa: E402

FONTS = os.path.join(HERE, 'fonts')
GROUPS = ('containers', 'sts')
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


def main(argv):
    p = argparse.ArgumentParser(description='Generate Terminal Twin assets with Blender (bpy).')
    p.add_argument('--out', required=True, help='staging directory')
    p.add_argument('--only', choices=GROUPS, action='append', help='asset group(s); default all')
    p.add_argument('--no-previews', action='store_true', help='skip Cycles previews (fast iteration)')
    p.add_argument('--samples', type=int, default=48, help='Cycles samples per preview')
    args = p.parse_args(argv)
    groups = args.only or list(GROUPS)
    print(f'bpy {bpy.app.version_string}', flush=True)
    if 'containers' in groups:
        build_containers(os.path.join(args.out, 'containers'), previews=not args.no_previews, samples=args.samples)
    if 'sts' in groups:
        build_sts(os.path.join(args.out, 'sts'), previews=not args.no_previews, samples=args.samples)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    main(argv)
