"""Shared procedural texture & geometry kit for IDOK-49 (M2.6-16):
- libin_middle: 九中（桂林市中山中学漓滨校区）校门与校园
- guilin_book_market: 桂林图书市场、滨江大厦、环球国际酒店与漓滨路衔接街景
- guilin_theater: 桂林剧院（漓江歌剧院）双曲波浪屋顶、滨水小楼与江岸泛光

All textures are procedurally painted (never from photos) per docs/style.md.
Each landmark exports `lod0`, `lod1`, and `collision_body` with <= 2 materials
(`*_atlas` and `*_lit`), keeping draw calls <= 2 and atlas <= 1024 px.
"""
import math
from pathlib import Path

import mapbox_earcut
import numpy as np
import trimesh
from PIL import Image, ImageFont

from functools import lru_cache
from world_surface import Surface
from c_kit import landmark_surface


@lru_cache(maxsize=1)
def finished_world():
    return Surface()


# Exact station table of IDOK-48 `jiefang_bridge` SIDE_ROAD (`way/675174045`, z_bm in [15.44..21.44])
# in `bm_frame` (`origin = (-422.60, 84.95), +x_bm = (0.4318, -0.9020), +z_bm = (0.9020, 0.4318)`):
_SIDE_ROAD_XBM = np.array([5.6, 11.5, 17.4, 23.3, 29.3, 35.2, 41.1, 47.0, 53.0], dtype=np.float64)
_SIDE_ROAD_WY = np.array([153.30, 153.11, 151.94, 150.86, 149.83, 148.95, 149.10, 149.27, 149.51], dtype=np.float64)


def libin_terrain_y(wx: float, wz: float) -> float:
    """Exact triangle-interpolated chunk ground elevation in metres at world `(wx, wz)`."""
    return finished_world().sample(wx,wz)[0]


def libin_street_base_y(wx: float, wz: float) -> float:
    """Ground/deck reference along Libin Road that matches `jiefang_bridge` SIDE_ROAD (`way/675174045`)
    flush along `z_bm in [15.44, 21.44]` for `x_bm >= 5.6`, while staying strictly above `libin_terrain_y`
    everywhere outside the `SIDE_ROAD` seam so chunk terrain never pokes through asphalt or granite!"""
    ty = libin_terrain_y(wx, wz)
    dx, dz = wx - (-422.60), wz - 84.95
    xbm = dx * 0.4318 - dz * 0.9020
    zbm = dx * 0.9020 + dz * 0.4318
    if xbm <= -2.0 or zbm < 2.0 or zbm > 31.0:
        return ty + 0.08
    along_blend = float(np.clip((xbm + 2.0) / 7.6, 0.0, 1.0))
    y_road = float(np.interp(xbm, _SIDE_ROAD_XBM, _SIDE_ROAD_WY))
    if zbm < 15.44:
        d_edge = 15.44 - zbm
        w = float(np.clip(d_edge / 5.5, 0.0, 1.0))
        seam_guard = float(np.clip(d_edge / 0.8, 0.0, 1.0))
    elif zbm > 21.44:
        d_edge = zbm - 21.44
        w = float(np.clip(d_edge / 5.0, 0.0, 1.0))
        seam_guard = float(np.clip(d_edge / 0.8, 0.0, 1.0))
    else:
        w = 0.0
        seam_guard = 0.0
    blended = (1.0 - w) * y_road + w * (ty + 0.08)
    # Away from the 0.8 m seam (where grade_banks already keeps ty <= y_road - 0.20), enforce >= ty + 0.11 m!
    safe = (1.0 - seam_guard) * y_road + seam_guard * max(blended, ty + 0.11)
    return (1.0 - along_blend) * (ty + 0.08) + along_blend * safe


def get_font(size, bold=False, sans=False):
    candidates = []
    if sans:
        candidates.extend([
            ('/System/Library/Fonts/STHeiti Medium.ttc', 0),
            ('/System/Library/Fonts/Hiragino Sans GB.ttc', 0),
            ('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', 2),
        ])
    candidates.extend([
        ('/System/Library/Fonts/Supplemental/Songti.ttc', 1),
        ('/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc', 2),
        ('/System/Library/Fonts/Hiragino Sans GB.ttc', 2 if bold else 0),
        ('/System/Library/Fonts/STHeiti Medium.ttc', 0),
    ])
    for path, idx in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size, index=idx)
            except OSError:
                try:
                    return ImageFont.truetype(path, size, index=0)
                except OSError:
                    continue
    return ImageFont.load_default()


class MeshBucket:
    def __init__(self, rects, atlas_size):
        self.rects = rects
        self.atlas_size = float(atlas_size)
        self.pos = []
        self.nrm = []
        self.uv = []
        self.faces = []

    def __len__(self):
        return len(self.faces)

    def _map_uv(self, region, u, v, clamp=False):
        rx, ry, rw, rh = self.rects[region]
        pad = 2.0
        if clamp:
            uu = float(np.clip(u, 0.0, 1.0))
            vv = float(np.clip(v, 0.0, 1.0))
        else:
            uu = float(u) % 1.0
            vv = float(v) % 1.0
        px = rx + pad + uu * max(1.0, rw - 2.0 * pad)
        py = ry + pad + vv * max(1.0, rh - 2.0 * pad)
        return (px / self.atlas_size, 1.0 - py / self.atlas_size)

    def add_poly(self, pts, normal, region, tile=2.5, uvs=None):
        arr = np.asarray(pts, dtype=np.float64)
        if len(arr) < 3:
            return
        n = np.asarray(normal, dtype=np.float64)
        ln = np.linalg.norm(n)
        n = n / ln if ln > 1e-9 else np.array([0.0, 1.0, 0.0])
        cross = np.cross(arr[1] - arr[0], arr[2] - arr[0])
        if np.dot(cross, n) < 0:
            arr = arr[::-1]
            if uvs is not None:
                uvs = list(uvs)[::-1]
        base = len(self.pos)
        if region is None:
            mapped_uvs = [(0.0, 0.0)] * len(arr)
        elif uvs is not None:
            mapped_uvs = [self._map_uv(region, u, v, clamp=True) for u, v in uvs]
        else:
            ref = np.array([0.0, 1.0, 0.0]) if abs(n[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
            u_ax = np.cross(ref, n)
            u_ax /= np.linalg.norm(u_ax)
            v_ax = np.cross(n, u_ax)
            sc = tile or 2.5
            mapped_uvs = [
                self._map_uv(region, np.dot(p, u_ax) / sc, 1.0 - (np.dot(p, v_ax) / sc))
                for p in arr
            ]
        for p, t in zip(arr, mapped_uvs):
            self.pos.append(p)
            self.nrm.append(n)
            self.uv.append(t)
        for i in range(1, len(arr) - 1):
            self.faces.append((base, base + i, base + i + 1))


class SceneBuilder:
    """Right-handed local coordinates: +X East, +Y Up, +Z South."""
    def __init__(self, rects, atlas_size=512, lod=0, collide=True):
        self.rects = rects
        self.atlas_size = atlas_size
        self.lod = lod
        self.detail = (lod == 0)
        self.collide = collide
        self.atlas = MeshBucket(rects, atlas_size)
        self.lit = MeshBucket(rects, atlas_size)
        self.hit = MeshBucket(rects, atlas_size)
        self.origin = np.zeros(3, dtype=np.float64)
        self.ex = np.array([1.0, 0.0, 0.0])
        self.ey = np.array([0.0, 1.0, 0.0])
        self.ez = np.array([0.0, 0.0, 1.0])

    def set_frame(self, origin=(0.0, 0.0, 0.0), front_xz=(0.0, 1.0)):
        """Set local frame so +Z points outward along `front_xz`, +Y is Up, +X is viewer's right."""
        prev = (self.origin.copy(), self.ex.copy(), self.ey.copy(), self.ez.copy())
        fx, fz = front_xz
        ln = math.hypot(fx, fz)
        nx, nz = (fx / ln, fz / ln) if ln > 1e-9 else (0.0, 1.0)
        self.origin = np.asarray(origin, dtype=np.float64)
        self.ez = np.array([nx, 0.0, nz], dtype=np.float64)
        self.ey = np.array([0.0, 1.0, 0.0], dtype=np.float64)
        self.ex = np.array([nz, 0.0, -nx], dtype=np.float64)
        return prev

    def restore_frame(self, prev):
        self.origin, self.ex, self.ey, self.ez = prev

    def xf(self, p):
        return self.origin + p[0] * self.ex + p[1] * self.ey + p[2] * self.ez

    def grade(self,x,z):
        px,py,pz=self.xf((x,0,z))
        return self.surface.ground(px,pz)-py

    def xf_dir(self, d):
        return d[0] * self.ex + d[1] * self.ey + d[2] * self.ez

    def face(self, pts, normal, region, tile=2.5, uvs=None, lit=False):
        target = self.lit if lit else self.atlas
        target.add_poly([self.xf(p) for p in pts], self.xf_dir(normal), region, tile=tile, uvs=uvs)

    def hit_quad(self, pts, normal):
        if self.collide:
            self.hit.add_poly([self.xf(p) for p in pts], self.xf_dir(normal), None)

    def solid_box(self, x, y0, z, w, h, d, cell=8.0):
        if not self.collide:
            return
        x0, x1 = x - w / 2.0, x + w / 2.0
        y1 = y0 + h
        z0, z1 = z - d / 2.0, z + d / 2.0
        nx = max(1, math.ceil(w / cell))
        nz = max(1, math.ceil(d / cell))
        ny = max(1, math.ceil(h / cell))
        xs = np.linspace(x0, x1, nx + 1)
        zs = np.linspace(z0, z1, nz + 1)
        ys = np.linspace(y0, y1, ny + 1)
        for ix in range(nx):
            for iz in range(nz):
                a, b, c, dd = xs[ix], xs[ix + 1], zs[iz], zs[iz + 1]
                self.hit_quad([(a, y1, dd), (b, y1, dd), (b, y1, c), (a, y1, c)], (0, 1, 0))
        for iy in range(ny):
            ya, yb = ys[iy], ys[iy + 1]
            for ix in range(nx):
                a, b = xs[ix], xs[ix + 1]
                self.hit_quad([(a, ya, z1), (b, ya, z1), (b, yb, z1), (a, yb, z1)], (0, 0, 1))
                self.hit_quad([(b, ya, z0), (a, ya, z0), (a, yb, z0), (b, yb, z0)], (0, 0, -1))
            for iz in range(nz):
                c, dd = zs[iz], zs[iz + 1]
                self.hit_quad([(x1, ya, dd), (x1, ya, c), (x1, yb, c), (x1, yb, dd)], (1, 0, 0))
                self.hit_quad([(x0, ya, c), (x0, ya, dd), (x0, yb, dd), (x0, yb, c)], (-1, 0, 0))

    def box(self, x, y0, z, w, h, d, region, cap_region=None, tile=2.5, collide=False, lit=False, bottom=False):
        hw, hd = w / 2.0, d / 2.0
        x0, x1 = x - hw, x + hw
        y1 = y0 + h
        z0, z1 = z - hd, z + hd
        self.face([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], (0, 0, 1), region, tile=tile, lit=lit)
        self.face([(x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0)], (0, 0, -1), region, tile=tile, lit=lit)
        self.face([(x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1)], (1, 0, 0), region, tile=tile, lit=lit)
        self.face([(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)], (-1, 0, 0), region, tile=tile, lit=lit)
        self.face([(x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0)], (0, 1, 0), cap_region or region, tile=tile, lit=lit)
        if bottom:
            self.face([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], (0, -1, 0), region, tile=tile, lit=lit)
        if collide:
            self.solid_box(x, y0, z, w, h, d)

    def draped_patch(
        self,
        anchor_world_xyz,
        x0,
        x1,
        z0,
        z1,
        region,
        curb_region=None,
        lift=0.22,
        skirt=0.45,
        step=2.6,
        tile=2.6,
        curb_edges=(),
        curb_h=0.05,
        curb_w=0.22,
        collide=False,
        height_fn=None,
    ):
        """Build a terrain-following paved grid in the current frame (where landmark origin in world is
        `anchor_world_xyz = (AX, AY, AZ)`), sitting `lift` metres above exact `7_10.glc` terrain at every vertex!"""
        ax, ay, az = anchor_world_xyz
        hfn = height_fn or libin_terrain_y
        nx = max(1, int(math.ceil(abs(x1 - x0) / (step if self.detail else step * 2.2))))
        nz = max(1, int(math.ceil(abs(z1 - z0) / (step if self.detail else step * 2.2))))
        xs = np.linspace(x0, x1, nx + 1)
        zs = np.linspace(z0, z1, nz + 1)
        pts = np.zeros((nx + 1, nz + 1, 3), dtype=np.float64)
        for i, xv in enumerate(xs):
            for j, zv in enumerate(zs):
                lp = self.xf((xv, 0.0, zv))
                wy = hfn(ax + lp[0], az + lp[2]) + lift
                pts[i, j] = (xv, wy - ay - self.origin[1], zv)

        for i in range(nx):
            su0 = (i % 2) * 0.5
            su1 = su0 + 0.5
            for j in range(nz):
                sv0 = (j % 2) * 0.5
                sv1 = sv0 + 0.5
                p00, p10, p11, p01 = pts[i, j], pts[i + 1, j], pts[i + 1, j + 1], pts[i, j + 1]
                self.face(
                    [p01, p11, p10, p00],
                    (0, 1, 0),
                    region,
                    uvs=[(su0, sv1), (su1, sv1), (su1, sv0), (su0, sv0)],
                )
                if collide and self.collide:
                    self.hit_quad([p01, p11, p10, p00], (0, 1, 0))

        cr = curb_region or region
        # Skirt & raised stone curb along requested edges ('+z', '-z', '+x', '-x')
        if '+z' in curb_edges:
            for i in range(nx):
                a, b = pts[i, nz], pts[i + 1, nz]
                self.face(
                    [(a[0], self.grade(a[0],a[2])-.04, a[2]), (b[0], self.grade(b[0],b[2])-.04, b[2]), (b[0], b[1] + curb_h, b[2]), (a[0], a[1] + curb_h, a[2])],
                    (0, 0, 1),
                    cr,
                    tile=tile,
                )
                if curb_h > 0.005:
                    self.face(
                        [(a[0], a[1] + curb_h, a[2]), (b[0], b[1] + curb_h, b[2]), (b[0], b[1] + curb_h, b[2] - curb_w), (a[0], a[1] + curb_h, a[2] - curb_w)],
                        (0, 1, 0),
                        cr,
                        tile=tile,
                    )
        if '-z' in curb_edges:
            for i in range(nx):
                a, b = pts[i + 1, 0], pts[i, 0]
                self.face(
                    [(a[0], self.grade(a[0],a[2])-.04, a[2]), (b[0], self.grade(b[0],b[2])-.04, b[2]), (b[0], b[1] + curb_h, b[2]), (a[0], a[1] + curb_h, a[2])],
                    (0, 0, -1),
                    cr,
                    tile=tile,
                )
        if '+x' in curb_edges:
            for j in range(nz):
                a, b = pts[nx, j + 1], pts[nx, j]
                self.face(
                    [(a[0], self.grade(a[0],a[2])-.04, a[2]), (b[0], self.grade(b[0],b[2])-.04, b[2]), (b[0], b[1] + curb_h, b[2]), (a[0], a[1] + curb_h, a[2])],
                    (1, 0, 0),
                    cr,
                    tile=tile,
                )
        if '-x' in curb_edges:
            for j in range(nz):
                a, b = pts[0, j], pts[0, j + 1]
                self.face(
                    [(a[0], self.grade(a[0],a[2])-.04, a[2]), (b[0], self.grade(b[0],b[2])-.04, b[2]), (b[0], b[1] + curb_h, b[2]), (a[0], a[1] + curb_h, a[2])],
                    (-1, 0, 0),
                    cr,
                    tile=tile,
                )

    def sign_quad(self, x, yc, z, w, h, region, normal=(0, 0, 1), lit=False):
        """Place a UV-clamped sign quad facing `normal`."""
        hw, hh = w / 2.0, h / 2.0
        y0, y1 = yc - hh, yc + hh
        nx, ny, nz = normal
        if abs(nz) > 0.5:
            if nz > 0:
                pts = [(x - hw, y0, z), (x + hw, y0, z), (x + hw, y1, z), (x - hw, y1, z)]
            else:
                pts = [(x + hw, y0, z), (x - hw, y0, z), (x - hw, y1, z), (x + hw, y1, z)]
        else:
            if nx > 0:
                pts = [(x, y0, z + hw), (x, y0, z - hw), (x, y1, z - hw), (x, y1, z + hw)]
            else:
                pts = [(x, y0, z - hw), (x, y0, z + hw), (x, y1, z + hw), (x, y1, z - hw)]
        self.face(pts, normal, region, uvs=[(0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)], lit=lit)

    def cylinder_y(self, x, y0, h, z, r, region, sections=10, cap=True, collide=False, lit=False):
        y1 = y0 + h
        ring = [(x + r * math.cos(2 * math.pi * i / sections), z + r * math.sin(2 * math.pi * i / sections))
                for i in range(sections)]
        for i in range(sections):
            j = (i + 1) % sections
            x0, z0 = ring[i]
            x1, z1 = ring[j]
            self.face([(x0, y0, z0), (x1, y0, z1), (x1, y1, z1), (x0, y1, z0)],
                      ((x0 + x1) / 2 - x, 0, (z0 + z1) / 2 - z), region, tile=1.8, lit=lit)
        if cap:
            self.face([(px, y1, pz) for px, pz in ring[::-1]], (0, 1, 0), region, tile=1.8, lit=lit)
        if collide:
            self.solid_box(x, y0, z, r * 1.8, h, r * 1.8)

    def disc_z(self, x, yc, z, r, thickness, region, sections=16, lit=False):
        """Circular medallion / disc mounted on a +Z facade."""
        z0, z1 = z - thickness * 0.2, z + thickness * 0.8
        ring = [(x + r * math.cos(2 * math.pi * i / sections), yc + r * math.sin(2 * math.pi * i / sections))
                for i in range(sections)]
        self.face([(px, py, z1) for px, py in ring], (0, 0, 1), region, tile=r * 2.2, lit=lit)
        for i in range(sections):
            j = (i + 1) % sections
            x0, y0 = ring[i]
            x1, y1 = ring[j]
            self.face([(x0, y0, z0), (x1, y1, z0), (x1, y1, z1), (x0, y0, z1)],
                      ((x0 + x1) / 2 - x, (y0 + y1) / 2 - yc, 0.2), region, tile=1.5, lit=lit)

    def prism(self, poly_xz, y0, h, region, cap_region=None, tile=2.8, collide=False, lit=False, footing=False, paving=False):
        pts = np.asarray(poly_xz, dtype=np.float64)
        if len(pts) >= 2 and np.allclose(pts[0], pts[-1]):
            pts = pts[:-1]
        if len(pts) < 3:
            return
        area2 = np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1])
        if area2 < 0:
            pts = pts[::-1]
        tris = mapbox_earcut.triangulate_float64(pts, np.array([len(pts)], np.uint32)).reshape(-1, 3)
        y1 = y0 + h
        lower=[self.grade(x,z)-.045 if footing or paving else y0 for x,z in pts]
        upper=[level+.10 if paving else y1 for level in lower]
        for t in tris:
            quad_tri = [(pts[i, 0], upper[i], pts[i, 1]) for i in t]
            self.face(quad_tri, (0, 1, 0), cap_region or region, tile=tile, lit=lit)
            if collide and self.collide:
                self.hit_quad(quad_tri, (0, 1, 0))
        if h > 0.02:
            for i in range(len(pts)):
                j = (i + 1) % len(pts)
                a, b = pts[i], pts[j]
                nrm = (b[1] - a[1], 0.0, a[0] - b[0])
                quad = [(a[0], lower[i], a[1]), (b[0], lower[j], b[1]), (b[0], upper[j], b[1]), (a[0], upper[i], a[1])]
                self.face(quad, nrm, region, tile=tile, lit=lit)
                if collide and self.collide and h >= 0.35:
                    seg_len = math.hypot(b[0] - a[0], b[1] - a[1])
                    steps = max(1, math.ceil(seg_len / 6.0))
                    for s in range(steps):
                        t0, t1 = s / steps, (s + 1) / steps
                        xa, za = a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0
                        xb, zb = a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1
                        self.hit_quad([(xa, lower[i]*(1-t0)+lower[j]*t0, za), (xb, lower[i]*(1-t1)+lower[j]*t1, zb), (xb, upper[i]*(1-t1)+upper[j]*t1, zb), (xa, upper[i]*(1-t0)+upper[j]*t0, za)], nrm)

    def stone_lion(self, x, y0, z, scale=1.0, region='pale_stone'):
        """Low-poly sculpted Chinese guardian stone lion sitting on a carved pedestal."""
        s = scale
        self.box(x, y0, z, 1.05 * s, 0.32 * s, 1.30 * s, 'granite', tile=1.2, collide=True)
        self.box(x, y0 + 0.32 * s, z, 0.90 * s, 0.14 * s, 1.14 * s, region, tile=1.0)
        by = y0 + 0.46 * s
        if not self.detail:
            self.box(x, by, z, 0.72 * s, 1.25 * s, 0.92 * s, region, tile=1.0)
            return
        self.box(x, by, z - 0.14 * s, 0.68 * s, 0.56 * s, 0.62 * s, region, tile=0.9)
        self.box(x, by + 0.42 * s, z + 0.04 * s, 0.64 * s, 0.54 * s, 0.56 * s, region, tile=0.9)
        for sx in (-0.21 * s, 0.21 * s):
            self.box(x + sx, by, z + 0.28 * s, 0.20 * s, 0.58 * s, 0.22 * s, region, tile=0.8)
            self.box(x + sx, by, z + 0.40 * s, 0.22 * s, 0.14 * s, 0.20 * s, region, tile=0.8)
        self.box(x + 0.20 * s, by + 0.12 * s, z + 0.42 * s, 0.18 * s, 0.18 * s, 0.18 * s, region, tile=0.6)
        hy = by + 0.88 * s
        self.box(x, hy, z + 0.08 * s, 0.70 * s, 0.52 * s, 0.58 * s, region, tile=0.8)
        self.box(x, hy + 0.44 * s, z + 0.02 * s, 0.56 * s, 0.16 * s, 0.48 * s, region, tile=0.8)
        self.box(x, hy + 0.10 * s, z + 0.36 * s, 0.46 * s, 0.24 * s, 0.16 * s, region, tile=0.8)
        self.box(x, by + 0.20 * s, z - 0.46 * s, 0.18 * s, 0.44 * s, 0.14 * s, region, tile=0.8)

    def tree_cluster(self, x, y0, z, h=9.5, spread=3.8, foliage='foliage', bark='bark', trunk=True, lime_trunk=None):
        if trunk:
            if lime_trunk is not None:
                lime_h = min(1.35, h * 0.18)
                self.cylinder_y(x, y0, lime_h, z, 0.27, lime_trunk, sections=6 if self.detail else 5)
                self.cylinder_y(x, y0 + lime_h, h * 0.38 - lime_h, z, 0.25, bark, sections=6 if self.detail else 5)
            else:
                self.cylinder_y(x, y0, h * 0.38, z, 0.24, bark, sections=6 if self.detail else 5)
        if not self.detail:
            self.cylinder_y(x, y0 + h * 0.34, h * 0.54, z, spread * 0.78, foliage, sections=6)
            return
        blobs = [
            (0.0, h * 0.66, 0.0, spread * 0.85, h * 0.32),
            (-spread * 0.38, h * 0.54, spread * 0.22, spread * 0.58, h * 0.25),
            (spread * 0.36, h * 0.56, -spread * 0.20, spread * 0.56, h * 0.25),
            (0.08 * spread, h * 0.50, 0.38 * spread, spread * 0.50, h * 0.22),
        ]
        ico = trimesh.creation.icosphere(subdivisions=1, radius=1.0)
        for bx, by, bz, br, bh in blobs:
            verts = ico.vertices.copy()
            verts[:, 0] = verts[:, 0] * br + x + bx
            verts[:, 1] = verts[:, 1] * bh + y0 + by
            verts[:, 2] = verts[:, 2] * br + z + bz
            c_pt = np.array([x + bx, y0 + by, z + bz])
            for f in ico.faces:
                tri = [verts[f[0]], verts[f[1]], verts[f[2]]]
                nrm = np.mean(tri, axis=0) - c_pt
                self.face(tri, nrm, foliage, tile=2.4)


def bucket_to_trimesh(bucket: MeshBucket, image, mat_name, emissive=(0.0, 0.0, 0.0), metallic=0.04, roughness=0.86, double_sided=False):
    if not bucket.faces:
        return None
    mat = trimesh.visual.material.PBRMaterial(
        name=mat_name,
        baseColorTexture=image,
        metallicFactor=float(metallic),
        roughnessFactor=float(roughness),
        emissiveFactor=[float(c) for c in emissive],
        doubleSided=bool(double_sided),
    )
    if any(c > 0 for c in emissive):
        mat.emissiveTexture = image
    geom = trimesh.Trimesh(
        vertices=np.asarray(bucket.pos, np.float32),
        faces=np.asarray(bucket.faces, np.int64),
        vertex_normals=np.asarray(bucket.nrm, np.float32),
        process=False,
    )
    geom.visual = trimesh.visual.TextureVisuals(uv=np.asarray(bucket.uv, np.float32), material=mat)
    return geom


def export_landmark_glb(
    out_glb: Path,
    image: Image.Image,
    rects: dict,
    build_fn,
    mat_prefix: str,
    lit_emissive=(0.82, 0.78, 0.70),
    atlas_metallic=0.05,
    atlas_roughness=0.84,
    double_sided=False,
):
    atlas_size = image.width
    hi = SceneBuilder(rects, atlas_size=atlas_size, lod=0, collide=True)
    lo = SceneBuilder(rects, atlas_size=atlas_size, lod=1, collide=False)
    hi.surface=lo.surface=landmark_surface(out_glb.stem)
    build_fn(hi)
    build_fn(lo)

    scene = trimesh.Scene()
    base = scene.graph.base_frame
    for lod_name, b in (('lod0', hi), ('lod1', lo)):
        scene.graph.update(frame_from=base, frame_to=lod_name)
        m_atlas = bucket_to_trimesh(
            b.atlas, image, f'{mat_prefix}_atlas', (0, 0, 0), atlas_metallic, atlas_roughness, double_sided=double_sided
        )
        if m_atlas is not None:
            scene.add_geometry(m_atlas, node_name=f'{lod_name}_atlas', parent_node_name=lod_name)
        m_lit = bucket_to_trimesh(b.lit, image, f'{mat_prefix}_lit', lit_emissive, 0.08, 0.42, double_sided=double_sided)
        if m_lit is not None:
            scene.add_geometry(m_lit, node_name=f'{lod_name}_lit', parent_node_name=lod_name)

    if hi.hit.faces:
        m_hit = trimesh.Trimesh(
            vertices=np.asarray(hi.hit.pos, np.float32),
            faces=np.asarray(hi.hit.faces, np.int64),
            process=False,
        )
        scene.add_geometry(m_hit, node_name='collision_body')

    image.save(out_glb.parent / f'{mat_prefix}_atlas.png')
    scene.export(out_glb)
    n0 = len(hi.atlas) + len(hi.lit)
    n1 = len(lo.atlas) + len(lo.lit)
    print(f'{out_glb.stem}: lod0={n0} tris, lod1={n1} tris, collision={len(hi.hit)} tris')
    return n0, n1, len(hi.hit)
