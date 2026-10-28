"""Shared Blender modelling vocabulary for the Terminal Twin equipment assets (SHC, ASC, ...).

`Atlas` describes a swatch grid plus wide regions (UV lookups); `Part` is a MeshBuilder with box, beam,
plate, lens and revolve helpers that colour every face from the atlas. Moved here from shc.py (TT-25)
so the ASC (TT-24) and later assets reuse it.
"""
import math

import mathutils

from .blender import MeshBuilder


class Atlas:
    """A square atlas: a grid of flat swatch cells (4 per row) from the top-left, then named wide regions."""

    def __init__(self, size, cell, swatches, regions):
        self.size = size
        self.cell = cell
        self.swatches = swatches
        self.order = list(swatches)
        self.regions = regions

    def swatch_uv(self, name):
        i = self.order.index(name)
        cx, cy = (i % 4) * self.cell + self.cell / 2, (i // 4) * self.cell + self.cell / 2
        return (cx / self.size, 1 - cy / self.size)

    def region_uv(self, name):
        x0, y0, x1, y1 = self.regions[name]
        return (x0 / self.size, 1 - y1 / self.size, x1 / self.size, 1 - y0 / self.size)


class Part:
    """A MeshBuilder with the shared modelling vocabulary (all coordinates are node-local Blender)."""

    def __init__(self, atlas):
        self.atlas = atlas
        self.m = MeshBuilder()

    def sw(self, name):
        pt = self.atlas.swatch_uv(name)
        return lambda *_: [pt] * 4

    def box(self, lo, hi, swatch, faces=('+x', '-x', '+y', '-y', '+z', '-z')):
        lo, hi = tuple(min(a, b) for a, b in zip(lo, hi)), tuple(max(a, b) for a, b in zip(lo, hi))
        self.m.box_faces(lo, hi, faces, self.sw(swatch))

    def cbox(self, c, size, swatch, faces=('+x', '-x', '+y', '-y', '+z', '-z')):
        self.box(tuple(c[i] - size[i] / 2 for i in range(3)), tuple(c[i] + size[i] / 2 for i in range(3)), swatch, faces)

    def beam(self, p0, p1, w, h, swatch):
        """Prism of section w x h between two points (h is measured in the plane containing world Z)."""
        a, b = mathutils.Vector(p0), mathutils.Vector(p1)
        d = (b - a).normalized()
        up = mathutils.Vector((0, 0, 1)) if abs(d.z) < 0.95 else mathutils.Vector((1, 0, 0))
        s = d.cross(up).normalized()
        u = s.cross(d).normalized()
        ring = lambda o: [o + s * (w / 2) + u * (h / 2), o - s * (w / 2) + u * (h / 2), o - s * (w / 2) - u * (h / 2), o + s * (w / 2) - u * (h / 2)]
        ra, rb = ring(a), ring(b)
        pt = self.atlas.swatch_uv(swatch)
        for i in range(4):
            j = (i + 1) % 4
            centre = (ra[i] + ra[j] + rb[i] + rb[j]) / 4
            out = centre - (a + b) / 2
            self.m.quad([ra[i], ra[j], rb[j], rb[i]], [pt] * 4, outward=out)
        for r, sign in ((ra, -d), (rb, d)):
            self.m.quad(r, [pt] * 4, outward=sign)

    def plate(self, origin, ex, ey, w, h, region, lift=0.012, normal=None, cell=None):
        """A textured rectangle: `origin` bottom-left, `ex` along the width, `ey` up the height (unit vectors).
        `cell=(i, count)` uses only the i-th of count equal columns of the region (a strip of numbered cells)."""
        o = mathutils.Vector(origin)
        ex, ey = mathutils.Vector(ex), mathutils.Vector(ey)
        n = mathutils.Vector(normal) if normal is not None else ex.cross(ey)
        o = o + n.normalized() * lift
        pts = [o, o + ex * w, o + ex * w + ey * h, o + ey * h]
        u0, v0, u1, v1 = self.atlas.region_uv(region)
        if cell is not None:
            ci, cn = cell
            u0, u1 = u0 + (u1 - u0) * ci / cn, u0 + (u1 - u0) * (ci + 1) / cn
        self.m.quad(pts, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], outward=n)

    def lens(self, c, size, swatch, normal_axis, sign):
        """Thin lamp/lens plate facing +-axis."""
        lo, hi = list(c), list(c)
        for i in range(3):
            lo[i] -= size[i] / 2
            hi[i] += size[i] / 2
        face = ('+' if sign > 0 else '-') + normal_axis
        self.box(tuple(lo), tuple(hi), swatch, (face,))

    def revolve(self, centre, axis, profile, segs, swatch_for, phase=0.0):
        """Surface of revolution about `axis` ('x'|'y'|'z') through `centre`.

        profile: [(rho, h, kind, swatch)...] polyline along the axis (h = offset along the axis);
        kind of the edge to the next point is 'r' (outward radial), 'ri' (inward), 'a+' / 'a-' (faces along the axis).
        """
        cx, cy, cz = centre

        def pt(rho, h, ang):
            c, s = math.cos(ang), math.sin(ang)
            if axis == 'y':
                return (cx + rho * c, cy + h, cz + rho * s)
            if axis == 'z':
                return (cx + rho * c, cy + rho * s, cz + h)
            return (cx + h, cy + rho * c, cz + rho * s)

        for k in range(segs):
            a0 = phase + 2 * math.pi * k / segs
            a1 = phase + 2 * math.pi * (k + 1) / segs
            am = (a0 + a1) / 2
            for e in range(len(profile) - 1):
                r0, h0, kind, sw = profile[e]
                r1, h1 = profile[e + 1][0], profile[e + 1][1]
                s_name = swatch_for(k, e) if callable(swatch_for) else sw
                pts = [pt(r0, h0, a0), pt(r0, h0, a1), pt(r1, h1, a1), pt(r1, h1, a0)]
                if r0 == 0 and r1 == 0:
                    continue
                uv = [self.atlas.swatch_uv(s_name)] * 4
                radial = pt(1, 0, am)
                radial = (radial[0] - cx, radial[1] - cy, radial[2] - cz)
                axial = {'x': (1, 0, 0), 'y': (0, 1, 0), 'z': (0, 0, 1)}[axis]
                if kind in ('a+', 'a-'):
                    sign = 1 if kind == 'a+' else -1
                    out = tuple(sign * v for v in axial)
                elif kind == 'ri':
                    out = tuple(-v for v in radial)
                else:
                    out = radial
                if r0 == 0 or r1 == 0:  # cap: a fan triangle (two corners coincide on the axis)
                    tri = [pts[0], pts[2], pts[3]] if r0 == 0 else [pts[0], pts[1], pts[2]]
                    self.m.ngon(tri, [self.atlas.swatch_uv(s_name)] * 3, outward=out)
                else:
                    self.m.quad(pts, uv, outward=out)

    @property
    def triangles(self):
        return self.m.triangles
