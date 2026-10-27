"""Terminal Twin asset generator (Blender bpy, headless).

Normally run through `npm run tt:assets` (which also compresses the GLBs and
copies everything into assets/models/). Direct use:

    python build.py --out <staging dir> [--only containers] [--no-previews]
    blender --background --python build.py -- --out <staging dir>

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

FONTS = os.path.join(HERE, 'fonts')
GROUPS = ('containers',)


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


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    main(argv)
