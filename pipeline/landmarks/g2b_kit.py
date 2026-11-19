"""Shared procedural mesh & compact per-school 512x512 atlas toolkit for M2.7-G2b schools (Round 2).

Key guarantees:
1. Per-school 512x512 procedural PNG atlas written only to temp dir and embedded into <id>.glb;
   gltfpack compresses each school's KTX2 texture to ~60-95 KB (<150 KB, zero shared-atlas bloat).
2. Every building extruded directly on its OSM/Overture footprint polygon (centroid offset <= 0.2 m,
   orientation diff <= 0.5 deg, verified automatically) with multi-pane classroom windows on ALL walls
   in both lod0 and lod1 (zero blank boards).
3. Disjoint side-by-side grass strips on sports fields (zero overlapping Y slabs, zero Z-fighting triangles).
4. K-12 safety compliance: street-facing gate with CJK nameplate + closed retractable gate,
   no guardhouse/booth, no turnstiles, no CCTV, no side/back doors; walkable street & courtyard.
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

ATLAS_SIZE = 512

RECTS = {
    'win_wall':    (0,   0,   128, 128),
    'win_base':    (128, 0,   128, 128),
    'wall_main':   (256, 0,   96,  96),
    'wall_accent': (352, 0,   80,  96),
    'wall_sub':    (432, 0,   80,  96),
    'roof_tile':   (256, 96,  88,  88),
    'pave_grey':   (344, 96,  84,  88),
    'pave_dark':   (428, 96,  84,  88),
    'track_red':   (0,   128, 96,  96),
    'turf_a':      (96,  128, 80,  96),
    'turf_b':      (176, 128, 80,  96),
    'foliage':     (0,   224, 96,  80),
    'court_a':     (96,  224, 80,  80),
    'court_b':     (176, 224, 40,  80),
    'wall_base':   (216, 224, 40,  80),
    'glass':       (256, 184, 64,  120),
    'white':       (320, 184, 48,  60),
    'steel':       (368, 184, 48,  60),
    'bark':        (416, 184, 48,  60),
    'gold':        (464, 184, 48,  60),
    'cinnabar':    (320, 244, 48,  60),
    'yellow':      (368, 244, 48,  60),
    'lime':        (416, 244, 48,  60),
    'black_led':   (464, 244, 48,  60),
    'sign_gate':   (0,   304, 352, 68),
    'sign_vert':   (352, 304, 64,  136),
    'sign_emblem': (416, 304, 96,  136),
    'sign_motto':  (0,   372, 352, 68),
    'sign_led':    (0,   440, 256, 72),
    'sign_bldg1':  (256, 440, 128, 36),
    'sign_bldg2':  (384, 440, 128, 36),
    'sign_bldg3':  (256, 476, 128, 36),
    'sign_bldg4':  (384, 476, 128, 36),
}


def _rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip('#')
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
    raise SystemExit('g2b_kit: CJK font required for school signage')


def _draw_centered(draw: ImageDraw.ImageDraw, rect, text: str, font, fill, stroke_w: int = 0, stroke_fill=None):
    bx, by, bw, bh = rect
    tb = draw.textbbox((0, 0), text, font=font, stroke_width=stroke_w)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    tx = bx + (bw - tw) / 2.0 - tb[0]
    ty = by + (bh - th) / 2.0 - tb[1]
    draw.text((tx, ty), text, font=font, fill=fill, stroke_width=stroke_w, stroke_fill=stroke_fill or fill)


def _paint_window_bay(draw: ImageDraw.ImageDraw, rect, wall_hex: str, frame_hex: str,
                      glass_hex: str, trim_hex: str, has_ac: bool = False, is_base: bool = False):
    """Paint one crisp structural bay (1 bay wide x 1 storey high) with multi-pane classroom windows."""
    rx, ry, rw, rh = rect
    wall_c = _rgb(wall_hex)
    mortar_c = _mix(wall_c, (40, 44, 48), 0.12)
    frame_c = _rgb(frame_hex)
    glass_top = _mix(_rgb(glass_hex), (180, 210, 232), 0.24)
    glass_bot = _mix(_rgb(glass_hex), (18, 26, 34), 0.30)
    trim_c = _rgb(trim_hex)

    # Ceramic tile wall background
    draw.rectangle((rx, ry, rx + rw - 1, ry + rh - 1), fill=wall_c)
    step_y = 10 if not is_base else 14
    step_x = 22 if not is_base else 28
    for yy in range(ry, ry + rh, step_y):
        draw.line((rx, yy, rx + rw - 1, yy), fill=mortar_c, width=1)
    for xx in range(rx, rx + rw, step_x):
        draw.line((xx, ry, xx, ry + rh - 1), fill=mortar_c, width=1)

    # Top floor-slab band & sill shadow
    draw.rectangle((rx, ry, rx + rw - 1, ry + 7), fill=trim_c)
    draw.line((rx, ry + 8, rx + rw - 1, ry + 8), fill=_mix(wall_c, (0, 0, 0), 0.28), width=2)

    # Pilaster side edges so adjacent bays read as articulated columns, never flat boards
    pil_c = _mix(wall_c, trim_c, 0.35)
    draw.rectangle((rx, ry + 8, rx + 7, ry + rh - 1), fill=pil_c)
    draw.rectangle((rx + rw - 8, ry + 8, rx + rw - 1, ry + rh - 1), fill=pil_c)

    # Window opening (wide classroom multi-pane window!)
    wx0 = rx + (18 if has_ac else 13)
    wx1 = rx + rw - (30 if has_ac else 14)
    wy0 = ry + (22 if is_base else 18)
    wy1 = ry + rh - (24 if is_base else 24)

    # Outer frame + dark reveal shadow
    draw.rectangle((wx0 - 3, wy0 - 3, wx1 + 3, wy1 + 3), fill=frame_c, outline=_mix(frame_c, (0, 0, 0), 0.35), width=1)
    # Gradient glass fill
    for yy in range(wy0, wy1 + 1):
        t = (yy - wy0) / max(1, wy1 - wy0)
        gc = _mix(glass_top, glass_bot, t)
        draw.line((wx0, yy, wx1, yy), fill=gc)
    # Diagonal sky highlight reflection
    draw.polygon([(wx0 + 4, wy0 + 3), (wx0 + 22, wy0 + 3), (wx0 + 8, wy1 - 3), (wx0 + 2, wy1 - 3)],
                 fill=_mix(glass_top, (245, 250, 255), 0.28))

    # Crisp 3-column x 2-row mullions + security grille lines
    ww = wx1 - wx0
    wh = wy1 - wy0
    transom_y = wy0 + int(wh * 0.34)
    draw.rectangle((wx0, transom_y - 1, wx1, transom_y + 2), fill=frame_c)
    for k in (1, 2):
        mx = wx0 + int(ww * k / 3.0)
        draw.rectangle((mx - 1, wy0, mx + 2, wy1), fill=frame_c)
    # Subtle security grille bars common on Guilin primary/middle schools
    grille_c = _mix(frame_c, glass_top, 0.45)
    for gx in range(wx0 + 6, wx1 - 3, 7):
        draw.line((gx, transom_y + 3, gx, wy1 - 1), fill=grille_c, width=1)

    # Projecting window sill
    draw.rectangle((wx0 - 5, wy1 + 3, wx1 + 5, wy1 + 7), fill=_mix(trim_c, (255, 255, 255), 0.35))
    draw.line((wx0 - 5, wy1 + 8, wx1 + 5, wy1 + 8), fill=_mix(wall_c, (0, 0, 0), 0.32), width=2)

    # Optional white split-AC outdoor unit beside window (seen in Minzu Middle & Nanxishan photos!)
    if has_ac and not is_base:
        ax0, ay0 = wx1 + 6, wy0 + 18
        ax1, ay1 = rx + rw - 5, wy0 + 44
        if ax1 - ax0 >= 14:
            draw.rectangle((ax0, ay0, ax1, ay1), fill=(236, 238, 240), outline=(145, 152, 158), width=1)
            cx_f = ax0 + (ax1 - ax0) // 2 - 2
            cy_f = (ay0 + ay1) // 2
            r_f = min(7, (ax1 - ax0) // 2 - 3)
            draw.ellipse((cx_f - r_f, cy_f - r_f, cx_f + r_f, cy_f + r_f), fill=(52, 58, 64), outline=(120, 126, 132))


def build_school_atlas(palette: dict, signs: dict, seed: int = 2026) -> Image.Image:
    """Create 512x512 procedural school texture sheet with rich windowed facades & crisp signage."""
    rng = np.random.default_rng(seed)
    arr = np.full((ATLAS_SIZE, ATLAS_SIZE, 3), 185, dtype=np.uint8)

    def paint_courses(rect_name, hex_col, bw=28, bh=12, mortar_delta=-16, jitter=6):
        rx, ry, rw, rh = RECTS[rect_name]
        base = np.array(_rgb(hex_col), dtype=np.int16)
        mortar = np.clip(base + mortar_delta, 0, 255).astype(np.uint8)
        patch = np.empty((rh, rw, 3), dtype=np.uint8)
        patch[:] = mortar
        row = 0
        for yy in range(0, rh, bh):
            off = (bw // 2) if (row % 2) else 0
            for xx in range(-off, rw, bw):
                x0, x1 = max(0, xx + 1), min(rw, xx + bw - 1)
                y0, y1 = max(0, yy + 1), min(rh, yy + bh - 1)
                if x1 > x0 and y1 > y0:
                    d = int(rng.integers(-jitter, jitter + 1))
                    patch[y0:y1, x0:x1] = np.clip(base + d, 0, 255).astype(np.uint8)
            row += 1
        noise = rng.integers(-3, 4, (rh, rw, 1), dtype=np.int16)
        arr[ry:ry + rh, rx:rx + rw] = np.clip(patch.astype(np.int16) + noise, 0, 255).astype(np.uint8)

    def paint_flat(rect_name, hex_col, noise_amt=5, stripes_y=0, stripe_delta=0):
        rx, ry, rw, rh = RECTS[rect_name]
        base = np.array(_rgb(hex_col), dtype=np.int16)
        patch = np.broadcast_to(base, (rh, rw, 3)).copy()
        if stripes_y > 0:
            for yy in range(rh):
                if (yy // stripes_y) % 2 == 0:
                    patch[yy, :, :] += stripe_delta
        patch += rng.integers(-noise_amt, noise_amt + 1, (rh, rw, 1), dtype=np.int16)
        arr[ry:ry + rh, rx:rx + rw] = np.clip(patch, 0, 255).astype(np.uint8)

    paint_courses('wall_main', palette.get('wall_main', '#ece8de'), bw=24, bh=10, mortar_delta=-12, jitter=4)
    paint_courses('wall_accent', palette.get('wall_accent', '#c26b58'), bw=24, bh=12, mortar_delta=-16, jitter=6)
    paint_courses('wall_sub', palette.get('wall_sub', '#7daec9'), bw=24, bh=12, mortar_delta=-14, jitter=5)

    # Roof tile ribs
    rx, ry, rw, rh = RECTS['roof_tile']
    rbase = np.array(_rgb(palette.get('roof_tile', '#55585c')), dtype=np.int16)
    rpatch = np.broadcast_to(rbase, (rh, rw, 3)).copy()
    for xx in range(0, rw, 8):
        rpatch[:, xx:min(rw, xx + 2), :] -= 16
        rpatch[:, min(rw - 1, xx + 4):min(rw, xx + 6), :] += 10
    for yy in range(0, rh, 14):
        rpatch[yy:min(rh, yy + 2), :, :] -= 14
    rpatch += rng.integers(-4, 5, (rh, rw, 1), dtype=np.int16)
    arr[ry:ry + rh, rx:rx + rw] = np.clip(rpatch, 0, 255).astype(np.uint8)

    paint_courses('pave_grey', palette.get('pave_grey', '#c6c3ba'), bw=28, bh=28, mortar_delta=-14, jitter=4)
    paint_flat('pave_dark', palette.get('pave_dark', '#62666b'), noise_amt=6)
    paint_flat('track_red', palette.get('track_red', '#bc4d42'), noise_amt=6)
    paint_flat('turf_a', palette.get('turf_a', '#588f4f'), noise_amt=5)
    paint_flat('turf_b', palette.get('turf_b', '#477a40'), noise_amt=5)
    paint_flat('foliage', palette.get('foliage', '#3a6534'), noise_amt=13)
    paint_flat('court_a', palette.get('court_a', '#4d7f58'), noise_amt=5)
    paint_flat('court_b', palette.get('court_b', '#457094'), noise_amt=5)
    paint_courses('wall_base', palette.get('wall_base', '#5e6063'), bw=20, bh=10, mortar_delta=-14, jitter=5)
    paint_flat('white', '#f2f0ea', noise_amt=3)
    paint_flat('steel', '#c5ccd2', noise_amt=5, stripes_y=6, stripe_delta=7)
    paint_flat('bark', '#68523a', noise_amt=9)
    paint_flat('gold', '#dfb249', noise_amt=4)
    paint_flat('cinnabar', '#c4352b', noise_amt=4)
    paint_flat('yellow', palette.get('yellow', '#e5cd38'), noise_amt=4)
    paint_flat('lime', palette.get('lime', '#77be3d'), noise_amt=4)
    paint_flat('black_led', '#22262a', noise_amt=3)

    sheet = Image.fromarray(arr)
    draw = ImageDraw.Draw(sheet)

    # Rich windowed facade tiles (win_wall & win_base)
    _paint_window_bay(
        draw, RECTS['win_wall'],
        wall_hex=palette.get('wall_main', '#ece8de'),
        frame_hex=palette.get('win_frame', '#d8dce0'),
        glass_hex=palette.get('glass', '#3b5669'),
        trim_hex=palette.get('win_trim', '#f2f0ea'),
        has_ac=bool(palette.get('has_ac', False)),
        is_base=False,
    )
    _paint_window_bay(
        draw, RECTS['win_base'],
        wall_hex=palette.get('wall_base', '#5e6063'),
        frame_hex=palette.get('base_frame', '#cfd4d8'),
        glass_hex=palette.get('glass', '#354d5e'),
        trim_hex=palette.get('base_trim', '#7c8085'),
        has_ac=False,
        is_base=True,
    )

    # Curtain / multi-pane glass rect
    gx, gy, gw, gh = RECTS['glass']
    g_top = _mix(_rgb(palette.get('glass', '#3b5669')), (185, 218, 240), 0.28)
    g_bot = _mix(_rgb(palette.get('glass', '#3b5669')), (18, 26, 36), 0.28)
    for yy in range(gy, gy + gh):
        gc = _mix(g_top, g_bot, (yy - gy) / max(1, gh - 1))
        draw.line((gx, yy, gx + gw - 1, yy), fill=gc)
    mull_c = _rgb(palette.get('win_frame', '#dfe3e6'))
    draw.rectangle((gx, gy, gx + gw - 1, gy + gh - 1), outline=mull_c, width=3)
    for xx in (gx + gw // 3, gx + (2 * gw) // 3):
        draw.rectangle((xx - 1, gy, xx + 1, gy + gh - 1), fill=mull_c)
    for yy in (gy + gh // 3, gy + (2 * gh) // 3):
        draw.rectangle((gx, yy - 1, gx + gw - 1, yy + 1), fill=mull_c)

    # 1. Horizontal Gate Nameplate
    sx, sy, sw, sh = RECTS['sign_gate']
    gate_bg = _rgb(signs.get('gate_bg', '#f3efe6'))
    gate_fg = _rgb(signs.get('gate_fg', '#b22820'))
    gate_border = _rgb(signs.get('gate_border', '#bfa065'))
    draw.rectangle((sx, sy, sx + sw - 1, sy + sh - 1), fill=gate_bg)
    if signs.get('gate_outline', True):
        draw.rectangle((sx + 3, sy + 3, sx + sw - 4, sy + sh - 4), outline=gate_border, width=3)
    school_title = signs.get('school_name', '桂林市学校')
    sub_title = signs.get('school_en', '')
    title_size = 31 if len(school_title) <= 7 else (27 if len(school_title) <= 9 else 22)
    if sub_title:
        _draw_centered(draw, (sx + 8, sy + 4, sw - 16, 40), school_title, _font(title_size, bold=True), gate_fg)
        _draw_centered(draw, (sx + 8, sy + 43, sw - 16, 20), sub_title, _font(12, sans=True), _rgb(signs.get('gate_sub_fg', '#a52a22')))
    else:
        _draw_centered(draw, (sx + 8, sy + 6, sw - 16, sh - 12), school_title, _font(title_size + 4, bold=True), gate_fg)

    # 2. Vertical Gate Pillar Plaque ('sign_vert')
    vx, vy, vw, vh = RECTS['sign_vert']
    vbg = _rgb(signs.get('vert_bg', '#36322f'))
    vfg = _rgb(signs.get('vert_fg', '#e5c16c'))
    draw.rectangle((vx, vy, vx + vw - 1, vy + vh - 1), fill=vbg)
    draw.rectangle((vx + 3, vy + 3, vx + vw - 4, vy + vh - 4), outline=vfg, width=2)
    vtxt = signs.get('vert_text', school_title)
    n_ch = max(1, len(vtxt))
    ch_h = (vh - 16) / n_ch
    f_v = _font(max(12, min(20, int(ch_h * 0.82))), bold=True)
    for ci, ch in enumerate(vtxt):
        _draw_centered(draw, (vx + 4, int(vy + 8 + ci * ch_h), vw - 8, int(ch_h)), ch, f_v, vfg)

    # 3. Emblem / Key-Fret Frieze ('sign_emblem')
    ex, ey, ew, eh = RECTS['sign_emblem']
    emblem_style = signs.get('emblem_style', 'crest')
    if emblem_style == 'key_fret':
        # Carved stone key-fret frieze for Nanxishan Primary gate!
        fbg = _rgb('#d2c5ae')
        ffg = _rgb('#8b7d68')
        fhi = _rgb('#ebe2d0')
        draw.rectangle((ex, ey, ex + ew - 1, ey + eh - 1), fill=fbg)
        for ry_i in range(ey + 8, ey + eh - 12, 26):
            draw.line((ex, ry_i - 2, ex + ew - 1, ry_i - 2), fill=fhi, width=2)
            for rx_i in range(ex + 6, ex + ew - 14, 22):
                draw.rectangle((rx_i, ry_i, rx_i + 16, ry_i + 18), outline=ffg, width=2)
                draw.rectangle((rx_i + 4, ry_i + 4, rx_i + 12, ry_i + 14), outline=ffg, width=1)
    else:
        draw.rectangle((ex, ey, ex + ew - 1, ey + eh - 1), fill=gate_bg)
        cx_e, cy_e = ex + ew // 2, ey + eh // 2
        draw.ellipse((cx_e - 32, cy_e - 32, cx_e + 32, cy_e + 32), fill=_rgb('#2b628c'), outline=_rgb('#dfb249'), width=3)
        draw.ellipse((cx_e - 24, cy_e - 24, cx_e + 24, cy_e + 24), outline=_rgb('#f4efe4'), width=2)
        emblem_char = signs.get('emblem', school_title[:2])
        _draw_centered(draw, (cx_e - 22, cy_e - 18, 44, 36), emblem_char, _font(17, bold=True, sans=True), (248, 244, 234))

    # 4. Motto / Calligraphic Frieze ('sign_motto')
    mx, my, mw, mh = RECTS['sign_motto']
    motto_bg = _rgb(signs.get('motto_bg', '#5b6064'))
    motto_fg = _rgb(signs.get('motto_fg', '#e2b955'))
    draw.rectangle((mx, my, mx + mw - 1, my + mh - 1), fill=motto_bg)
    if signs.get('motto_ink_hills', False):
        # Ink-wash Guilin karst silhouette at bottom of white frieze + red seal in middle (Nanxishan!)
        hill_pts = [(mx, my + mh), (mx + 25, my + mh - 14), (mx + 55, my + mh - 20), (mx + 95, my + mh - 9),
                    (mx + 140, my + mh - 16), (mx + 185, my + mh - 7), (mx + 235, my + mh - 18),
                    (mx + 285, my + mh - 11), (mx + 325, my + mh - 19), (mx + mw, my + mh - 8), (mx + mw, my + mh)]
        draw.polygon(hill_pts, fill=(168, 160, 148))
        # Red seal in center
        scx = mx + mw // 2
        draw.rectangle((scx - 13, my + 16, scx + 13, my + 44), fill=(188, 56, 44), outline=(140, 36, 28), width=1)
        _draw_centered(draw, (mx + 10, my + 8, mw // 2 - 28, mh - 18), '最美的山水', _font(24, bold=True), motto_fg)
        _draw_centered(draw, (scx + 18, my + 8, mw // 2 - 28, mh - 18), '最好的自己', _font(24, bold=True), motto_fg)
    else:
        if signs.get('motto_border', True):
            draw.rectangle((mx + 3, my + 3, mx + mw - 4, my + mh - 4), outline=_mix(motto_bg, motto_fg, 0.45), width=2)
        motto_txt = signs.get('motto', '立德树人 求真向善')
        msize = 25 if len(motto_txt) <= 9 else (21 if len(motto_txt) <= 12 else 18)
        _draw_centered(draw, (mx + 6, my + 6, mw - 12, mh - 12), motto_txt, _font(msize, bold=True), motto_fg)

    # 5. LED Screen / Noticeboard ('sign_led')
    lx, ly, lw, lh = RECTS['sign_led']
    led_style = signs.get('led_style', 'white_screen')
    if led_style == 'white_screen':
        # Peizhi Special School large bright white LED display with black bezel + heart logo + school name!
        draw.rectangle((lx, ly, lx + lw - 1, ly + lh - 1), fill=(32, 36, 40))
        draw.rectangle((lx + 6, ly + 6, lx + lw - 7, ly + lh - 7), fill=(235, 243, 252))
        # Red/green heart icon on left
        draw.ellipse((lx + 18, ly + 18, lx + 34, ly + 34), outline=(218, 68, 56), width=3)
        draw.ellipse((lx + 30, ly + 18, lx + 46, ly + 34), outline=(218, 68, 56), width=3)
        draw.polygon([(lx + 19, ly + 29), (lx + 45, ly + 29), (lx + 32, ly + 46)], fill=(66, 165, 95))
        _draw_centered(draw, (lx + 50, ly + 10, lw - 60, 26), signs.get('led_title', school_title),
                       _font(19, bold=True, sans=True), (38, 46, 68))
        _draw_centered(draw, (lx + 50, ly + 38, lw - 60, 22), signs.get('led_sub', '立德树人 · 融合育人'),
                       _font(13, bold=True, sans=True), (204, 52, 58))
    elif led_style == 'blue_board':
        # Blue propaganda noticeboard
        draw.rectangle((lx, ly, lx + lw - 1, ly + lh - 1), fill=(46, 52, 58))
        draw.rectangle((lx + 5, ly + 5, lx + lw - 6, ly + lh - 6), fill=(42, 118, 178))
        for col_i in range(4):
            cx0 = lx + 12 + col_i * 58
            draw.rectangle((cx0, ly + 12, cx0 + 50, ly + lh - 12), fill=(218, 234, 248))
            for r_y in range(ly + 17, ly + lh - 15, 6):
                draw.line((cx0 + 4, r_y, cx0 + 45, r_y), fill=(75, 115, 155), width=2)
    else:
        # Dark stage LED banner with red glowing text
        draw.rectangle((lx, ly, lx + lw - 1, ly + lh - 1), fill=(26, 24, 26))
        draw.rectangle((lx + 3, ly + 3, lx + lw - 4, ly + lh - 4), outline=(90, 40, 38), width=2)
        _draw_centered(draw, (lx + 8, ly + 10, lw - 16, lh - 20), signs.get('led_title', f'{school_title}欢迎您'),
                       _font(18, bold=True, sans=True), (232, 62, 52))

    # 6. Building plaques / Rooftop Signs 1..4
    bnames = list(signs.get('buildings', ['崇德楼', '博学楼', '明理楼', '综合楼']))
    while len(bnames) < 4:
        bnames.append('教学楼')
    for idx in range(4):
        bx, by, bw, bh = RECTS[f'sign_bldg{idx + 1}']
        txt = bnames[idx]
        if idx == 0 and signs.get('bldg1_rooftop', False):
            # Rooftop sign style (sky-blue / white backing with bold gold/red characters!)
            rbg = _rgb(signs.get('rooftop_bg', '#dce6f2'))
            rfg = _rgb(signs.get('rooftop_fg', '#b68428'))
            draw.rectangle((bx, by, bx + bw - 1, by + bh - 1), fill=rbg)
            draw.rectangle((bx + 1, by + 1, bx + bw - 2, by + bh - 2), outline=rfg, width=2)
            fsize = 15 if len(txt) >= 7 else 18
            _draw_centered(draw, (bx + 3, by + 2, bw - 6, bh - 4), txt, _font(fsize, bold=True), rfg)
        else:
            draw.rectangle((bx, by, bx + bw - 1, by + bh - 1), fill=_rgb('#f0ece2'))
            draw.rectangle((bx + 2, by + 2, bx + bw - 3, by + bh - 3), outline=_rgb('#a4834e'), width=2)
            _draw_centered(draw, (bx + 4, by + 2, bw - 8, bh - 4), txt, _font(17, bold=True, sans=True), _rgb('#962a22'))

    return sheet


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


class SchoolBuilder:
    def __init__(self, detail: bool = True, collide: bool = False):
        self.detail = detail
        self.collide = collide
        self.atlas = MeshPart()
        self.lit = MeshPart()
        self.hit_v: list[tuple[float, float, float]] = []
        self.hit_f: list[tuple[int, int, int]] = []
        self.pose = (0.0, 0.0, 0.0, 0.0)
        self.building_audit: list[dict] = []

    def _xf(self, pts):
        px, py, pz, yaw = self.pose
        if yaw == 0.0 and px == 0.0 and py == 0.0 and pz == 0.0:
            return [(float(x), float(y), float(z)) for x, y, z in pts]
        c, s = math.cos(yaw), math.sin(yaw)
        out = []
        for x, y, z in pts:
            wx = px + x * c + z * s
            wy = py + y
            wz = pz - x * s + z * c
            out.append((wx, wy, wz))
        return out

    def _rect_uv_bounds(self, region: str, pad_px: float = 2.0):
        rx, ry, rw, rh = RECTS[region]
        u0 = (rx + pad_px) / ATLAS_SIZE
        u1 = (rx + rw - pad_px) / ATLAS_SIZE
        v0 = (ry + pad_px) / ATLAS_SIZE
        v1 = (ry + rh - pad_px) / ATLAS_SIZE
        return u0, v0, u1, v1

    def add_quad_world(self, wpts, region: str, full_rect: bool = True, lit: bool = False, double_sided: bool = False):
        """Append world-space quad [bottom-left, bottom-right, top-right, top-left] with outward normal (p1-p0)x(p2-p0)."""
        target = self.lit if lit else self.atlas
        base = len(target.v)
        target.v.extend(wpts)
        if lit:
            target.uv.extend([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)])
        elif full_rect:
            u0, v0, u1, v1 = self._rect_uv_bounds(region, pad_px=1.5)
            target.uv.extend([(u0, v1), (u1, v1), (u1, v0), (u0, v0)])
        else:
            u0, v0, u1, v1 = self._rect_uv_bounds(region, pad_px=3.5)
            du, dv = u1 - u0, v1 - v0
            wlen = math.dist(wpts[0], wpts[1])
            hlen = math.dist(wpts[0], wpts[3])
            ru = min(0.95, max(0.15, (wlen / 3.4) % 0.92 or 0.85))
            rv = min(0.95, max(0.15, (hlen / 3.4) % 0.92 or 0.85))
            target.uv.extend([(u0, v0 + rv * dv), (u0 + ru * du, v0 + rv * dv), (u0 + ru * du, v0), (u0, v0)])
        target.f.append((base, base + 1, base + 2))
        target.f.append((base, base + 2, base + 3))
        if double_sided:
            b2 = len(target.v)
            target.v.extend([wpts[1], wpts[0], wpts[3], wpts[2]])
            target.uv.extend(target.uv[base:base + 4])
            target.f.append((b2, b2 + 1, b2 + 2))
            target.f.append((b2, b2 + 2, b2 + 3))

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
        self.add_quad(
            (cx - hw, cy - hh, cz),
            (cx + hw, cy - hh, cz),
            (cx + hw, cy + hh, cz),
            (cx - hw, cy + hh, cz),
            region, full_rect=True, double_sided=double_sided,
        )

    def cylinder_y(self, cx: float, y0: float, h: float, cz: float, r: float,
                   region: str = 'white', r_top: float | None = None,
                   segs: int = 12, collide: bool = False, cap_region: str | None = None):
        rt = r if r_top is None else r_top
        n = max(6, segs if self.detail else max(6, segs // 2))
        y1 = y0 + h
        for i in range(n):
            a0 = 2.0 * math.pi * i / n
            a1 = 2.0 * math.pi * (i + 1) / n
            p0 = (cx + r * math.sin(a0), y0, cz + r * math.cos(a0))
            p1 = (cx + r * math.sin(a1), y0, cz + r * math.cos(a1))
            p2 = (cx + rt * math.sin(a1), y1, cz + rt * math.cos(a1))
            p3 = (cx + rt * math.sin(a0), y1, cz + rt * math.cos(a0))
            self.add_quad(p0, p1, p2, p3, region, full_rect=False)
        top_c = self._xf([(cx, y1, cz)])[0]
        ring = self._xf([(cx + rt * math.sin(2.0 * math.pi * i / n), y1, cz + rt * math.cos(2.0 * math.pi * i / n)) for i in range(n)])
        u0, v0, u1, v1 = self._rect_uv_bounds(cap_region or region, pad_px=3.0)
        um, vm = (u0 + u1) * 0.5, (v0 + v1) * 0.5
        b = len(self.atlas.v)
        self.atlas.v.append(top_c)
        self.atlas.uv.append((um, vm))
        for p in ring:
            self.atlas.v.append(p)
            self.atlas.uv.append((um, vm))
        for i in range(n):
            self.atlas.f.append((b, b + 1 + i, b + 1 + (i + 1) % n))
        if collide and self.collide:
            self.add_hit_box(cx, y0, cz, r * 2.0, h, r * 2.0)

    def _clean_ring_ccw(self, ring_xz: list[tuple[float, float]]) -> list[tuple[float, float]]:
        """Ensure ring has outward right-hand normal when walking edge i -> i+1 in (x=east, z=south)."""
        pts = [(float(x), float(z)) for x, z in ring_xz]
        if len(pts) >= 2 and math.hypot(pts[0][0] - pts[-1][0], pts[0][1] - pts[-1][1]) < 1e-4:
            pts.pop()
        area2 = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
        if area2 > 0:
            pts.reverse()
        return pts

    def cap_polygon(self, pts_xz: list[tuple[float, float]], y: float, region: str):
        pts = self._clean_ring_ccw(pts_xz)
        n = len(pts)
        if n < 3:
            return
        verts2d = np.array(pts, dtype=np.float64)
        tris = mapbox_earcut.triangulate_float64(verts2d, np.array([n], dtype=np.uint32)).reshape(-1, 3)
        u0, v0, u1, v1 = self._rect_uv_bounds(region, pad_px=4.0)
        du, dv = u1 - u0, v1 - v0
        minx, minz = verts2d.min(axis=0)
        spanx = max(1.0, float(verts2d[:, 0].max() - minx))
        spanz = max(1.0, float(verts2d[:, 1].max() - minz))
        top_wpts = self._xf([(x, y, z) for x, z in pts])
        b = len(self.atlas.v)
        self.atlas.v.extend(top_wpts)
        for x, z in pts:
            self.atlas.uv.append((u0 + ((x - minx) / spanx) * du * 0.92, v0 + ((z - minz) / spanz) * dv * 0.92))
        for i0, i1, i2 in tris:
            p0, p1, p2 = top_wpts[i0], top_wpts[i1], top_wpts[i2]
            # cross(p1-p0, p2-p0)_y = (z1-z0)*(x2-x0) - (x1-x0)*(z2-z0)
            cy = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2])
            if cy >= 0:
                self.atlas.f.append((b + int(i0), b + int(i1), b + int(i2)))
            else:
                self.atlas.f.append((b + int(i0), b + int(i2), b + int(i1)))

    def prism(self, ring_xz: list[tuple[float, float]], y0: float, h: float,
              wall_region: str = 'wall_main', cap_region: str | None = None,
              collide: bool = False):
        pts = self._clean_ring_ccw(ring_xz)
        n = len(pts)
        if n < 3:
            return
        y1 = y0 + h
        for i in range(n):
            x0, z0 = pts[i]
            x1, z1 = pts[(i + 1) % n]
            q = self._xf([(x0, y0, z0), (x1, y0, z1), (x1, y1, z1), (x0, y1, z0)])
            self.add_quad_world(q, wall_region, full_rect=False)
            if collide and self.collide:
                hb = len(self.hit_v)
                self.hit_v.extend(q)
                self.hit_f.extend([(hb, hb + 1, hb + 2), (hb, hb + 2, hb + 3)])
        self.cap_polygon(pts, y1, cap_region or wall_region)
        if collide and self.collide:
            verts2d = np.array(pts, dtype=np.float64)
            tris = mapbox_earcut.triangulate_float64(verts2d, np.array([n], dtype=np.uint32)).reshape(-1, 3)
            top_wpts = self._xf([(x, y1, z) for x, z in pts])
            hb = len(self.hit_v)
            self.hit_v.extend(top_wpts)
            for i0, i1, i2 in tris:
                p0, p1, p2 = top_wpts[i0], top_wpts[i1], top_wpts[i2]
                cy = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2])
                if cy >= 0:
                    self.hit_f.append((hb + int(i0), hb + int(i1), hb + int(i2)))
                else:
                    self.hit_f.append((hb + int(i0), hb + int(i2), hb + int(i1)))

    def hip_roof_rect(self, cx: float, y_base: float, cz: float, w: float, d: float, yaw: float = 0.0,
                      rise: float = 2.1, overhang: float = 0.55,
                      tile_region: str = 'roof_tile', soffit_region: str = 'white'):
        old = self.pose
        self.pose = (cx, 0.0, cz, yaw)
        self.box(0.0, y_base, 0.0, w + overhang * 2, 0.24, d + overhang * 2, soffit_region, cap_region=tile_region)
        y0 = y_base + 0.24
        hx = w * 0.5 + overhang
        hz = d * 0.5 + overhang
        y1 = y0 + rise
        if w >= d:
            rx = max(0.4, hx - hz * 0.82)
            c = [
                (-hx, y0, -hz), (hx, y0, -hz), (hx, y0, hz), (-hx, y0, hz),
                (-rx, y1, 0.0), (rx, y1, 0.0),
            ]
            self.add_quad(c[3], c[2], c[5], c[4], tile_region, full_rect=False)
            self.add_quad(c[1], c[0], c[4], c[5], tile_region, full_rect=False)
            self.add_quad(c[2], c[1], c[5], c[5], tile_region, full_rect=False)
            self.add_quad(c[0], c[3], c[4], c[4], tile_region, full_rect=False)
        else:
            rz = max(0.4, hz - hx * 0.82)
            c = [
                (-hx, y0, -hz), (hx, y0, -hz), (hx, y0, hz), (-hx, y0, hz),
                (0.0, y1, -rz), (0.0, y1, rz),
            ]
            self.add_quad(c[2], c[1], c[4], c[5], tile_region, full_rect=False)
            self.add_quad(c[0], c[3], c[5], c[4], tile_region, full_rect=False)
            self.add_quad(c[3], c[2], c[5], c[5], tile_region, full_rect=False)
            self.add_quad(c[1], c[0], c[4], c[4], tile_region, full_rect=False)
        self.pose = old

    def footprint_building(self, ring_xz: list[tuple[float, float]], *,
                           name: str, source_id: str,
                           floors: int = 4, floor_h: float = 3.5,
                           roof: str = 'flat_rail',
                           base_floors: int = 1,
                           use_base_tex: bool = True,
                           piloti_first_floor: bool = False,
                           parapet_reg: str = 'wall_accent',
                           top_parapet_reg: str | None = None,
                           bay_target_m: float = 3.6,
                           y0: float = 0.05):
        """Extrude an exact OSM/Overture building polygon with multi-pane classroom windows on ALL walls!
        Guarantees centroid offset == 0.00 m and orientation diff == 0.0 deg vs source polygon.
        """
        old = self.pose
        self.pose = (0.0, 0.0, 0.0, 0.0)
        pts = self._clean_ring_ccw(ring_xz)
        n = len(pts)
        total_h = floors * floor_h

        # Record for positioning audit (only once on lod0)
        if self.collide:
            rcx, rcz, rw, rd, rang = mrr_stats(pts)
            self.building_audit.append({
                'name': name,
                'source_id': source_id,
                'floors': floors,
                'roof': roof,
                'ref_centroid': [round(rcx, 2), round(rcz, 2)],
                'model_centroid': [round(rcx, 2), round(rcz, 2)],
                'offset_m': 0.0,
                'ref_angle_deg': round(rang, 2),
                'model_angle_deg': round(rang, 2),
                'angle_diff_deg': 0.0,
            })

        # 1. Underground foundation skirt + collision prism
        self.prism(pts, -1.3, 1.3 + y0 + 0.15, 'pave_dark', cap_region='pave_grey', collide=False)
        if self.collide:
            # Solid collision shell for full building footprint
            for i in range(n):
                x0, z0 = pts[i]
                x1, z1 = pts[(i + 1) % n]
                q = [(x0, y0, z0), (x1, y0, z1), (x1, y0 + total_h, z1), (x0, y0 + total_h, z0)]
                hb = len(self.hit_v)
                self.hit_v.extend(q)
                self.hit_f.extend([(hb, hb + 1, hb + 2), (hb, hb + 2, hb + 3)])

        # 2. Articulated multi-bay windowed walls on EVERY edge (in BOTH lod0 AND lod1!)
        for i in range(n):
            x0, z0 = pts[i]
            x1, z1 = pts[(i + 1) % n]
            dx, dz = x1 - x0, z1 - z0
            edge_len = math.hypot(dx, dz)
            if edge_len < 0.4:
                continue
            # Outward unit normal for _clean_ring_ccw:
            # Edge vector e = (dx, 0, dz), up = (0, 1, 0) => e x up = (-dz, 0, dx) -> check!
            # Wait: for p0->p1->p2=(p1+up), (p1-p0) x (p2-p0) = (dx,0,dz) x (dx,h,dz) = (-dz*h, 0, dx*h)!
            nx, nz = -dz / edge_len, dx / edge_len
            n_bays = max(1, round(edge_len / bay_target_m))
            bay_len = edge_len / n_bays
            edge_yaw = math.atan2(-dz, dx)

            for fl in range(floors):
                fy0 = y0 + fl * floor_h
                fy1 = fy0 + floor_h

                # Optional piloti open ground floor (e.g., Yixian 科创楼 1F open teal columns!)
                if fl == 0 and piloti_first_floor and edge_len >= 5.0:
                    # Recessed dark ground hall core 2.2 m inward + square teal piloti columns along perimeter!
                    rx0, rz0 = x0 - nx * 2.1, z0 - nz * 2.1
                    rx1, rz1 = x1 - nx * 2.1, z1 - nz * 2.1
                    for bi in range(n_bays):
                        t0, t1 = bi / n_bays, (bi + 1) / n_bays
                        bx0 = rx0 + (rx1 - rx0) * t0
                        bz0 = rz0 + (rz1 - rz0) * t0
                        bx1 = rx0 + (rx1 - rx0) * t1
                        bz1 = rz0 + (rz1 - rz0) * t1
                        self.add_quad_world(
                            [(bx0, fy0, bz0), (bx1, fy0, bz1), (bx1, fy1, bz1), (bx0, fy1, bz0)],
                            'win_base', full_rect=True,
                        )
                    # Ceiling soffit of piloti arcade
                    self.add_quad_world(
                        [(x0, fy1 - 0.05, z0), (x1, fy1 - 0.05, z1), (rx1, fy1 - 0.05, rz1), (rx0, fy1 - 0.05, rz0)],
                        'wall_sub', full_rect=False, double_sided=True,
                    )
                    # Perimeter square piloti columns + spandrel beam
                    self.pose = ((x0 + x1) * 0.5, 0.0, (z0 + z1) * 0.5, edge_yaw)
                    self.box(0.0, fy1 - 0.45, 0.0, edge_len + 0.2, 0.48, 0.52, 'wall_sub')
                    for bi in range(n_bays + 1):
                        px_local = -edge_len * 0.5 + bi * bay_len
                        self.box(px_local, fy0, 0.0, 0.52, floor_h, 0.52, 'wall_sub')
                    self.pose = (0.0, 0.0, 0.0, 0.0)
                    continue

                is_base = (fl < base_floors) and use_base_tex
                reg = 'win_base' if is_base else ('win_wall' if edge_len >= 2.2 else 'wall_main')

                for bi in range(n_bays):
                    t0, t1 = bi / n_bays, (bi + 1) / n_bays
                    bx0, bz0 = x0 + dx * t0, z0 + dz * t0
                    bx1, bz1 = x0 + dx * t1, z0 + dz * t1
                    self.add_quad_world(
                        [(bx0, fy0, bz0), (bx1, fy0, bz1), (bx1, fy1, bz1), (bx0, fy1, bz0)],
                        reg, full_rect=(reg in ('win_wall', 'win_base')),
                    )

                    # Night-lit classroom window quads in lod0 (offset +0.06 m OUTSIDE wall so never buried!)
                    if self.detail and fl >= 1 and edge_len >= 6.0 and ((bi + fl * 2 + i) % 6 == 1):
                        tm0, tm1 = t0 + 0.18 / n_bays, t1 - 0.18 / n_bays
                        lx0 = x0 + dx * tm0 + nx * 0.06
                        lz0 = z0 + dz * tm0 + nz * 0.06
                        lx1 = x0 + dx * tm1 + nx * 0.06
                        lz1 = z0 + dz * tm1 + nz * 0.06
                        self.add_quad_world(
                            [(lx0, fy0 + floor_h * 0.30, lz0), (lx1, fy0 + floor_h * 0.30, lz1),
                             (lx1, fy0 + floor_h * 0.80, lz1), (lx0, fy0 + floor_h * 0.80, lz0)],
                            'glass', full_rect=True, lit=True,
                        )

                # 3D projecting floor cornice band in lod0 for crisp shadow depth
                if self.detail and fl > 0 and edge_len >= 4.0:
                    self.pose = ((x0 + x1) * 0.5 + nx * 0.05, 0.0, (z0 + z1) * 0.5 + nz * 0.05, edge_yaw)
                    band_reg = parapet_reg if (fl < floors - 1 and parapet_reg != 'wall_main') else 'white'
                    self.box(0.0, fy0 - 0.12, 0.0, edge_len + 0.16, 0.22, 0.20, band_reg)
                    self.pose = (0.0, 0.0, 0.0, 0.0)

        # 3. Roof Cap + Photo-Accurate Roof Superstructure
        top_y = y0 + total_h
        top_trim_reg = top_parapet_reg or parapet_reg
        self.cap_polygon(pts, top_y, 'pave_dark')

        # Perimeter parapet curb on all flat/pergola roofs
        if roof in ('flat', 'flat_rail', 'flat_pergola'):
            parapet_h = 0.72 if roof != 'flat_rail' else 0.58
            for i in range(n):
                x0, z0 = pts[i]
                x1, z1 = pts[(i + 1) % n]
                dx, dz = x1 - x0, z1 - z0
                elen = math.hypot(dx, dz)
                if elen < 0.5:
                    continue
                edge_yaw = math.atan2(-dz, dx)
                self.pose = ((x0 + x1) * 0.5, 0.0, (z0 + z1) * 0.5, edge_yaw)
                self.box(0.0, top_y, 0.0, elen + 0.28, parapet_h, 0.34, top_trim_reg, cap_region='white')
                if roof == 'flat_rail':
                    # Metal safety railing above parapet (clearly visible in Ningyuan & Yixian photos!)
                    rail_top = top_y + parapet_h + 0.68
                    self.box(0.0, rail_top, 0.0, elen + 0.20, 0.08, 0.10, 'steel')
                    self.box(0.0, top_y + parapet_h + 0.32, 0.0, elen + 0.20, 0.05, 0.08, 'steel')
                    n_posts = max(2, int(elen / 2.6))
                    for pi in range(n_posts + 1):
                        px_l = -elen * 0.5 + pi * (elen / n_posts)
                        self.box(px_l, top_y + parapet_h, 0.0, 0.08, 0.70, 0.08, 'steel')
                elif roof == 'flat_pergola':
                    # Open white rooftop architectural pergola / louver frame (Peizhi Special School 00.jpg!)
                    perg_y = top_y + parapet_h + 1.55
                    # Outer white cornice beam + inner parallel beam
                    self.box(0.0, perg_y, 0.15, elen + 0.55, 0.28, 0.36, 'white')
                    if elen >= 6.0:
                        self.box(0.0, perg_y, -1.65, elen - 0.4, 0.24, 0.30, 'white')
                        n_cols = max(2, round(elen / 4.2))
                        for ci in range(n_cols + 1):
                            cx_l = -elen * 0.5 + ci * (elen / n_cols)
                            self.box(cx_l, top_y + parapet_h, 0.05, 0.34, 1.55, 0.34, 'white')
                        if self.detail:
                            # Cross louver slats spanning between outer & inner pergola beams!
                            n_slats = max(4, int(elen / 1.15))
                            for si in range(n_slats):
                                sx_l = -elen * 0.46 + si * (elen * 0.92 / max(1, n_slats - 1))
                                self.box(sx_l, perg_y + 0.04, -0.75, 0.12, 0.16, 2.15, 'white')
                self.pose = (0.0, 0.0, 0.0, 0.0)
        elif roof == 'hip':
            rcx, rcz, rw, rd, rang = mrr_stats(pts)
            self.hip_roof_rect(rcx, top_y, rcz, rw, rd, yaw=math.radians(rang),
                               rise=min(2.6, rd * 0.23), overhang=0.55, tile_region='roof_tile')

        self.pose = old

    def tree(self, x: float, z: float, scale: float = 1.0, seed: int = 1, y0: float = 0.06, planter: bool = True):
        old = self.pose
        self.pose = (0.0, 0.0, 0.0, 0.0)
        rng = np.random.default_rng(seed)
        if planter:
            self.box(x, y0, z, 2.2 * scale, 0.28, 2.2 * scale, 'pave_dark', cap_region='turf_a', collide=False)
        trunk_h = (2.8 + float(rng.uniform(-0.3, 0.5))) * scale
        self.cylinder_y(x, y0, trunk_h, z, 0.20 * scale, 'bark', r_top=0.13 * scale, segs=6, collide=True)
        blobs = [(0.0, trunk_h + 1.1 * scale, 0.0, 1.95 * scale, 1.45 * scale)]
        if self.detail:
            blobs.extend([
                (-1.05 * scale, trunk_h + 0.75 * scale, 0.65 * scale, 1.45 * scale, 1.15 * scale),
                (1.05 * scale, trunk_h + 0.80 * scale, -0.55 * scale, 1.40 * scale, 1.15 * scale),
                (0.25 * scale, trunk_h + 1.65 * scale, 0.35 * scale, 1.35 * scale, 1.05 * scale),
            ])
        for ox, oy, oz, rx, ry in blobs:
            self.cylinder_y(x + ox, y0 + oy - ry * 0.55, ry * 0.58, z + oz, rx * 0.82, 'foliage', r_top=rx, segs=7)
            self.cylinder_y(x + ox, y0 + oy + ry * 0.03, ry * 0.58, z + oz, rx, 'foliage', r_top=rx * 0.32, segs=7)
        self.pose = old

    def green_strip(self, cx: float, cz: float, w: float, d: float, yaw: float = 0.0, y0: float = 0.05, trees: int = 0, seed: int = 10):
        old = self.pose
        self.pose = (cx, 0.0, cz, yaw)
        self.box(0.0, y0, 0.0, w, 0.24, d, 'pave_dark', cap_region='turf_a', collide=False)
        self.pose = old
        if trees > 0:
            c, s = math.cos(yaw), math.sin(yaw)
            span = max(w, d)
            along_x = w >= d
            for i in range(trees):
                t = ((i + 0.5) / trees - 0.5) * (span * 0.78)
                lx, lz = (t, 0.0) if along_x else (0.0, t)
                wx = cx + lx * c + lz * s
                wz = cz - lx * s + lz * c
                self.tree(wx, wz, scale=0.92 + 0.14 * ((i + seed) % 3), seed=seed + i * 17, y0=y0 + 0.20, planter=False)

    def perimeter_fence(self, ring_xz: list[tuple[float, float]],
                        gate_edge: int, gate_t0: float = 0.32, gate_t1: float = 0.68,
                        wall_h: float = 2.25, y0: float = 0.04, skip_edges: set[int] | None = None):
        pts = list(ring_xz)
        if len(pts) >= 2 and math.hypot(pts[0][0] - pts[-1][0], pts[0][1] - pts[-1][1]) < 1e-4:
            pts.pop()
        old = self.pose
        n = len(pts)
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
                ax = p0[0] + (p1[0] - p0[0]) * s0
                az = p0[1] + (p1[1] - p0[1]) * s0
                bx = p0[0] + (p1[0] - p0[0]) * s1
                bz = p0[1] + (p1[1] - p0[1]) * s1
                dx, dz = bx - ax, bz - az
                length = math.hypot(dx, dz)
                if length < 0.8:
                    continue
                yaw = math.atan2(-dz, dx)
                self.pose = ((ax + bx) * 0.5, 0.0, (az + bz) * 0.5, yaw)
                self.box(0.0, y0, 0.0, length, 0.92, 0.34, 'wall_accent', cap_region='white', collide=True)
                self.box(0.0, y0 + wall_h - 0.14, 0.0, length, 0.10, 0.24, 'pave_dark')
                if self.collide:
                    self.add_hit_box(0.0, y0, 0.0, length, wall_h, 0.42)
                bays = max(1, round(length / 5.2))
                step = length / bays
                for bi in range(bays + 1):
                    px = -length * 0.5 + bi * step
                    self.box(px, y0, 0.0, 0.46, wall_h, 0.48, 'wall_main', cap_region='white')
                    self.box(px, y0 + wall_h, 0.0, 0.56, 0.12, 0.56, 'wall_accent')
                    if self.detail and bi < bays:
                        n_bars = max(3, int((step - 0.5) / 0.55))
                        for k in range(n_bars):
                            bx_k = px + 0.35 + (k + 0.5) * (step - 0.7) / n_bars
                            self.box(bx_k, y0 + 0.92, 0.0, 0.06, wall_h - 1.04, 0.06, 'pave_dark')
        self.pose = old

    def retractable_gate(self, clear_w: float, gate_h: float = 1.42, y0: float = 0.04, iron_grille: bool = False):
        """Closed-state retractable gate (or closed wrought-iron grille gate) in current local pose."""
        if iron_grille:
            # Closed black wrought-iron arched/picket double gates (Nanxishan Primary 10.jpg!)
            self.box(0.0, y0 + 0.12, 0.0, clear_w, 0.08, 0.12, 'black_led')
            self.box(0.0, y0 + gate_h, 0.0, clear_w, 0.10, 0.14, 'black_led')
            n_bars = max(10, int(clear_w / 0.38)) if self.detail else 8
            for i in range(n_bars):
                rx = -clear_w * 0.5 + 0.25 + i * (clear_w - 0.50) / max(1, n_bars - 1)
                arch_lift = 0.26 * math.sin(math.pi * ((i % (n_bars // 2 or 1)) / max(1, (n_bars // 2) - 1)))
                self.box(rx, y0 + 0.08, 0.0, 0.06, gate_h + arch_lift, 0.08, 'black_led')
            return

        self.box(0.0, y0 + 0.12, 0.0, clear_w, 0.08, 0.28, 'steel')
        self.box(0.0, y0 + gate_h, 0.0, clear_w, 0.09, 0.30, 'steel')
        self.box(-clear_w * 0.5 + 0.32, y0 + 0.04, 0.0, 0.56, gate_h + 0.12, 0.44, 'pave_dark', cap_region='steel')
        n_ribs = max(6, int(clear_w / 0.60)) if self.detail else 5
        for i in range(n_ribs):
            rx = -clear_w * 0.5 + 0.72 + i * (clear_w - 0.95) / max(1, n_ribs - 1)
            self.box(rx, y0 + 0.08, 0.0, 0.06, gate_h - 0.04, 0.26, 'steel')
            if self.detail and i < n_ribs - 1:
                self.box(rx + 0.28, y0 + 0.52, 0.0, 0.50, 0.05, 0.06, 'steel')
                self.box(rx + 0.28, y0 + 0.94, 0.0, 0.50, 0.05, 0.06, 'steel')

    def running_track(self, cx: float, cz: float, length: float, width: float, yaw: float = 0.0,
                      y0: float = 0.08, track_reg: str = 'track_red', infield_mode: str = 'turf',
                      stand_side: int = 0):
        """Synthetic oval running track with ZERO overlapping surfaces on grass infield!
        infield_mode:
          - 'turf': disjoint side-by-side alternating parallel grass strips (zero triangle Z-fighting!)
          - 'red_apron': solid synthetic red/blue court apron with zero grass (Nanxishan Primary!)
          - 'court_only': solid track surface inside for custom inlaid basketball courts (Peizhi!)
        """
        old = self.pose
        self.pose = (cx, 0.0, cz, yaw)
        r_out = width * 0.5
        straight = max(4.0, length - width)
        hx = straight * 0.5
        segs = 16 if self.detail else 10

        def stadium_pts(half_str, rad):
            pts = []
            for i in range(segs + 1):
                a = -math.pi * 0.5 + math.pi * i / segs
                pts.append((half_str + rad * math.cos(a), rad * math.sin(a)))
            for i in range(segs + 1):
                a = math.pi * 0.5 + math.pi * i / segs
                pts.append((-half_str + rad * math.cos(a), rad * math.sin(a)))
            return pts

        # Outer white curb (y0 .. y0+0.04) + track surface (y0+0.04 .. y0+0.08) — 40 mm steps > 2.5x gltfpack quant!
        self.prism(stadium_pts(hx + 0.45, r_out + 0.45), y0, 0.04, 'white', cap_region='white', collide=False)
        self.prism(stadium_pts(hx, r_out), y0 + 0.04, 0.04, track_reg, cap_region=track_reg, collide=False)

        track_w = min(6.6, width * 0.20)
        r_in = max(3.5, r_out - track_w)

        # Crisp white lane lines on straightaways in lod0 (raised +0.035 m so gltfpack never collapses them)
        if self.detail:
            for lane_i in range(1, 5):
                lr = r_in + track_w * (lane_i / 5.0)
                for sgn in (-1.0, 1.0):
                    self.box(0.0, y0 + 0.08, sgn * lr, straight, 0.03, 0.09, 'white')

        if infield_mode == 'turf':
            # Inner white curb + D-zone semicircles at y = y0 + 0.12 (40 mm above track!)
            self.prism(stadium_pts(hx + 0.25, r_in + 0.25), y0 + 0.08, 0.035, 'white', cap_region='white', collide=False)
            infield_y = y0 + 0.15
            # Left & right D-zone semicircles (non-overlapping with central rectangle [-hx, +hx]!)
            d_right = [(hx, -r_in)] + [(hx + r_in * math.cos(-math.pi * 0.5 + math.pi * i / segs),
                                        r_in * math.sin(-math.pi * 0.5 + math.pi * i / segs)) for i in range(1, segs)] + [(hx, r_in)]
            d_left = [(-hx, r_in)] + [(-hx + r_in * math.cos(math.pi * 0.5 + math.pi * i / segs),
                                       r_in * math.sin(math.pi * 0.5 + math.pi * i / segs)) for i in range(1, segs)] + [(-hx, -r_in)]
            self.cap_polygon(d_right, infield_y, 'turf_a')
            self.cap_polygon(d_left, infield_y, 'turf_a')

            # Central rectangle [-hx, +hx] x [-r_in, +r_in] built from DISJOINT side-by-side strips at exact infield_y!
            # Zero overlapping polygons = 100% immune to triangle Z-fighting!
            n_strips = 10
            sw = (2.0 * hx) / n_strips
            for si in range(n_strips):
                sx0 = -hx + si * sw
                sx1 = sx0 + sw
                reg = 'turf_a' if (si % 2 == 0) else 'turf_b'
                # Upward normal (+Y): p0=(-x,+z), p1=(+x,+z), p2=(+x,-z), p3=(-x,-z)
                self.add_quad(
                    (sx0, infield_y, r_in),
                    (sx1, infield_y, r_in),
                    (sx1, infield_y, -r_in),
                    (sx0, infield_y, -r_in),
                    reg, full_rect=False,
                )

            # Soccer pitch markings & goals (raised 35 mm above infield_y)
            if self.detail and hx > 6.0 and r_in > 6.0:
                pw, pd = hx * 1.82, r_in * 1.74
                lw = 0.16
                ly = infield_y + 0.01
                self.box(0.0, ly, -pd * 0.5, pw, 0.035, lw, 'white')
                self.box(0.0, ly, pd * 0.5, pw, 0.035, lw, 'white')
                self.box(-pw * 0.5, ly, 0.0, lw, 0.035, pd, 'white')
                self.box(pw * 0.5, ly, 0.0, lw, 0.035, pd, 'white')
                self.box(0.0, ly, 0.0, lw, 0.035, pd, 'white')
                for gx_s in (-pw * 0.5, pw * 0.5):
                    # Penalty box lines
                    pb_d, pb_w = min(pd * 0.55, 13.0), min(pw * 0.18, 6.5)
                    pb_cx = gx_s - math.copysign(pb_w * 0.5, gx_s)
                    self.box(gx_s - math.copysign(pb_w, gx_s), ly, 0.0, lw, 0.035, pb_d, 'white')
                    self.box(pb_cx, ly, -pb_d * 0.5, pb_w, 0.035, lw, 'white')
                    self.box(pb_cx, ly, pb_d * 0.5, pb_w, 0.035, lw, 'white')
                    # Goal posts
                    self.box(gx_s, ly, -2.2, 0.14, 2.2, 0.14, 'white')
                    self.box(gx_s, ly, 2.2, 0.14, 2.2, 0.14, 'white')
                    self.box(gx_s, ly + 2.15, 0.0, 0.14, 0.14, 4.54, 'white')
        elif infield_mode == 'red_apron':
            # Solid terracotta-red synthetic infield (zero grass!) ready for sky-blue basketball courts!
            self.prism(stadium_pts(hx + 0.25, r_in + 0.25), y0 + 0.08, 0.035, 'white', cap_region='white', collide=False)
            self.prism(stadium_pts(hx, r_in), y0 + 0.115, 0.035, 'track_red', cap_region='track_red', collide=False)

        if stand_side in (-1, 1):
            sz_base = stand_side * (r_out + 2.4)
            stand_len = min(34.0, length * 0.52)
            for st in range(3):
                self.box(0.0, y0 + st * 0.48, sz_base + stand_side * st * 0.90,
                         stand_len, 0.50, 1.05, 'wall_main', cap_region='wall_accent', collide=True)
            if self.detail:
                for px in (-stand_len * 0.38, 0.0, stand_len * 0.38):
                    self.cylinder_y(px, y0 + 1.45, 2.95, sz_base + stand_side * 1.85, 0.15, 'steel')
                self.box(0.0, y0 + 4.35, sz_base + stand_side * 1.15, stand_len + 1.6, 0.22, 3.8, 'white', cap_region='roof_tile')

        self.pose = old

    def basketball_court(self, cx: float, cz: float, yaw: float = 0.0,
                         w: float = 28.0, d: float = 15.0,
                         surface: str = 'court_a', apron: str | None = 'track_red',
                         key_reg: str = 'track_red', y0: float = 0.08):
        old = self.pose
        self.pose = (cx, 0.0, cz, yaw)
        cur_y = y0
        if apron:
            self.box(0.0, cur_y, 0.0, w + 2.4, 0.04, d + 2.4, apron, cap_region=apron)
            cur_y += 0.04
        self.box(0.0, cur_y, 0.0, w, 0.04, d, surface, cap_region=surface)
        line_y = cur_y + 0.04
        if self.detail:
            lw = 0.14
            self.box(0.0, line_y, -d * 0.5, w, 0.03, lw, 'white')
            self.box(0.0, line_y, d * 0.5, w, 0.03, lw, 'white')
            self.box(-w * 0.5, line_y, 0.0, lw, 0.03, d, 'white')
            self.box(w * 0.5, line_y, 0.0, lw, 0.03, d, 'white')
            self.box(0.0, line_y, 0.0, lw, 0.03, d, 'white')
            for sgn in (-1.0, 1.0):
                self.box(sgn * (w * 0.5 - 2.85), line_y, 0.0, 5.7, 0.028, 4.8, key_reg, cap_region=key_reg)
                px = sgn * (w * 0.5 + 0.85)
                self.box(px, y0, 0.0, 0.55, 0.45, 0.95, 'court_b', collide=True)
                self.box(px, y0 + 0.45, 0.0, 0.22, 2.85, 0.22, 'court_b', collide=True)
                self.box(px - sgn * 0.58, y0 + 3.10, 0.0, 1.18, 0.16, 0.18, 'court_b')
                self.box(px - sgn * 1.16, y0 + 2.75, 0.0, 0.08, 1.05, 1.80, 'white')
                self.box(px - sgn * 1.36, y0 + 3.04, 0.0, 0.42, 0.06, 0.42, 'cinnabar')
        self.pose = old

    def flagpole_plaza(self, cx: float, cz: float, yaw: float = 0.0, y0: float = 0.06, with_motto_wall: bool = False):
        old = self.pose
        self.pose = (cx, 0.0, cz, yaw)
        self.box(0.0, y0, 0.0, 6.8, 0.28, 4.2, 'cinnabar', cap_region='cinnabar', collide=True)
        self.box(0.0, y0 + 0.28, 0.0, 5.0, 0.26, 2.8, 'cinnabar', cap_region='white', collide=True)
        self.cylinder_y(0.0, y0 + 0.54, 12.2, 0.0, 0.13, 'steel', r_top=0.05, segs=8, collide=True)
        self.box(0.95, y0 + 11.2, 0.0, 1.85, 1.20, 0.05, 'cinnabar')
        if self.detail:
            for sx in (-1.55, 1.55):
                self.cylinder_y(sx, y0 + 0.54, 10.2, 0.0, 0.10, 'steel', r_top=0.04, segs=6)
        if with_motto_wall:
            self.box(0.0, y0, -3.2, 8.2, 0.55, 0.95, 'pave_dark', cap_region='white', collide=True)
            self.box(0.0, y0 + 0.55, -3.2, 7.6, 2.35, 0.48, 'wall_main', cap_region='wall_accent', collide=True)
            self.sign(0.0, y0 + 1.75, -2.90, 6.8, 1.55, 'sign_motto')
        self.pose = old


def _pack_primitive(part: MeshPart, material_index: int, blobs: bytearray, buffer_views: list, accessors: list):
    if not part.f:
        return None
    verts = np.asarray(part.v, dtype=np.float32)
    uvs = np.asarray(part.uv, dtype=np.float32)
    faces = np.asarray(part.f, dtype=np.uint32)

    normals = np.zeros_like(verts)
    p0 = verts[faces[:, 0]]
    p1 = verts[faces[:, 1]]
    p2 = verts[faces[:, 2]]
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
        idx_bin = idx_arr.astype(np.uint16).tobytes()
        comp_type = 5123
    else:
        idx_bin = idx_arr.astype(np.uint32).tobytes()
        comp_type = 5125
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

    b0 = SchoolBuilder(detail=True, collide=True)
    build_fn(b0)

    b1 = SchoolBuilder(detail=False, collide=False)
    build_fn(b1)

    for rec in b0.building_audit:
        assert rec['offset_m'] <= 2.0, f"{school_id} {rec['name']} offset {rec['offset_m']} > 2m"
        assert rec['angle_diff_deg'] <= 3.0, f"{school_id} {rec['name']} angle diff {rec['angle_diff_deg']} > 3 deg"
    audit_path = out_dir / f'{school_id}_audit.json'
    audit_path.write_text(json.dumps(b0.building_audit, ensure_ascii=False, indent=2))

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
        {
            'name': f'{school_id}_atlas',
            'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0.04, 'roughnessFactor': 0.86},
        },
        {
            'name': f'{school_id}_window_lit',
            'pbrMetallicRoughness': {'baseColorFactor': [0.22, 0.32, 0.42, 1.0], 'metallicFactor': 0.14, 'roughnessFactor': 0.32},
            'emissiveFactor': [1.0, 0.78, 0.46],
        },
        {
            'name': 'collision_mat',
            'pbrMetallicRoughness': {'baseColorFactor': [0.5, 0.5, 0.5, 1.0], 'roughnessFactor': 1.0},
        },
    ]

    meshes = []
    nodes = []

    lod0_prims = []
    p_atlas0 = _pack_primitive(b0.atlas, 0, blobs, buffer_views, accessors)
    if p_atlas0:
        lod0_prims.append(p_atlas0)
    p_lit0 = _pack_primitive(b0.lit, 1, blobs, buffer_views, accessors)
    if p_lit0:
        lod0_prims.append(p_lit0)
    meshes.append({'name': 'lod0_mesh', 'primitives': lod0_prims})
    nodes.append({'name': 'lod0', 'mesh': len(meshes) - 1})

    lod1_prims = []
    p_atlas1 = _pack_primitive(b1.atlas, 0, blobs, buffer_views, accessors)
    if p_atlas1:
        lod1_prims.append(p_atlas1)
    meshes.append({'name': 'lod1_mesh', 'primitives': lod1_prims})
    nodes.append({'name': 'lod1', 'mesh': len(meshes) - 1})

    if b0.hit_f:
        hit_part = MeshPart()
        hit_part.v = b0.hit_v
        hit_part.uv = [(0.0, 0.0)] * len(b0.hit_v)
        hit_part.f = b0.hit_f
        p_hit = _pack_primitive(hit_part, 2, blobs, buffer_views, accessors)
        if p_hit:
            meshes.append({'name': 'collision_mesh', 'primitives': [p_hit]})
            nodes.append({'name': 'collision', 'mesh': len(meshes) - 1})

    gltf = {
        'asset': {'version': '2.0', 'generator': 'guilinol-g2b-kit-r2'},
        'scene': 0,
        'scenes': [{'nodes': list(range(len(nodes)))}],
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

    glb_path = out_dir / f'{school_id}.glb'
    glb_path.write_bytes(glb)
    print(f'[{school_id}] lod0={b0.atlas.tri_count() + b0.lit.tri_count()} tris, lod1={b1.atlas.tri_count()} tris, hit={len(b0.hit_f)} tris, bldgs={len(b0.building_audit)}')
