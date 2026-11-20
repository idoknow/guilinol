"""Shared procedural campus builder with glTF instancing, 3-LODs, IDOK-71 trees, and GL04 terrain grounding.

Used for IDOK-83 campus interior restoration:
- Samples final terrain surface (`LandmarkSurface.ground(x, z)`) for every building skirt,
  campus slab, boundary wall, gate, road, court, and tree.
- Emits shared glTF template meshes referenced by named transform nodes for repeated
  components (window modules, roof railings, fence bays, basketball hoops, IDOK-71 trees),
  which `web/src/landmarks.ts` (`batchRepeatedMeshes`) merges into `THREE.InstancedMesh`.
- Generates compact 512x512 per-school procedural atlas (no web photos, no building use/name signs).
- Supports lod0 (0-350m), lod1 (350-650m), and lod2 (650-900m).
"""
from __future__ import annotations

import json
import math
import struct
import sys
from pathlib import Path

import mapbox_earcut
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import Polygon

if __package__:
    from .c_kit import landmark_surface
else:
    from c_kit import landmark_surface

ATLAS_SIZE = 512

# 64x48 swatch grid in y=0..240 (40 swatches), signage in y=240..512
SWATCH_DEFS = [
    # Row 0 (y=0..48)
    ('wall_main',        'tiles', (236, 231, 221)),
    ('wall_sub',         'tiles', (125, 176, 208)),
    ('wall_accent',      'tiles', (207, 113, 100)),
    ('wall_base',        'brick', (158, 91, 73)),
    ('pave_grey',        'paver', (198, 194, 185)),
    ('pave_road',        'noise', (156, 155, 150)),
    ('pave_dark',        'brick', (86, 74, 68)),
    ('granite',          'paver', (172, 170, 162)),
    # Row 1 (y=48..96)
    ('roof_tile',        'rib',   (108, 114, 122)),
    ('roof_blue',        'rib',   (104, 152, 192)),
    ('roof_red',         'rib',   (166, 76, 62)),
    ('track_red',        'noise', (184, 78, 67)),
    ('turf_a',           'noise', (84, 142, 74)),
    ('turf_b',           'noise', (68, 122, 60)),
    ('court_a',          'noise', (66, 138, 104)),
    ('court_b',          'noise', (68, 114, 152)),
    # Row 2 (y=96..144)
    ('white',            'flat',  (242, 240, 234)),
    ('steel',            'stripe',(194, 200, 206)),
    ('glass',            'glass', (58, 92, 114)),
    ('win_frame',        'flat',  (198, 110, 88)),
    ('bark',             'bark',  (96, 78, 60)),
    ('foliage_camphor',  'leaf',  (58, 106, 52)),
    ('foliage_banyan',   'leaf',  (68, 120, 56)),
    ('foliage_osmanthus','leaf',  (46, 92, 46)),
    # Row 3 (y=144..192)
    ('foliage_palm',     'leaf',  (76, 128, 58)),
    ('foliage_ginkgo',   'leaf',  (178, 186, 58)),
    ('foliage_bischofia','leaf',  (74, 116, 54)),
    ('foliage_shrub',    'leaf',  (64, 108, 52)),
    ('cinnabar',         'noise', (196, 54, 44)),
    ('yellow',           'noise', (229, 206, 56)),
    ('lime',             'noise', (120, 190, 60)),
    ('gold',             'noise', (222, 178, 72)),
    # Row 4 (y=192..240)
    ('black_led',        'flat',  (34, 38, 42)),
    ('lawn',             'leaf',  (98, 138, 84)),
    ('ochre',            'tiles', (208, 168, 108)),
    ('dark_stone',       'brick', (72, 76, 80)),
    ('cream',            'tiles', (228, 220, 202)),
    ('mint',             'tiles', (168, 214, 212)),
    ('blue_wall',        'tiles', (76, 122, 162)),
    ('wood',             'bark',  (124, 82, 56)),
]

RECTS = {}
for _i, (_name, _style, _col) in enumerate(SWATCH_DEFS):
    RECTS[_name] = ((_i % 8) * 64, (_i // 8) * 48, 64, 48)

RECTS['win_wall']    = (0,   240, 128, 128)
RECTS['win_base']    = (128, 240, 128, 128)
RECTS['sign_gate']   = (256, 240, 256, 72)
RECTS['sign_motto']  = (256, 312, 256, 64)
RECTS['sign_led']    = (0,   368, 256, 72)
RECTS['sign_vert']   = (448, 376, 64,  136)
RECTS['sign_emblem'] = (256, 376, 192, 136)
RECTS['sign_extra']  = (0,   440, 256, 72)


def _rgb(hex_or_rgb) -> tuple[int, int, int]:
    if isinstance(hex_or_rgb, (tuple, list)):
        return tuple(int(c) for c in hex_or_rgb[:3])
    h = str(hex_or_rgb).lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _mix(c1, c2, t: float) -> tuple[int, int, int]:
    return tuple(int(round(c1[i] * (1.0 - t) + c2[i] * t)) for i in range(3))


def _font(size: int, bold: bool = False, sans: bool = False):
    noto = '/usr/share/fonts/opentype/noto'
    candidates = []
    if sans:
        candidates.extend([
            (f'{noto}/NotoSansCJK-Bold.ttc', 2),
            ('/System/Library/Fonts/STHeiti Medium.ttc', 0),
            ('/System/Library/Fonts/Hiragino Sans GB.ttc', 0),
        ])
    if bold:
        candidates.append(('/System/Library/Fonts/Supplemental/Songti.ttc', 0))
    candidates.extend([
        (f'{noto}/NotoSerifCJK-Bold.ttc', 2),
        (f'{noto}/NotoSansCJK-Bold.ttc', 2),
        ('/System/Library/Fonts/Supplemental/Songti.ttc', 0 if bold else 1),
        ('/System/Library/Fonts/STHeiti Medium.ttc', 0),
        ('/System/Library/Fonts/Hiragino Sans GB.ttc', 0),
    ])
    for path, idx in candidates:
        if not Path(path).exists():
            continue
        for try_idx in (idx, 0):
            try:
                return ImageFont.truetype(path, size, index=try_idx)
            except OSError:
                continue
    raise SystemExit('school_kit: CJK font required for signage')


def _draw_centered(draw: ImageDraw.ImageDraw, rect, text: str, font, fill, stroke_w: int = 0):
    bx, by, bw, bh = rect
    tb = draw.textbbox((0, 0), text, font=font, stroke_width=stroke_w)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    tx = bx + (bw - tw) / 2.0 - tb[0]
    ty = by + (bh - th) / 2.0 - tb[1]
    draw.text((tx, ty), text, font=font, fill=fill, stroke_width=stroke_w, stroke_fill=fill)


def _paint_window_bay(draw: ImageDraw.ImageDraw, rect, wall_rgb, frame_rgb, glass_rgb, trim_rgb, has_ac=False, is_base=False):
    rx, ry, rw, rh = rect
    mortar = _mix(wall_rgb, (36, 40, 44), 0.12)
    draw.rectangle((rx, ry, rx + rw - 1, ry + rh - 1), fill=wall_rgb)
    for yy in range(ry, ry + rh, 12 if is_base else 10):
        draw.line((rx, yy, rx + rw - 1, yy), fill=mortar, width=1)
    for xx in range(rx, rx + rw, 24 if is_base else 20):
        draw.line((xx, ry, xx, ry + rh - 1), fill=mortar, width=1)
    draw.rectangle((rx, ry, rx + rw - 1, ry + 7), fill=trim_rgb)
    draw.line((rx, ry + 8, rx + rw - 1, ry + 8), fill=_mix(wall_rgb, (0, 0, 0), 0.25), width=2)
    pil_c = _mix(wall_rgb, trim_rgb, 0.35)
    draw.rectangle((rx, ry + 8, rx + 6, ry + rh - 1), fill=pil_c)
    draw.rectangle((rx + rw - 7, ry + 8, rx + rw - 1, ry + rh - 1), fill=pil_c)

    wx0 = rx + (16 if has_ac else 12)
    wx1 = rx + rw - (28 if has_ac else 13)
    wy0 = ry + (22 if is_base else 17)
    wy1 = ry + rh - 22
    draw.rectangle((wx0 - 3, wy0 - 3, wx1 + 3, wy1 + 3), fill=frame_rgb, outline=_mix(frame_rgb, (0, 0, 0), 0.35), width=1)
    g_top = _mix(glass_rgb, (190, 220, 238), 0.26)
    g_bot = _mix(glass_rgb, (18, 26, 34), 0.28)
    for yy in range(wy0, wy1 + 1):
        t = (yy - wy0) / max(1, wy1 - wy0)
        draw.line((wx0, yy, wx1, yy), fill=_mix(g_top, g_bot, t))
    draw.polygon([(wx0 + 4, wy0 + 3), (wx0 + 20, wy0 + 3), (wx0 + 8, wy1 - 3), (wx0 + 2, wy1 - 3)],
                 fill=_mix(g_top, (245, 250, 255), 0.28))
    ww, wh = wx1 - wx0, wy1 - wy0
    transom_y = wy0 + int(wh * 0.34)
    draw.rectangle((wx0, transom_y - 1, wx1, transom_y + 2), fill=frame_rgb)
    for k in (1, 2):
        mx = wx0 + int(ww * k / 3.0)
        draw.rectangle((mx - 1, wy0, mx + 2, wy1), fill=frame_rgb)
    grille_c = _mix(frame_rgb, g_top, 0.45)
    for gx in range(wx0 + 6, wx1 - 3, 7):
        draw.line((gx, transom_y + 3, gx, wy1 - 1), fill=grille_c, width=1)
    draw.rectangle((wx0 - 4, wy1 + 3, wx1 + 4, wy1 + 7), fill=_mix(trim_rgb, (255, 255, 255), 0.35))
    if has_ac and not is_base:
        ax0, ay0 = wx1 + 5, wy0 + 16
        ax1, ay1 = rx + rw - 5, wy0 + 42
        if ax1 - ax0 >= 12:
            draw.rectangle((ax0, ay0, ax1, ay1), fill=(236, 238, 240), outline=(145, 152, 158), width=1)
            cx_f, cy_f = (ax0 + ax1) // 2 - 2, (ay0 + ay1) // 2
            rf = min(6, (ax1 - ax0) // 2 - 3)
            draw.ellipse((cx_f - rf, cy_f - rf, cx_f + rf, cy_f + rf), fill=(52, 58, 64))


def build_school_atlas(palette: dict, signs: dict, seed: int = 2026) -> Image.Image:
    rng = np.random.default_rng(seed)
    arr = np.full((ATLAS_SIZE, ATLAS_SIZE, 3), 185, dtype=np.uint8)

    for name, style, default_rgb in SWATCH_DEFS:
        rx, ry, rw, rh = RECTS[name]
        base = np.array(_rgb(palette.get(name, default_rgb)), dtype=np.int16)
        patch = np.broadcast_to(base, (rh, rw, 3)).copy()
        if style == 'tiles':
            for yy in range(0, rh, 10):
                patch[yy:yy + 1, :, :] = np.clip(base - 14, 0, 255)
            for xx in range(0, rw, 20):
                patch[:, xx:xx + 1, :] = np.clip(base - 10, 0, 255)
            patch += rng.integers(-4, 5, (rh, rw, 1), dtype=np.int16)
        elif style in ('brick', 'paver'):
            bh, bw = (12, 24) if style == 'brick' else (16, 16)
            patch[:] = np.clip(base - 18, 0, 255)
            for r_i, yy in enumerate(range(0, rh, bh)):
                off = (bw // 2) if (r_i % 2) else 0
                for xx in range(-off, rw, bw):
                    x0, x1 = max(0, xx + 1), min(rw, xx + bw - 1)
                    y0, y1 = max(0, yy + 1), min(rh, yy + bh - 1)
                    if x1 > x0 and y1 > y0:
                        patch[y0:y1, x0:x1] = np.clip(base + int(rng.integers(-6, 7)), 0, 255)
            patch += rng.integers(-3, 4, (rh, rw, 1), dtype=np.int16)
        elif style == 'rib':
            for xx in range(0, rw, 8):
                patch[:, xx:min(rw, xx + 2), :] -= 16
                patch[:, min(rw - 1, xx + 4):min(rw, xx + 6), :] += 10
            for yy in range(0, rh, 14):
                patch[yy:min(rh, yy + 2), :, :] -= 12
            patch += rng.integers(-4, 5, (rh, rw, 1), dtype=np.int16)
        elif style == 'stripe':
            for yy in range(rh):
                if (yy // 6) % 2 == 0:
                    patch[yy, :, :] += 7
            patch += rng.integers(-4, 5, (rh, rw, 1), dtype=np.int16)
        elif style == 'leaf':
            patch += rng.integers(-14, 15, (rh, rw, 1), dtype=np.int16)
        elif style == 'bark':
            for xx in range(0, rw, 6):
                patch[:, xx:min(rw, xx + 2), :] -= int(rng.integers(8, 16))
            patch += rng.integers(-6, 7, (rh, rw, 1), dtype=np.int16)
        elif style == 'glass':
            top_c = _mix(tuple(base), (185, 218, 240), 0.28)
            bot_c = _mix(tuple(base), (18, 26, 36), 0.28)
            for yy in range(rh):
                patch[yy, :, :] = _mix(top_c, bot_c, yy / max(1, rh - 1))
        elif style == 'noise':
            patch += rng.integers(-6, 7, (rh, rw, 1), dtype=np.int16)
        arr[ry:ry + rh, rx:rx + rw] = np.clip(patch, 0, 255).astype(np.uint8)

    sheet = Image.fromarray(arr)
    draw = ImageDraw.Draw(sheet)

    _paint_window_bay(
        draw, RECTS['win_wall'],
        _rgb(palette.get('wall_main', (236, 231, 221))),
        _rgb(palette.get('win_frame', (198, 110, 88))),
        _rgb(palette.get('glass', (58, 92, 114))),
        _rgb(palette.get('win_trim', (242, 240, 234))),
        has_ac=bool(palette.get('has_ac', False)),
        is_base=False,
    )
    _paint_window_bay(
        draw, RECTS['win_base'],
        _rgb(palette.get('wall_base', (158, 91, 73))),
        _rgb(palette.get('base_frame', (216, 216, 212))),
        _rgb(palette.get('glass', (58, 92, 114))),
        _rgb(palette.get('base_trim', (180, 112, 92))),
        has_ac=False,
        is_base=True,
    )

    # Gate nameplate (school name only; zero internal building names/uses)
    sx, sy, sw, sh = RECTS['sign_gate']
    gate_bg = _rgb(signs.get('gate_bg', '#eee9df'))
    gate_fg = _rgb(signs.get('gate_fg', '#9e2620'))
    draw.rectangle((sx, sy, sx + sw - 1, sy + sh - 1), fill=gate_bg)
    if signs.get('gate_outline', False):
        draw.rectangle((sx + 2, sy + 2, sx + sw - 3, sy + sh - 3), outline=_rgb(signs.get('gate_border', '#bfa065')), width=2)
    title = signs.get('school_name', '桂林市学校')
    sub = signs.get('school_en', '')
    tsz = 28 if len(title) <= 6 else (23 if len(title) <= 9 else 18)
    if sub:
        _draw_centered(draw, (sx + 6, sy + 4, sw - 12, 40), title, _font(tsz, bold=True), gate_fg)
        _draw_centered(draw, (sx + 6, sy + 44, sw - 12, 22), sub, _font(11, sans=True), _rgb(signs.get('gate_sub_fg', gate_fg)))
    else:
        _draw_centered(draw, (sx + 6, sy + 6, sw - 12, sh - 12), title, _font(tsz + 3, bold=True), gate_fg)

    # Vertical gate pillar sign
    vx, vy, vw, vh = RECTS['sign_vert']
    vbg = _rgb(signs.get('vert_bg', '#36322f'))
    vfg = _rgb(signs.get('vert_fg', '#e5c16c'))
    draw.rectangle((vx, vy, vx + vw - 1, vy + vh - 1), fill=vbg)
    draw.rectangle((vx + 2, vy + 2, vx + vw - 3, vy + vh - 3), outline=vfg, width=2)
    vtxt = signs.get('vert_text', title)
    ch_h = (vh - 14) / max(1, len(vtxt))
    fv = _font(max(11, min(19, int(ch_h * 0.82))), bold=True)
    for ci, ch in enumerate(vtxt):
        _draw_centered(draw, (vx + 3, int(vy + 7 + ci * ch_h), vw - 6, int(ch_h)), ch, fv, vfg)

    # Motto / frieze sign
    mx, my, mw, mh = RECTS['sign_motto']
    mbg = _rgb(signs.get('motto_bg', '#eee9df'))
    mfg = _rgb(signs.get('motto_fg', '#9e2620'))
    draw.rectangle((mx, my, mx + mw - 1, my + mh - 1), fill=mbg)
    if signs.get('motto_border', True):
        draw.rectangle((mx + 2, my + 2, mx + mw - 3, my + mh - 3), outline=_mix(mbg, mfg, 0.45), width=2)
    mtxt = signs.get('motto', '')
    if mtxt:
        msz = 22 if len(mtxt) <= 8 else (18 if len(mtxt) <= 12 else 14)
        _draw_centered(draw, (mx + 6, my + 4, mw - 12, mh - 8), mtxt, _font(msz, bold=True), mfg)

    # LED banner
    lx, ly, lw, lh = RECTS['sign_led']
    draw.rectangle((lx, ly, lx + lw - 1, ly + lh - 1), fill=(26, 24, 26))
    draw.rectangle((lx + 3, ly + 3, lx + lw - 4, ly + lh - 4), outline=(90, 40, 38), width=2)
    _draw_centered(draw, (lx + 6, ly + 8, lw - 12, lh - 16), signs.get('led_title', f'{title}欢迎您'),
                   _font(17, bold=True, sans=True), (232, 62, 52))

    # Emblem / custom stone-frieze region
    ex, ey, ew, eh = RECTS['sign_emblem']
    draw.rectangle((ex, ey, ex + ew - 1, ey + eh - 1), fill=gate_bg)
    cx_e, cy_e = ex + ew // 2, ey + eh // 2
    draw.ellipse((cx_e - 36, cy_e - 36, cx_e + 36, cy_e + 36), fill=_rgb('#2b628c'), outline=_rgb('#dfb249'), width=3)
    _draw_centered(draw, (cx_e - 28, cy_e - 20, 56, 40), signs.get('emblem', title[:2]), _font(18, bold=True, sans=True), (248, 244, 234))

    return sheet


# ---------------- Geometry & Instancing Helpers ----------------

_PHI = (1.0 + math.sqrt(5.0)) / 2.0
_ICO_RAW = [
    (-1, _PHI, 0), (1, _PHI, 0), (-1, -_PHI, 0), (1, -_PHI, 0),
    (0, -1, _PHI), (0, 1, _PHI), (0, -1, -_PHI), (0, 1, -_PHI),
    (_PHI, 0, -1), (_PHI, 0, 1), (-_PHI, 0, -1), (-_PHI, 0, 1),
]
_ICO_V0 = [tuple(c / math.hypot(*v) for c in v) for v in _ICO_RAW]
_ICO_F0 = [
    (0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11),
    (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
    (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9),
    (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1),
]


def _subdiv_ico():
    v_out = list(_ICO_V0)
    cache = {}
    def mid(i, j):
        k = (i, j) if i < j else (j, i)
        if k in cache:
            return cache[k]
        ax, ay, az = v_out[i]
        bx, by, bz = v_out[j]
        mx, my, mz = (ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5
        ln = math.hypot(mx, my, mz)
        idx = len(v_out)
        v_out.append((mx / ln, my / ln, mz / ln))
        cache[k] = idx
        return idx
    f_out = []
    for a, b, c in _ICO_F0:
        ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
        f_out.extend([(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)])
    return v_out, f_out


_ICO_V1, _ICO_F1 = _subdiv_ico()


def mrr_stats(ring_xz: list[tuple[float, float]]):
    poly = Polygon(ring_xz)
    cx, cz = poly.centroid.x, poly.centroid.y
    rect = poly.minimum_rotated_rectangle
    coords = list(rect.exterior.coords)[:4]
    e0 = math.hypot(coords[1][0] - coords[0][0], coords[1][1] - coords[0][1])
    e1 = math.hypot(coords[2][0] - coords[1][0], coords[2][1] - coords[1][1])
    if e0 >= e1:
        dx, dz = coords[1][0] - coords[0][0], coords[1][1] - coords[0][1]
        w, d = e0, e1
    else:
        dx, dz = coords[2][0] - coords[1][0], coords[2][1] - coords[1][1]
        w, d = e1, e0
    ang = math.degrees(math.atan2(-dz, dx)) % 180.0
    return cx, cz, w, d, ang


class MeshPart:
    def __init__(self):
        self.v: list[tuple[float, float, float]] = []
        self.uv: list[tuple[float, float]] = []
        self.f: list[tuple[int, int, int]] = []

    def tri_count(self) -> int:
        return len(self.f)

    def _rect_uv_bounds(self, region: str, pad_px: float = 2.0):
        rx, ry, rw, rh = RECTS[region]
        return (
            (rx + pad_px) / ATLAS_SIZE,
            (ry + pad_px) / ATLAS_SIZE,
            (rx + rw - pad_px) / ATLAS_SIZE,
            (ry + rh - pad_px) / ATLAS_SIZE,
        )

    def add_quad(self, wpts, region: str, full_rect: bool = True, lit: bool = False, double_sided: bool = False):
        base = len(self.v)
        self.v.extend(wpts)
        if lit:
            self.uv.extend([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)])
        elif full_rect:
            u0, v0, u1, v1 = self._rect_uv_bounds(region, pad_px=1.5)
            # Raw glTF uses top-left v=0 (matching PIL y=0) with GLTFLoader flipY=false
            self.uv.extend([(u0, v1), (u1, v1), (u1, v0), (u0, v0)])
        else:
            u0, v0, u1, v1 = self._rect_uv_bounds(region, pad_px=3.0)
            du, dv = u1 - u0, v1 - v0
            wlen = math.dist(wpts[0], wpts[1])
            hlen = math.dist(wpts[0], wpts[3])
            ru = min(0.95, max(0.15, (wlen / 3.4) % 0.92 or 0.85))
            rv = min(0.95, max(0.15, (hlen / 3.4) % 0.92 or 0.85))
            self.uv.extend([
                (u0, v0 + rv * dv),
                (u0 + ru * du, v0 + rv * dv),
                (u0 + ru * du, v0),
                (u0, v0),
            ])
        self.f.append((base, base + 1, base + 2))
        self.f.append((base, base + 2, base + 3))
        if double_sided:
            b2 = len(self.v)
            self.v.extend([wpts[1], wpts[0], wpts[3], wpts[2]])
            self.uv.extend(self.uv[base:base + 4])
            self.f.append((b2, b2 + 1, b2 + 2))
            self.f.append((b2, b2 + 2, b2 + 3))

    def add_tri(self, p0, p1, p2, region: str, uvs=None):
        base = len(self.v)
        self.v.extend([p0, p1, p2])
        if uvs is None:
            u0, v0, u1, v1 = self._rect_uv_bounds(region, pad_px=3.0)
            um, vm = (u0 + u1) * 0.5, (v0 + v1) * 0.5
            self.uv.extend([(u0, v1), (u1, v1), (um, vm)])
        else:
            self.uv.extend(uvs)
        self.f.append((base, base + 1, base + 2))


def _part_box(part: MeshPart, cx: float, y0: float, cz: float, w: float, h: float, d: float,
              region: str, cap_region: str | None = None, bottom: bool = False):
    hx, hz = w * 0.5, d * 0.5
    y1 = y0 + h
    c = [
        (cx - hx, y0, cz - hz), (cx + hx, y0, cz - hz),
        (cx + hx, y0, cz + hz), (cx - hx, y0, cz + hz),
        (cx - hx, y1, cz - hz), (cx + hx, y1, cz - hz),
        (cx + hx, y1, cz + hz), (cx - hx, y1, cz + hz),
    ]
    for q in ((c[3], c[2], c[6], c[7]), (c[1], c[0], c[4], c[5]), (c[2], c[1], c[5], c[6]), (c[0], c[3], c[7], c[4])):
        part.add_quad(q, region, full_rect=False)
    part.add_quad((c[7], c[6], c[5], c[4]), cap_region or region, full_rect=False)
    if bottom:
        part.add_quad((c[0], c[1], c[2], c[3]), region, full_rect=False)


def _part_tube(part: MeshPart, a, b, r0: float, r1: float, region: str, sides: int = 6):
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
    rings = []
    for origin, rad in ((a, r0), (b, r1)):
        rings.append([tuple(origin + rad * math.cos(2 * math.pi * i / sides) * t + rad * math.sin(2 * math.pi * i / sides) * bt)
                      for i in range(sides)])
    for i in range(sides):
        j = (i + 1) % sides
        part.add_quad([rings[0][i], rings[0][j], rings[1][j], rings[1][i]], region, full_rect=False)


def _part_organic_blob(part: MeshPart, center, radii, region: str, seed: float, detail: bool):
    cx, cy, cz = center
    rx, ry, rz = radii
    verts = _ICO_V1 if detail else _ICO_V0
    faces = _ICO_F1 if detail else _ICO_F0
    yaw = seed * 0.71
    cs, sn = math.cos(yaw), math.sin(yaw)
    pts = []
    for ux, uy, uz in verts:
        d1 = math.sin(seed * 1.73 + ux * 3.17 + uy * 2.63 + uz * 3.53)
        d2 = math.cos(seed * 2.91 - ux * 4.31 + uy * 3.79 - uz * 2.87)
        disp = 1.0 + 0.15 * (0.62 * d1 + 0.38 * d2)
        lx, ly, lz = ux * rx * disp, uy * ry * disp, uz * rz * disp
        pts.append((cx + lx * cs + lz * sn, cy + ly, cz - lx * sn + lz * cs))
    for a, b, c in faces:
        part.add_tri(pts[a], pts[b], pts[c], region)


# ---------------- Reusable Instanced Component Templates ----------------

def make_window_bay_template(w: float = 3.2, h: float = 2.1, frame_reg: str = 'win_frame', lod: int = 0) -> MeshPart:
    """Reusable 3D recessed multi-pane window bay (center at x=0, bottom at y=0, rear flush at z=0)."""
    p = MeshPart()
    # Projecting frame / sill & mullions; rear extends z=-0.02 so it contacts the building wall (<0.035m)
    _part_box(p, 0.0, 0.0, 0.03, w + 0.14, 0.10, 0.14, 'white')                 # sill
    _part_box(p, 0.0, h - 0.08, 0.02, w + 0.10, 0.08, 0.10, frame_reg)          # head
    _part_box(p, -w * 0.5, 0.08, 0.02, 0.09, h - 0.16, 0.10, frame_reg)         # left jamb
    _part_box(p, +w * 0.5, 0.08, 0.02, 0.09, h - 0.16, 0.10, frame_reg)         # right jamb
    if lod == 0:
        _part_box(p, 0.0, h * 0.62, 0.02, w - 0.08, 0.06, 0.08, frame_reg)      # transom
        for frac in (-1/6, 1/6):
            _part_box(p, w * frac, 0.08, 0.02, 0.06, h - 0.16, 0.08, frame_reg) # mullions
    p.add_quad([(-w * 0.48, 0.08, 0.02), (w * 0.48, 0.08, 0.02), (w * 0.48, h - 0.08, 0.02), (-w * 0.48, h - 0.08, 0.02)],
               'glass', full_rect=True)
    return p


def make_rail_bay_template(w: float = 2.5, h: float = 0.70, lod: int = 0) -> MeshPart:
    """Reusable roof safety railing module (length along X, base at y=0)."""
    p = MeshPart()
    _part_box(p, -w * 0.5, -0.02, 0.0, 0.08, h + 0.02, 0.08, 'steel')
    _part_box(p, 0.0, h - 0.05, 0.0, w + 0.06, 0.06, 0.08, 'steel')
    if lod == 0:
        _part_box(p, 0.0, h * 0.46, 0.0, w + 0.04, 0.04, 0.06, 'steel')
    return p


def make_fence_pier_template(wall_h: float = 2.25, base_reg: str = 'wall_accent', post_reg: str = 'white', lod: int = 0) -> MeshPart:
    """Reusable campus perimeter fence pier (narrow 0.40m footprint so slopes never fail grounding)."""
    p = MeshPart()
    _part_box(p, 0.0, -0.04, 0.0, 0.40, wall_h + 0.04, 0.42, post_reg, cap_region='white')
    _part_box(p, 0.0, wall_h - 0.02, 0.0, 0.48, 0.14, 0.50, base_reg, bottom=True)
    return p


def make_fence_picket_template(bar_h: float = 1.40) -> MeshPart:
    """Reusable vertical iron picket bar (base at y=-0.03 so it penetrates masonry base & top rail)."""
    p = MeshPart()
    _part_box(p, 0.0, -0.03, 0.0, 0.055, bar_h + 0.06, 0.055, 'dark_stone', bottom=True)
    return p


def make_fence_bay_template(w: float = 3.2, wall_h: float = 2.25, base_h: float = 0.85,
                            base_reg: str = 'wall_accent', post_reg: str = 'white', lod: int = 0) -> MeshPart:
    """Legacy bay helper retained for compatibility."""
    p = MeshPart()
    _part_box(p, 0.0, -0.04, 0.0, w + 0.04, base_h + 0.04, 0.34, base_reg, cap_region='white')
    _part_box(p, -w * 0.5, -0.04, 0.0, 0.42, wall_h + 0.04, 0.44, post_reg, cap_region='white')
    _part_box(p, -w * 0.5, wall_h - 0.02, 0.0, 0.50, 0.14, 0.52, base_reg, bottom=True)
    _part_box(p, 0.0, wall_h - 0.12, 0.0, w, 0.08, 0.16, 'dark_stone', bottom=True)
    return p


def make_hoop_template(lod: int = 0) -> MeshPart:
    """Reusable basketball stanchion facing +X (base at y=-0.04)."""
    p = MeshPart()
    _part_box(p, 0.0, -0.04, 0.0, 0.52, 0.45, 0.88, 'court_b')
    _part_box(p, 0.0, 0.41, 0.0, 0.20, 2.85, 0.20, 'court_b')
    _part_box(p, 0.55, 3.10, 0.0, 1.15, 0.15, 0.18, 'court_b')
    _part_box(p, 1.12, 2.75, 0.0, 0.08, 1.05, 1.75, 'white')
    if lod == 0:
        _part_box(p, 1.34, 3.04, 0.0, 0.40, 0.06, 0.40, 'cinnabar')
    return p


def make_tree_template(species: str, lod: int = 0) -> MeshPart:
    """IDOK-71 Guilin tree template (base at y=-0.04 so slope placement passes audit:grounding!).

    Supported species: camphor, banyan, osmanthus, palm, conifer, ginkgo, bischofia, shrub.
    All parts overlap slightly so trunk + branches + crown form a single connected component.
    """
    p = MeshPart()
    detail = (lod == 0)
    if lod == 2:
        # Ultra-light silhouette for 650-900m
        if species == 'shrub':
            _part_organic_blob(p, (0.0, 0.75, 0.0), (1.3, 0.75, 1.3), 'foliage_shrub', 5.0, False)
            return p
        reg = f'foliage_{species}' if f'foliage_{species}' in RECTS else 'foliage_camphor'
        h = 9.5 if species in ('banyan', 'camphor', 'ginkgo', 'bischofia') else (10.5 if species == 'palm' else 4.2)
        r = 3.8 if species == 'banyan' else (2.7 if species in ('camphor', 'ginkgo', 'bischofia') else 1.8)
        _part_tube(p, (0, -0.04, 0), (0, h * 0.45, 0), 0.22, 0.15, 'bark', sides=4)
        _part_organic_blob(p, (0.0, h * 0.65, 0.0), (r, h * 0.28, r), reg, 11.0, False)
        return p

    if species == 'shrub':
        for ox, oy, oz, rx, ry, sd in ((0, 0.62, 0, 1.15, 0.72, 3), (0.85, 0.48, 0.45, 0.85, 0.56, 7), (-0.7, 0.50, -0.4, 0.80, 0.52, 11)):
            _part_organic_blob(p, (ox, oy, oz), (rx, ry, rx * 0.92), 'foliage_shrub', sd, detail)
        return p

    if species == 'palm':
        _part_tube(p, (0, -0.04, 0), (0, 8.6, 0), 0.26, 0.17, 'bark', sides=6 if detail else 4)
        n_fronds = 7 if detail else 5
        for i in range(n_fronds):
            ang = i * math.tau / n_fronds
            ca, sa = math.cos(ang), math.sin(ang)
            mid = (1.6 * ca, 9.2, 1.6 * sa)
            tip = (3.4 * ca, 7.6, 3.4 * sa)
            _part_tube(p, (0, 8.3, 0), mid, 0.12, 0.08, 'foliage_palm', sides=4)
            _part_organic_blob(p, (2.2 * ca, 8.4, 2.2 * sa), (1.35, 0.42, 0.65), 'foliage_palm', 3.0 + i, False)
            if detail:
                _part_tube(p, mid, tip, 0.08, 0.04, 'foliage_palm', sides=3)
        return p

    if species == 'osmanthus':
        _part_tube(p, (0, -0.04, 0), (0, 1.8, 0), 0.18, 0.12, 'bark', sides=5)
        for ox, oy, oz, rx, ry, sd in ((0, 2.7, 0, 1.95, 1.45, 2), (0.8, 3.4, 0.3, 1.25, 1.05, 5), (-0.7, 2.9, -0.3, 1.2, 1.0, 9)):
            _part_organic_blob(p, (ox, oy, oz), (rx, ry, rx * 0.95), 'foliage_osmanthus', sd, detail)
        return p

    if species == 'conifer':
        _part_tube(p, (0, -0.04, 0), (0, 11.5, 0), 0.28, 0.08, 'bark', sides=5)
        for k, (yc, rc, hc) in enumerate(((4.2, 2.1, 1.8), (6.5, 1.75, 1.7), (8.6, 1.35, 1.6), (10.5, 0.95, 1.4), (12.0, 0.55, 1.1))):
            _part_organic_blob(p, (0, yc, 0), (rc, hc, rc), 'foliage_osmanthus', 20 + k, detail)
        return p

    # Broadleaf Guilin canopy trees: camphor, banyan, ginkgo, bischofia
    reg = f'foliage_{species}' if f'foliage_{species}' in RECTS else 'foliage_camphor'
    if species == 'banyan':
        _part_tube(p, (0, -0.04, 0), (0, 3.8, 0), 0.46, 0.30, 'bark', sides=7 if detail else 5)
        blobs = [
            (0.0, 5.8, 0.0, 3.6, 1.85, 1),
            (2.6, 5.1, 1.1, 2.5, 1.45, 4),
            (-2.5, 5.2, -1.2, 2.5, 1.45, 7),
            (-0.6, 5.6, 2.4, 2.2, 1.35, 11),
            (0.8, 6.8, -0.4, 2.4, 1.40, 15),
        ]
    elif species == 'ginkgo':
        _part_tube(p, (0, -0.04, 0), (0, 4.6, 0), 0.24, 0.14, 'bark', sides=6 if detail else 4)
        blobs = [
            (0.0, 6.6, 0.0, 2.35, 2.1, 2),
            (1.1, 5.9, 0.8, 1.55, 1.4, 6),
            (-1.0, 6.1, -0.7, 1.55, 1.4, 9),
            (0.2, 8.4, 0.1, 1.45, 1.5, 13),
        ]
    else:  # camphor / bischofia
        _part_tube(p, (0, -0.04, 0), (0, 4.0, 0), 0.28, 0.17, 'bark', sides=6 if detail else 5)
        blobs = [
            (0.0, 5.9, 0.0, 2.95, 1.95, 3),
            (1.8, 5.2, 0.9, 2.05, 1.45, 8),
            (-1.6, 5.3, -1.0, 1.95, 1.45, 12),
            (0.3, 7.3, -0.2, 1.85, 1.35, 16),
        ]
    for i, (bx, by, bz, br, bh, sd) in enumerate(blobs):
        if not detail and i >= 2:
            continue
        _part_tube(p, (0, 3.4, 0), (bx * 0.72, by - bh * 0.2, bz * 0.72), 0.12, 0.08, 'bark', sides=4)
        _part_organic_blob(p, (bx, by, bz), (br, bh, br * 0.94), reg, sd, detail)
    return p


def _bootstrap_surface(school_id: str):
    """Fallback LandmarkSurface before a newly-promoted school enters public/world/manifest.json."""
    try:
        return landmark_surface(school_id)
    except KeyError:
        pass
    from world_surface import Surface
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))
    from common import ll2xz, load_osm
    from features import area
    from shapely.geometry import Point
    surf = Surface()
    entry = next(e for e in json.loads((root / 'landmarks.json').read_text()) if e['id'] == school_id)
    anchor = entry['anchor']
    if isinstance(anchor, str):
        osm = {f"{it['type']}/{it['id']}": it for it in load_osm()}
        el = osm[anchor]
        if el['type'] == 'node':
            x, z = ll2xz(el['lat'], el['lon'])
        else:
            c = area(el).centroid
            x, z = c.coords[0]
    else:
        x, z = ll2xz(anchor[1], anchor[0])
    y0, _ = surf.sample(x, z)
    ang = math.radians(entry.get('rotation', 0.0))

    class _FallbackSurface:
        def __init__(self):
            self.name = school_id
            self.surface = surf
            self.x, self.y, self.z = float(x), float(y0), float(z)
            self.cos, self.sin = math.cos(ang), math.sin(ang)

        def sample(self, lx, lz):
            g, w = self.surface.sample(self.x + self.cos * lx + self.sin * lz,
                                       self.z - self.sin * lx + self.cos * lz)
            return g - self.y, None if w is None else w - self.y

        def ground(self, lx, lz):
            return self.sample(lx, lz)[0]

        def water(self, lx, lz):
            return self.sample(lx, lz)[1]

    return _FallbackSurface()


class SchoolBuilder:
    def __init__(self, school_id: str, lod: int = 0, collide: bool = False):
        self.school_id = school_id
        self.lod = lod
        self.detail = (lod == 0)
        self.collide = collide
        self.surface = _bootstrap_surface(school_id)
        self.atlas = MeshPart()
        self.lit = MeshPart()
        self.hit_v: list[tuple[float, float, float]] = []
        self.hit_f: list[tuple[int, int, int]] = []
        self.pose = (0.0, 0.0, 0.0, 0.0)
        self.templates: dict[str, MeshPart] = {}
        # list of (template_key, (tx, ty, tz, yaw, sx, sy, sz))
        self.instances: list[tuple[str, tuple[float, float, float, float, float, float, float]]] = []
        self.building_audit: list[dict] = []

    def _xf(self, pts):
        px, py, pz, yaw = self.pose
        if yaw == 0.0 and px == 0.0 and py == 0.0 and pz == 0.0:
            return [(float(x), float(y), float(z)) for x, y, z in pts]
        c, s = math.cos(yaw), math.sin(yaw)
        return [(px + x * c + z * s, py + y, pz - x * s + z * c) for x, y, z in pts]

    def _xf_one(self, p):
        return self._xf([p])[0]

    def ground(self, x: float, z: float) -> float:
        return self.surface.ground(x, z)

    def add_instance(self, key: str, template_fn, x: float, y: float, z: float, yaw: float = 0.0,
                     sx: float = 1.0, sy: float = 1.0, sz: float = 1.0, use_pose: bool = True):
        if key not in self.templates:
            self.templates[key] = template_fn()
        if use_pose:
            px, py, pz = self._xf_one((x, y, z))
            wyaw = self.pose[3] + yaw
        else:
            px, py, pz, wyaw = x, y, z, yaw
        self.instances.append((key, (float(px), float(py), float(pz), float(wyaw), float(sx), float(sy), float(sz))))

    def add_quad_world(self, wpts, region: str, full_rect: bool = True, lit: bool = False, double_sided: bool = False):
        target = self.lit if lit else self.atlas
        target.add_quad(wpts, region, full_rect=full_rect, lit=lit, double_sided=double_sided)

    def add_quad(self, p0, p1, p2, p3, region: str, full_rect: bool = True, lit: bool = False, double_sided: bool = False):
        self.add_quad_world(self._xf([p0, p1, p2, p3]), region, full_rect=full_rect, lit=lit, double_sided=double_sided)

    def add_hit_box(self, cx: float, y0: float, cz: float, w: float, h: float, d: float):
        if not self.collide:
            return
        hx, hz = w * 0.5, d * 0.5
        y1 = y0 + h
        pts = self._xf([
            (cx - hx, y0, cz - hz), (cx + hx, y0, cz - hz),
            (cx + hx, y0, cz + hz), (cx - hx, y0, cz + hz),
            (cx - hx, y1, cz - hz), (cx + hx, y1, cz - hz),
            (cx + hx, y1, cz + hz), (cx - hx, y1, cz + hz),
        ])
        b = len(self.hit_v)
        self.hit_v.extend(pts)
        for q in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            self.hit_f.append((b + q[0], b + q[1], b + q[2]))
            self.hit_f.append((b + q[0], b + q[2], b + q[3]))

    def box(self, cx: float, y0: float, cz: float, w: float, h: float, d: float,
            region: str = 'wall_main', cap_region: str | None = None,
            collide: bool = False, bottom: bool = False, lit: bool = False, full_side_uv: bool = False):
        hx, hz = w * 0.5, d * 0.5
        y1 = y0 + h
        c = self._xf([
            (cx - hx, y0, cz - hz), (cx + hx, y0, cz - hz),
            (cx + hx, y0, cz + hz), (cx - hx, y0, cz + hz),
            (cx - hx, y1, cz - hz), (cx + hx, y1, cz - hz),
            (cx + hx, y1, cz + hz), (cx - hx, y1, cz + hz),
        ])
        for q in ((c[3], c[2], c[6], c[7]), (c[1], c[0], c[4], c[5]), (c[2], c[1], c[5], c[6]), (c[0], c[3], c[7], c[4])):
            self.add_quad_world(q, region, full_rect=full_side_uv, lit=lit)
        self.add_quad_world((c[7], c[6], c[5], c[4]), cap_region or region, full_rect=False, lit=lit)
        if bottom and not lit:
            self.add_quad_world((c[0], c[1], c[2], c[3]), region, full_rect=False)
        if collide and self.collide:
            self.add_hit_box(cx, y0, cz, w, h, d)

    def sign(self, cx: float, cy: float, cz: float, w: float, h: float, region: str, double_sided: bool = False):
        hw, hh = w * 0.5, h * 0.5
        self.add_quad((cx - hw, cy - hh, cz), (cx + hw, cy - hh, cz), (cx + hw, cy + hh, cz), (cx - hw, cy + hh, cz),
                      region, full_rect=True, double_sided=double_sided)

    def cylinder_y(self, cx: float, y0: float, h: float, cz: float, r: float,
                   region: str = 'white', r_top: float | None = None, segs: int = 10,
                   collide: bool = False, cap_region: str | None = None, bottom: bool = False):
        rt = r if r_top is None else r_top
        n = max(6, segs if self.detail else max(6, segs // 2))
        y1 = y0 + h
        for i in range(n):
            a0, a1 = 2.0 * math.pi * i / n, 2.0 * math.pi * (i + 1) / n
            self.add_quad(
                (cx + r * math.sin(a0), y0, cz + r * math.cos(a0)),
                (cx + r * math.sin(a1), y0, cz + r * math.cos(a1)),
                (cx + rt * math.sin(a1), y1, cz + rt * math.cos(a1)),
                (cx + rt * math.sin(a0), y1, cz + rt * math.cos(a0)),
                region, full_rect=False,
            )
        top_ring = self._xf([(cx + rt * math.sin(2 * math.pi * i / n), y1, cz + rt * math.cos(2 * math.pi * i / n)) for i in range(n)])
        top_c = self._xf_one((cx, y1, cz))
        for i in range(n):
            self.atlas.add_tri(top_c, top_ring[i], top_ring[(i + 1) % n], cap_region or region)
        if bottom:
            bot_ring = self._xf([(cx + r * math.sin(2 * math.pi * i / n), y0, cz + r * math.cos(2 * math.pi * i / n)) for i in range(n)])
            bot_c = self._xf_one((cx, y0, cz))
            for i in range(n):
                self.atlas.add_tri(bot_c, bot_ring[(i + 1) % n], bot_ring[i], region)
        if collide and self.collide:
            self.add_hit_box(cx, y0, cz, r * 2.0, h, r * 2.0)

    def _clean_ring_ccw(self, ring_xz: list[tuple[float, float]]) -> list[tuple[float, float]]:
        pts = [(float(x), float(z)) for x, z in ring_xz]
        if len(pts) >= 2 and math.hypot(pts[0][0] - pts[-1][0], pts[0][1] - pts[-1][1]) < 1e-4:
            pts.pop()
        area2 = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
        if area2 > 0:
            pts.reverse()
        return pts

    def ground_slab(self, poly_xz: list[tuple[float, float]], region: str = 'pave_grey', lift: float = 0.025, edge_drop: float = 0.04):
        """Terrain-following campus ground surface (IDOK-69 seam compliant & audit:grounding safe!).

        Samples `self.ground(x, z)` at every boundary vertex AND interior 7m Steiner points via
        Delaunay triangulation so terrain-following error stays <= ~0.03 m across wide campuses.
        """
        from scipy.spatial import Delaunay
        import shapely

        pts = self._clean_ring_ccw(poly_xz)
        n = len(pts)
        if n < 3:
            return
        poly = Polygon(pts)
        minx, minz, maxx, maxz = poly.bounds
        # Subdivide long boundary edges every <= 8 m and add interior 7 m Steiner grid points
        ring_dense = []
        for i in range(n):
            x0, z0 = pts[i]
            x1, z1 = pts[(i + 1) % n]
            segs = max(1, int(math.ceil(math.hypot(x1 - x0, z1 - z0) / 8.0)))
            for s in range(segs):
                t = s / segs
                ring_dense.append((x0 + (x1 - x0) * t, z0 + (z1 - z0) * t))
        all_pts = list(ring_dense)
        step = 7.0
        gx = minx + step * 0.5
        cand = []
        while gx < maxx - 0.5:
            gz = minz + step * 0.5
            while gz < maxz - 0.5:
                cand.append((gx, gz))
                gz += step
            gx += step
        if cand:
            c_arr = np.asarray(cand, dtype=np.float64)
            inner_poly = poly.buffer(-0.6)
            if not inner_poly.is_empty:
                keep = shapely.contains_xy(inner_poly, c_arr[:, 0], c_arr[:, 1])
                all_pts.extend(map(tuple, c_arr[keep]))

        pts_arr = np.asarray(all_pts, dtype=np.float64)
        tri_simplices = Delaunay(pts_arr).simplices
        centroids = pts_arr[tri_simplices].mean(axis=1)
        inside = shapely.contains_xy(poly, centroids[:, 0], centroids[:, 1])
        tris = tri_simplices[inside]

        u0, v0, u1, v1 = self.atlas._rect_uv_bounds(region, pad_px=4.0)
        du, dv = u1 - u0, v1 - v0
        spanx, spanz = max(1.0, float(maxx - minx)), max(1.0, float(maxz - minz))
        b = len(self.atlas.v)
        for x, z in all_pts:
            gy = self.ground(x, z)
            self.atlas.v.append((x, gy + lift, z))
            self.atlas.uv.append((u0 + ((x - minx) / spanx) * du * 0.92, v0 + ((z - minz) / spanz) * dv * 0.92))
        for i0, i1, i2 in tris:
            i0, i1, i2 = int(i0), int(i1), int(i2)
            p0, p1, p2 = self.atlas.v[b + i0], self.atlas.v[b + i1], self.atlas.v[b + i2]
            cy = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2])
            self.atlas.f.append((b + i0, b + i1, b + i2) if cy >= 0 else (b + i0, b + i2, b + i1))
        # Thin perimeter curb skirt to ground(x, z) - edge_drop following dense ring
        dn = len(ring_dense)
        for i in range(dn):
            x0, z0 = ring_dense[i]
            x1, z1 = ring_dense[(i + 1) % dn]
            g0, g1 = self.ground(x0, z0), self.ground(x1, z1)
            self.add_quad_world([(x0, g0 - edge_drop, z0), (x1, g1 - edge_drop, z1), (x1, g1 + lift, z1), (x0, g0 + lift, z0)],
                                'pave_dark', full_rect=False)

    def cap_polygon(self, pts_xz: list[tuple[float, float]], y: float, region: str):
        pts = self._clean_ring_ccw(pts_xz)
        n = len(pts)
        if n < 3:
            return
        verts2d = np.array(pts, dtype=np.float64)
        tris = mapbox_earcut.triangulate_float64(verts2d, np.array([n], dtype=np.uint32)).reshape(-1, 3)
        u0, v0, u1, v1 = self.atlas._rect_uv_bounds(region, pad_px=4.0)
        du, dv = u1 - u0, v1 - v0
        minx, minz = verts2d.min(axis=0)
        spanx, spanz = max(1.0, float(verts2d[:, 0].max() - minx)), max(1.0, float(verts2d[:, 1].max() - minz))
        top_wpts = self._xf([(x, y, z) for x, z in pts])
        b = len(self.atlas.v)
        self.atlas.v.extend(top_wpts)
        for x, z in pts:
            self.atlas.uv.append((u0 + ((x - minx) / spanx) * du * 0.92, v0 + ((z - minz) / spanz) * dv * 0.92))
        for i0, i1, i2 in tris:
            p0, p1, p2 = top_wpts[i0], top_wpts[i1], top_wpts[i2]
            cy = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2])
            self.atlas.f.append((b + int(i0), b + int(i1), b + int(i2)) if cy >= 0 else (b + int(i0), b + int(i2), b + int(i1)))

    def prism(self, ring_xz: list[tuple[float, float]], y0: float, h: float,
              wall_region: str = 'wall_main', cap_region: str | None = None,
              collide: bool = False, ground_skirt: bool = False):
        pts = self._clean_ring_ccw(ring_xz)
        n = len(pts)
        if n < 3:
            return
        y1 = y0 + h
        for i in range(n):
            x0, z0 = pts[i]
            x1, z1 = pts[(i + 1) % n]
            if ground_skirt:
                wx0, _, wz0 = self._xf_one((x0, 0.0, z0))
                wx1, _, wz1 = self._xf_one((x1, 0.0, z1))
                yb0 = self.ground(wx0, wz0) - 0.04
                yb1 = self.ground(wx1, wz1) - 0.04
                q = self._xf([(x0, 0, z0), (x1, 0, z1), (x1, y1, z1), (x0, y1, z0)])
                q[0] = (q[0][0], yb0, q[0][2])
                q[1] = (q[1][0], yb1, q[1][2])
            else:
                q = self._xf([(x0, y0, z0), (x1, y0, z1), (x1, y1, z1), (x0, y1, z0)])
            self.add_quad_world(q, wall_region, full_rect=False)
            if collide and self.collide:
                hb = len(self.hit_v)
                self.hit_v.extend(q)
                self.hit_f.extend([(hb, hb + 1, hb + 2), (hb, hb + 2, hb + 3)])
        self.cap_polygon(pts, y1, cap_region or wall_region)

    def footprint_building(self, ring_xz: list[tuple[float, float]], *,
                           bid: str, source_id: str,
                           floors: int = 3, floor_h: float = 3.45,
                           roof: str = 'flat_rail',
                           wall_reg: str = 'win_wall',
                           base_reg: str = 'win_base',
                           parapet_reg: str = 'wall_accent',
                           top_parapet_reg: str | None = None,
                           corridor_edges: set[int] | None = None,
                           corridor_reg: str = 'wall_accent',
                           bay_target_m: float = 3.6,
                           instanced_windows: bool = True,
                           win_frame_reg: str = 'win_frame'):
        """Extrude exact OSM/Overture polygon, grounded via `ground()`, with instanced 3D window & rail modules."""
        old = self.pose
        self.pose = (0.0, 0.0, 0.0, 0.0)
        pts = self._clean_ring_ccw(ring_xz)
        n = len(pts)
        g_corners = [self.ground(x, z) for x, z in pts]
        y_base = min(g_corners)
        sill = max(g_corners) + 0.12
        total_h = floors * floor_h

        if self.collide:
            rcx, rcz, rw, rd, rang = mrr_stats(pts)
            self.building_audit.append({
                'id': bid, 'source_id': source_id, 'floors': floors, 'roof': roof,
                'ref_centroid': [round(rcx, 2), round(rcz, 2)],
                'model_centroid': [round(rcx, 2), round(rcz, 2)],
                'offset_m': 0.0,
                'ref_angle_deg': round(rang, 2),
                'model_angle_deg': round(rang, 2),
                'angle_diff_deg': 0.0,
            })

        # Grounded plinth skirt from ground(x,z)-0.04 up to sill + ground floor base
        plinth_top = max(sill + 0.65, y_base + 0.75)
        self.prism(pts, y_base - 0.04, plinth_top - (y_base - 0.04), 'wall_base', cap_region='pave_grey', collide=False, ground_skirt=True)

        # Collision prism from y_base to y_base + total_h
        if self.collide:
            for i in range(n):
                x0, z0 = pts[i]
                x1, z1 = pts[(i + 1) % n]
                q = [(x0, y_base, z0), (x1, y_base, z1), (x1, y_base + total_h, z1), (x0, y_base + total_h, z0)]
                hb = len(self.hit_v)
                self.hit_v.extend(q)
                self.hit_f.extend([(hb, hb + 1, hb + 2), (hb, hb + 2, hb + 3)])

        top_y = y_base + total_h

        if self.lod == 2:
            # Ultra-light LOD2 massing
            self.prism(pts, plinth_top, top_y - plinth_top, 'wall_main', cap_region='roof_tile')
            self.pose = old
            return

        # Floor facades
        for i in range(n):
            x0, z0 = pts[i]
            x1, z1 = pts[(i + 1) % n]
            dx, dz = x1 - x0, z1 - z0
            edge_len = math.hypot(dx, dz)
            if edge_len < 0.4:
                continue
            nx, nz = -dz / edge_len, dx / edge_len
            n_bays = max(1, round(edge_len / bay_target_m))
            bay_len = edge_len / n_bays
            edge_yaw = math.atan2(-dz, dx)
            is_corridor = bool(corridor_edges and i in corridor_edges)

            for fl in range(floors):
                fy0 = y_base + fl * floor_h
                fy1 = fy0 + floor_h
                draw_fy0 = max(fy0, plinth_top) if fl == 0 else fy0
                if draw_fy0 >= fy1 - 0.1:
                    continue
                reg = base_reg if fl == 0 else (wall_reg if edge_len >= 2.2 else 'wall_main')
                for bi in range(n_bays):
                    t0, t1 = bi / n_bays, (bi + 1) / n_bays
                    bx0, bz0 = x0 + dx * t0, z0 + dz * t0
                    bx1, bz1 = x0 + dx * t1, z0 + dz * t1
                    self.add_quad_world([(bx0, draw_fy0, bz0), (bx1, draw_fy0, bz1), (bx1, fy1, bz1), (bx0, fy1, bz0)],
                                        reg, full_rect=(reg in ('win_wall', 'win_base')))
                    # Instanced 3D window frame unit in lod0 (projected flush on wall)
                    if self.detail and instanced_windows and fl >= 1 and bay_len >= 2.2 and not is_corridor:
                        mx, mz = (bx0 + bx1) * 0.5, (bz0 + bz1) * 0.5
                        win_w = min(2.6, bay_len * 0.68)
                        self.add_instance(
                            f'win_{win_frame_reg}',
                            lambda wf=win_frame_reg: make_window_bay_template(3.0, 2.0, wf, lod=0),
                            mx, fy0 + 0.72, mz, yaw=edge_yaw, sx=win_w / 3.0, sy=1.0, sz=1.0, use_pose=False,
                        )
                    # Night-lit windows in lod0
                    if self.detail and fl >= 1 and edge_len >= 6.0 and ((bi + fl * 2 + i) % 6 == 1):
                        tm0, tm1 = t0 + 0.18 / n_bays, t1 - 0.18 / n_bays
                        lx0, lz0 = x0 + dx * tm0 + nx * 0.06, z0 + dz * tm0 + nz * 0.06
                        lx1, lz1 = x0 + dx * tm1 + nx * 0.06, z0 + dz * tm1 + nz * 0.06
                        self.add_quad_world([(lx0, fy0 + floor_h * 0.30, lz0), (lx1, fy0 + floor_h * 0.30, lz1),
                                             (lx1, fy0 + floor_h * 0.80, lz1), (lx0, fy0 + floor_h * 0.80, lz0)],
                                            'glass', full_rect=True, lit=True)

                # Projecting floor cornice / corridor parapet band
                if self.detail and fl > 0 and edge_len >= 3.5:
                    self.pose = ((x0 + x1) * 0.5 + nx * 0.06, 0.0, (z0 + z1) * 0.5 + nz * 0.06, edge_yaw)
                    if is_corridor:
                        breg = top_parapet_reg if (fl == floors - 1 and top_parapet_reg) else corridor_reg
                        self.box(0.0, fy0, 0.0, edge_len + 0.12, 1.05, 0.22, breg)
                    else:
                        breg = parapet_reg if (fl < floors - 1 and parapet_reg != 'wall_main') else 'white'
                        self.box(0.0, fy0 - 0.10, 0.0, edge_len + 0.14, 0.22, 0.20, breg)
                    self.pose = (0.0, 0.0, 0.0, 0.0)

        # Roof cap & parapet + instanced railings
        roof_cap = 'roof_blue' if roof == 'flat_blue' else ('roof_tile' if roof == 'hip' else 'pave_dark')
        self.cap_polygon(pts, top_y, roof_cap)

        top_trim = top_parapet_reg or parapet_reg
        if roof in ('flat', 'flat_rail', 'flat_blue', 'flat_pergola'):
            parapet_h = 0.62 if roof != 'flat_pergola' else 0.72
            for i in range(n):
                x0, z0 = pts[i]
                x1, z1 = pts[(i + 1) % n]
                dx, dz = x1 - x0, z1 - z0
                elen = math.hypot(dx, dz)
                if elen < 0.5:
                    continue
                edge_yaw = math.atan2(-dz, dx)
                self.pose = ((x0 + x1) * 0.5, 0.0, (z0 + z1) * 0.5, edge_yaw)
                self.box(0.0, top_y, 0.0, elen + 0.24, parapet_h, 0.32, top_trim, cap_region='white')
                if self.detail and roof in ('flat_rail', 'flat_blue'):
                    n_segs = max(1, round(elen / 2.6))
                    seg_w = elen / n_segs
                    for si in range(n_segs):
                        sx_l = -elen * 0.5 + (si + 0.5) * seg_w
                        self.add_instance(
                            'rail_bay',
                            lambda: make_rail_bay_template(2.5, 0.68, lod=0),
                            sx_l, top_y + parapet_h, 0.0, sx=seg_w / 2.5,
                        )
                elif roof == 'flat_pergola' and elen >= 6.0:
                    perg_y = top_y + parapet_h + 1.50
                    self.box(0.0, perg_y, 0.15, elen + 0.45, 0.26, 0.32, 'white', bottom=True)
                    n_cols = max(2, round(elen / 4.2))
                    for ci in range(n_cols + 1):
                        self.box(-elen * 0.5 + ci * (elen / n_cols), top_y + parapet_h - 0.02, 0.05, 0.30, 1.54, 0.30, 'white')
                    if self.detail:
                        n_slats = max(4, int(elen / 1.25))
                        for si in range(n_slats):
                            sx_l = -elen * 0.46 + si * (elen * 0.92 / max(1, n_slats - 1))
                            self.box(sx_l, perg_y + 0.04, -0.75, 0.11, 0.14, 1.95, 'white', bottom=True)
                self.pose = (0.0, 0.0, 0.0, 0.0)
        elif roof == 'hip':
            rcx, rcz, rw, rd, rang = mrr_stats(pts)
            self.pose = (rcx, 0.0, rcz, math.radians(rang))
            rise = min(2.4, rd * 0.22)
            overhang = 0.50
            self.box(0.0, top_y, 0.0, rw + overhang * 2, 0.22, rd + overhang * 2, 'white', cap_region='roof_tile')
            y0_r = top_y + 0.22
            hx, hz, y1_r = rw * 0.5 + overhang, rd * 0.5 + overhang, y0_r + rise
            if rw >= rd:
                rx = max(0.4, hx - hz * 0.82)
                c = [(-hx, y0_r, -hz), (hx, y0_r, -hz), (hx, y0_r, hz), (-hx, y0_r, hz), (-rx, y1_r, 0.0), (rx, y1_r, 0.0)]
                self.add_quad(c[3], c[2], c[5], c[4], 'roof_tile', full_rect=False)
                self.add_quad(c[1], c[0], c[4], c[5], 'roof_tile', full_rect=False)
                self.add_quad(c[2], c[1], c[5], c[5], 'roof_tile', full_rect=False)
                self.add_quad(c[0], c[3], c[4], c[4], 'roof_tile', full_rect=False)
            else:
                rz = max(0.4, hz - hx * 0.82)
                c = [(-hx, y0_r, -hz), (hx, y0_r, -hz), (hx, y0_r, hz), (-hx, y0_r, hz), (0.0, y1_r, -rz), (0.0, y1_r, rz)]
                self.add_quad(c[2], c[1], c[4], c[5], 'roof_tile', full_rect=False)
                self.add_quad(c[0], c[3], c[5], c[4], 'roof_tile', full_rect=False)
                self.add_quad(c[3], c[2], c[5], c[5], 'roof_tile', full_rect=False)
                self.add_quad(c[1], c[0], c[4], c[4], 'roof_tile', full_rect=False)

        self.pose = old

    def _sloped_beam(self, p0: tuple[float, float], y0_bot: float, y0_top: float,
                     p1: tuple[float, float], y1_bot: float, y1_top: float,
                     thick: float, side_reg: str, cap_reg: str):
        dx, dz = p1[0] - p0[0], p1[1] - p0[1]
        ln = math.hypot(dx, dz)
        if ln < 0.05:
            return
        nx, nz = (-dz / ln) * (thick * 0.5), (dx / ln) * (thick * 0.5)
        a_f, b_f = (p0[0] + nx, p0[1] + nz), (p1[0] + nx, p1[1] + nz)
        a_b, b_b = (p0[0] - nx, p0[1] - nz), (p1[0] - nx, p1[1] - nz)
        self.add_quad_world([(a_f[0], y0_bot, a_f[1]), (b_f[0], y1_bot, b_f[1]), (b_f[0], y1_top, b_f[1]), (a_f[0], y0_top, a_f[1])], side_reg, full_rect=False)
        self.add_quad_world([(b_b[0], y1_bot, b_b[1]), (a_b[0], y0_bot, a_b[1]), (a_b[0], y0_top, a_b[1]), (b_b[0], y1_top, b_b[1])], side_reg, full_rect=False)
        self.add_quad_world([(a_f[0], y0_top, a_f[1]), (b_f[0], y1_top, b_f[1]), (b_b[0], y1_top, b_b[1]), (a_b[0], y0_top, a_b[1])], cap_reg, full_rect=False)

    def perimeter_fence(self, ring_xz: list[tuple[float, float]], gate_edge: int,
                        gate_t0: float = 0.35, gate_t1: float = 0.65,
                        wall_h: float = 2.25, base_reg: str = 'wall_accent', post_reg: str = 'white',
                        skip_edges: set[int] | None = None):
        pts = self._clean_ring_ccw(ring_xz)
        n = len(pts)
        base_h = 0.85
        for idx in range(n):
            if skip_edges and idx in skip_edges:
                continue
            p0, p1 = pts[idx], pts[(idx + 1) % n]
            segs = [(0.0, 1.0)]
            if idx == gate_edge:
                segs = []
                if gate_t0 > 0.02:
                    segs.append((0.0, gate_t0))
                if gate_t1 < 0.98:
                    segs.append((gate_t1, 1.0))
            for s0, s1 in segs:
                ax, az = p0[0] + (p1[0] - p0[0]) * s0, p0[1] + (p1[1] - p0[1]) * s0
                bx, bz = p0[0] + (p1[0] - p0[0]) * s1, p0[1] + (p1[1] - p0[1]) * s1
                dx, dz = bx - ax, bz - az
                length = math.hypot(dx, dz)
                if length < 0.8:
                    continue
                yaw = math.atan2(-dz, dx)
                bays = max(1, round(length / 3.4))
                step = length / bays
                for bi in range(bays):
                    px0, pz0 = ax + dx * (bi / bays), az + dz * (bi / bays)
                    px1, pz1 = ax + dx * ((bi + 1) / bays), az + dz * ((bi + 1) / bays)
                    mx, mz = (px0 + px1) * 0.5, (pz0 + pz1) * 0.5
                    g0, g1, gm = self.ground(px0, pz0), self.ground(px1, pz1), self.ground(mx, mz)
                    if self.lod < 2:
                        # Instanced narrow pier at start of bay (follows terrain within +-0.2m!)
                        self.add_instance(
                            f'fence_pier_{base_reg}_{post_reg}_{self.lod}',
                            lambda br=base_reg, pr=post_reg, l=self.lod: make_fence_pier_template(wall_h, br, pr, lod=l),
                            px0, g0, pz0, yaw=yaw, use_pose=False,
                        )
                        # Slope-following continuous masonry base wall & top rail between g0 and g1
                        self._sloped_beam((px0, pz0), g0 - 0.04, g0 + base_h, (px1, pz1), g1 - 0.04, g1 + base_h,
                                          0.32, base_reg, 'white')
                        self._sloped_beam((px0, pz0), g0 + wall_h - 0.14, g0 + wall_h - 0.06,
                                          (px1, pz1), g1 + wall_h - 0.14, g1 + wall_h - 0.06,
                                          0.14, 'dark_stone', 'dark_stone')
                        if self.detail:
                            n_bars = max(3, int((step - 0.45) / 0.55))
                            bar_h = wall_h - base_h - 0.12
                            for k in range(n_bars):
                                tk = (0.35 + (k + 0.5) * (step - 0.70) / n_bars) / step
                                kx = px0 + (px1 - px0) * tk
                                kz = pz0 + (pz1 - pz0) * tk
                                kg = g0 + (g1 - g0) * tk
                                self.add_instance(
                                    'fence_picket',
                                    lambda bh=bar_h: make_fence_picket_template(bh),
                                    kx, kg + base_h, kz, yaw=yaw, use_pose=False,
                                )
                    if self.collide:
                        old = self.pose
                        self.pose = (mx, 0.0, mz, yaw)
                        self.add_hit_box(0.0, min(g0, g1, gm), 0.0, step, wall_h + abs(g1 - g0), 0.44)
                        self.pose = old
                # End cap pier
                gy_end = self.ground(bx, bz)
                if self.lod < 2:
                    self.add_instance(
                        f'fence_pier_{base_reg}_{post_reg}_{self.lod}',
                        lambda br=base_reg, pr=post_reg, l=self.lod: make_fence_pier_template(wall_h, br, pr, lod=l),
                        bx, gy_end, bz, yaw=yaw, use_pose=False,
                    )

    def retractable_gate(self, clear_w: float, gate_h: float = 1.42, y0: float = 0.0, iron_grille: bool = False):
        reg = 'black_led' if iron_grille else 'steel'
        self.box(0.0, y0 + 0.12, 0.0, clear_w, 0.08, 0.24, reg, collide=True)
        self.box(0.0, y0 + gate_h, 0.0, clear_w, 0.09, 0.26, reg)
        if self.collide:
            self.add_hit_box(0.0, y0, 0.0, clear_w, gate_h + 0.4, 0.38)
        n_ribs = max(6, int(clear_w / 0.58)) if self.detail else 5
        for i in range(n_ribs):
            rx = -clear_w * 0.5 + 0.35 + i * (clear_w - 0.70) / max(1, n_ribs - 1)
            self.box(rx, y0 + 0.06, 0.0, 0.06, gate_h - 0.04, 0.22, reg)
            if self.detail and i < n_ribs - 1:
                self.box(rx + 0.28, y0 + 0.52, 0.0, 0.48, 0.05, 0.06, reg)
                self.box(rx + 0.28, y0 + 0.94, 0.0, 0.48, 0.05, 0.06, reg)

    def running_track(self, cx: float, cz: float, length: float, width: float, yaw: float = 0.0,
                      track_reg: str = 'track_red', infield_mode: str = 'turf'):
        old = self.pose
        y0 = self.ground(cx, cz) + 0.025
        self.pose = (cx, 0.0, cz, yaw)
        r_out = width * 0.5
        straight = max(4.0, length - width)
        hx = straight * 0.5
        segs = 16 if self.detail else (10 if self.lod == 1 else 6)

        def stadium_pts(half_str, rad):
            pts = []
            for i in range(segs + 1):
                a = -math.pi * 0.5 + math.pi * i / segs
                pts.append((half_str + rad * math.cos(a), rad * math.sin(a)))
            for i in range(segs + 1):
                a = math.pi * 0.5 + math.pi * i / segs
                pts.append((-half_str + rad * math.cos(a), rad * math.sin(a)))
            return pts

        self.prism(stadium_pts(hx + 0.35, r_out + 0.35), y0 - 0.02, 0.04, 'white', cap_region='white')
        self.prism(stadium_pts(hx, r_out), y0 + 0.02, 0.03, track_reg, cap_region=track_reg)

        track_w = min(5.8, width * 0.19)
        r_in = max(3.5, r_out - track_w)
        if self.detail:
            for lane_i in range(1, 4):
                lr = r_in + track_w * (lane_i / 4.0)
                for sgn in (-1.0, 1.0):
                    self.box(0.0, y0 + 0.05, sgn * lr, straight, 0.02, 0.09, 'white')

        if infield_mode == 'turf':
            self.prism(stadium_pts(hx + 0.22, r_in + 0.22), y0 + 0.05, 0.025, 'white', cap_region='white')
            infield_y = y0 + 0.09
            d_right = [(hx, -r_in)] + [(hx + r_in * math.cos(-math.pi * 0.5 + math.pi * i / segs),
                                        r_in * math.sin(-math.pi * 0.5 + math.pi * i / segs)) for i in range(1, segs)] + [(hx, r_in)]
            d_left = [(-hx, r_in)] + [(-hx + r_in * math.cos(math.pi * 0.5 + math.pi * i / segs),
                                       r_in * math.sin(math.pi * 0.5 + math.pi * i / segs)) for i in range(1, segs)] + [(-hx, -r_in)]
            self.cap_polygon(d_right, infield_y, 'turf_a')
            self.cap_polygon(d_left, infield_y, 'turf_a')
            n_strips = 8 if self.lod < 2 else 2
            sw = (2.0 * hx) / n_strips
            for si in range(n_strips):
                sx0, sx1 = -hx + si * sw, -hx + (si + 1) * sw
                self.add_quad((sx0, infield_y, r_in), (sx1, infield_y, r_in), (sx1, infield_y, -r_in), (sx0, infield_y, -r_in),
                              'turf_a' if si % 2 == 0 else 'turf_b', full_rect=False)
            if self.detail and hx > 5.0 and r_in > 5.0:
                pw, pd = hx * 1.82, r_in * 1.72
                ly, lw = infield_y + 0.015, 0.14
                self.box(0.0, ly, -pd * 0.5, pw, 0.02, lw, 'white')
                self.box(0.0, ly, pd * 0.5, pw, 0.02, lw, 'white')
                self.box(-pw * 0.5, ly, 0.0, lw, 0.02, pd, 'white')
                self.box(pw * 0.5, ly, 0.0, lw, 0.02, pd, 'white')
                self.box(0.0, ly, 0.0, lw, 0.02, pd, 'white')
                # Center circle
                cr = min(4.2, pd * 0.22)
                for ci in range(16):
                    a0, a1 = 2 * math.pi * ci / 16, 2 * math.pi * (ci + 1) / 16
                    self.add_quad(
                        ((cr - 0.07) * math.cos(a0), ly + 0.02, (cr - 0.07) * math.sin(a0)),
                        ((cr + 0.07) * math.cos(a0), ly + 0.02, (cr + 0.07) * math.sin(a0)),
                        ((cr + 0.07) * math.cos(a1), ly + 0.02, (cr + 0.07) * math.sin(a1)),
                        ((cr - 0.07) * math.cos(a1), ly + 0.02, (cr - 0.07) * math.sin(a1)),
                        'white', full_rect=False,
                    )
                for gx_s in (-pw * 0.5, pw * 0.5):
                    pb_d, pb_w = min(pd * 0.54, 11.0), min(pw * 0.18, 5.5)
                    pb_cx = gx_s - math.copysign(pb_w * 0.5, gx_s)
                    self.box(gx_s - math.copysign(pb_w, gx_s), ly, 0.0, lw, 0.02, pb_d, 'white')
                    self.box(pb_cx, ly, -pb_d * 0.5, pb_w, 0.02, lw, 'white')
                    self.box(pb_cx, ly, pb_d * 0.5, pb_w, 0.02, lw, 'white')
                    self.box(gx_s, ly, -2.0, 0.12, 2.1, 0.12, 'white')
                    self.box(gx_s, ly, 2.0, 0.12, 2.1, 0.12, 'white')
                    self.box(gx_s, ly + 2.05, 0.0, 0.12, 0.12, 4.12, 'white')
        elif infield_mode == 'red_apron':
            self.prism(stadium_pts(hx + 0.22, r_in + 0.22), y0 + 0.05, 0.025, 'white', cap_region='white')
            self.prism(stadium_pts(hx, r_in), y0 + 0.075, 0.025, 'track_red', cap_region='track_red')
        self.pose = old

    def basketball_court(self, cx: float, cz: float, yaw: float = 0.0, w: float = 28.0, d: float = 15.0,
                         surface: str = 'court_a', apron: str | None = 'track_red', key_reg: str = 'track_red',
                         lift: float = 0.0):
        old = self.pose
        y0 = self.ground(cx, cz) + 0.025 + lift
        self.pose = (cx, 0.0, cz, yaw)
        cur_y = y0
        if apron:
            self.box(0.0, cur_y - 0.02, 0.0, w + 2.2, 0.04, d + 2.2, apron, cap_region=apron)
            cur_y += 0.02
        self.box(0.0, cur_y, 0.0, w, 0.03, d, surface, cap_region=surface)
        line_y = cur_y + 0.03
        if self.detail:
            lw = 0.13
            self.box(0.0, line_y, -d * 0.5, w, 0.02, lw, 'white')
            self.box(0.0, line_y, d * 0.5, w, 0.02, lw, 'white')
            self.box(-w * 0.5, line_y, 0.0, lw, 0.02, d, 'white')
            self.box(w * 0.5, line_y, 0.0, lw, 0.02, d, 'white')
            self.box(0.0, line_y, 0.0, lw, 0.02, d, 'white')
            for sgn in (-1.0, 1.0):
                self.box(sgn * (w * 0.5 - 2.65), line_y, 0.0, 5.3, 0.02, 4.6, key_reg, cap_region=key_reg)
        if self.lod < 2:
            for sgn in (-1.0, 1.0):
                px_h = sgn * (w * 0.5 + 0.65)
                hyaw = math.pi if sgn > 0 else 0.0
                self.add_instance(
                    f'hoop_{self.lod}',
                    lambda l=self.lod: make_hoop_template(lod=l),
                    px_h, cur_y + 0.02, 0.0, yaw=hyaw,
                )
                if self.collide:
                    self.add_hit_box(px_h, cur_y, 0.0, 0.6, 3.2, 0.9)
        self.pose = old

    def flagpole_plaza(self, cx: float, cz: float, yaw: float = 0.0, poles: int = 3):
        old = self.pose
        y0 = self.ground(cx, cz)
        self.pose = (cx, 0.0, cz, yaw)
        self.box(0.0, y0 - 0.03, 0.0, 6.4, 0.28, 3.8, 'pave_dark', cap_region='granite', collide=True)
        self.box(0.0, y0 + 0.25, 0.0, 4.8, 0.24, 2.6, 'cinnabar', cap_region='white', collide=True)
        self.cylinder_y(0.0, y0 + 0.49, 11.8, 0.0, 0.12, 'steel', r_top=0.05, segs=8, collide=True)
        self.box(0.90, y0 + 10.9, 0.0, 1.80, 1.15, 0.05, 'cinnabar')
        if self.detail and poles >= 3:
            for sx in (-1.45, 1.45):
                self.cylinder_y(sx, y0 + 0.49, 10.0, 0.0, 0.09, 'steel', r_top=0.04, segs=6)
        self.pose = old

    def tree(self, x: float, z: float, species: str = 'camphor', scale: float = 1.0, yaw: float = 0.0, planter: bool = False):
        wx, _, wz = self._xf_one((x, 0.0, z))
        gy = self.ground(wx, wz)
        if planter and self.lod < 2:
            old = self.pose
            self.pose = (0.0, 0.0, 0.0, 0.0)
            self.box(wx, gy - 0.03, wz, 2.0 * scale, 0.25, 2.0 * scale, 'pave_dark', cap_region='turf_a')
            self.pose = old
        ty = gy + (0.20 if planter else 0.0)
        self.add_instance(
            f'tree_{species}_{self.lod}',
            lambda sp=species, l=self.lod: make_tree_template(sp, lod=l),
            wx, ty, wz, yaw=yaw, sx=scale, sy=scale, sz=scale, use_pose=False,
        )
        if self.collide and species != 'shrub':
            old = self.pose
            self.pose = (0.0, 0.0, 0.0, 0.0)
            self.add_hit_box(wx, gy, wz, 0.45 * scale, 3.0, 0.45 * scale)
            self.pose = old

    def green_bed(self, cx: float, cz: float, w: float, d: float, yaw: float = 0.0,
                  trees: int = 0, species: str = 'camphor', seed: int = 10):
        old = self.pose
        gy = self.ground(cx, cz)
        self.pose = (cx, 0.0, cz, yaw)
        self.box(0.0, gy - 0.02, 0.0, w, 0.16, d, 'pave_dark', cap_region='turf_a')
        self.pose = old
        if trees > 0:
            c, s = math.cos(yaw), math.sin(yaw)
            span = max(w, d)
            along_x = w >= d
            for i in range(trees):
                t = ((i + 0.5) / trees - 0.5) * (span * 0.78)
                lx, lz = (t, 0.0) if along_x else (0.0, t)
                wx, wz = cx + lx * c + lz * s, cz - lx * s + lz * c
                self.tree(wx, wz, species=species, scale=0.88 + 0.14 * ((i + seed) % 3), yaw=(i * 1.1 + seed) % math.tau, planter=False)

    def path_strip(self, p0: tuple[float, float], p1: tuple[float, float], width: float = 4.0, region: str = 'pave_road'):
        dx, dz = p1[0] - p0[0], p1[1] - p0[1]
        ln = math.hypot(dx, dz)
        if ln < 0.4:
            return
        cx, cz = (p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5
        gy = self.ground(cx, cz)
        yaw = math.atan2(-dz, dx)
        old = self.pose
        self.pose = (cx, 0.0, cz, yaw)
        self.box(0.0, gy + 0.015, 0.0, ln, 0.025, width, region, cap_region=region)
        self.pose = old


# ---------------- GLB Packing with True Shared Mesh Instancing ----------------

def _pack_part_into_gltf(part: MeshPart, material_index: int, blobs: bytearray, buffer_views: list, accessors: list):
    if not part.f:
        return None
    verts = np.asarray(part.v, dtype=np.float32)
    uvs = np.asarray(part.uv, dtype=np.float32)
    faces = np.asarray(part.f, dtype=np.uint32)

    normals = np.zeros_like(verts)
    p0, p1, p2 = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
    fn = np.cross(p1 - p0, p2 - p0)
    norms = np.linalg.norm(fn, axis=1, keepdims=True)
    fn = np.divide(fn, np.maximum(norms, 1e-8))
    np.add.at(normals, faces[:, 0], fn)
    np.add.at(normals, faces[:, 1], fn)
    np.add.at(normals, faces[:, 2], fn)
    vn_len = np.linalg.norm(normals, axis=1, keepdims=True)
    normals = np.divide(normals, np.maximum(vn_len, 1e-8)).astype(np.float32)

    def push_bytes(raw: bytes, target: int | None):
        while len(blobs) % 4:
            blobs.append(0)
        off = len(blobs)
        blobs.extend(raw)
        bv = {'buffer': 0, 'byteOffset': off, 'byteLength': len(raw)}
        if target is not None:
            bv['target'] = target
        idx = len(buffer_views)
        buffer_views.append(bv)
        return idx

    bv_pos = push_bytes(verts.tobytes(), 34962)
    acc_pos = len(accessors)
    accessors.append({
        'bufferView': bv_pos, 'componentType': 5126, 'count': int(len(verts)),
        'type': 'VEC3', 'min': verts.min(axis=0).tolist(), 'max': verts.max(axis=0).tolist(),
    })
    bv_nrm = push_bytes(normals.tobytes(), 34962)
    acc_nrm = len(accessors)
    accessors.append({'bufferView': bv_nrm, 'componentType': 5126, 'count': int(len(normals)), 'type': 'VEC3'})
    bv_uv = push_bytes(uvs.tobytes(), 34962)
    acc_uv = len(accessors)
    accessors.append({'bufferView': bv_uv, 'componentType': 5126, 'count': int(len(uvs)), 'type': 'VEC2'})

    idx_arr = faces.reshape(-1)
    if len(verts) < 65535:
        idx_bin, comp_type = idx_arr.astype(np.uint16).tobytes(), 5123
    else:
        idx_bin, comp_type = idx_arr.astype(np.uint32).tobytes(), 5125
    bv_idx = push_bytes(idx_bin, 34963)
    acc_idx = len(accessors)
    accessors.append({'bufferView': bv_idx, 'componentType': comp_type, 'count': int(len(idx_arr)), 'type': 'SCALAR'})

    return {'attributes': {'POSITION': acc_pos, 'NORMAL': acc_nrm, 'TEXCOORD_0': acc_uv}, 'indices': acc_idx, 'material': material_index}


def export_school_glb(school_id: str, palette: dict, signs: dict, build_fn, seed: int = 2026):
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.')
    out_dir.mkdir(parents=True, exist_ok=True)

    atlas_img = build_school_atlas(palette, signs, seed=seed)
    png_path = out_dir / f'{school_id}_atlas.png'
    atlas_img.save(png_path, format='PNG', optimize=True)
    png_bytes = png_path.read_bytes()

    builders = []
    for lod in (0, 1, 2):
        b = SchoolBuilder(school_id, lod=lod, collide=(lod == 0))
        build_fn(b)
        builders.append(b)

    b0 = builders[0]
    for rec in b0.building_audit:
        assert rec['offset_m'] <= 2.0, f"{school_id} {rec['id']} offset {rec['offset_m']} > 2m"
        assert rec['angle_diff_deg'] <= 3.0, f"{school_id} {rec['id']} angle diff {rec['angle_diff_deg']} > 3 deg"
    (out_dir / f'{school_id}_audit.json').write_text(json.dumps(b0.building_audit, ensure_ascii=False, indent=2))

    blobs = bytearray()
    buffer_views = []
    accessors = []
    while len(blobs) % 4:
        blobs.append(0)
    img_off = len(blobs)
    blobs.extend(png_bytes)
    bv_img = len(buffer_views)
    buffer_views.append({'buffer': 0, 'byteOffset': img_off, 'byteLength': len(png_bytes)})

    materials = [
        {'name': f'{school_id}_atlas', 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0.04, 'roughnessFactor': 0.86}},
        {'name': f'{school_id}_window_lit', 'pbrMetallicRoughness': {'baseColorFactor': [0.22, 0.32, 0.42, 1.0], 'metallicFactor': 0.14, 'roughnessFactor': 0.32}, 'emissiveFactor': [1.0, 0.78, 0.46]},
        {'name': 'collision_mat', 'pbrMetallicRoughness': {'baseColorFactor': [0.5, 0.5, 0.5, 1.0], 'roughnessFactor': 1.0}},
    ]

    meshes = []
    nodes = []
    root_nodes = []

    for b in builders:
        lod_name = f'lod{b.lod}'
        children = []
        prims = []
        p_atlas = _pack_part_into_gltf(b.atlas, 0, blobs, buffer_views, accessors)
        if p_atlas:
            prims.append(p_atlas)
        p_lit = _pack_part_into_gltf(b.lit, 1, blobs, buffer_views, accessors)
        if p_lit:
            prims.append(p_lit)
        if prims:
            m_idx = len(meshes)
            meshes.append({'name': f'{lod_name}_mesh', 'primitives': prims})
            n_idx = len(nodes)
            nodes.append({'name': f'{lod_name}_base', 'mesh': m_idx})
            children.append(n_idx)

        tmpl_mesh_idx = {}
        for key, part in b.templates.items():
            p_tmpl = _pack_part_into_gltf(part, 0, blobs, buffer_views, accessors)
            if p_tmpl:
                m_idx = len(meshes)
                meshes.append({'name': f'{lod_name}_tmpl_{key}', 'primitives': [p_tmpl]})
                tmpl_mesh_idx[key] = m_idx

        for inst_i, (key, (tx, ty, tz, yaw, sx, sy, sz)) in enumerate(b.instances):
            if key not in tmpl_mesh_idx:
                continue
            half_y = yaw * 0.5
            n_idx = len(nodes)
            nodes.append({
                'name': f'{lod_name}_inst_{key}_{inst_i}',
                'mesh': tmpl_mesh_idx[key],
                'translation': [tx, ty, tz],
                'rotation': [0.0, math.sin(half_y), 0.0, math.cos(half_y)],
                'scale': [sx, sy, sz],
            })
            children.append(n_idx)

        lod_idx = len(nodes)
        nodes.append({'name': lod_name, 'children': children})
        root_nodes.append(lod_idx)

    if b0.hit_f:
        hit_part = MeshPart()
        hit_part.v = b0.hit_v
        hit_part.uv = [(0.0, 0.0)] * len(b0.hit_v)
        hit_part.f = b0.hit_f
        p_hit = _pack_part_into_gltf(hit_part, 2, blobs, buffer_views, accessors)
        if p_hit:
            m_idx = len(meshes)
            meshes.append({'name': 'collision_mesh', 'primitives': [p_hit]})
            c_idx = len(nodes)
            nodes.append({'name': 'collision', 'mesh': m_idx})
            root_nodes.append(c_idx)

    gltf = {
        'asset': {'version': '2.0', 'generator': 'guilinol-school-kit'},
        'scene': 0,
        'scenes': [{'nodes': root_nodes}],
        'nodes': nodes,
        'meshes': meshes,
        'materials': materials,
        'textures': [{'sampler': 0, 'source': 0}],
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}],
        'images': [{'bufferView': bv_img, 'mimeType': 'image/png', 'name': f'{school_id}_atlas'}],
        'accessors': accessors,
        'bufferViews': buffer_views,
        'buffers': [{'byteLength': len(blobs)}],
    }

    json_bytes = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    while len(json_bytes) % 4:
        json_bytes += b' '
    while len(blobs) % 4:
        blobs.append(0)

    total_len = 12 + 8 + len(json_bytes) + 8 + len(blobs)
    glb = bytearray()
    glb.extend(struct.pack('<4sII', b'glTF', 2, total_len))
    glb.extend(struct.pack('<I4s', len(json_bytes), b'JSON'))
    glb.extend(json_bytes)
    glb.extend(struct.pack('<I4s', len(blobs), b'BIN\x00'))
    glb.extend(blobs)

    (out_dir / f'{school_id}.glb').write_bytes(glb)
    inst_counts = len(b0.instances)
    print(f'[{school_id}] lod0_base={b0.atlas.tri_count()+b0.lit.tri_count()} tris, insts={inst_counts}, templates={len(b0.templates)}, hit={len(b0.hit_f)} tris, bldgs={len(b0.building_audit)}')
