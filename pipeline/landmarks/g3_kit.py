"""Shared procedural mini-atlas and architectural builder for M2.7-G3 schools.

All textures are painted procedurally (never from photos) following docs/style.md.
Each school generates its own compact 512x512 procedural atlas containing clean
low-poly material swatches + only that school's plaques/LED boards, keeping
embedded KTX2 well below 150 KB (~30-55 KB) and draw calls <= 2 (`atlas` + `lit`).
"""
import math
from pathlib import Path

import mapbox_earcut
import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFont

ATLAS = 512

# 4 rows x 8 cols of 64x48 = 32 clean low-poly swatches in y = 0..192
SWATCH_SPECS = [
    # Row 0 (y = 0..48)
    ('white',       (236, 234, 226)),
    ('cream',       (227, 217, 193)),
    ('yellow_wall', (230, 210, 134)),
    ('ochre',       (204, 168, 110)),
    ('terracotta',  (181,  98,  82)),
    ('brick_red',   (156,  62,  54)),
    ('blue_facade', ( 66, 114, 150)),
    ('granite',     (168, 167, 159)),
    # Row 1 (y = 48..96)
    ('dark_stone',  ( 73,  78,  82)),
    ('gray_tile',   ( 92, 100, 106)),
    ('green_glaze', ( 54, 118,  82)),
    ('red_tile',    (168,  78,  66)),
    ('track_red',   (182,  83,  71)),
    ('turf_green',  ( 96, 135,  84)),
    ('turf_light',  (111, 150,  98)),
    ('court_green', ( 78, 131, 104)),
    # Row 2 (y = 96..144)
    ('court_blue',  ( 77, 121, 155)),
    ('pave',        (201, 199, 190)),
    ('pave_plaza',  (216, 213, 203)),
    ('lawn',        (104, 140,  89)),
    ('foliage',     ( 77, 115,  67)),
    ('bark',        (110,  94,  77)),
    ('glass',       ( 72, 110, 134)),
    ('steel',       (188, 194, 199)),
    # Row 3 (y = 144..192)
    ('line_white',  (244, 242, 234)),
    ('vermilion',   (198,  58,  50)),
    ('gold',        (222, 188,  92)),
    ('led_bg',      ( 28,  24,  26)),
    ('hedge',       ( 85, 123,  72)),
    ('silver_roof', (174, 182, 188)),
    ('pink_wall',   (224, 206, 204)),
    ('wood',        (132,  92,  68)),
]

BASE_RECTS = {}
for _idx, (_name, _rgb) in enumerate(SWATCH_SPECS):
    _col, _row = _idx % 8, _idx // 8
    BASE_RECTS[_name] = (_col * 64, _row * 48, 64, 48)


def _font(size, bold=False, sans=False):
    noto = '/usr/share/fonts/opentype/noto'
    candidates = []
    if sans:
        candidates.extend((
            (f'{noto}/NotoSansCJK-Bold.ttc', 2),
            ('/System/Library/Fonts/STHeiti Medium.ttc', 0),
            ('/System/Library/Fonts/Hiragino Sans GB.ttc', 0),
        ))
    if bold:
        candidates.append(('/System/Library/Fonts/Supplemental/Songti.ttc', 0))
    candidates.extend((
        (f'{noto}/NotoSerifCJK-Bold.ttc', 2),
        (f'{noto}/NotoSansCJK-Bold.ttc', 2),
        ('/System/Library/Fonts/Supplemental/Songti.ttc', 0 if bold else 1),
        ('/System/Library/Fonts/Hiragino Sans GB.ttc', 0),
        ('/System/Library/Fonts/STHeiti Medium.ttc', 0),
    ))
    for path, index in candidates:
        if not Path(path).exists():
            continue
        try:
            return ImageFont.truetype(path, size, index=index)
        except OSError:
            try:
                return ImageFont.truetype(path, size, index=0)
            except OSError:
                continue
    for bare in ('NotoSansCJK-Bold.ttc', 'NotoSansCJK-Regular.ttc'):
        try:
            return ImageFont.truetype(bare, size)
        except OSError:
            continue
    raise SystemExit('g3_kit: no CJK font found for school plaques.')


def make_school_atlas(signs=()):
    """Build a compact 512x512 PIL image and return (image, rects_dict).

    `signs` is a list of dicts:
      dict(key='...', title='...', sub='', fg=(r,g,b), bg=(r,g,b),
           orient='h'|'v', sans=True, border=None, raised=False)
    """
    im = Image.new('RGB', (ATLAS, ATLAS), (201, 199, 190))
    draw = ImageDraw.Draw(im)
    rects = dict(BASE_RECTS)

    for name, rgb in SWATCH_SPECS:
        x, y, w, h = rects[name]
        draw.rectangle((x, y, x + w - 1, y + h - 1), fill=rgb)
        if name in ('gray_tile', 'green_glaze', 'red_tile'):
            darker = tuple(max(0, c - 16) for c in rgb)
            for ry in range(y + 8, y + h, 8):
                draw.line((x, ry, x + w - 1, ry), fill=darker, width=1)
        elif name in ('cream', 'terracotta', 'brick_red'):
            mortar = tuple(min(255, c + 14) if name == 'cream' else max(0, c - 14) for c in rgb)
            for ry in range(y + 12, y + h, 12):
                draw.line((x, ry, x + w - 1, ry), fill=mortar, width=1)
        elif name == 'glass':
            hi = (94, 136, 160)
            draw.rectangle((x + 4, y + 4, x + w - 5, y + 18), fill=hi)

    # Pack horizontal & vertical signs into y = 192..512
    # Horizontal slots: up to 5 rows of (384, 64), and vertical slots on right x = 384..512 (two cols of 64x256)
    h_signs = [s for s in signs if s.get('orient', 'h') == 'h']
    v_signs = [s for s in signs if s.get('orient', 'h') == 'v']

    hy = 192
    hw = 384 if v_signs else 512
    for s in h_signs[:5]:
        sh = s.get('h_px', 64)
        if hy + sh > ATLAS:
            break
        rect = (0, hy, hw, sh)
        rects[s['key']] = rect
        _draw_h_sign(draw, rect, s)
        hy += sh

    vx = 384
    for s in v_signs[:2]:
        if vx + 64 > ATLAS:
            break
        rect = (vx, 192, 64, 320)
        rects[s['key']] = rect
        _draw_v_sign(draw, rect, s)
        vx += 64

    return im, rects


def _draw_h_sign(draw: ImageDraw.ImageDraw, rect, s):
    x, y, w, h = rect
    bg = s.get('bg', (240, 238, 232))
    fg = s.get('fg', (168, 38, 34))
    title = s['title']
    sub = s.get('sub', '')
    sans = s.get('sans', True)
    border = s.get('border')
    draw.rectangle((x, y, x + w - 1, y + h - 1), fill=bg)
    if border:
        draw.rectangle((x + 2, y + 2, x + w - 3, y + h - 3), outline=border, width=2)
    max_sz = int(h * (0.52 if sub else 0.64))
    fit_sz = max(14, min(max_sz, int((w - 24) / max(1.0, len(title) * 0.88))))
    f_main = _font(fit_sz, bold=True, sans=sans)
    cy = y + (int(h * 0.40) if sub else h // 2)
    if s.get('raised'):
        shadow = tuple(max(0, c - 55) for c in bg)
        draw.text((x + w // 2 + 2, cy + 2), title, fill=shadow, font=f_main, anchor='mm')
    draw.text((x + w // 2, cy), title, fill=fg, font=f_main, anchor='mm')
    if sub:
        sub_sz = max(10, min(int(h * 0.22), int((w - 24) / max(1.0, len(sub) * 0.58))))
        f_sub = _font(sub_sz, bold=False, sans=True)
        draw.text((x + w // 2, y + int(h * 0.78)), sub, fill=fg, font=f_sub, anchor='mm')


def _draw_v_sign(draw: ImageDraw.ImageDraw, rect, s):
    x, y, w, h = rect
    bg = s.get('bg', (227, 217, 193))
    fg = s.get('fg', (168, 38, 34))
    title = s['title'].replace(' ', '')
    header = s.get('sub', '')
    border = s.get('border')
    draw.rectangle((x, y, x + w - 1, y + h - 1), fill=bg)
    if border:
        draw.rectangle((x + 2, y + 2, x + w - 3, y + h - 3), outline=border, width=2)
    top_pad = 16
    if header:
        fh = _font(11, bold=True, sans=True)
        draw.text((x + w // 2, y + 16), header[:6], fill=fg, font=fh, anchor='mm')
        top_pad = 32
    avail_h = h - top_pad - 14
    n = max(1, len(title))
    step = avail_h / n
    sz = max(14, min(int(w * 0.66), int(step * 0.84)))
    f_ch = _font(sz, bold=True, sans=s.get('sans', False))
    for i, ch in enumerate(title):
        cy = y + top_pad + int((i + 0.5) * step)
        if s.get('raised'):
            draw.text((x + w // 2 + 1, cy + 1), ch, fill=(70, 62, 50), font=f_ch, anchor='mm')
        draw.text((x + w // 2, cy), ch, fill=fg, font=f_ch, anchor='mm')


def _uv_of(rects, key, u, v):
    rx, ry, rw, rh = rects[key]
    u = float(u) % 1.0 if u > 1.0 or u < 0.0 else float(u)
    v = float(v) % 1.0 if v > 1.0 or v < 0.0 else float(v)
    pad = 2.0
    px = rx + pad + u * max(1.0, rw - 2 * pad)
    py = ry + pad + v * max(1.0, rh - 2 * pad)
    return px / ATLAS, 1.0 - py / ATLAS


class MeshPart:
    def __init__(self, rects):
        self.rects = rects
        self.pos = []
        self.nrm = []
        self.uv = []
        self.faces = []

    def __len__(self):
        return len(self.faces)

    def add_poly(self, pts, normal, region, tile=2.4, uvs=None):
        arr = np.asarray(pts, dtype=np.float64)
        n = np.asarray(normal, dtype=np.float64)
        ln = np.linalg.norm(n)
        n = n / ln if ln > 1e-9 else np.array([0.0, 1.0, 0.0])
        cross = np.cross(arr[1] - arr[0], arr[2] - arr[0])
        if np.dot(cross, n) < 0:
            arr = arr[::-1]
            if uvs is not None:
                uvs = list(uvs)[::-1]
        base = len(self.pos)
        if uvs is None and region is not None:
            ref = np.array([0.0, 1.0, 0.0]) if abs(n[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
            u_ax = np.cross(ref, n)
            u_ax /= np.linalg.norm(u_ax)
            v_ax = np.cross(n, u_ax)
            scale = tile or 2.4
            uvs = []
            for p in arr:
                uu = (np.dot(p, u_ax) / scale) % 1.0
                vv = (np.dot(p, v_ax) / scale) % 1.0
                uvs.append(_uv_of(self.rects, region, uu, vv))
        elif uvs is not None and region is not None:
            rx, ry, rw, rh = self.rects[region]
            mapped = []
            for uu, vv in uvs:
                px = rx + 1.5 + np.clip(uu, 0.0, 1.0) * (rw - 3.0)
                py = ry + 1.5 + np.clip(vv, 0.0, 1.0) * (rh - 3.0)
                mapped.append((px / ATLAS, 1.0 - py / ATLAS))
            uvs = mapped
        else:
            uvs = [(0.0, 0.0)] * len(arr)

        for p, t in zip(arr, uvs):
            self.pos.append(p)
            self.nrm.append(n)
            self.uv.append(t)
        for i in range(1, len(arr) - 1):
            self.faces.append((base, base + i, base + i + 1))


class Builder:
    def __init__(self, rects, lod=0, collide=True):
        self.rects = rects
        self.lod = lod
        self.detail = (lod == 0)
        self.collide = collide
        self.atlas = MeshPart(rects)
        self.lit = MeshPart(rects)
        self.hit = MeshPart(rects)
        self.pose = (0.0, 0.0, 0.0, 0.0)

    def _xf(self, p):
        ox, oy, oz, yaw = self.pose
        x, y, z = p
        if yaw:
            c, s = math.cos(yaw), math.sin(yaw)
            x, z = x * c + z * s, -x * s + z * c
        return np.array([x + ox, y + oy, z + oz], dtype=np.float64)

    def _xf_dir(self, d):
        yaw = self.pose[3]
        x, y, z = d
        if yaw:
            c, s = math.cos(yaw), math.sin(yaw)
            x, z = x * c + z * s, -x * s + z * c
        return np.array([x, y, z], dtype=np.float64)

    def face(self, pts, normal, region, tile=2.4, uvs=None, lit=False):
        target = self.lit if lit else self.atlas
        target.add_poly([self._xf(p) for p in pts], self._xf_dir(normal), region, tile=tile, uvs=uvs)

    def solid_box(self, x, y0, z, w, h, d, cell=10.0):
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
                self.hit.add_poly([self._xf(p) for p in [(a, y1, dd), (b, y1, dd), (b, y1, c), (a, y1, c)]],
                                  self._xf_dir((0, 1, 0)), None)
        for iy in range(ny):
            ya, yb = ys[iy], ys[iy + 1]
            for ix in range(nx):
                a, b = xs[ix], xs[ix + 1]
                self.hit.add_poly([self._xf(p) for p in [(a, ya, z1), (b, ya, z1), (b, yb, z1), (a, yb, z1)]],
                                  self._xf_dir((0, 0, 1)), None)
                self.hit.add_poly([self._xf(p) for p in [(b, ya, z0), (a, ya, z0), (a, yb, z0), (b, yb, z0)]],
                                  self._xf_dir((0, 0, -1)), None)
            for iz in range(nz):
                c, dd = zs[iz], zs[iz + 1]
                self.hit.add_poly([self._xf(p) for p in [(x1, ya, dd), (x1, ya, c), (x1, yb, c), (x1, yb, dd)]],
                                  self._xf_dir((1, 0, 0)), None)
                self.hit.add_poly([self._xf(p) for p in [(x0, ya, c), (x0, ya, dd), (x0, yb, dd), (x0, yb, c)]],
                                  self._xf_dir((-1, 0, 0)), None)

    def box(self, x, y0, z, w, h, d, region, cap_region=None, tile=2.4, collide=False, lit=False, bottom=False):
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

    def cylinder_y(self, x, y0, h, z, r, region, sections=10, cap=True, collide=False):
        y1 = y0 + h
        ring = [(x + r * math.cos(2 * math.pi * i / sections), z + r * math.sin(2 * math.pi * i / sections))
                for i in range(sections)]
        for i in range(sections):
            j = (i + 1) % sections
            x0, z0 = ring[i]
            x1, z1 = ring[j]
            self.face([(x0, y0, z0), (x1, y0, z1), (x1, y1, z1), (x0, y1, z0)],
                      ((x0 + x1) / 2 - x, 0, (z0 + z1) / 2 - z), region, tile=2.0)
        if cap:
            self.face([(px, y1, pz) for px, pz in ring[::-1]], (0, 1, 0), region, tile=2.0)
        if collide:
            self.solid_box(x, y0, z, r * 1.85, h, r * 1.85)

    def tube(self, p0, p1, r, region, sections=6):
        a = np.asarray(p0, dtype=np.float64)
        b = np.asarray(p1, dtype=np.float64)
        d = b - a
        ln = np.linalg.norm(d)
        if ln < 1e-4:
            return
        d /= ln
        helper = np.array([0.0, 1.0, 0.0]) if abs(d[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
        t = np.cross(helper, d)
        t /= np.linalg.norm(t)
        bt = np.cross(d, t)
        rings = [[origin + r * math.cos(2 * math.pi * i / sections) * t + r * math.sin(2 * math.pi * i / sections) * bt
                  for i in range(sections)] for origin in (a, b)]
        for i in range(sections):
            j = (i + 1) % sections
            mid = (rings[0][i] + rings[0][j] + rings[1][j] + rings[1][i]) / 4
            out = mid - (a + b) / 2
            self.face([rings[0][i], rings[0][j], rings[1][j], rings[1][i]], out, region, tile=0.8)

    def pave_polygon(self, poly_xz, y=0.03, region='pave'):
        """Fill an arbitrary 2D polygon on the ground with clean paving (eliminating bare dirt)."""
        pts = np.asarray(poly_xz, dtype=np.float64)
        if len(pts) >= 2 and np.allclose(pts[0], pts[-1]):
            pts = pts[:-1]
        if len(pts) < 3:
            return
        area2 = np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1])
        if area2 < 0:
            pts = pts[::-1]
        tris = mapbox_earcut.triangulate_float64(pts, np.array([len(pts)], np.uint32)).reshape(-1, 3)
        for t in tris:
            self.face([(pts[i, 0], y, pts[i, 1]) for i in t], (0, 1, 0), region, tile=4.0)

    def walkway(self, p0, p1, width=4.6, y=0.045, region='pave_plaza', curb=False):
        dx, dz = p1[0] - p0[0], p1[1] - p0[1]
        ln = math.hypot(dx, dz)
        if ln < 0.3:
            return
        yaw = math.atan2(-dx, -dz) + math.pi / 2
        prev = self.pose
        self.pose = ((p0[0] + p1[0]) / 2.0, 0.0, (p0[1] + p1[1]) / 2.0, yaw)
        self.box(0, y - 0.02, 0, ln, 0.025, width, region, tile=3.0)
        if curb and self.detail:
            for sz in (-width / 2 - 0.12, width / 2 + 0.12):
                self.box(0, y - 0.02, sz, ln, 0.08, 0.22, 'granite', tile=2.0)
        self.pose = prev

    def lawn_patch(self, cx, cz, yaw, w, d, y=0.04, curb=True, shrubs=False):
        prev = self.pose
        self.pose = (cx, 0.0, cz, yaw)
        if curb:
            self.box(0, y - 0.02, 0, w + 0.36, 0.12, d + 0.36, 'granite', cap_region='granite', tile=2.0)
        self.box(0, y + (0.08 if curb else 0.0), 0, w, 0.05, d, 'lawn', tile=3.0)
        if shrubs and self.detail and w > 3.0 and d > 1.8:
            self.box(0, y + 0.12, 0, w - 1.2, 0.42, min(1.0, d * 0.4), 'hedge', tile=1.5)
        self.pose = prev

    def prism(self, poly_xz, y0, h, region, cap_region=None, tile=2.4, collide=False, holes=(), footing=False):
        pts = np.asarray(poly_xz, dtype=np.float64)
        if len(pts) >= 2 and np.allclose(pts[0], pts[-1]):
            pts = pts[:-1]
        if len(pts) < 3:
            return
        # Signed area in (x, z): in right-handed (X=east, Y=up, Z=south),
        # positive shoelace sum(x_i*z_{i+1} - x_{i+1}*z_i) means clockwise when viewed from +Y,
        # whose outward edge normal for edge a->b is (-(b_z - a_z), 0, b_x - a_x) = (a_z - b_z, 0, b_x - a_x).
        area2 = np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1])
        if area2 < 0:
            pts = pts[::-1]
        rings = [pts, *(np.asarray(ring) for ring in holes)]
        pts = np.concatenate(rings)
        tris = mapbox_earcut.triangulate_float64(pts, np.cumsum([len(ring) for ring in rings],dtype=np.uint32)).reshape(-1, 3)
        y1 = y0 + h
        for t in tris:
            quad_tri = [(pts[i, 0], y1, pts[i, 1]) for i in t]
            self.face(quad_tri, (0, 1, 0), cap_region or region, tile=tile)
            if collide and self.collide:
                self.hit.add_poly([self._xf(p) for p in quad_tri], self._xf_dir((0, 1, 0)), None)
        def bottom(point):
            if not footing:
                return y0
            x,y,z = self._xf((point[0],0,point[1]))
            return self.surface.ground(x,z)-y-.04
        if h > 0.02:
            for a,b in (pair for ring in rings for pair in zip(ring,np.roll(ring,-1,axis=0))):
                nrm = (b[1] - a[1], 0.0, a[0] - b[0])
                quad = [(a[0], bottom(a), a[1]), (b[0], bottom(b), b[1]), (b[0], y1, b[1]), (a[0], y1, a[1])]
                self.face(quad, nrm, region, tile=tile)
                if collide and self.collide and h >= 0.35:
                    seg_len = math.hypot(b[0] - a[0], b[1] - a[1])
                    steps = max(1, math.ceil(seg_len / 6.0))
                    for s in range(steps):
                        t0, t1 = s / steps, (s + 1) / steps
                        xa, za = a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0
                        xb, zb = a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1
                        self.hit.add_poly(
                            [self._xf((xa, y0, za)), self._xf((xb, y0, zb)), self._xf((xb, y1, zb)), self._xf((xa, y1, za))],
                            self._xf_dir(nrm), None)

    def footprint_building(
        self, poly_xz, floors=4, floor_h=3.45, wall='white', accent='terracotta',
        plinth='dark_stone', roof_kind='flat', roof_tile='gray_tile', y0=0.0,
        window_edges=None, sill_bands=True, holes=(),
    ):
        """Extrude an exact OSM/Overture polygon with plinth, window bands, sills, and roof.
        Guarantees 0.00 m centroid offset and 0.00 deg orientation difference vs map footprint."""
        pts = np.asarray(poly_xz, dtype=np.float64)
        if len(pts) >= 2 and np.allclose(pts[0], pts[-1]):
            pts = pts[:-1]
        if len(pts) < 3:
            return
        area2 = np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1])
        if area2 < 0:
            pts = pts[::-1]

        total_h = floors * floor_h
        corners = [self._xf((x, 0, z)) for x, z in pts]
        sill = max(y0+.55, max(self.surface.ground(x,z)-y for x,y,z in corners)+.10)
        self.prism(pts, y0-.35, sill-y0+.35, plinth, cap_region=plinth, tile=2.0, holes=holes, footing=True)
        self.prism(pts, sill, y0+total_h-sill, wall, cap_region=roof_tile if roof_kind == 'flat' else wall, tile=2.4, collide=True, holes=holes)
        # Parapet band at top
        self.prism(pts, y0 + total_h, 0.48, accent, cap_region=roof_tile if roof_kind == 'flat' else accent, tile=2.0, collide=False, holes=holes)

        # Add window strips along polygon edges >= 5.0m
        for i in range(len(pts)):
            if window_edges is not None and i not in window_edges:
                continue
            j = (i + 1) % len(pts)
            a, b = pts[i], pts[j]
            dx, dz = b[0] - a[0], b[1] - a[1]
            seg_len = math.hypot(dx, dz)
            if seg_len < 4.8:
                continue
            ux, uz = dx / seg_len, dz / seg_len
            nx, nz = (b[1] - a[1]) / seg_len, (a[0] - b[0]) / seg_len
            inset = min(1.1, seg_len * 0.10)
            w_len = seg_len - 2 * inset
            if w_len < 2.2:
                continue
            p_start = (a[0] + ux * inset + nx * 0.06, a[1] + uz * inset + nz * 0.06)
            p_end = (b[0] - ux * inset + nx * 0.06, b[1] - uz * inset + nz * 0.06)
            for fl in range(floors):
                wy0 = y0 + fl * floor_h + 1.12
                wy1 = wy0 + 1.48
                self.face([
                    (p_start[0], wy0, p_start[1]),
                    (p_end[0], wy0, p_end[1]),
                    (p_end[0], wy1, p_end[1]),
                    (p_start[0], wy1, p_start[1]),
                ], (nx, 0.0, nz), 'glass', tile=2.2, lit=True)
                if self.detail and sill_bands:
                    sx0, sz0 = a[0] + ux * (inset * 0.6) + nx * 0.08, a[1] + uz * (inset * 0.6) + nz * 0.08
                    sx1, sz1 = b[0] - ux * (inset * 0.6) + nx * 0.08, b[1] - uz * (inset * 0.6) + nz * 0.08
                    self.face([
                        (sx0, wy0 - 0.14, sz0), (sx1, wy0 - 0.14, sz1),
                        (sx1, wy0, sz1), (sx0, wy0, sz0),
                    ], (nx, 0.2, nz), accent if fl == 0 else 'white', tile=1.8)

        # Optional pitched hipped roof fitted onto minimum bounding box of polygon
        if roof_kind == 'pitched':
            # Compute principal orientation from longest edge
            best_len, best_ang = 0.0, 0.0
            for i in range(len(pts)):
                j = (i + 1) % len(pts)
                dx, dz = pts[j, 0] - pts[i, 0], pts[j, 1] - pts[i, 1]
                ln = math.hypot(dx, dz)
                if ln > best_len:
                    best_len = ln
                    best_ang = math.atan2(-dz, dx)
            c, s = math.cos(-best_ang), math.sin(-best_ang)
            rx = pts[:, 0] * c + pts[:, 1] * s
            rz = -pts[:, 0] * s + pts[:, 1] * c
            cx_r, cz_r = (rx.min() + rx.max()) / 2.0, (rz.min() + rz.max()) / 2.0
            w_r, d_r = float(rx.max() - rx.min()), float(rz.max() - rz.min())
            if d_r <= 22.0:
                wx = cx_r * math.cos(best_ang) + cz_r * math.sin(best_ang)
                wz = -cx_r * math.sin(best_ang) + cz_r * math.cos(best_ang)
                prev = self.pose
                self.pose = (float(wx), y0, float(wz), best_ang)
                self.pitched_roof(0, total_h + 0.42, 0, w_r, d_r, min(2.6, d_r * 0.19), 0.55, roof_tile, 'white')
                self.pose = prev

    def sign_board(self, x, yc, z, w, h, sign_key, backing='dark_stone', depth=0.08, double_sided=False):
        if backing and depth > 0:
            self.box(x, yc - h / 2 - 0.03, z - depth / 2, w + 0.10, h + 0.06, depth, backing, tile=1.0)
        hw, hh = w / 2.0, h / 2.0
        uvs = [(0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)]
        zf = z + 0.02
        self.face([(x - hw, yc - hh, zf), (x + hw, yc - hh, zf), (x + hw, yc + hh, zf), (x - hw, yc + hh, zf)],
                  (0, 0, 1), sign_key, tile=None, uvs=uvs)
        if double_sided:
            zb = z - depth - 0.02
            self.face([(x + hw, yc - hh, zb), (x - hw, yc - hh, zb), (x - hw, yc + hh, zb), (x + hw, yc + hh, zb)],
                      (0, 0, -1), sign_key, tile=None, uvs=uvs)

    def pitched_roof(self, x, y0, z, w, d, rise, overhang=0.60, tile_region='gray_tile', fascia_region='white'):
        hw, hd = w / 2.0 + overhang, d / 2.0 + overhang
        self.box(x, y0 - 0.20, z, hw * 2, 0.22, hd * 2, fascia_region, tile=2.0, bottom=True)
        ridge_half = max(0.3, hw - hd * 0.70)
        y1 = y0 + rise
        s_l, s_r = (x - hw, y0, z + hd), (x + hw, y0, z + hd)
        n_r, n_l = (x + hw, y0, z - hd), (x - hw, y0, z - hd)
        r_l, r_r = (x - ridge_half, y1, z), (x + ridge_half, y1, z)
        self.face([s_l, s_r, r_r, r_l], (0, rise, hd), tile_region, tile=1.6)
        self.face([n_r, n_l, r_l, r_r], (0, rise, -hd), tile_region, tile=1.6)
        self.face([s_r, n_r, r_r], (hd, rise, 0), tile_region, tile=1.6)
        self.face([n_l, s_l, r_l], (-hd, rise, 0), tile_region, tile=1.6)
        if self.detail and ridge_half > 0.5:
            self.box(x, y1 - 0.06, z, ridge_half * 2, 0.20, 0.30, tile_region, tile=1.0)

    def teaching_block(
        self, cx, cz, yaw, width, depth, floors, floor_h=3.45,
        wall='white', accent='terracotta', plinth='dark_stone', roof_kind='pitched',
        roof_tile='gray_tile', corridor=True, portico=True, sign_key=None, y0=0.0,
    ):
        prev = self.pose
        self.pose = (cx, y0, cz, yaw)
        total_h = floors * floor_h
        self.box(0, 0.0, 0, width + 0.3, 0.55, depth + 0.3, plinth, tile=2.0)
        self.box(0, 0.55, 0, width, total_h - 0.55, depth, wall, tile=2.4, collide=True)

        bay_w = min(5.0, width * 0.14)
        for sx in (-1, 1):
            bx = sx * (width / 2 - bay_w / 2 + 0.06)
            self.box(bx, 0.55, 0, bay_w, total_h + 0.30, depth + 0.32, accent, tile=2.0)

        corr_d = 1.75 if corridor else 0.0
        if corridor:
            for fl in range(floors):
                slab_y = fl * floor_h + (0.12 if fl == 0 else 0.0)
                if fl > 0:
                    self.box(0, slab_y, depth / 2 + corr_d / 2, width - bay_w * 1.6, 0.22, corr_d, 'white', tile=2.0)
                    self.box(0, slab_y + 0.22, depth / 2 + corr_d - 0.12, width - bay_w * 1.6, 0.90, 0.16,
                             accent if fl == 1 else 'white', tile=2.0)
            self.box(0, total_h - 0.18, depth / 2 + corr_d / 2, width - bay_w * 1.4, 0.26, corr_d + 0.2, 'white', tile=2.0)
            if self.detail:
                span = width - bay_w * 2.0
                n_cols = max(3, int(span / 4.8) + 1)
                for i in range(n_cols):
                    px = -span / 2 + span * i / max(1, n_cols - 1)
                    self.box(px, 0.1, depth / 2 + corr_d - 0.15, 0.32, total_h - 0.1, 0.32, 'white', tile=1.6)

        win_span = max(4.0, width - bay_w * 2.2)
        for fl in range(floors):
            wy = fl * floor_h + 1.15
            for side in (-1, 1):
                wz = side * (depth / 2 + 0.05)
                self.box(0, wy, wz, win_span, 1.50, 0.08, 'glass', tile=2.2, lit=True)

        if portico:
            pw = min(8.8, width * 0.24)
            pz = depth / 2 + corr_d
            self.box(0, 0.0, pz + 1.0, pw + 1.0, 0.36, 2.2, 'granite', tile=1.8)
            self.box(0, 3.80, pz + 0.85, pw, 0.38, 2.0, accent, tile=1.8)
            for sx in (-pw / 2 + 0.32, pw / 2 - 0.32):
                self.box(sx, 0.36, pz + 1.55, 0.44, 3.45, 0.44, 'granite', tile=1.5)
            if sign_key:
                self.box(0, total_h, depth / 2 + corr_d * 0.4, pw + 1.2, 1.25, 1.4, accent, tile=1.8)
                self.sign_board(0, total_h + 0.62, depth / 2 + corr_d * 0.4 + 0.72, min(pw, 5.0), 0.96, sign_key, backing=None, depth=0)
        elif sign_key:
            self.sign_board(0, total_h - 0.65, depth / 2 + corr_d + 0.1, 4.6, 0.95, sign_key)

        if roof_kind == 'pitched':
            self.pitched_roof(0, total_h + 0.1, corr_d * 0.4, width + 0.2, depth + corr_d * 0.8, 2.30, 0.60, roof_tile, 'white')
        else:
            self.box(0, total_h, corr_d * 0.4, width + 0.4, 0.55, depth + corr_d * 0.8 + 0.4, accent, cap_region=roof_tile, tile=2.0)

        self.pose = prev

    def retractable_gate(self, x0, x1, z, h=1.32, y0=0.04):
        """Closed-state stainless steel retractable gate with compact 0.38x0.52m motor head."""
        span = abs(x1 - x0)
        if span < 0.6:
            return
        xc = (x0 + x1) / 2.0
        head_x = x1 - 0.20 if x1 > x0 else x1 + 0.20
        # Compact motor box (~0.38 x 0.52 m, h=1.05m) so it never resembles a guardhouse
        self.box(head_x, y0, z, 0.38, 1.05, 0.52, 'dark_stone', tile=1.0)
        self.box(head_x, y0 + 0.72, z, 0.40, 0.14, 0.54, 'vermilion', tile=0.8)
        self.box(xc, y0 + 0.12, z, span, 0.07, 0.16, 'steel', tile=1.0)
        self.box(xc, y0 + h - 0.08, z, span, 0.08, 0.18, 'steel', tile=1.0)
        n_seg = max(4, int(span / 0.72)) if self.detail else max(3, int(span / 1.5))
        step = span / n_seg
        start = min(x0, x1)
        for i in range(n_seg):
            xa, xb = start + i * step, start + (i + 1) * step
            self.box(xa, y0 + 0.04, z, 0.05, h, 0.18, 'steel', tile=0.8)
            if self.detail:
                self.tube((xa, y0 + 0.16, z), (xb, y0 + h - 0.10, z), 0.028, 'steel', 4)
                self.tube((xa, y0 + h - 0.10, z), (xb, y0 + 0.16, z), 0.028, 'steel', 4)
        self.solid_box(xc, y0, z, span, h + 0.08, 0.32)

    def perimeter_wall(self, chain_xz, gap_segments=(), h=2.15, wall_mat='white', base_mat='granite', cap_mat='gray_tile'):
        pts = [np.asarray(p, np.float64) for p in chain_xz]
        for idx in range(len(pts) - 1):
            if idx in gap_segments:
                continue
            a, b = pts[idx], pts[idx + 1]
            dx, dz = b[0] - a[0], b[1] - a[1]
            ln = math.hypot(dx, dz)
            if ln < 0.4:
                continue
            yaw = math.atan2(-dx, -dz) + math.pi / 2
            prev = self.pose
            self.pose = (float((a[0] + b[0]) / 2), 0.0, float((a[1] + b[1]) / 2), yaw)
            parts = [self.atlas,self.lit,self.hit]
            starts = [len(part.pos) for part in parts]
            # Sample long runs in short panels so the stone cap follows the
            # same grade as the pickets between the two road survey vertices.
            spans = max(1, math.ceil(ln / 1.5))
            step_len = ln/spans
            centers = [(i+.5)*step_len-ln/2 for i in range(spans)]
            for px in centers:
                self.box(px, 0, 0, step_len, .68, .32, base_mat, tile=1.8, collide=True)
            if self.detail:
                n_bays = max(1, int(ln / 4.5))
                step = ln / n_bays
                for bi in range(n_bays + 1):
                    px = -ln / 2 + bi * step
                    self.box(px, 0.68, 0, 0.38, h - 0.68, 0.38, wall_mat, tile=1.5)
                    self.box(px, h, 0, 0.48, 0.12, 0.46, cap_mat, tile=1.0, bottom=True)
                for px in centers:
                    self.box(px, h-.16, 0, step_len, .06, .07, 'dark_stone', tile=1.0)
                    self.box(px, .82, 0, step_len, .05, .07, 'dark_stone', tile=1.0)
                for rx in np.arange(-ln / 2 + 0.4, ln / 2 - 0.3, 0.55):
                    self.box(float(rx), 0.70, 0, 0.035, h - 0.86, 0.045, 'dark_stone', tile=0.8)
            else:
                for px in centers:
                    self.box(px, .68, 0, step_len, h-.68, .26, wall_mat, tile=2.2)
            if self.collide:
                for px in centers:
                    self.solid_box(px, 0, 0, step_len, h, .36)
            for part,start in zip(parts,starts):
                for k in range(start,len(part.pos)):
                    x,y,z = part.pos[k]
                    part.pos[k]=(x,y+self.surface.ground(x,z),z)
            self.pose = prev

    def track_field(self, cx, cz, yaw, straight_len, inner_r, track_w=5.2, stand_side=0, y0=0.05):
        """Red running track oval + parallel-mow-striped green soccer pitch (zero radial fan lines)."""
        prev = self.pose
        self.pose = (cx, y0, cz, yaw)
        outer_r = inner_r + track_w
        half_s = straight_len / 2.0
        steps = 18 if self.detail else 8

        def oval_ring(r):
            pts = []
            for i in range(steps + 1):
                ang = math.pi * i / steps
                pts.append((r * math.cos(ang), half_s + r * math.sin(ang)))
            for i in range(steps + 1):
                ang = math.pi + math.pi * i / steps
                pts.append((r * math.cos(ang), -half_s + r * math.sin(ang)))
            return pts

        outer = oval_ring(outer_r)
        inner = oval_ring(inner_r)
        # 1. Track ring
        for i in range(len(outer)):
            j = (i + 1) % len(outer)
            self.face([(inner[i][0], 0.02, inner[i][1]), (outer[i][0], 0.02, outer[i][1]),
                       (outer[j][0], 0.02, outer[j][1]), (inner[j][0], 0.02, inner[j][1])],
                      (0, 1, 0), 'track_red', tile=4.0)

        # 2. North & South semicircular D-zones in solid turf_green (parallel chord strips, no radial fan!)
        for sign_z in (1.0, -1.0):
            base_z = sign_z * half_s
            for i in range(steps // 2):
                a0 = math.pi * i / steps
                a1 = math.pi * (i + 1) / steps
                z0 = base_z + sign_z * inner_r * math.sin(a0)
                z1 = base_z + sign_z * inner_r * math.sin(a1)
                x0 = inner_r * math.cos(a0)
                x1 = inner_r * math.cos(a1)
                if sign_z > 0:
                    quad = [(-x0, 0.025, z0), (x0, 0.025, z0), (x1, 0.025, z1), (-x1, 0.025, z1)]
                else:
                    quad = [(-x1, 0.025, z1), (x1, 0.025, z1), (x0, 0.025, z0), (-x0, 0.025, z0)]
                self.face(quad, (0, 1, 0), 'turf_green', tile=8.0)

        # 3. Central rectangular pitch in clean PARALLEL cross-field mow stripes!
        n_stripes = 10
        for si in range(n_stripes):
            za = -half_s + straight_len * si / n_stripes
            zb = -half_s + straight_len * (si + 1) / n_stripes
            mat = 'turf_light' if (si % 2 == 0) else 'turf_green'
            self.face([(-inner_r, 0.026, zb), (inner_r, 0.026, zb), (inner_r, 0.026, za), (-inner_r, 0.026, za)],
                      (0, 1, 0), mat, tile=8.0)

        if self.detail:
            for lane in (1, 2, 3):
                lr = inner_r + track_w * lane / 4.0
                la, lb = oval_ring(lr - 0.045), oval_ring(lr + 0.045)
                for i in range(len(la)):
                    j = (i + 1) % len(la)
                    self.face([(la[i][0], 0.038, la[i][1]), (lb[i][0], 0.038, lb[i][1]),
                               (lb[j][0], 0.038, lb[j][1]), (la[j][0], 0.038, la[j][1])],
                              (0, 1, 0), 'line_white', tile=2.0)
            fw, fl = inner_r * 1.62, straight_len * 0.96
            self.box(0, 0.036, 0, fw, 0.015, 0.12, 'line_white', tile=1.0)
            # Center circle
            cr = min(6.5, fw * 0.18)
            c_steps = 16
            for i in range(c_steps):
                a0, a1 = 2 * math.pi * i / c_steps, 2 * math.pi * (i + 1) / c_steps
                self.face([
                    ((cr - 0.06) * math.cos(a0), 0.038, (cr - 0.06) * math.sin(a0)),
                    ((cr + 0.06) * math.cos(a0), 0.038, (cr + 0.06) * math.sin(a0)),
                    ((cr + 0.06) * math.cos(a1), 0.038, (cr + 0.06) * math.sin(a1)),
                    ((cr - 0.06) * math.cos(a1), 0.038, (cr - 0.06) * math.sin(a1)),
                ], (0, 1, 0), 'line_white', tile=1.0)
            for sx in (-fw / 2, fw / 2):
                self.box(sx, 0.036, 0, 0.12, 0.015, fl, 'line_white', tile=1.0)
            for sz in (-fl / 2, fl / 2):
                self.box(0, 0.036, sz, fw, 0.015, 0.12, 'line_white', tile=1.0)
                # Penalty box
                sdir = -1.0 if sz > 0 else 1.0
                pw, pd = fw * 0.52, min(11.0, fl * 0.16)
                self.box(0, 0.036, sz + sdir * pd, pw, 0.015, 0.10, 'line_white', tile=1.0)
                for px in (-pw / 2, pw / 2):
                    self.box(px, 0.036, sz + sdir * pd / 2, 0.10, 0.015, pd, 'line_white', tile=1.0)
                gw, gh = min(5.4, fw * 0.30), 2.15
                self.box(-gw / 2, 0.03, sz, 0.10, gh, 0.10, 'line_white', tile=0.8)
                self.box(gw / 2, 0.03, sz, 0.10, gh, 0.10, 'line_white', tile=0.8)
                self.box(0, gh, sz, gw + 0.10, 0.10, 0.10, 'line_white', tile=0.8)

        if stand_side in (-1, 1) and straight_len >= 18:
            sx = stand_side * (outer_r + 2.8)
            sw = min(28.0, straight_len * 0.72)
            for step in range(4):
                self.box(sx + stand_side * step * 0.85, 0.0, 0, 0.9, 0.45 * (step + 1), sw, 'granite', tile=2.0, collide=(step == 3))
            self.box(sx + stand_side * 1.6, 1.8, 0, 3.8, 2.8, min(12.0, sw * 0.5), 'white', tile=2.0)
            self.box(sx + stand_side * 1.2, 4.5, 0, 5.2, 0.28, min(13.2, sw * 0.55), 'terracotta', tile=2.0)

        self.pose = prev

    def basketball_court(self, cx, cz, yaw, surface='court_green', apron='track_red', y0=0.05, scale=1.0):
        prev = self.pose
        self.pose = (cx, y0, cz, yaw)
        w, d = 15.0 * scale, 28.0 * scale
        self.box(0, 0.0, 0, w + 2.4 * scale, 0.035, d + 2.4 * scale, apron, tile=3.0)
        self.box(0, 0.04, 0, w, 0.02, d, surface, tile=3.0)
        if self.detail:
            self.box(0, 0.065, 0, w, 0.015, 0.10, 'line_white', tile=1.0)
            for sx in (-w / 2 + 0.05, w / 2 - 0.05):
                self.box(sx, 0.065, 0, 0.10, 0.015, d, 'line_white', tile=1.0)
            for sz in (-d / 2 + 0.05, d / 2 - 0.05):
                self.box(0, 0.065, sz, w, 0.015, 0.10, 'line_white', tile=1.0)
                sdir = 1 if sz > 0 else -1
                self.box(0, 0.062, sz - sdir * 2.8 * scale, 4.8 * scale, 0.015, 5.6 * scale, apron, tile=2.0)
                hz = sz + sdir * 0.85 * scale
                self.box(0, 0.04, hz, 0.20, 3.05, 0.20, 'blue_facade', tile=0.8)
                self.box(0, 2.95, hz - sdir * 0.50, 0.14, 0.14, 1.0, 'blue_facade', tile=0.8)
                self.box(0, 2.55, hz - sdir * 1.0, 1.7, 1.0, 0.06, 'line_white', tile=1.0)
                self.box(0, 2.75, hz - sdir * 1.18, 0.44, 0.05, 0.44, 'vermilion', tile=0.5)
        self.pose = prev

    def flagpole_plinth(self, cx, cz, yaw, poles=1, height=11.5, y0=0.0):
        prev = self.pose
        self.pose = (cx, y0, cz, yaw)
        w = 4.4 if poles == 1 else 6.8
        self.box(0, 0.0, 0, w, 0.28, 3.4, 'granite', tile=1.6, collide=True)
        self.box(0, 0.28, 0, w - 0.8, 0.28, 2.6, 'dark_stone', tile=1.4, collide=True)
        offsets = [0.0] if poles == 1 else [-1.5, 0.0, 1.5]
        for ox in offsets:
            ph = height if ox == 0 else height * 0.86
            self.cylinder_y(ox, 0.56, ph, 0.0, 0.085, 'steel', sections=6)
            if ox == 0:
                self.box(ox + 0.92, 0.56 + ph - 1.40, 0.0, 1.80, 1.18, 0.04, 'vermilion', tile=1.0)
            elif self.detail:
                self.box(ox + 0.75, 0.56 + ph - 1.30, 0.0, 1.45, 0.95, 0.04, 'court_blue', tile=1.0)
        self.pose = prev

    def motto_stone(self, cx, cz, yaw, sign_key, w=4.4, h=1.85, y0=0.0):
        prev = self.pose
        self.pose = (cx, y0, cz, yaw)
        self.cylinder_y(0, 0.0, 0.28, 0, w * 0.72, 'granite', sections=14)
        self.cylinder_y(0, 0.28, 0.16, 0, w * 0.64, 'lawn', sections=14)
        self.box(0, 0.32, 0, w + 0.4, 0.32, 1.35, 'dark_stone', tile=1.4, collide=True)
        self.box(0, 0.64, 0, w, h, 0.78, 'granite', tile=1.8, collide=True)
        self.sign_board(0, 0.64 + h * 0.52, 0.41, w * 0.84, h * 0.66, sign_key, backing=None, depth=0, double_sided=True)
        self.pose = prev

    def campus_tree(self, x, z, h=8.0, spread=3.2, seed=1, kind='camphor', y0=0.0, planter=True):
        tx, ty, tz = self._xf((x, y0, z))
        prev = self.pose
        self.pose = (tx, ty+self.surface.ground(tx,tz), tz, 0.0)
        if planter:
            self.box(0, 0.02, 0, 1.85, 0.16, 1.85, 'granite', tile=1.2)
            self.box(0, 0.18, 0, 1.48, 0.04, 1.48, 'lawn', tile=1.2)
        trunk_h = h * 0.40
        self.cylinder_y(0, 0.16 if planter else 0.0, trunk_h, 0, 0.21 * (1.3 if kind == 'banyan' else 1.0), 'bark', sections=6)
        if not self.detail:
            self.cylinder_y(0, trunk_h - 0.15, h * 0.50, 0, spread * 0.80, 'foliage', sections=6)
            self.pose = prev
            return
        blobs = [
            (0.0, trunk_h + h * 0.25, 0.0, spread * 0.84, h * 0.33),
            (-spread * 0.34, trunk_h + h * 0.16, spread * 0.20, spread * 0.56, h * 0.24),
            (spread * 0.32, trunk_h + h * 0.18, -spread * 0.20, spread * 0.54, h * 0.24),
        ]
        ico = trimesh.creation.icosphere(subdivisions=1, radius=1.0)
        for bx, by, bz, br, bh in blobs:
            verts = ico.vertices.copy()
            verts[:, 0] = verts[:, 0] * br + bx
            verts[:, 1] = verts[:, 1] * bh + by
            verts[:, 2] = verts[:, 2] * br + bz
            for f in ico.faces:
                tri = [verts[f[0]], verts[f[1]], verts[f[2]]]
                nrm = np.mean(tri, axis=0) - np.array([bx, by, bz])
                self.face(tri, nrm, 'foliage', tile=2.2)
        self.pose = prev


def _to_trimesh(part: MeshPart, image, name, emissive=(0, 0, 0), metallic=0.04, roughness=0.88):
    if not part.faces:
        return None
    mat = trimesh.visual.material.PBRMaterial(
        name=name,
        baseColorTexture=image,
        metallicFactor=float(metallic),
        roughnessFactor=float(roughness),
        emissiveFactor=[float(c) for c in emissive],
        doubleSided=False,
    )
    if any(emissive):
        mat.emissiveTexture = image
    geom = trimesh.Trimesh(
        vertices=np.asarray(part.pos, np.float32),
        faces=np.asarray(part.faces, np.int64),
        vertex_normals=np.asarray(part.nrm, np.float32),
        process=False,
    )
    geom.visual = trimesh.visual.TextureVisuals(uv=np.asarray(part.uv, np.float32), material=mat)
    return geom


def export_school(path, build_fn, signs=()):
    image, rects = make_school_atlas(signs)
    hi = Builder(rects, lod=0, collide=True)
    lo = Builder(rects, lod=1, collide=False)
    from c_kit import landmark_surface
    hi.surface = lo.surface = landmark_surface(Path(path).stem)
    build_fn(hi)
    build_fn(lo)

    scene = trimesh.Scene()
    base = scene.graph.base_frame
    for lod_name, b in (('lod0', hi), ('lod1', lo)):
        scene.graph.update(frame_from=base, frame_to=lod_name)
        m_atlas = _to_trimesh(b.atlas, image, 'g3_atlas', (0, 0, 0), 0.04, 0.88)
        if m_atlas is not None:
            scene.add_geometry(m_atlas, node_name=f'{lod_name}_atlas', parent_node_name=lod_name)
        m_lit = _to_trimesh(b.lit, image, 'g3_window_lit', (0.42, 0.28, 0.14), 0.06, 0.38)
        if m_lit is not None:
            scene.add_geometry(m_lit, node_name=f'{lod_name}_lit', parent_node_name=lod_name)

    if hi.hit.faces:
        m_hit = trimesh.Trimesh(
            vertices=np.asarray(hi.hit.pos, np.float32),
            faces=np.asarray(hi.hit.faces, np.int64),
            process=False,
        )
        scene.add_geometry(m_hit, node_name='collision_body')

    scene.export(path)
    n0 = len(hi.atlas) + len(hi.lit)
    n1 = len(lo.atlas) + len(lo.lit)
    print(f"{Path(path).stem}: lod0={n0} tris, lod1={n1} tris, collision={len(hi.hit)} tris")
    return n0, n1
