"""Shared Blender (bpy) helpers for the Terminal Twin asset generators.

Coordinates here are Blender's: X = asset length, Y = width, Z = up.
The glTF exporter converts to Y-up (glTF X = X, Y = Z, Z = -Y).
Everything is deterministic: no random numbers, fixed render seeds.
"""
import math
import os

import bpy
import mathutils


def reset_scene():
    """Empty factory scene (no default cube, camera or light)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.seed = 0
    scene.cycles.use_animated_seed = False
    scene.cycles.use_denoising = False
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    return scene


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(hex_colour):
    h = hex_colour.lstrip('#')
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


def empty(name, parent=None, location=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    obj.location = location
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


class MeshBuilder:
    """Collects flat-shaded quads with per-corner UVs (one or two UV layers).

    `quad(points, uv0, uv1=None, outward=None)`: points are 4 (x, y, z) tuples
    in order around the face. If `outward` is given, the winding is flipped
    when needed so the face normal points that way.
    """

    def __init__(self, uv_layers=1):
        self.verts = []
        self.faces = []
        self.smooth = []
        self.uvs = [[] for _ in range(uv_layers)]

    def quad(self, points, uv0, uv1=None, outward=None):
        pts = [mathutils.Vector(p) for p in points]
        uv_sets = [list(uv0)] + ([list(uv1)] if uv1 is not None else [])
        if outward is not None:
            n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
            if n.dot(mathutils.Vector(outward)) < 0:
                pts.reverse()
                uv_sets = [list(reversed(u)) for u in uv_sets]
        base = len(self.verts)
        self.verts.extend(tuple(round(c, 6) for c in p) for p in pts)
        self.faces.append(tuple(range(base, base + len(pts))))
        self.smooth.append(False)
        for layer, uvs in enumerate(self.uvs):
            src = uv_sets[layer] if layer < len(uv_sets) else uv_sets[0]
            uvs.extend(src)

    def ngon(self, points, uv, outward=None):
        """A convex polygon face (3+ points), one UV per point (first UV layer only)."""
        pts = [mathutils.Vector(p) for p in points]
        uvs = list(uv)
        if outward is not None:
            n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
            if n.dot(mathutils.Vector(outward)) < 0:
                pts.reverse()
                uvs.reverse()
        base = len(self.verts)
        self.verts.extend(tuple(round(c, 6) for c in p) for p in pts)
        self.faces.append(tuple(range(base, base + len(pts))))
        self.smooth.append(False)
        self.uvs[0].extend(uvs)
        for extra in self.uvs[1:]:
            extra.extend([uvs[0]] * len(pts))

    def shift(self, offset):
        """Moves every vertex by -offset (to express the mesh in a rig node's local frame)."""
        ox, oy, oz = offset
        self.verts = [(x - ox, y - oy, z - oz) for x, y, z in self.verts]

    def tri(self, points, uv0, outward=None):
        """One triangle (same conventions as `quad`)."""
        self.quad(points, uv0, outward=outward)

    def grid(self, rings, uv_of, flip=False, smooth=True):
        """A smooth surface through `rings` (a list of equally long point lists),
        with shared vertices: ring i point j joins ring i+1 point j. `uv_of(point)`
        gives each vertex its UV (so UVs must be continuous over the surface).
        `flip` reverses the winding."""
        base = len(self.verts)
        n = len(rings[0])
        for ring in rings:
            for p in ring:
                self.verts.append(tuple(round(c, 6) for c in p))
                uv = uv_of(p)
                for uvs in self.uvs:
                    uvs.append(uv)
        for i in range(len(rings) - 1):
            for j in range(n - 1):
                a, b = base + i * n + j, base + (i + 1) * n + j
                face = (a, b, b + 1, a + 1)
                self.faces.append(tuple(reversed(face)) if flip else face)
                self.smooth.append(smooth)

    def cylinder(self, centre, radius, height, segments, uv, axis='z', caps=True):
        """Closed prism approximating a cylinder (flat UV `uv`). `axis` x/y/z; `centre` is the base centre."""
        cx, cy, cz = centre

        def at(a, h):
            c, s_ = radius * math.cos(a), radius * math.sin(a)
            if axis == 'z':
                return (cx + c, cy + s_, cz + h)
            if axis == 'y':
                return (cx + c, cy + h, cz + s_)
            return (cx + h, cy + c, cz + s_)
        d = {'x': (1, 0, 0), 'y': (0, 1, 0), 'z': (0, 0, 1)}[axis]
        for k in range(segments):
            a0, a1 = 2 * math.pi * k / segments, 2 * math.pi * (k + 1) / segments
            mid = at((a0 + a1) / 2, height / 2)
            axis_mid = (cx + d[0] * height / 2, cy + d[1] * height / 2, cz + d[2] * height / 2)
            outward = tuple(m - c for m, c in zip(mid, axis_mid))
            self.quad([at(a0, 0), at(a1, 0), at(a1, height), at(a0, height)], [uv] * 4, outward=outward)
        if caps:
            for h, sign in ((0, -1), (height, 1)):
                pts = [at(2 * math.pi * k / segments, h) for k in range(segments)]
                self.quad(pts, [uv] * segments, outward=tuple(sign * c for c in d))

    def box_faces(self, lo, hi, faces, uv_for_face, uv1_for_face=None):
        """Axis-aligned box from `lo` to `hi`, emitting only the listed faces
        ('+x', '-x', '+y', '-y', '+z', '-z'). `uv_for_face(face, corners)`
        returns 4 UVs for the 4 corners."""
        (x0, y0, z0), (x1, y1, z1) = lo, hi
        corners = {
            '+x': [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)],
            '-x': [(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)],
            '+y': [(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)],
            '-y': [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
            '+z': [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)],
            '-z': [(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)],
        }
        normals = {'+x': (1, 0, 0), '-x': (-1, 0, 0), '+y': (0, 1, 0), '-y': (0, -1, 0), '+z': (0, 0, 1), '-z': (0, 0, -1)}
        for f in faces:
            pts = corners[f]
            uv1 = uv1_for_face(f, pts) if uv1_for_face else None
            self.quad(pts, uv_for_face(f, pts), uv1, outward=normals[f])

    @property
    def triangles(self):
        return sum(len(f) - 2 for f in self.faces)

    def extend(self, other):
        """Appends another builder's faces (same UV layer count)."""
        base = len(self.verts)
        self.verts.extend(other.verts)
        self.faces.extend(tuple(base + i for i in f) for f in other.faces)
        self.smooth.extend(other.smooth)
        for mine, theirs in zip(self.uvs, other.uvs):
            mine.extend(theirs)

    def to_object(self, name, material, parent=None, uv_names=('UVMap', 'UV1')):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.verts, [], self.faces)
        mesh.update()
        for layer, uvs in enumerate(self.uvs):
            uv_layer = mesh.uv_layers.new(name=uv_names[layer])
            # Every quad has its own 4 vertices, so a loop's vertex index is its UV index.
            for i, loop in enumerate(mesh.loops):
                uv_layer.data[i].uv = uvs[loop.vertex_index]
        for poly, smooth in zip(mesh.polygons, self.smooth):
            poly.use_smooth = smooth
        mesh.materials.append(material)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        if parent is not None:
            obj.parent = parent
        return obj


def load_image(path, non_color=False, name=None):
    img = bpy.data.images.load(path)
    if name:
        img.name = name
    if non_color:
        img.colorspace_settings.name = 'Non-Color'
    return img


def textured_material(name, base_image, roughness=0.55, metallic=0.0, normal_image=None, normal_uv='UV1', normal_strength=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = base_image
    tex.extension = 'EXTEND'
    tex.interpolation = 'Linear'
    uv0 = nt.nodes.new('ShaderNodeUVMap')
    uv0.uv_map = 'UVMap'
    nt.links.new(uv0.outputs['UV'], tex.inputs['Vector'])
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    if normal_image is not None:
        ntex = nt.nodes.new('ShaderNodeTexImage')
        ntex.image = normal_image
        ntex.extension = 'REPEAT'
        ntex.interpolation = 'Linear'
        uv1 = nt.nodes.new('ShaderNodeUVMap')
        uv1.uv_map = normal_uv
        nt.links.new(uv1.outputs['UV'], ntex.inputs['Vector'])
        nmap = nt.nodes.new('ShaderNodeNormalMap')
        nmap.space = 'TANGENT'
        nmap.uv_map = normal_uv
        nmap.inputs['Strength'].default_value = normal_strength
        nt.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
        nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def emission_material(name, hex_colour):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = hex_to_linear(hex_colour)
    em.inputs['Strength'].default_value = 1.0
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return mat


def select_hierarchy(root):
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    stack = [root]
    while stack:
        o = stack.pop()
        o.select_set(True)
        stack.extend(o.children)


def export_glb(root, path, image_quality=90):
    """Exports `root` and its descendants only, as a GLB with WebP textures."""
    select_hierarchy(root)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials='EXPORT',
        export_image_format='WEBP',
        export_image_quality=image_quality,
        export_extras=False,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_draco_mesh_compression_enable=False,
        export_meshopt_compression_enable=False,
    )


def look_at(obj, target):
    direction = mathutils.Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


def setup_preview_stage(ground_size=80.0):
    """Ground plane, sun and a pale sky for Cycles previews."""
    scene = bpy.context.scene
    world = bpy.data.worlds.new('preview-sky')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = hex_to_linear('#c9d6e3')
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.9
    scene.world = world
    mesh = bpy.data.meshes.new('preview-ground')
    s = ground_size / 2
    mesh.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    ground = bpy.data.objects.new('preview-ground', mesh)
    gm = bpy.data.materials.new('preview-concrete')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = hex_to_linear('#9a9c9a')
    gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.95
    mesh.materials.append(gm)
    scene.collection.objects.link(ground)
    sun = bpy.data.objects.new('preview-sun', bpy.data.lights.new('preview-sun', 'SUN'))
    sun.data.energy = 3.2
    sun.data.angle = math.radians(3)
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new('preview-camera', bpy.data.cameras.new('preview-camera'))
    cam.data.lens = 50
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam, ground


def render_preview(cam, location, target, path, samples=48, width=800, height=600):
    scene = bpy.context.scene
    cam.location = location
    look_at(cam, target)
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.cycles.samples = samples
    scene.cycles.max_bounces = 4
    scene.render.image_settings.file_format = 'WEBP'
    scene.render.image_settings.quality = 82
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    if not os.path.exists(path):
        raise RuntimeError(f'preview not written: {path}')
