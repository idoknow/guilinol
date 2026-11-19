"""Shared procedural texture atlas and architectural builder for M2.7-G3 schools.

All textures are painted procedurally (never from photos) following docs/style.md
and saved to public/textures/landmarks/g3/atlas.png. Each school GLB embeds the
single 1024x1024 atlas and uses at most two materials (`atlas` + `lit` for night
windows), keeping per-school draw calls <= 2.
"""
import math
from pathlib import Path

import mapbox_earcut
import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFont

ATLAS = 1024
ROOT = Path(__file__).resolve().parents[2]
TEX_DIR = ROOT / 'public' / 'textures' / 'landmarks' / 'g3'

# Material swatches in top 288 px (3 rows x 8 cols of 128x96).
SWATCH_GRID = [
    # Row 0 (y = 0..96)
    ('white',       (0,   0, 128, 96)),
    ('cream',       (128, 0, 128, 96)),
    ('ochre',       (256, 0, 128, 96)),
    ('terracotta',  (384, 0, 128, 96)),
    ('brick_red',   (512, 0, 128, 96)),
    ('blue_facade', (640, 0, 128, 96)),
    ('granite',     (768, 0, 128, 96)),
    ('dark_stone',  (896, 0, 128, 96)),
    # Row 1 (y = 96..192)
    ('gray_tile',   (0,   96, 128, 96)),
    ('green_glaze', (128, 96, 128, 96)),
    ('red_tile',    (256, 96, 128, 96)),
    ('track_red',   (384, 96, 128, 96)),
    ('turf_green',  (512, 96, 128, 96)),
    ('court_green', (640, 96, 128, 96)),
    ('court_blue',  (768, 96, 128, 96)),
    ('pave',        (896, 96, 128, 96)),
    # Row 2 (y = 192..288)
    ('wood',        (0,   192, 128, 96)),
    ('vermilion',   (128, 192, 128, 96)),
    ('steel',       (256, 192, 128, 96)),
    ('gold',        (384, 192, 128, 96)),
    ('foliage',     (512, 192, 128, 96)),
    ('bark',        (640, 192, 128, 96)),
    ('glass',       (768, 192, 128, 96)),
    ('line_white',  (896, 192, 128, 96)),
]

RECTS = dict(SWATCH_GRID)

# High-DPI plaques & signage in y = 288..1024
SIGN_DEFS = {
    # Row y=288..368 (h=80): University & Middle school main gate plaques
    'glmu_gate':      ((0,   288, 640, 80), '桂 林 医 科 大 学', 'GUILIN MEDICAL UNIVERSITY', (228, 190, 92), (96, 42, 38), True),
    'glmu_stone':     ((640, 288, 384, 80), '桂林医科大学', '东城校区', (168, 36, 34), (234, 232, 226), False),
    # Row y=368..448 (h=80)
    'glut_gate':      ((0,   368, 640, 80), '桂林理工大学附属小学', 'PRIMARY SCHOOL ATTACHED TO GLUT', (176, 38, 34), (242, 239, 232), True),
    'glmu_motto':     ((640, 368, 384, 80), '弘 德 善 医', '', (168, 40, 36), (222, 218, 208), False),
    # Row y=448..528 (h=80)
    'tjb_gate':       ((0,   448, 640, 80), '桂林市田家炳中学', 'GUILIN TIAN JIABING MIDDLE SCHOOL', (218, 178, 72), (124, 42, 38), True),
    'tjb_motto':      ((640, 448, 384, 80), '己立立人  博学笃行', '', (168, 40, 36), (240, 236, 228), False),
    # Row y=528..608 (h=80)
    'chenshan_gate':  ((0,   528, 640, 80), '桂 林 市 辰 山 小 学', 'GUILIN CHENSHAN PRIMARY SCHOOL', (178, 40, 36), (242, 238, 228), True),
    'chenshan_motto': ((640, 528, 384, 80), '向阳生长  逐光而行', '', (172, 44, 38), (240, 236, 226), False),
    # Row y=608..688 (h=80)
    'lijiang_gate':   ((0,   608, 640, 80), '桂 林 市 漓 江 小 学', 'GUILIN LIJIANG PRIMARY SCHOOL', (36, 94, 138), (242, 240, 234), True),
    'lijiang_motto':  ((640, 608, 384, 80), '上善若水  润泽童年', '', (36, 94, 138), (240, 242, 244), False),
    # Row y=688..768 (h=80)
    'longyin_gate':   ((0,   688, 640, 80), '桂 林 市 龙 隐 小 学', 'GUILIN LONGYIN PRIMARY SCHOOL', (174, 38, 34), (242, 238, 230), True),
    'longyin_motto':  ((640, 688, 384, 80), '龙行致远  隐学笃志', '', (174, 38, 34), (242, 238, 228), False),
    # Row y=768..832 (h=64): Building plaques
    'bld_hongde':     ((0,   768, 256, 64), '弘 德 楼', '', (232, 194, 84), (116, 42, 38), False),
    'bld_lib':        ((256, 768, 256, 64), '图 书 馆', 'LIBRARY', (42, 50, 60), (236, 234, 228), True),
    'bld_kejiao':     ((512, 768, 256, 64), '科 教 楼', '', (168, 40, 36), (238, 234, 226), False),
    'bld_stomat':     ((768, 768, 256, 64), '附属口腔医院', '', (32, 92, 140), (242, 244, 246), True),
    # Row y=832..896 (h=64)
    'bld_tjb_hall':   ((0,   832, 256, 64), '田 家 炳 楼', '', (230, 190, 80), (122, 42, 38), False),
    'bld_mingde':     ((256, 832, 256, 64), '明 德 楼', '', (168, 40, 36), (240, 236, 228), False),
    'bld_boxue':      ((512, 832, 256, 64), '博 学 楼', '', (168, 40, 36), (240, 236, 228), False),
    'bld_zhiyuan':    ((768, 832, 256, 64), '致 远 楼', '', (36, 92, 138), (240, 242, 244), False),
    # Row y=896..960 (h=64)
    'bld_houde':      ((0,   896, 256, 64), '厚 德 楼', '', (168, 40, 36), (240, 236, 228), False),
    'bld_shangshan':  ((256, 896, 256, 64), '尚 善 楼', '', (36, 94, 138), (240, 242, 244), False),
    'bld_chongwen':   ((512, 896, 256, 64), '崇 文 楼', '', (168, 40, 36), (240, 236, 228), False),
    'bld_qiushi':     ((768, 896, 256, 64), '求 是 楼', '', (168, 40, 36), (240, 236, 228), False),
    # Row y=960..1024 (h=64): Banners & emblems
    'banner_study':   ((0,   960, 512, 64), '文明  博学  求真  向上', '', (246, 242, 232), (166, 42, 38), True),
    'banner_sport':   ((512, 960, 512, 64), '阳光体育  健康成长', '', (246, 242, 232), (44, 108, 148), True),
}

for _k, (_rect, *_rest) in SIGN_DEFS.items():
    RECTS[_k] = _rect


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
    raise SystemExit('g3_kit: no CJK font found for school plaques.')


def _paint_bricks(img, rect, base, mortar, bw, bh, seed, shade=10):
    x, y, w, h = rect
    rng = np.random.default_rng(seed)
    patch = np.empty((h, w, 3), np.uint8)
    patch[:] = mortar
    row = 0
    for yy in range(0, h, bh):
        off = (bw // 2) if (row % 2) else 0
        for xx in range(-off, w, bw):
            x0, x1 = max(0, xx + 1), min(w, xx + bw - 1)
            y0, y1 = max(0, yy + 1), min(h, yy + bh - 1)
            if x1 > x0 and y1 > y0:
                d = int(rng.integers(-shade, shade + 1))
                patch[y0:y1, x0:x1] = np.clip(np.array(base) + d, 0, 255)
        row += 1
    img[y:y + h, x:x + w] = patch


def _paint_tiles(img, rect, base, dark, seed):
    x, y, w, h = rect
    rng = np.random.default_rng(seed)
    patch = np.empty((h, w, 3), np.uint8)
    patch[:] = dark
    bw, bh = 18, 12
    row = 0
    for yy in range(0, h, bh):
        off = (bw // 2) if (row % 2) else 0
        for xx in range(-off, w, bw):
            x0, x1 = max(0, xx + 1), min(w, xx + bw - 2)
            y0, y1 = max(0, yy + 1), min(h, yy + bh - 2)
            if x1 > x0 and y1 > y0:
                d = int(rng.integers(-9, 10))
                patch[y0:y1, x0:x1] = np.clip(np.array(base) + d, 0, 255)
        row += 1
    img[y:y + h, x:x + w] = patch


def _paint_noise(img, rect, base, amount, seed, stripes=False):
    x, y, w, h = rect
    rng = np.random.default_rng(seed)
    patch = np.full((h, w, 3), base, np.int16)
    patch += rng.integers(-amount, amount + 1, (h, w, 1))
    if stripes:
        for row in range(0, h, 16):
            patch[row:row + 8] += 7
            patch[row + 8:row + 16] -= 6
    img[y:y + h, x:x + w] = np.clip(patch, 0, 255).astype(np.uint8)


def paint_atlas():
    img = np.zeros((ATLAS, ATLAS, 3), np.uint8)
    _paint_bricks(img, RECTS['white'], (236, 232, 223), (220, 216, 207), 32, 16, 101, shade=4)
    _paint_bricks(img, RECTS['cream'], (223, 213, 194), (206, 196, 178), 32, 16, 102, shade=5)
    _paint_bricks(img, RECTS['ochre'], (216, 182, 116), (196, 162, 100), 32, 16, 103, shade=7)
    _paint_bricks(img, RECTS['terracotta'], (173, 86, 71), (194, 178, 166), 24, 12, 104, shade=9)
    _paint_bricks(img, RECTS['brick_red'], (143, 63, 54), (176, 164, 156), 24, 12, 105, shade=9)
    _paint_bricks(img, RECTS['blue_facade'], (76, 108, 134), (62, 90, 114), 32, 16, 106, shade=6)
    _paint_bricks(img, RECTS['granite'], (184, 184, 179), (162, 162, 157), 36, 24, 107, shade=7)
    _paint_bricks(img, RECTS['dark_stone'], (70, 75, 81), (54, 58, 64), 36, 24, 108, shade=6)

    _paint_tiles(img, RECTS['gray_tile'], (93, 99, 104), (64, 68, 72), 109)
    _paint_tiles(img, RECTS['green_glaze'], (75, 125, 92), (48, 86, 62), 110)
    _paint_tiles(img, RECTS['red_tile'], (149, 74, 62), (108, 50, 42), 111)
    _paint_noise(img, RECTS['track_red'], (184, 74, 62), 9, 112)
    _paint_noise(img, RECTS['turf_green'], (85, 129, 74), 7, 113, stripes=True)
    _paint_noise(img, RECTS['court_green'], (75, 122, 89), 5, 114)
    _paint_noise(img, RECTS['court_blue'], (69, 107, 139), 5, 115)
    _paint_bricks(img, RECTS['pave'], (182, 178, 166), (160, 156, 145), 28, 20, 116, shade=6)

    _paint_noise(img, RECTS['wood'], (120, 73, 57), 8, 117)
    _paint_noise(img, RECTS['vermilion'], (180, 51, 45), 6, 118)
    _paint_noise(img, RECTS['steel'], (174, 181, 188), 6, 119)
    _paint_noise(img, RECTS['gold'], (217, 175, 77), 7, 120)
    _paint_noise(img, RECTS['bark'], (101, 80, 58), 10, 121)
    _paint_noise(img, RECTS['line_white'], (243, 241, 234), 2, 122)

    # Foliage patch
    fx, fy, fw, fh = RECTS['foliage']
    rng = np.random.default_rng(123)
    fpatch = np.full((fh, fw, 3), (44, 76, 40), np.uint8)
    yy, xx = np.mgrid[0:fh, 0:fw]
    for _ in range(22):
        cx, cy = int(rng.integers(0, fw)), int(rng.integers(0, fh))
        rad = int(rng.integers(10, 28))
        col = rng.integers((52, 88, 44), (104, 142, 68))
        fpatch[(xx - cx) ** 2 + (yy - cy) ** 2 < rad ** 2] = col
    img[fy:fy + fh, fx:fx + fw] = fpatch

    # Glass patch with mullions
    gx, gy, gw, gh = RECTS['glass']
    gpatch = np.full((gh, gw, 3), (49, 66, 80), np.uint8)
    for col in range(0, gw, 32):
        gpatch[:, max(0, col - 1):min(gw, col + 2)] = (92, 108, 120)
    for row in range(0, gh, 32):
        gpatch[max(0, row - 1):min(gh, row + 2), :] = (92, 108, 120)
    img[gy:gy + gh, gx:gx + gw] = gpatch

    pil = Image.fromarray(img)
    draw = ImageDraw.Draw(pil)
    for key, (rect, main_txt, sub_txt, fg, bg, sans) in SIGN_DEFS.items():
        rx, ry, rw, rh = rect
        draw.rectangle((rx, ry, rx + rw - 1, ry + rh - 1), fill=bg)
        border = tuple(int(c * 0.75 + fg[i] * 0.25) for i, c in enumerate(bg))
        draw.rectangle((rx + 3, ry + 3, rx + rw - 4, ry + rh - 4), outline=border, width=2)
        if sub_txt:
            main_h = int(rh * 0.62)
            f_main = _font(min(44, int(main_h * 0.74)), bold=True, sans=sans)
            tb = draw.textbbox((0, 0), main_txt, font=f_main, stroke_width=1)
            tw, th = tb[2] - tb[0], tb[3] - tb[1]
            draw.text((rx + (rw - tw) / 2 - tb[0], ry + (main_h - th) / 2 - tb[1] + 2),
                      main_txt, font=f_main, fill=fg, stroke_width=1, stroke_fill=fg)
            sub_h = rh - main_h
            f_sub = _font(max(12, int(sub_h * 0.52)), bold=True, sans=True)
            sb = draw.textbbox((0, 0), sub_txt, font=f_sub)
            sw, sh = sb[2] - sb[0], sb[3] - sb[1]
            draw.text((rx + (rw - sw) / 2 - sb[0], ry + main_h + (sub_h - sh) / 2 - sb[1] - 2),
                      sub_txt, font=f_sub, fill=fg)
        else:
            sz = min(46, int(rh * 0.58))
            while sz > 18:
                f_main = _font(sz, bold=True, sans=sans)
                tb = draw.textbbox((0, 0), main_txt, font=f_main, stroke_width=1)
                if tb[2] - tb[0] <= rw - 24:
                    break
                sz -= 3
            tw, th = tb[2] - tb[0], tb[3] - tb[1]
            draw.text((rx + (rw - tw) / 2 - tb[0], ry + (rh - th) / 2 - tb[1]),
                      main_txt, font=f_main, fill=fg, stroke_width=1, stroke_fill=fg)
    return pil


def ensure_textures(folder=None):
    image = paint_atlas()
    TEX_DIR.mkdir(parents=True, exist_ok=True)
    image.save(TEX_DIR / 'atlas.png', optimize=True)
    if folder is not None:
        image.save(Path(folder) / 'atlas.png', optimize=True)
    return image


class MeshPart:
    def __init__(self):
        self.pos = []
        self.nrm = []
        self.uv = []
        self.faces = []

    def __len__(self):
        return len(self.faces)

    def add_quad_or_poly(self, pts, outward, region, tile=None, uvs=None):
        pts = [np.asarray(p, np.float64) for p in pts]
        if len(pts) < 3:
            return
        normal = np.cross(pts[1] - pts[0], pts[2] - pts[0])
        ln = np.linalg.norm(normal)
        if ln < 1e-8:
            return
        normal /= ln
        if outward is not None and np.dot(normal, np.asarray(outward, np.float64)) < 0:
            pts = list(reversed(pts))
            if uvs is not None:
                uvs = list(reversed(uvs))
            normal = -normal
        if uvs is not None:
            local = [(float(u), float(v)) for u, v in uvs]
        else:
            helper = np.array([0.0, 1.0, 0.0]) if abs(normal[1]) < 0.85 else np.array([1.0, 0.0, 0.0])
            tangent = np.cross(helper, normal)
            tangent /= np.linalg.norm(tangent)
            bitangent = np.cross(normal, tangent)
            raw = [(float(np.dot(p, tangent)), float(np.dot(p, bitangent))) for p in pts]
            if tile is None:
                us, vs = [u for u, _ in raw], [v for _, v in raw]
                minu, maxu, minv, maxv = min(us), max(us), min(vs), max(vs)
                du, dv = max(maxu - minu, 1e-6), max(maxv - minv, 1e-6)
                local = [((u - minu) / du, (v - minv) / dv) for u, v in raw]
            else:
                local = [((u / tile) % 1.0, (v / tile) % 1.0) for u, v in raw]
        rx, ry, rw, rh = RECTS[region]
        pad_x = 2.0 if tile is not None else 1.5
        pad_y = 2.0 if tile is not None else 1.5
        ix, iy, iw, ih = rx + pad_x, ry + pad_y, rw - 2 * pad_x, rh - 2 * pad_y
        packed = [((ix + (u % 1.0 if tile is not None else np.clip(u, 0.0, 1.0)) * iw) / ATLAS,
                   1.0 - (iy + (v % 1.0 if tile is not None else np.clip(v, 0.0, 1.0)) * ih) / ATLAS)
                  for u, v in local]
        base = len(self.pos)
        for p, uv in zip(pts, packed):
            self.pos.append((float(p[0]), float(p[1]), float(p[2])))
            self.nrm.append((float(normal[0]), float(normal[1]), float(normal[2])))
            self.uv.append(uv)
        for i in range(1, len(pts) - 1):
            self.faces.append((base, base + i, base + i + 1))


class Builder:
    def __init__(self, lod=0, collide=False):
        self.lod = lod
        self.detail = (lod == 0)
        self.collide = collide
        self.atlas = MeshPart()
        self.lit = MeshPart()
        self.hit = MeshPart()
        self.pose = (0.0, 0.0, 0.0, 0.0)  # (tx, ty, tz, yaw_rad)

    def _xf(self, p):
        tx, ty, tz, yaw = self.pose
        x, y, z = float(p[0]), float(p[1]), float(p[2])
        if yaw:
            c, s = math.cos(yaw), math.sin(yaw)
            return (tx + x * c + z * s, ty + y, tz - x * s + z * c)
        return (tx + x, ty + y, tz + z)

    def _xf_dir(self, d):
        if d is None:
            return None
        _, _, _, yaw = self.pose
        x, y, z = float(d[0]), float(d[1]), float(d[2])
        if yaw:
            c, s = math.cos(yaw), math.sin(yaw)
            return (x * c + z * s, y, -x * s + z * c)
        return (x, y, z)

    def face(self, pts, outward, region, tile=None, uvs=None, lit=False):
        target = self.lit if lit else self.atlas
        target.add_quad_or_poly([self._xf(p) for p in pts], self._xf_dir(outward), region, tile=tile, uvs=uvs)

    def solid_box(self, x, y0, z, w, h, d, cell=10.0):
        if not self.collide:
            return
        hx, hz = w / 2.0, d / 2.0
        x0, x1, y1, z0, z1 = x - hx, x + hx, y0 + h, z - hz, z + hz

        def subdiv(f_axis, f_val, u_ax, u0, u1, v_ax, v0, v1, out_dir):
            nu = max(1, math.ceil(abs(u1 - u0) / cell))
            nv = max(1, math.ceil(abs(v1 - v0) / cell))
            for i in range(nu):
                for j in range(nv):
                    a0 = u0 + (u1 - u0) * i / nu
                    a1 = u0 + (u1 - u0) * (i + 1) / nu
                    b0 = v0 + (v1 - v0) * j / nv
                    b1 = v0 + (v1 - v0) * (j + 1) / nv

                    def pt(u, v):
                        arr = [0.0, 0.0, 0.0]
                        arr[f_axis] = f_val
                        arr[u_ax] = u
                        arr[v_ax] = v
                        return self._xf(arr)

                    self.hit.add_quad_or_poly([pt(a0, b0), pt(a1, b0), pt(a1, b1), pt(a0, b1)],
                                              self._xf_dir(out_dir), 'granite', tile=None)

        subdiv(0, x1, 2, z0, z1, 1, y0, y1, (1, 0, 0))
        subdiv(0, x0, 2, z1, z0, 1, y0, y1, (-1, 0, 0))
        subdiv(1, y1, 0, x0, x1, 2, z1, z0, (0, 1, 0))
        subdiv(2, z1, 0, x0, x1, 1, y0, y1, (0, 0, 1))
        subdiv(2, z0, 0, x1, x0, 1, y0, y1, (0, 0, -1))

    def box(self, x, y0, z, w, h, d, region, tile=2.0, collide=False, lit=False, bottom=False):
        hx, hz = w / 2.0, d / 2.0
        x0, x1, y1, z0, z1 = x - hx, x + hx, y0 + h, z - hz, z + hz
        faces = [
            ([(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)], (0, 1, 0)),
            ([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], (1, 0, 0)),
            ([(x0, y0, z1), (x0, y1, z1), (x0, y1, z0), (x0, y0, z0)], (-1, 0, 0)),
            ([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], (0, 0, 1)),
            ([(x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0)], (0, 0, -1)),
        ]
        if bottom:
            faces.append(([(x0, y0, z1), (x1, y0, z1), (x1, y0, z0), (x0, y0, z0)], (0, -1, 0)))
        for pts, out in faces:
            self.face(pts, out, region, tile=tile, lit=lit)
        if collide:
            self.solid_box(x, y0, z, w, h, d)

    def cylinder_y(self, x, y0, h, z, r, region, sections=10, tile=1.2, collide=False):
        if not self.detail:
            sections = max(5, sections // 2)
        y1 = y0 + h
        r0 = [(x + r * math.cos(2 * math.pi * i / sections), y0, z + r * math.sin(2 * math.pi * i / sections)) for i in range(sections)]
        r1 = [(x + r * math.cos(2 * math.pi * i / sections), y1, z + r * math.sin(2 * math.pi * i / sections)) for i in range(sections)]
        for i in range(sections):
            j = (i + 1) % sections
            out = ((r0[i][0] + r0[j][0]) / 2 - x, 0, (r0[i][2] + r0[j][2]) / 2 - z)
            self.face([r0[i], r0[j], r1[j], r1[i]], out, region, tile=tile)
        self.face(r1, (0, 1, 0), region, tile=tile)
        if collide:
            self.solid_box(x, y0, z, r * 1.85, h, r * 1.85)

    def tube(self, a, b, r, region, sections=4):
        a, b = np.asarray(a, np.float64), np.asarray(b, np.float64)
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

    def prism(self, poly_xz, y0, h, region, cap_region=None, tile=2.4, collide=False):
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
        for t in tris:
            quad_tri = [(pts[i, 0], y1, pts[i, 1]) for i in t]
            self.face(quad_tri, (0, 1, 0), cap_region or region, tile=tile)
            if collide and self.collide:
                self.hit.add_quad_or_poly([self._xf(p) for p in quad_tri], (0, 1, 0), 'granite', tile=None)
        if h > 0.02:
            for i in range(len(pts)):
                j = (i + 1) % len(pts)
                a, b = pts[i], pts[j]
                out = (b[1] - a[1], 0, -(b[0] - a[0]))
                # Ensure outward points away from polygon interior
                quad = [(a[0], y0, a[1]), (b[0], y0, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1])]
                # Check midpoint + out vs polygon orientation
                self.face(quad, (a[1] - b[1], 0, b[0] - a[0]) if area2 > 0 else out, region, tile=tile)
                if collide and self.collide and h >= 0.4:
                    seg_len = math.hypot(b[0] - a[0], b[1] - a[1])
                    steps = max(1, math.ceil(seg_len / 2.5))
                    for s in range(steps):
                        t0, t1 = s / steps, (s + 1) / steps
                        xa, za = a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0
                        xb, zb = a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1
                        nrm = (a[1] - b[1], 0, b[0] - a[0]) if area2 > 0 else out
                        self.hit.add_quad_or_poly(
                            [self._xf((xa, y0, za)), self._xf((xb, y0, zb)), self._xf((xb, y1, zb)), self._xf((xa, y1, za))],
                            self._xf_dir(nrm), 'granite', tile=None)

    def sign_board(self, x, yc, z, w, h, sign_key, backing='dark_stone', depth=0.10, double_sided=False):
        if backing and depth > 0:
            self.box(x, yc - h / 2 - 0.04, z - depth / 2, w + 0.12, h + 0.08, depth, backing, tile=None)
        hw, hh = w / 2.0, h / 2.0
        # UV: top of sign image is v=0 in local rect, bottom is v=1 in local rect
        uvs = [(0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)]
        zf = z + 0.02
        self.face([(x - hw, yc - hh, zf), (x + hw, yc - hh, zf), (x + hw, yc + hh, zf), (x - hw, yc - hh + h, zf)],
                  (0, 0, 1), sign_key, tile=None, uvs=uvs)
        if double_sided:
            zb = z - depth - 0.02
            self.face([(x + hw, yc - hh, zb), (x - hw, yc - hh, zb), (x - hw, yc + hh, zb), (x + hw, yc + hh, zb)],
                      (0, 0, -1), sign_key, tile=None, uvs=uvs)

    def pitched_roof(self, x, y0, z, w, d, rise, overhang=0.65, tile_region='gray_tile', fascia_region='white'):
        hw, hd = w / 2.0 + overhang, d / 2.0 + overhang
        self.box(x, y0 - 0.22, z, hw * 2, 0.24, hd * 2, fascia_region, tile=2.0, bottom=True)
        ridge_half = max(0.4, hw - hd * 0.72)
        y1 = y0 + rise
        s_l, s_r = (x - hw, y0, z + hd), (x + hw, y0, z + hd)
        n_r, n_l = (x + hw, y0, z - hd), (x - hw, y0, z - hd)
        r_l, r_r = (x - ridge_half, y1, z), (x + ridge_half, y1, z)
        self.face([s_l, s_r, r_r, r_l], (0, rise, hd), tile_region, tile=1.4)
        self.face([n_r, n_l, r_l, r_r], (0, rise, -hd), tile_region, tile=1.4)
        self.face([s_r, n_r, r_r], (hd, rise, 0), tile_region, tile=1.4)
        self.face([n_l, s_l, r_l], (-hd, rise, 0), tile_region, tile=1.4)
        if self.detail and ridge_half > 0.5:
            self.box(x, y1 - 0.08, z, ridge_half * 2, 0.24, 0.34, tile_region, tile=1.0)

    def teaching_block(
        self, cx, cz, yaw, width, depth, floors, floor_h=3.45,
        wall='white', accent='terracotta', plinth='dark_stone', roof_kind='pitched',
        roof_tile='gray_tile', corridor=True, portico=True, sign_key=None, y0=0.0,
    ):
        prev = self.pose
        self.pose = (cx, y0, cz, yaw)
        total_h = floors * floor_h
        # Plinth + main mass
        self.box(0, 0.0, 0, width + 0.3, 0.55, depth + 0.3, plinth, tile=2.0)
        self.box(0, 0.55, 0, width, total_h - 0.55, depth, wall, tile=2.4, collide=True)
        if self.collide:
            self.solid_box(0, 0.0, 0, width, total_h, depth)

        # Accent stair/end bays
        bay_w = min(5.2, width * 0.14)
        for sx in (-1, 1):
            bx = sx * (width / 2 - bay_w / 2 + 0.08)
            self.box(bx, 0.55, 0, bay_w, total_h + 0.35, depth + 0.36, accent, tile=2.0)

        # Front exterior corridor (+Z) + rear window bands (-Z)
        corr_d = 1.85 if corridor else 0.0
        if corridor:
            for fl in range(floors):
                slab_y = fl * floor_h + (0.12 if fl == 0 else 0.0)
                if fl > 0:
                    self.box(0, slab_y, depth / 2 + corr_d / 2, width - bay_w * 1.6, 0.24, corr_d, 'white', tile=2.0)
                    # Parapet railing along exterior corridor
                    self.box(0, slab_y + 0.24, depth / 2 + corr_d - 0.12, width - bay_w * 1.6, 0.92, 0.18,
                             accent if fl == 1 else 'white', tile=2.0)
                    if self.detail:
                        self.box(0, slab_y + 1.16, depth / 2 + corr_d - 0.12, width - bay_w * 1.6, 0.09, 0.24, plinth, tile=1.5)
            # Top eave slab over top-floor corridor
            self.box(0, total_h - 0.18, depth / 2 + corr_d / 2, width - bay_w * 1.4, 0.28, corr_d + 0.2, 'white', tile=2.0)
            if self.detail:
                span = width - bay_w * 2.0
                n_cols = max(3, int(span / 4.8) + 1)
                for i in range(n_cols):
                    px = -span / 2 + span * i / max(1, n_cols - 1)
                    self.box(px, 0.1, depth / 2 + corr_d - 0.16, 0.34, total_h - 0.1, 0.34, 'white', tile=1.6)

        # Horizontal window bands (lit glass for night glow)
        win_span = max(4.0, width - bay_w * 2.2)
        for fl in range(floors):
            wy = fl * floor_h + 1.15
            for side in (-1, 1):
                wz = side * (depth / 2 + 0.05)
                self.box(0, wy, wz, win_span, 1.55, 0.08, 'glass', tile=2.2, lit=True)
                if self.detail and not (corridor and side == 1):
                    # Window sill + sunshade眉板
                    self.box(0, wy + 1.56, side * (depth / 2 + 0.16), win_span + 0.2, 0.14, 0.28, 'white', tile=1.8)
                    for mx in np.arange(-win_span / 2 + 3.2, win_span / 2 - 1.0, 3.2):
                        self.box(float(mx), wy - 0.1, side * (depth / 2 + 0.09), 0.24, 1.75, 0.12, wall, tile=1.4)

        # Central entrance portico + steps
        if portico:
            pw = min(9.2, width * 0.24)
            pz = depth / 2 + corr_d
            self.box(0, 0.0, pz + 1.1, pw + 1.2, 0.38, 2.4, 'granite', tile=1.8)
            self.box(0, 3.85, pz + 0.9, pw, 0.42, 2.2, accent, tile=1.8)
            for sx in (-pw / 2 + 0.35, pw / 2 - 0.35):
                self.box(sx, 0.38, pz + 1.65, 0.48, 3.5, 0.48, 'granite', tile=1.5)
            # Crown pediment at roofline
            self.box(0, total_h, depth / 2 + corr_d * 0.4, pw + 1.4, 1.35, 1.6, accent, tile=1.8)
            if sign_key:
                self.sign_board(0, total_h + 0.68, depth / 2 + corr_d * 0.4 + 0.82, min(pw, 5.2), 1.05, sign_key, backing=None, depth=0)
        elif sign_key:
            self.sign_board(0, total_h - 0.7, depth / 2 + corr_d + 0.1, 4.8, 1.0, sign_key)

        # Roof
        if roof_kind == 'pitched':
            self.pitched_roof(0, total_h + 0.1, corr_d * 0.4, width + 0.2, depth + corr_d * 0.8, 2.35, 0.65, roof_tile, 'white')
        else:
            self.box(0, total_h, corr_d * 0.4, width + 0.5, 0.65, depth + corr_d * 0.8 + 0.4, accent, tile=2.0)
            self.box(0, total_h + 0.65, corr_d * 0.4, width + 0.7, 0.18, depth + corr_d * 0.8 + 0.6, plinth, tile=1.8)

        self.pose = prev

    def retractable_gate(self, x0, x1, z, h=1.36, y0=0.04):
        """Closed-state stainless steel retractable gate (伸缩门关闭状态) with collision."""
        span = abs(x1 - x0)
        if span < 0.6:
            return
        xc = (x0 + x1) / 2.0
        # End motor head box
        head_x = x1 - 0.28 if x1 > x0 else x1 + 0.28
        self.box(head_x, y0, z, 0.52, h + 0.14, 0.44, 'dark_stone', tile=1.0)
        self.box(head_x, y0 + h * 0.65, z, 0.54, 0.24, 0.46, 'vermilion', tile=0.8)
        # Top & bottom horizontal rails
        self.box(xc, y0 + 0.12, z, span, 0.08, 0.18, 'steel', tile=1.0)
        self.box(xc, y0 + h - 0.08, z, span, 0.09, 0.20, 'steel', tile=1.0)
        n_seg = max(4, int(span / 0.72)) if self.detail else max(3, int(span / 1.5))
        step = span / n_seg
        start = min(x0, x1)
        for i in range(n_seg):
            xa, xb = start + i * step, start + (i + 1) * step
            self.box(xa, y0 + 0.04, z, 0.06, h, 0.22, 'steel', tile=0.8)
            if self.detail:
                self.tube((xa, y0 + 0.16, z), (xb, y0 + h - 0.10, z), 0.032, 'steel', 4)
                self.tube((xa, y0 + h - 0.10, z), (xb, y0 + 0.16, z), 0.032, 'steel', 4)
        self.solid_box(xc, y0, z, span, h + 0.1, 0.35)

    def school_gate(
        self, cx, cz, yaw, sign_key, total_w=16.0, veh_span=6.6, ped_open_w=2.4,
        pillar_h=5.2, beam_h=1.18, style='classic', pillar_mat='granite',
        accent_mat='terracotta', roof_tile='gray_tile', closed_retractable=True, y0=0.0,
    ):
        """Street-facing school gate: pillars + inscribed lintel/arch + closed retractable gate
        + an open pedestrian bay (no turnstile, no guardhouse, no security booth)."""
        prev = self.pose
        self.pose = (cx, y0, cz, yaw)
        # Layout along local X:
        # [-total_w/2 .. pL] wing wall, pL = -veh_span/2 - 0.65 (left main pillar),
        # [pL+0.65 .. pM-0.55] vehicle span with closed retractable gate (when closed_retractable),
        # pM = +veh_span/2 + 0.55 (middle main pillar),
        # [pM+0.55 .. pR-0.45] open pedestrian walkway bay (ped_open_w ~ 2.4m, completely open!),
        # pR = pM + 0.55 + ped_open_w + 0.45 (right sub-pillar).
        pL = -veh_span / 2.0 - 0.65
        pM = veh_span / 2.0 + 0.65
        pR = pM + 0.55 + ped_open_w + 0.45

        # Threshold stone apron
        self.box((pL + pR) / 2, 0.0, 0.0, (pR - pL) + 3.2, 0.05, 4.4, 'pave', tile=1.8)

        # Main pillars pL & pM + right pedestrian pillar pR
        for px, pw, ph in ((pL, 1.30, pillar_h), (pM, 1.30, pillar_h), (pR, 0.92, pillar_h * 0.84)):
            self.box(px, 0.0, 0.0, pw + 0.24, 0.55, 1.56, 'dark_stone', tile=1.4)
            self.box(px, 0.55, 0.0, pw, ph - 0.55, 1.34, pillar_mat, tile=1.6, collide=True)
            self.box(px, ph, 0.0, pw + 0.30, 0.26, 1.62, accent_mat, tile=1.2)
            if self.collide:
                self.solid_box(px, 0.0, 0.0, pw + 0.1, ph, 1.4)

        # Lintel beam across main span + pedestrian lintel
        beam_w = (pM - pL) + 2.2
        beam_xc = (pL + pM) / 2.0
        if style in ('classic', 'glazed', 'arch'):
            self.box(beam_xc, pillar_h + 0.12, 0.0, beam_w, beam_h, 1.46, 'white', tile=2.0)
            self.sign_board(beam_xc, pillar_h + 0.12 + beam_h / 2, 0.76, beam_w - 1.2, beam_h * 0.84,
                            sign_key, backing=None, depth=0, double_sided=True)
            self.pitched_roof(beam_xc, pillar_h + 0.12 + beam_h, 0.0, beam_w + 0.6, 1.8, 1.35, 0.55, roof_tile, accent_mat)
            # Secondary lintel over pedestrian bay
            ped_xc = (pM + pR) / 2.0
            ped_top = pillar_h * 0.84
            self.box(ped_xc, ped_top - 0.55, 0.0, (pR - pM) + 0.6, 0.58, 1.15, accent_mat, tile=1.6)
            if style == 'glazed':
                self.pitched_roof(ped_xc, ped_top + 0.04, 0.0, (pR - pM) + 0.9, 1.35, 0.78, 0.38, roof_tile, 'white')
        else:
            # Modern horizontal portal / screen wall style (e.g. modern primary/university)
            full_w = (pR - pL) + 2.0
            full_xc = (pL + pR) / 2.0
            self.box(full_xc, pillar_h * 0.82, 0.0, full_w, beam_h, 1.48, accent_mat, tile=2.0)
            self.sign_board(beam_xc, pillar_h * 0.82 + beam_h / 2, 0.78, beam_w - 0.8, beam_h * 0.84,
                            sign_key, backing=None, depth=0, double_sided=True)

        # Closed retractable gate across vehicle opening (leaving pedestrian bay [pM..pR] open!)
        if closed_retractable:
            self.retractable_gate(pL + 0.68, pM - 0.68, 0.0, h=1.36)

        # Short flanking screen walls out to +-total_w/2 if wider
        left_end = -total_w / 2.0
        if pL - 0.75 > left_end + 0.5:
            lw = (pL - 0.75) - left_end
            self.box(left_end + lw / 2, 0.0, 0.0, lw, 2.35, 0.42, 'white', tile=1.8, collide=True)
            self.box(left_end + lw / 2, 2.35, 0.0, lw + 0.1, 0.18, 0.54, accent_mat, tile=1.4)

        self.pose = prev

    def perimeter_wall(self, chain_xz, gap_segments=(), h=2.25, wall_mat='white', base_mat='granite', cap_mat='gray_tile'):
        """Campus perimeter fence wall along a list of (x, z) points, skipping indices in gap_segments."""
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
            # Base plinth + upper grille/wall + coping
            self.box(0, 0.0, 0, ln, 0.72, 0.34, base_mat, tile=1.8, collide=True)
            if self.detail:
                # Open wrought-iron fence bays between masonry piers
                n_bays = max(1, int(ln / 4.2))
                step = ln / n_bays
                for bi in range(n_bays + 1):
                    px = -ln / 2 + bi * step
                    self.box(px, 0.72, 0, 0.42, h - 0.72, 0.40, wall_mat, tile=1.5)
                    self.box(px, h, 0, 0.52, 0.14, 0.50, cap_mat, tile=1.0)
                # Top & mid iron rails + vertical pickets every 0.45m
                self.box(0, h - 0.18, 0, ln, 0.07, 0.08, 'dark_stone', tile=1.0)
                self.box(0, 0.85, 0, ln, 0.06, 0.08, 'dark_stone', tile=1.0)
                for rx in np.arange(-ln / 2 + 0.35, ln / 2 - 0.25, 0.48):
                    self.box(float(rx), 0.74, 0, 0.04, h - 0.90, 0.05, 'dark_stone', tile=0.8)
            else:
                self.box(0, 0.72, 0, ln, h - 0.72, 0.28, wall_mat, tile=2.2)
            if self.collide:
                self.solid_box(0, 0.0, 0, ln, h, 0.38)
            self.pose = prev

    def track_field(self, cx, cz, yaw, straight_len, inner_r, track_w=5.2, stand_side=0, y0=0.05):
        """Red synthetic running track oval + green soccer turf infield + optional spectator stand."""
        prev = self.pose
        self.pose = (cx, y0, cz, yaw)
        outer_r = inner_r + track_w
        half_s = straight_len / 2.0
        steps = 18 if self.detail else 8

        def oval_ring(r):
            pts = []
            # +Z semicircle then -Z semicircle (straight runs along Z!)
            for i in range(steps + 1):
                ang = math.pi * i / steps
                pts.append((r * math.cos(ang), half_s + r * math.sin(ang)))
            for i in range(steps + 1):
                ang = math.pi + math.pi * i / steps
                pts.append((r * math.cos(ang), -half_s + r * math.sin(ang)))
            return pts

        outer = oval_ring(outer_r)
        inner = oval_ring(inner_r)
        # Track ring
        for i in range(len(outer)):
            j = (i + 1) % len(outer)
            self.face([(inner[i][0], 0.02, inner[i][1]), (outer[i][0], 0.02, outer[i][1]),
                       (outer[j][0], 0.02, outer[j][1]), (inner[j][0], 0.02, inner[j][1])],
                      (0, 1, 0), 'track_red', tile=4.0)
        # Green turf infield
        for i in range(1, len(inner) - 1):
            self.face([(0, 0.025, 0), (inner[i][0], 0.025, inner[i][1]), (inner[i + 1][0], 0.025, inner[i + 1][1])],
                      (0, 1, 0), 'turf_green', tile=6.0)
        self.face([(0, 0.025, 0), (inner[-1][0], 0.025, inner[-1][1]), (inner[0][0], 0.025, inner[0][1])],
                  (0, 1, 0), 'turf_green', tile=6.0)

        if self.detail:
            # White lane lines
            for lane in (1, 2, 3):
                lr = inner_r + track_w * lane / 4.0
                la, lb = oval_ring(lr - 0.045), oval_ring(lr + 0.045)
                for i in range(len(la)):
                    j = (i + 1) % len(la)
                    self.face([(la[i][0], 0.04, la[i][1]), (lb[i][0], 0.04, lb[i][1]),
                               (lb[j][0], 0.04, lb[j][1]), (la[j][0], 0.04, la[j][1])],
                              (0, 1, 0), 'line_white', tile=2.0)
            # Soccer field touchlines + halfway line + goals
            fw, fl = inner_r * 1.55, straight_len + inner_r * 0.55
            self.box(0, 0.035, 0, fw, 0.02, 0.12, 'line_white', tile=1.0)
            for sx in (-fw / 2, fw / 2):
                self.box(sx, 0.035, 0, 0.12, 0.02, fl, 'line_white', tile=1.0)
            for sz in (-fl / 2, fl / 2):
                self.box(0, 0.035, sz, fw, 0.02, 0.12, 'line_white', tile=1.0)
                # Soccer goalposts
                gw, gh = min(5.4, fw * 0.32), 2.15
                self.box(-gw / 2, 0.03, sz, 0.10, gh, 0.10, 'line_white', tile=0.8)
                self.box(gw / 2, 0.03, sz, 0.10, gh, 0.10, 'line_white', tile=0.8)
                self.box(0, gh, sz, gw + 0.10, 0.10, 0.10, 'line_white', tile=0.8)

        # Optional spectator stand / rostrum along straight
        if stand_side in (-1, 1) and straight_len >= 18:
            sx = stand_side * (outer_r + 2.8)
            sw = min(28.0, straight_len * 0.72)
            for step in range(4):
                self.box(sx + stand_side * step * 0.85, 0.0, 0, 0.9, 0.45 * (step + 1), sw, 'granite', tile=2.0, collide=(step == 3))
            # Canopy over center rostrum
            self.box(sx + stand_side * 1.6, 1.8, 0, 3.8, 2.8, min(12.0, sw * 0.5), 'white', tile=2.0)
            self.box(sx + stand_side * 1.2, 4.5, 0, 5.2, 0.28, min(13.2, sw * 0.55), 'terracotta', tile=2.0)

        self.pose = prev

    def basketball_court(self, cx, cz, yaw, surface='court_green', apron='track_red', y0=0.05):
        prev = self.pose
        self.pose = (cx, y0, cz, yaw)
        self.box(0, 0.0, 0, 17.6, 0.04, 30.6, apron, tile=3.0)
        self.box(0, 0.045, 0, 15.0, 0.02, 28.0, surface, tile=3.0)
        if self.detail:
            self.box(0, 0.07, 0, 15.0, 0.015, 0.10, 'line_white', tile=1.0)
            for sx in (-7.45, 7.45):
                self.box(sx, 0.07, 0, 0.10, 0.015, 28.0, 'line_white', tile=1.0)
            for sz in (-13.95, 13.95):
                self.box(0, 0.07, sz, 15.0, 0.015, 0.10, 'line_white', tile=1.0)
                # Key box + hoop stanchion
                sdir = 1 if sz > 0 else -1
                self.box(0, 0.068, sz - sdir * 2.9, 4.9, 0.015, 5.8, apron, tile=2.0)
                hz = sz + sdir * 0.9
                self.box(0, 0.04, hz, 0.22, 3.15, 0.22, 'blue_facade', tile=0.8)
                self.box(0, 3.05, hz - sdir * 0.55, 0.16, 0.16, 1.1, 'blue_facade', tile=0.8)
                self.box(0, 2.65, hz - sdir * 1.1, 1.8, 1.05, 0.06, 'line_white', tile=1.0)
                self.box(0, 2.85, hz - sdir * 1.28, 0.46, 0.05, 0.46, 'vermilion', tile=0.5)
        self.pose = prev

    def flagpole_plinth(self, cx, cz, yaw, poles=1, height=11.5, y0=0.0):
        prev = self.pose
        self.pose = (cx, y0, cz, yaw)
        w = 4.6 if poles == 1 else 7.2
        self.box(0, 0.0, 0, w, 0.28, 3.6, 'granite', tile=1.6, collide=True)
        self.box(0, 0.28, 0, w - 0.9, 0.30, 2.7, 'dark_stone', tile=1.4, collide=True)
        if self.detail:
            self.box(0, 0.58, -1.1, w - 1.2, 0.75, 0.16, 'white', tile=1.2)
        offsets = [0.0] if poles == 1 else [-1.6, 0.0, 1.6]
        for idx, ox in enumerate(offsets):
            ph = height if ox == 0 else height * 0.86
            self.cylinder_y(ox, 0.58, ph, 0.0, 0.09, 'steel', sections=6)
            if ox == 0:
                self.box(ox + 0.95, 0.58 + ph - 1.45, 0.0, 1.85, 1.22, 0.04, 'vermilion', tile=None)
            elif self.detail:
                self.box(ox + 0.78, 0.58 + ph - 1.35, 0.0, 1.50, 0.98, 0.04, 'court_blue', tile=None)
        self.pose = prev

    def motto_stone(self, cx, cz, yaw, sign_key, w=4.4, h=1.85, y0=0.0):
        """Landscape stone boulder / cultural stele with circular flowerbed."""
        prev = self.pose
        self.pose = (cx, y0, cz, yaw)
        self.cylinder_y(0, 0.0, 0.28, 0, w * 0.72, 'granite', sections=14)
        self.cylinder_y(0, 0.28, 0.16, 0, w * 0.64, 'foliage', sections=14)
        self.box(0, 0.32, 0, w + 0.4, 0.32, 1.35, 'dark_stone', tile=1.4, collide=True)
        # Sculpted boulder mass
        self.box(0, 0.64, 0, w, h, 0.78, 'granite', tile=1.8, collide=True)
        if self.detail:
            self.box(-w * 0.28, 0.64 + h, 0, w * 0.42, 0.26, 0.64, 'granite', tile=1.4)
        self.sign_board(0, 0.64 + h * 0.52, 0.41, w * 0.84, h * 0.66, sign_key, backing=None, depth=0, double_sided=True)
        self.pose = prev

    def campus_tree(self, x, z, h=8.2, spread=3.4, seed=1, kind='camphor', y0=0.0):
        tx, ty, tz = self._xf((x, y0, z))
        prev = self.pose
        self.pose = (tx, ty, tz, 0.0)
        if kind == 'palm':
            self.cylinder_y(0, 0, h * 0.76, 0, 0.20, 'bark', sections=6)
            fronds = 8 if self.detail else 4
            top = h * 0.76
            for i in range(fronds):
                a = 2 * math.pi * i / fronds + (seed % 5) * 0.15
                dx, dz = math.cos(a), math.sin(a)
                px, pz = -dz * 0.42, dx * 0.42
                self.face([(0, top + 0.15, 0),
                           (dx * spread * 0.52 + px, top + 0.75, dz * spread * 0.52 + pz),
                           (dx * spread, top - 0.55, dz * spread),
                           (dx * spread * 0.52 - px, top + 0.75, dz * spread * 0.52 - pz)],
                          (0, 1, 0), 'foliage', tile=2.0)
            self.pose = prev
            return

        trunk_h = h * 0.40
        self.cylinder_y(0, 0, trunk_h, 0, 0.22 * (1.35 if kind == 'banyan' else 1.0), 'bark', sections=6)
        if not self.detail:
            self.cylinder_y(0, trunk_h - 0.2, h * 0.52, 0, spread * 0.82, 'foliage', sections=6)
            self.pose = prev
            return
        blobs = [(0.0, trunk_h + h * 0.25, 0.0, spread * 0.85, h * 0.34)]
        if kind == 'banyan':
            blobs.extend([
                (-spread * 0.48, trunk_h + h * 0.18, spread * 0.24, spread * 0.68, h * 0.26),
                (spread * 0.46, trunk_h + h * 0.18, -spread * 0.24, spread * 0.66, h * 0.26),
            ])
        else:
            blobs.extend([
                (-spread * 0.34, trunk_h + h * 0.16, spread * 0.22, spread * 0.56, h * 0.25),
                (spread * 0.32, trunk_h + h * 0.18, -spread * 0.22, spread * 0.54, h * 0.25),
            ])
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


def export_school(path, image, build_fn):
    hi = Builder(lod=0, collide=True)
    lo = Builder(lod=1, collide=False)
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

    m_hit = _to_trimesh(hi.hit, image, 'g3_collision', (0, 0, 0), 0.0, 1.0)
    if m_hit is not None:
        scene.add_geometry(m_hit, node_name='collision_body')

    scene.export(path)
    n0 = len(hi.atlas) + len(hi.lit)
    n1 = len(lo.atlas) + len(lo.lit)
    print(f"{Path(path).stem}: lod0={n0} tris, lod1={n1} tris, collision={len(hi.hit)} tris")
    return n0, n1
