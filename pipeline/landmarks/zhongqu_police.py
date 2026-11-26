"""Zhongqu Police Station & Traffic Police Squadron Compound (秀峰榕城派出所与中区交警据点).

Real-world Zhongqu public-security & traffic-police dispatch nexus at Yiren Rd No. 1-4 ×
Libin Rd No. 1-3 (`[110.294645, 25.277825]`, world `(-539.03, 151.61, 240.50)`), directly
linking Central Square, Zhengyang Pedestrian Street / Shangshui Night Market (`IDOK-393`),
Shizijie Crossroads Police Kiosk (`shizijie.py`), Old-Town Moto Patrols (`IDOK-394`), and
Jiefang Bridge West Approach Duty Post (`IDOK-282` / `IDOK-283` / `IDOK-300`).

Calibrated from 2021-2023 Baidu NorthDir street-view panoramas (`/tmp/zhongqu-police-ref/`),
OSM 2026-11 & Overture footprints (set back cleanly behind GL04 motorized `street_kind=0`
carriageways), and Tsinghua CMAB measured heights (`#23826` 17.25 m, `#24340` 9.67 m):
1. Rongcheng Police Station (`桂林市公安局秀峰分局榕城派出所`, Yiren Rd No. 1-4, `way/675586428`):
   - 5-storey (17.25 m) white ceramic-tile institutional building with twin PSB cobalt-blue
     waistbands, stepped central roof pediment + sculpted geometric star-shield emblem,
     2.05 m recessed 1F Yiren Rd colonnade (`6` sidewalk piers clear of central reception
     window and clear of `street_kind=0` asphalt), sealed `(0, -1, 0)` colonnade ceiling
     soffit, `110` lightbox, and south courtyard command entrance.
2. Zhongqu Traffic Police Squadron (`桂林市公安局交警支队·中区执勤中队`, `way/675586430`):
   - 5-storey (15.85 m) stepped L-wing fronting the Yiren Rd × Libin Rd motorized junction,
     brushed-silver ACP & ribbon glazing, sealed 2F arcade soffit, rooftop comms mast,
     corner `桂林交警` duty kiosk, and 6 angled roadside Iron-Cavalry (`交警铁骑`) bays.
3. South Duty Wing (`4f12b2be`, Libin Rd No. 3, 3F 10.7 m), West Fast-Handling & Equipment
   Locker Wing (`8a366675`, 3F 10.8 m, Violence-Scale-A compliant hi-vis vest / whistle /
   cone locker), and 2F EV Cruiser Charging & Dispatch Pavilion (`ca4acda4`).
4. Seamless road-blended courtyard & `8.6 m` Libin Rd dispatch gateway (raised boom barrier,
   guardhouse, slope-conforming yellow cross-hatched `出警通道`, 3 parked standard blue-white
   police cruisers/van with full-UV side liveries + open player/NPC dispatch bays).
"""
from __future__ import annotations

import json
import math
from pathlib import Path
import sys

import mapbox_earcut
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import shapely
from shapely.geometry import LineString, Point, Polygon, box

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from common import ll2xz, xz2ll
from features import polygons
from m26_16_kit import SceneBuilder, export_landmark_glb
from seam_streets import Streets
from world_surface import LandmarkSurface, Surface


LANDMARK_ID = 'zhongqu_police'
ANCHOR_LON, ANCHOR_LAT = 110.294645, 25.277825
ORIGIN_X, ORIGIN_Z = ll2xz(ANCHOR_LAT, ANCHOR_LON)

# Exact local footprints relative to ANCHOR (`[110.294645, 25.277825]`, rotation=0)
# 1. Rongcheng Police Station (`way/675586428`):
#    Upper 2F-5F set back >=0.48 m south of GL04 `street_kind=0` Yiren Rd carriageway (`0.00 m2` road overlap, IoU ~0.80);
#    1F recessed 2.05 m south behind colonnade piers (`6` sidewalk piers, zero central-window obstruction).
B1_1F_PTS = [
    (5.05, 2.63), (6.81, -6.19), (-51.71, -16.95), (-53.35, -8.77),
]
B1_UPPER_PTS = [
    (-51.33, -18.97), (7.19, -8.21), (5.05, 2.63), (-53.35, -8.77),
]

# 2. Zhongqu Traffic Police Squadron (`way/675586430`):
#    Upper 2F-5F set back >=0.35 m behind GL04 `street_kind=0` (`0.00 m2` road overlap, IoU ~0.92);
#    1F recessed 1.55 m along NE/SE street frontages under sealed 2F soffit ceiling.
B2_1F_PTS = [
    (7.95, 2.20), (20.03, 4.63), (6.46, 17.31), (14.38, 25.21),
    (35.55, 3.98), (34.25, 2.68), (21.85, -4.35), (9.90, -7.84),
]
B2_UPPER_PTS = [
    (7.95, 2.20), (20.03, 4.63), (6.46, 17.31), (15.48, 26.31),
    (37.10, 4.93), (35.35, 3.18), (22.34, -5.56), (9.90, -7.84),
]

# 3. South Duty Annex (`Overture 4f12b2be-aec8-4f5d-9418-821acbab7ba9`, Libin Rd No. 3)
B3_SOUTH_PTS = [
    (7.16, 36.89), (-3.84, 25.88), (-9.14, 33.15),
    (-5.74, 37.07), (-10.25, 41.78), (-4.26, 49.54),
]

# 4. West Fast-Handling & Equipment Locker Wing (`Overture 8a366675-15a7-4639-b5e3-fb4abed37cd1`)
B4_WEST_PTS = [
    (-23.46, 23.69), (-20.52, 15.07), (-43.35, 7.28), (-46.28, 15.89),
]

# 5. Courtyard EV Cruiser Charging & Dispatch Pavilion (`Overture ca4acda4-92a9-4f21-97b9-c61e72afd120`)
B5_PAVILION_PTS = [
    (-4.98, 23.35), (-8.21, 18.96), (-13.45, 22.82), (-10.22, 27.19),
]

# Outer courtyard + Yiren Rd colonnade sidewalk + Libin Rd dispatch lane & Iron-Cavalry apron (local XZ)
# Strictly inside street edges & flush with B3 NE corner `(7.16, 36.89)` so zero orphan slivers or cantilevered acute corners occur.
SITE_PAVING_RING = [
    (-53.4, -19.2), (7.6, -8.1), (22.6, -5.6), (37.4, 5.2),
    (16.8, 31.8), (6.9, 36.7), (-3.9, 26.0), (-21.8, 24.2),
    (-45.5, 15.9), (-43.6, 7.1), (-53.5, -8.7),
]
# Vehicular asphalt zone (courtyard core + SE dispatch channel meeting Libin Rd)
ROAD_ZONE_RING = [
    (-22.5, -2.0), (7.5, 2.5), (19.5, 4.8), (8.0, 17.5),
    (17.2, 31.2), (9.8, 35.4), (-3.5, 24.5), (-22.0, 19.5),
]


def _cjk_font(size: int, bold: bool = False):
    """Strict CJK font loader matching `c_kit.py`: fails explicitly instead of falling back to ASCII bitmap font."""
    noto = '/usr/share/fonts/opentype/noto'
    candidates = [
        ('/System/Library/Fonts/STHeiti Medium.ttc', 0),
        ('/System/Library/Fonts/PingFang.ttc', 0),
        ('/System/Library/Fonts/Hiragino Sans GB.ttc', 2 if bold else 0),
        ('/System/Library/Fonts/Supplemental/Songti.ttc', 0 if bold else 1),
        (f'{noto}/NotoSansCJK-Bold.ttc', 2),
        (f'{noto}/NotoSerifCJK-Bold.ttc', 2),
        (f'{noto}/NotoSansCJK-Regular.ttc', 2),
        (f'{noto}/NotoSerifCJK-Regular.ttc', 2),
    ]
    for path, idx in candidates:
        if not Path(path).exists():
            continue
        try:
            return ImageFont.truetype(path, size, index=idx)
        except OSError:
            try:
                return ImageFont.truetype(path, size, index=0)
            except OSError:
                continue
    raise SystemExit(
        'zhongqu_police: no CJK font found for landmark signs '
        '(need STHeiti/PingFang/Songti or NotoSansCJK); refusing ImageFont.load_default().'
    )


def _bootstrap_surface():
    """Return LandmarkSurface from manifest if present, else fallback to world Surface at ANCHOR."""
    surf = Surface()
    if LANDMARK_ID in surf.entries:
        return LandmarkSurface(surf, LANDMARK_ID)

    y0, _ = surf.sample(ORIGIN_X, ORIGIN_Z)

    class _FallbackSurface:
        def __init__(self):
            self.name = LANDMARK_ID
            self.surface = surf
            self.x, self.y, self.z = float(ORIGIN_X), float(y0), float(ORIGIN_Z)
            self.cos, self.sin = 1.0, 0.0

        def sample(self, lx, lz):
            g, w = self.surface.sample(self.x + lx, self.z + lz)
            return g - self.y, None if w is None else w - self.y

        def ground(self, lx, lz):
            return self.sample(lx, lz)[0]

    return _FallbackSurface()


class SiteGrader:
    """Computes smooth road-tied courtyard & forecourt elevations seamlessly matching Yiren Rd & Libin Rd."""

    def __init__(self, lm_surface):
        self.lm = lm_surface
        self.surf = lm_surface.surface
        self.ox, self.oy, self.oz = lm_surface.x, lm_surface.y, lm_surface.z
        self.streets = Streets(self.surf)

        roi_w = box(self.ox - 68.0, self.oz - 34.0, self.ox + 56.0, self.oz + 62.0)
        st_geoms = []
        adj_geoms = []
        size = self.surf.size
        w0, n0, e0, s0 = roi_w.bounds
        for col in range(math.floor(w0 / size), math.floor(e0 / size) + 1):
            for row in range(math.floor(n0 / size), math.floor(s0 / size) + 1):
                orig = (col * size, row * size)
                if orig not in self.surf.files:
                    continue
                tree, kinds, _ = self.streets.tile(orig)
                for idx in tree.query(roi_w, predicate='intersects'):
                    g = shapely.make_valid(tree.geometries[idx])
                    st_geoms.append(g)
                    if int(kinds[idx]) in (0, 1, 4, 5, 6):
                        ins = g.buffer(-0.015)
                        if not ins.is_empty:
                            adj_geoms.append(ins)

        self.streets_mask = shapely.union_all(st_geoms) if st_geoms else Polygon()
        self.adj_tree = shapely.STRtree(adj_geoms)

        site_world = Polygon([(self.ox + x, self.oz + z) for x, z in SITE_PAVING_RING])
        road_world = Polygon([(self.ox + x, self.oz + z) for x, z in ROAD_ZONE_RING])
        raw_paving = site_world.difference(self.streets_mask)
        parts = polygons(raw_paving)
        # Keep strictly the primary continuous courtyard polygon (eliminates any cross-street sliver)
        self.paving_world = max(parts, key=lambda p: p.area) if parts else Polygon()
        self.road_world = self.paving_world.intersection(road_world)
        self.sidewalk_world = self.paving_world.difference(road_world)

    def world_pave_y(self, wx: float, wz: float) -> float:
        """Smooth courtyard/apron elevation that meets `streets.at` flush at every street seam."""
        gy = self.surf.sample(wx, wz)[0]
        lz = wz - self.oz
        base = max(gy + 0.08, 152.38 - 0.008 * max(-12.0, min(28.0, lz - 8.0)))
        pt = Point(wx, wz)
        idxs = self.adj_tree.query_nearest(pt, max_distance=11.0, all_matches=False)
        if len(idxs):
            line = shapely.shortest_line(pt, self.adj_tree.geometries[idxs[0]])
            tx, tz = line.coords[-1]
            sy, sk = self.streets.at(tx, tz)
            if sk:
                t = max(0.0, min(1.0, 1.0 - line.length / 11.0))
                w = t * t * (3.0 - 2.0 * t)
                return (1.0 - w) * base + w * (sy + 0.006)
        return base

    def local_y(self, lx: float, lz: float) -> float:
        return self.world_pave_y(self.ox + lx, self.oz + lz) - self.oy

    def footing_y(self, lx: float, lz: float, depth: float = 0.08) -> float:
        return self.lm.ground(lx, lz) - depth


# ---------------------------------------------------------------------------
# IDOK-385 v1+ Desaturated Weathered Procedural Atlas (1024x1024)
# Note on `web/src/look/night.ts:171-172` (`landmarkNight`):
#   Shader treats vertical `_atlas` texels with linear `lum < 0.17 && b > r + 0.03` as dark
#   building window glazing and adds random 3m warm yellow glow.
#   Therefore:
#     - All non-window blues (`police_blue`, vehicle blue bands) keep linear `lum >= 0.21 > 0.17`!
#     - All vehicle/kiosk smoked glass (`cabin_glass`) keeps neutral `b - r <= 0.005 < 0.03`!
#     - ONLY actual building windows in wall swatches use `(18, 34, 64)` (`lum ~0.017`, `b > r + 0.04`)!
# ---------------------------------------------------------------------------
def _desat_rgb(r: int, g: int, b: int, mix_luma: float = 0.20) -> tuple[int, int, int]:
    """20% neutral-luma saturation governor to offset look.gradeDay [1.22, 1.12]."""
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    return (
        int(round(np.clip(r * (1.0 - mix_luma) + lum * mix_luma, 0, 255))),
        int(round(np.clip(g * (1.0 - mix_luma) + lum * mix_luma, 0, 255))),
        int(round(np.clip(b * (1.0 - mix_luma) + lum * mix_luma, 0, 255))),
    )


def _paint_weathered_panel(
    im: Image.Image,
    rect: tuple[int, int, int, int],
    base_rgb: tuple[int, int, int],
    *,
    mode: str = 'acp',
    seed: int = 1,
    rain_strength: float = 0.08,
    desat: float = 0.20,
    noise_amp: float = 5.0,
):
    x, y, w, h = rect
    c = _desat_rgb(*base_rgb, mix_luma=desat) if desat > 0 else base_rgb
    rng = np.random.default_rng(seed)
    arr = np.empty((h, w, 3), dtype=np.float32)
    arr[:, :] = c

    # Subtle vertical rain-wash gradient & fine grain
    yy = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None, None]
    arr *= (1.02 - rain_strength * 0.45 * yy)
    arr += rng.normal(0.0, noise_amp, size=(h, w, 1)).astype(np.float32)

    if mode == 'tile':
        for ty in range(0, h, 16):
            arr[ty:ty + 1, :, :] -= 9.0
        for tx in range(0, w, 32):
            arr[:, tx:tx + 1, :] -= 7.0
    elif mode == 'acp':
        for gx in range(0, w, 64):
            arr[:, gx:gx + 2, :] -= 6.0
    elif mode == 'gusset':
        for gy in range(0, h, 8):
            arr[gy:gy + 2, :, :] -= 5.0

    patch = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), mode='RGB')
    im.paste(patch, (x, y))


def _draw_shield_emblem(dr: ImageDraw.ImageDraw, cx: int, cy: int, r: int):
    """Original geometric star-shield civic emblem (non-trademarked stylized vector badge)."""
    pts_outer = [
        (cx - int(r * 0.78), cy - int(r * 0.82)),
        (cx + int(r * 0.78), cy - int(r * 0.82)),
        (cx + int(r * 0.84), cy + int(r * 0.08)),
        (cx, cy + int(r * 0.94)),
        (cx - int(r * 0.84), cy + int(r * 0.08)),
    ]
    pts_inner = [
        (cx - int(r * 0.62), cy - int(r * 0.66)),
        (cx + int(r * 0.62), cy - int(r * 0.66)),
        (cx + int(r * 0.67), cy + int(r * 0.04)),
        (cx, cy + int(r * 0.76)),
        (cx - int(r * 0.67), cy + int(r * 0.04)),
    ]
    dr.polygon(pts_outer, fill=_desat_rgb(232, 194, 78), outline=(40, 42, 42))
    dr.polygon(pts_inner, fill=_desat_rgb(102, 146, 198, mix_luma=0.16))
    # 5-point gold star at center
    star = []
    for k in range(10):
        ang = -math.pi / 2 + k * math.pi / 5
        rad = r * (0.40 if k % 2 == 0 else 0.17)
        star.append((cx + math.cos(ang) * rad, cy - r * 0.04 + math.sin(ang) * rad))
    dr.polygon(star, fill=_desat_rgb(238, 68, 56), outline=_desat_rgb(242, 212, 98))


def _shadow_text(dr: ImageDraw.ImageDraw, xy, text: str, font, fill, anchor='mm'):
    x, y = xy
    dr.text((x + 2, y + 2), text, font=font, fill=(22, 26, 30), anchor=anchor)
    dr.text((x, y), text, font=font, fill=fill, anchor=anchor)


def make_zhongqu_police_atlas() -> tuple[Image.Image, dict]:
    size = 1024
    im = Image.new('RGB', (size, size), _desat_rgb(198, 196, 190))
    dr = ImageDraw.Draw(im)
    rects: dict[str, tuple[int, int, int, int]] = {}

    # PSB Cobalt Blue on `_atlas` surfaces: linear min_lum >= 0.21 (> 0.17) -> ZERO false-positive night window glow!
    c_psb_blue_raw = (102, 146, 198)
    c_psb_blue = _desat_rgb(*c_psb_blue_raw, mix_luma=0.16)
    # Neutral dark slate for text on `_atlas` panels (`b - r <= 2` -> ZERO night window glow!)
    c_slate_txt = (36, 40, 42)
    c_deep_sign = _desat_rgb(24, 62, 116)  # Used only on `_lit` sign_quads (not `landmarkNight`)
    c_white_txt = (242, 244, 246)
    c_gold_txt = _desat_rgb(236, 196, 78)
    c_lime = _desat_rgb(188, 206, 58)
    c_frame = (56, 60, 62)

    # 1. Main Rongcheng Police Station fascia (0, 0, 640, 128) — `_lit` material
    r = (0, 0, 640, 128)
    rects['sign_rongcheng_main'] = r
    _paint_weathered_panel(im, r, (28, 72, 132), mode='acp', seed=201)
    dr.rectangle((2, 2, 637, 125), outline=c_frame, width=4)
    dr.rectangle((0, 96, 639, 123), fill=_desat_rgb(232, 236, 240))
    dr.rectangle((0, 92, 639, 96), fill=_desat_rgb(184, 42, 38))
    _draw_shield_emblem(dr, 44, 48, 30)
    _shadow_text(dr, (364, 42), '桂林市公安局秀峰分局榕城派出所', _cjk_font(31, bold=True), c_white_txt)
    _shadow_text(dr, (364, 76), 'RONGCHENG POLICE STATION  ·  依仁路 1-4 号', _cjk_font(16, bold=True), (212, 224, 238))
    dr.text((336, 110), '立警为公  执法为民   |   24 小时值班报警电话：110', font=_cjk_font(16, bold=True), fill=c_deep_sign, anchor='mm')

    # 2. Main Traffic Police Zhongqu Squadron fascia (0, 128, 640, 128) — `_lit` material (extra +18px margin after shield!)
    r = (0, 128, 640, 128)
    rects['sign_traffic_main'] = r
    _paint_weathered_panel(im, r, (26, 76, 138), mode='gusset', seed=202)
    dr.rectangle((2, 130, 637, 253), outline=c_frame, width=4)
    dr.rectangle((0, 222, 639, 251), fill=_desat_rgb(234, 238, 242))
    dr.rectangle((0, 216, 639, 222), fill=c_lime)
    _draw_shield_emblem(dr, 42, 174, 29)
    _shadow_text(dr, (368, 168), '桂林市公安局交警支队 · 中区执勤中队', _cjk_font(29, bold=True), c_white_txt)
    _shadow_text(dr, (368, 200), 'GUILIN TRAFFIC POLICE  ·  ZHONGQU SQUADRON', _cjk_font(15, bold=True), c_lime)
    dr.text((336, 236), '铁骑快反  ·  事故快处  ·  十字街—解放桥中区交通联动据点', font=_cjk_font(16, bold=True), fill=c_deep_sign, anchor='mm')

    # 3. Libin Rd Dispatch Gateway Arch Sign (0, 256, 512, 96) — `_lit`
    r = (0, 256, 512, 96)
    rects['sign_gate_arch'] = r
    _paint_weathered_panel(im, r, (24, 64, 120), mode='acp', seed=203)
    dr.rectangle((2, 258, 509, 349), outline=c_frame, width=4)
    dr.rectangle((8, 264, 503, 343), outline=c_gold_txt, width=2)
    _draw_shield_emblem(dr, 42, 304, 24)
    _shadow_text(dr, (284, 292), '警 务 联 动  ·  快 速 出 警', _cjk_font(29, bold=True), c_white_txt)
    _shadow_text(dr, (284, 326), '秀峰榕城派出所  ×  桂林交警中区中队  联合执勤大院', _cjk_font(15, bold=True), c_gold_txt)

    # 4. Equipment Locker & Fast-Handling Hall Sign (0, 352, 512, 96) — `_lit`
    r = (0, 352, 512, 96)
    rects['sign_equip_hall'] = r
    _paint_weathered_panel(im, r, (30, 74, 126), mode='acp', seed=204)
    dr.rectangle((2, 354, 509, 445), outline=c_frame, width=3)
    dr.rectangle((0, 422, 511, 445), fill=c_lime)
    _shadow_text(dr, (256, 382), '警务装备领用室 · 交通快处中心', _cjk_font(28, bold=True), c_white_txt)
    _shadow_text(dr, (256, 408), 'EQUIPMENT LOCKER & TRAFFIC FAST-RESPONSE DESK', _cjk_font(13, bold=True), (214, 226, 238))
    dr.text((256, 433), '执勤反光背心 · 劝导哨 · 安全锥桶 · 铁骑护具领用点', font=_cjk_font(14, bold=True), fill=c_slate_txt, anchor='mm')

    # 5. Corner Traffic Police Kiosk Header & Courtyard Command Plaque (512, 256, 512, 96) & (512, 352, 512, 96) — `_lit`
    r = (512, 256, 512, 96)
    rects['sign_kiosk_jj'] = r
    _paint_weathered_panel(im, r, (26, 78, 142), mode='acp', seed=205)
    dr.rectangle((514, 258, 1021, 349), outline=c_frame, width=3)
    dr.rectangle((512, 330, 1023, 351), fill=_desat_rgb(236, 240, 244))
    _draw_shield_emblem(dr, 550, 294, 23)
    _shadow_text(dr, (792, 294), '桂 林 交 警 · 漓滨执勤岗', _cjk_font(28, bold=True), c_white_txt)
    dr.text((776, 340), 'GUILIN TRAFFIC POLICE  ·  铁骑值守点', font=_cjk_font(13, bold=True), fill=c_deep_sign, anchor='mm')

    r = (512, 352, 512, 96)
    rects['sign_south_duty'] = r
    _paint_weathered_panel(im, r, (38, 66, 104), mode='acp', seed=206)
    dr.rectangle((514, 354, 1021, 445), outline=c_frame, width=3)
    _shadow_text(dr, (768, 386), '漓滨路 3 号 · 治安巡防与接处警备勤楼', _cjk_font(24, bold=True), c_white_txt)
    _shadow_text(dr, (768, 420), '夜市市容劝导联动  ·  老城街区平安巡防驻点', _cjk_font(16, bold=True), c_gold_txt)

    # 6. Top-Right Badges: 110 Vertical Lightbox (`_lit`), No-Parking Sign (`_atlas`), Bulletin Board (`_atlas`)
    r = (640, 0, 128, 256)
    rects['sign_110_box'] = r
    _paint_weathered_panel(im, r, (24, 68, 134), mode='acp', seed=207)
    dr.rectangle((643, 3, 764, 252), outline=(230, 236, 242), width=3)
    _draw_shield_emblem(dr, 704, 44, 25)
    _shadow_text(dr, (704, 96), '110', _cjk_font(38, bold=True), c_gold_txt)
    for idx, ch in enumerate('报警服务台'):
        _shadow_text(dr, (704, 132 + idx * 24), ch, _cjk_font(20, bold=True), c_white_txt)

    r = (768, 0, 256, 128)
    rects['sign_no_park'] = r
    _paint_weathered_panel(im, r, (214, 172, 52), mode='acp', seed=208)
    dr.rectangle((772, 4, 1019, 123), outline=(42, 44, 46), width=4)
    dr.text((896, 42), '出 警 通 道', font=_cjk_font(30, bold=True), fill=c_slate_txt, anchor='mm')
    dr.rectangle((782, 70, 1009, 112), fill=_desat_rgb(178, 44, 40))
    dr.text((896, 91), '24h 警车出入 · 严禁占道', font=_cjk_font(17, bold=True), fill=c_white_txt, anchor='mm')

    r = (768, 128, 256, 128)
    rects['sign_bulletin'] = r
    _paint_weathered_panel(im, r, (232, 228, 218), mode='acp', seed=209)
    dr.rectangle((772, 132, 1019, 251), outline=_desat_rgb(162, 46, 42), width=5)
    dr.rectangle((776, 136, 1015, 166), fill=_desat_rgb(168, 46, 42))
    dr.text((896, 151), '法治秀峰 · 文明交通宣传栏', font=_cjk_font(16, bold=True), fill=c_white_txt, anchor='mm')
    dr.text((896, 190), '一盔一带  安全常在', font=_cjk_font(20, bold=True), fill=c_slate_txt, anchor='mm')
    dr.text((896, 222), '规范停放非机动车 · 共建平安夜市街区', font=_cjk_font(12, bold=True), fill=(58, 60, 62), anchor='mm')

    # 7. Architectural 2-Storey Wall Swatches (y = 448 .. 736)
    #    ONLY the recessed window panes use `(18, 34, 64)` (`lum ~0.017, b > r + 0.04`) so `landmarkNight` lights ~50% warm!
    win_glass = (18, 34, 64)
    # 7a. White ceramic institutional tile wall with 2x2 windows (0, 448, 256, 288)
    r = (0, 448, 256, 288)
    rects['white_tile_wall'] = r
    _paint_weathered_panel(im, r, (226, 224, 218), mode='tile', seed=210, rain_strength=0.12)
    for fl in range(2):
        wy = 448 + fl * 144
        dr.rectangle((0, wy, 255, wy + 12), fill=_desat_rgb(172, 174, 174))
        for col in range(2):
            wx = col * 128
            dr.rectangle((wx + 20, wy + 28, wx + 108, wy + 112), fill=win_glass, outline=(104, 108, 110), width=3)
            dr.line((wx + 64, wy + 28, wx + 64, wy + 112), fill=(124, 128, 130), width=2)
            dr.line((wx + 20, wy + 68, wx + 108, wy + 68), fill=(116, 120, 122), width=2)
            dr.rectangle((wx + 16, wy + 112, wx + 112, wy + 120), fill=_desat_rgb(156, 158, 158))

    # 7b. Modern Traffic-Police Silver ACP + Ribbon Window Wall (256, 448, 256, 288)
    r = (256, 448, 256, 288)
    rects['traffic_glass_wall'] = r
    _paint_weathered_panel(im, r, (202, 206, 210), mode='acp', seed=211, rain_strength=0.10)
    for fl in range(2):
        wy = 448 + fl * 144
        # Spandrel stripe uses `c_psb_blue` (lum >= 0.21) so spandrels NEVER turn yellow at night!
        dr.rectangle((256, wy, 511, wy + 20), fill=c_psb_blue)
        dr.rectangle((272, wy + 30, 495, wy + 114), fill=win_glass, outline=(136, 142, 146), width=3)
        for mx in (328, 384, 440):
            dr.line((mx, wy + 30, mx, wy + 114), fill=(148, 154, 158), width=3)

    # 7c. Warm Beige-White Annex Plaster/Tile Wall matching Libin Rd No.3 street view (512, 448, 256, 288)
    r = (512, 448, 256, 288)
    rects['beige_annex_wall'] = r
    _paint_weathered_panel(im, r, (214, 202, 186), mode='tile', seed=212, rain_strength=0.13)
    for fl in range(2):
        wy = 448 + fl * 144
        dr.rectangle((512, wy, 767, wy + 10), fill=_desat_rgb(154, 144, 132))
        for col in range(2):
            wx = 512 + col * 128
            dr.rectangle((wx + 22, wy + 30, wx + 106, wy + 108), fill=win_glass, outline=(96, 92, 86), width=3)
            dr.line((wx + 64, wy + 30, wx + 64, wy + 108), fill=(112, 108, 102), width=2)

    # 7d. Swatches column (768..1024, 448..736):
    #     `police_blue` uses `(88, 134, 188)` (desat=0.16, noise_amp=3.0) -> linear lum ~0.23 >> 0.17 (ZERO night yellow bug!)
    rects['police_blue'] = (768, 448, 128, 144)
    _paint_weathered_panel(im, rects['police_blue'], c_psb_blue_raw, mode='acp', seed=213, rain_strength=0.04, desat=0.16, noise_amp=3.0)
    rects['white_clean'] = (896, 448, 128, 144)
    _paint_weathered_panel(im, rects['white_clean'], (232, 232, 228), mode='acp', seed=214, rain_strength=0.05)
    rects['granite_dark'] = (768, 592, 128, 144)
    _paint_weathered_panel(im, rects['granite_dark'], (104, 106, 108), mode='noise', seed=215, rain_strength=0.06, desat=0.0)
    rects['courtyard_wall'] = (896, 592, 128, 144)
    _paint_weathered_panel(im, rects['courtyard_wall'], (208, 198, 186), mode='acp', seed=216, rain_strength=0.12)

    # 8. Vehicle Full-Side Liveries (clamped 0..1 UVs!), Hall Interiors & Metals (y = 736 .. 864)
    # 8a. Standard Chinese Police Cruiser Side Livery (`警察 POLICE / 桂 C · 1108 警`) (0, 736, 320, 128)
    r = (0, 736, 320, 128)
    rects['police_car_side'] = r
    _paint_weathered_panel(im, r, (240, 242, 244), mode='acp', seed=217, rain_strength=0.02, noise_amp=2.0)
    dr.rectangle((0, 804, 319, 863), fill=c_psb_blue)
    dr.rectangle((0, 796, 319, 803), fill=_desat_rgb(192, 46, 42))
    _draw_shield_emblem(dr, 52, 766, 20)
    dr.text((178, 766), '警 察  POLICE', font=_cjk_font(25, bold=True), fill=c_slate_txt, anchor='mm')
    dr.text((160, 833), '桂 C · 1108 警   |   公安巡逻', font=_cjk_font(18, bold=True), fill=c_white_txt, anchor='mm')

    # 8b. Traffic Police Iron-Cavalry Moto Side Livery (`桂林交警铁骑`) (320, 736, 256, 128)
    r = (320, 736, 256, 128)
    rects['moto_cavalry_side'] = r
    _paint_weathered_panel(im, r, (238, 240, 242), mode='acp', seed=218, rain_strength=0.02, noise_amp=2.0)
    dr.rectangle((320, 806, 575, 863), fill=c_psb_blue)
    dr.rectangle((320, 786, 575, 805), fill=c_lime)
    dr.text((448, 758), '桂 林 交 警 铁 骑', font=_cjk_font(23, bold=True), fill=c_slate_txt, anchor='mm')
    dr.text((448, 834), 'TRAFFIC POLICE', font=_cjk_font(17, bold=True), fill=c_white_txt, anchor='mm')

    # 8c. Warm-lit Reception Hall / Duty Interior Window (576, 736, 256, 128) — `_lit`
    r = (576, 736, 256, 128)
    rects['hall_interior'] = r
    _paint_weathered_panel(im, r, (220, 206, 178), mode='acp', seed=219, rain_strength=0.0)
    dr.rectangle((584, 744, 823, 855), fill=_desat_rgb(230, 216, 186), outline=(84, 88, 92), width=4)
    dr.rectangle((598, 758, 810, 790), fill=c_deep_sign)
    dr.text((704, 774), '人民公安为人民 · 综合服务窗口', font=_cjk_font(14, bold=True), fill=c_white_txt, anchor='mm')
    dr.rectangle((604, 810, 804, 850), fill=_desat_rgb(138, 146, 152))

    # 8d. Roof Grey Concrete, Neutral Dark Metal & Tire Black (`b == r` so `step(r+0.03, b) == 0`!)
    rects['roof_conc'] = (832, 736, 96, 128)
    _paint_weathered_panel(im, rects['roof_conc'], (134, 136, 136), mode='noise', seed=220, rain_strength=0.08, desat=0.0)
    rects['dark_metal'] = (928, 736, 96, 64)
    _paint_weathered_panel(im, rects['dark_metal'], (52, 54, 54), mode='noise', seed=221, rain_strength=0.0, desat=0.0, noise_amp=2.0)
    rects['tire_black'] = (928, 800, 96, 64)
    _paint_weathered_panel(im, rects['tire_black'], (34, 35, 35), mode='noise', seed=222, rain_strength=0.0, desat=0.0, noise_amp=2.0)

    # 9. Bottom Strip (y = 864 .. 1024): Strobe lights, foliage, bark, markings, cone, vest, emblem medallion
    rects['red_lit'] = (0, 864, 96, 80)
    _paint_weathered_panel(im, rects['red_lit'], (214, 48, 46), mode='noise', seed=223, rain_strength=0.0)
    rects['blue_lit'] = (96, 864, 96, 80)
    _paint_weathered_panel(im, rects['blue_lit'], (42, 112, 224), mode='noise', seed=224, rain_strength=0.0)
    rects['warm_lit'] = (192, 864, 96, 80)
    _paint_weathered_panel(im, rects['warm_lit'], (244, 224, 182), mode='noise', seed=225, rain_strength=0.0)
    rects['yellow_mark'] = (288, 864, 96, 80)
    _paint_weathered_panel(im, rects['yellow_mark'], (212, 174, 52), mode='noise', seed=226, rain_strength=0.04)
    rects['white_mark'] = (384, 864, 96, 80)
    _paint_weathered_panel(im, rects['white_mark'], (226, 228, 224), mode='noise', seed=227, rain_strength=0.04)
    rects['lime_vest'] = (480, 864, 96, 80)
    _paint_weathered_panel(im, rects['lime_vest'], (188, 208, 56), mode='noise', seed=228, rain_strength=0.02)
    rects['cone_orange'] = (576, 864, 96, 80)
    _paint_weathered_panel(im, rects['cone_orange'], (212, 94, 42), mode='noise', seed=229, rain_strength=0.04)
    dr.rectangle((576, 892, 671, 912), fill=(236, 238, 240))

    rects['foliage'] = (672, 864, 128, 160)
    _paint_weathered_panel(im, rects['foliage'], (66, 98, 58), mode='noise', seed=230, rain_strength=0.0)
    rects['bark'] = (800, 864, 96, 160)
    _paint_weathered_panel(im, rects['bark'], (94, 86, 78), mode='noise', seed=231, rain_strength=0.0)

    # Civic Emblem Medallion (896, 864, 128, 160)
    r = (896, 864, 128, 160)
    rects['emblem_medallion'] = r
    _paint_weathered_panel(im, r, (226, 226, 222), mode='acp', seed=232, rain_strength=0.04)
    _draw_shield_emblem(dr, 960, 944, 52)

    # Boom-gate red/white stripe & neutral smoked vehicle/kiosk glass (`b == r` -> ZERO night yellow noise!)
    rects['boom_stripe'] = (0, 944, 384, 80)
    _paint_weathered_panel(im, rects['boom_stripe'], (236, 238, 240), mode='acp', seed=233, rain_strength=0.0)
    for bx in range(0, 384, 64):
        dr.rectangle((bx, 944, bx + 31, 1023), fill=_desat_rgb(192, 44, 40))
    rects['cabin_glass'] = (384, 944, 288, 80)
    _paint_weathered_panel(im, rects['cabin_glass'], (48, 50, 50), mode='acp', seed=234, rain_strength=0.0, desat=0.0, noise_amp=2.0)

    return im, rects


# ---------------------------------------------------------------------------
# Geometry Helpers
# ---------------------------------------------------------------------------
def _grounded_prism(
    b: SceneBuilder,
    grader: SiteGrader,
    poly_xz: list[tuple[float, float]],
    y_top: float,
    wall_region: str,
    cap_region: str | None = 'roof_conc',
    bottom_cap_region: str | None = None,
    y_bot_fixed: float | None = None,
    tile_u: float = 3.4,
    tile_v: float = 5.6,
    collide: bool = True,
):
    """Extrude a local XZ polygon with per-bay & per-course clamped [0..1] UVs (zero `% 1.0` wrap distortion)
    and optional downward `(0, -1, 0)` soffit ceiling cap."""
    pts = np.asarray(poly_xz, dtype=np.float64)
    area2 = np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1])
    if area2 < 0:
        pts = pts[::-1]
    tris = mapbox_earcut.triangulate_float64(pts, np.array([len(pts)], np.uint32)).reshape(-1, 3)

    if cap_region is not None:
        for t in tris:
            tri = [(float(pts[i, 0]), float(y_top), float(pts[i, 1])) for i in t]
            b.face(tri, (0, 1, 0), cap_region, tile=tile_u)
            if collide and b.collide:
                b.hit_quad(tri, (0, 1, 0))

    if bottom_cap_region is not None and y_bot_fixed is not None:
        for t in tris:
            tri_b = [(float(pts[i, 0]), float(y_bot_fixed), float(pts[i, 1])) for i in t]
            b.face(tri_b, (0, -1, 0), bottom_cap_region, tile=tile_u)

    quad_uvs = [(0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)]
    windowed = wall_region in ('white_tile_wall', 'traffic_glass_wall', 'beige_annex_wall')

    for i in range(len(pts)):
        j = (i + 1) % len(pts)
        pa, pb = pts[i], pts[j]
        seg_len = float(math.hypot(pb[0] - pa[0], pb[1] - pa[1]))
        if seg_len < 1e-3:
            continue
        nrm = (float(pb[1] - pa[1]), 0.0, float(pa[0] - pb[0]))
        nx = max(1, round(seg_len / max(1.2, tile_u)))

        # Emit single collision quad per edge to keep collision_body ultra-lean
        if collide and b.collide:
            yb_a = grader.footing_y(float(pa[0]), float(pa[1]), 0.08) if y_bot_fixed is None else y_bot_fixed
            yb_b = grader.footing_y(float(pb[0]), float(pb[1]), 0.08) if y_bot_fixed is None else y_bot_fixed
            b.hit_quad(
                [(pa[0], yb_a, pa[1]), (pb[0], yb_b, pb[1]), (pb[0], y_top, pb[1]), (pa[0], y_top, pa[1])],
                nrm,
            )

        # Precompute bay XZ & footing heights so adjacent bays share bit-identical vertices
        bay_pts = []
        bay_ybs = []
        for ix in range(nx + 1):
            t = ix / nx
            vx = round(float(pa[0] + (pb[0] - pa[0]) * t), 4)
            vz = round(float(pa[1] + (pb[1] - pa[1]) * t), 4)
            bay_pts.append((vx, vz))
            bay_ybs.append(round(grader.footing_y(vx, vz, 0.08) if y_bot_fixed is None else y_bot_fixed, 4))

        if y_bot_fixed is None and windowed:
            # Grounded sloped granite plinth up to level `y_plinth`, then level 2-storey window courses above
            y_plinth = round(min(y_top - 0.6, max(bay_ybs) + 0.65), 4)
            for ix in range(nx):
                (x0, z0), (x1, z1) = bay_pts[ix], bay_pts[ix + 1]
                yb0, yb1 = bay_ybs[ix], bay_ybs[ix + 1]
                b.face([(x0, yb0, z0), (x1, yb1, z1), (x1, y_plinth, z1), (x0, y_plinth, z0)], nrm, 'granite_dark', uvs=quad_uvs)
            rem_h = max(0.2, y_top - y_plinth)
            ny = max(1, round(rem_h / max(2.2, tile_v)))
            ys = [round(y_plinth + (y_top - y_plinth) * (iy / ny), 4) for iy in range(ny + 1)]
            for ix in range(nx):
                (x0, z0), (x1, z1) = bay_pts[ix], bay_pts[ix + 1]
                for iy in range(ny):
                    yc0, yc1 = ys[iy], ys[iy + 1]
                    b.face([(x0, yc0, z0), (x1, yc0, z1), (x1, yc1, z1), (x0, yc1, z0)], nrm, wall_region, uvs=quad_uvs)
        else:
            ref_h = max(0.2, y_top - (y_bot_fixed if y_bot_fixed is not None else min(bay_ybs)))
            ny = max(1, round(ref_h / max(1.0, tile_v))) if windowed else 1
            for ix in range(nx):
                (x0, z0), (x1, z1) = bay_pts[ix], bay_pts[ix + 1]
                yb0, yb1 = bay_ybs[ix], bay_ybs[ix + 1]
                for iy in range(ny):
                    f0, f1 = iy / ny, (iy + 1) / ny
                    ya0 = round(yb0 + (y_top - yb0) * f0, 4)
                    ya1 = round(yb0 + (y_top - yb0) * f1, 4)
                    yb0_c = round(yb1 + (y_top - yb1) * f0, 4)
                    yb1_c = round(yb1 + (y_top - yb1) * f1, 4)
                    b.face([(x0, ya0, z0), (x1, yb0_c, z1), (x1, yb1_c, z1), (x0, ya1, z0)], nrm, wall_region, uvs=quad_uvs)


def _build_courtyard_paving(b: SceneBuilder, grader: SiteGrader):
    """Triangulate road-blended courtyard & roadside motorcycle apron with zero street overlap or slivers."""
    ox, oz = grader.ox, grader.oz
    step = 2.5 if b.detail else 5.0
    w0, n0, e0, s0 = grader.paving_world.bounds

    for role, region_poly in (('road', grader.road_world), ('sidewalk', grader.sidewalk_world)):
        if region_poly.is_empty:
            continue
        for col in range(math.floor(w0 / step), math.ceil(e0 / step)):
            for row in range(math.floor(n0 / step), math.ceil(s0 / step)):
                cell = box(col * step, row * step, (col + 1) * step, (row + 1) * step)
                clipped = region_poly.intersection(cell)
                if clipped.is_empty:
                    continue
                for part in polygons(clipped):
                    for tri_g in shapely.constrained_delaunay_triangles(part).geoms:
                        if tri_g.area < 1e-4:
                            continue
                        coords = list(shapely.orient_polygons(tri_g, exterior_cw=True).exterior.coords)[:3]
                        pts3 = []
                        for wx, wz in coords:
                            lx, lz = wx - ox, wz - oz
                            pts3.append((lx, grader.local_y(lx, lz), lz))
                        b.face(pts3, (0, 1, 0), None, street_role=role)
                        if b.collide:
                            b.hit_quad(pts3, (0, 1, 0))

    # Solid perimeter grounding skirt along exposed outer edges so paving slab bears cleanly on GL04 terrain
    for part in polygons(grader.paving_world):
        ring = list(part.exterior.coords)
        for p0, p1 in zip(ring, ring[1:]):
            seg = LineString([p0, p1])
            if seg.length < 0.05:
                continue
            nsub = max(1, math.ceil(seg.length / 3.0))
            for k in range(nsub):
                q0 = seg.interpolate(k / nsub, normalized=True).coords[0]
                q1 = seg.interpolate((k + 1) / nsub, normalized=True).coords[0]
                lx0, lz0 = q0[0] - ox, q0[1] - oz
                lx1, lz1 = q1[0] - ox, q1[1] - oz
                yt0, yt1 = grader.local_y(lx0, lz0), grader.local_y(lx1, lz1)
                yb0 = min(yt0 - 0.05, grader.footing_y(lx0, lz0, 0.08))
                yb1 = min(yt1 - 0.05, grader.footing_y(lx1, lz1, 0.08))
                nrm = (lz1 - lz0, 0.0, lx0 - lx1)
                b.face(
                    [(lx0, yb0, lz0), (lx1, yb1, lz1), (lx1, yt1, lz1), (lx0, yt0, lz0)],
                    nrm,
                    None,
                    street_role='curb',
                )


def _add_mark_strip(b: SceneBuilder, grader: SiteGrader, x0: float, z0: float, x1: float, z1: float, width: float, region: str):
    """Slope-conforming painted pavement marking strip (`+0.038 m` per-vertex clearance, zero Z-fighting)."""
    dx, dz = x1 - x0, z1 - z0
    ln = math.hypot(dx, dz)
    if ln < 0.05:
        return
    nx_p, nz_p = -dz / ln * (width * 0.5), dx / ln * (width * 0.5)
    segs = max(1, math.ceil(ln / 0.85), math.ceil((ln * width) / 0.32))
    uvs = [(0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)]
    lift = 0.038
    for k in range(segs):
        t0, t1 = k / segs, (k + 1) / segs
        ax, az = x0 + dx * t0, z0 + dz * t0
        bx, bz = x0 + dx * t1, z0 + dz * t1
        p0 = (ax - nx_p, grader.local_y(ax - nx_p, az - nz_p) + lift, az - nz_p)
        p1 = (ax + nx_p, grader.local_y(ax + nx_p, az + nz_p) + lift, az + nz_p)
        p2 = (bx + nx_p, grader.local_y(bx + nx_p, bz + nz_p) + lift, bz + nz_p)
        p3 = (bx - nx_p, grader.local_y(bx - nx_p, bz - nz_p) + lift, bz - nz_p)
        b.face([p0, p1, p2, p3], (0, 1, 0), region, uvs=uvs)


def _mounted_sign(
    b: SceneBuilder,
    x: float,
    yc: float,
    z_wall: float,
    w: float,
    h: float,
    region: str,
    protrude: float = 0.16,
    embed: float = 0.16,
    lit: bool = False,
    flip_z: bool = False,
):
    """3D wall-embedded sign lightbox whose return flanges share front vertices & penetrate the backing wall."""
    hw, hh = w * 0.5, h * 0.5
    y0, y1 = yc - hh, yc + hh
    zf = z_wall - protrude if flip_z else z_wall + protrude
    zb = z_wall + embed if flip_z else z_wall - embed
    uvs = [(0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)]
    if not flip_z:
        f_pts = [(x - hw, y0, zf), (x + hw, y0, zf), (x + hw, y1, zf), (x - hw, y1, zf)]
        n_f = (0, 0, 1)
    else:
        f_pts = [(x + hw, y0, zf), (x - hw, y0, zf), (x - hw, y1, zf), (x + hw, y1, zf)]
        n_f = (0, 0, -1)
    b.face(f_pts, n_f, region, uvs=uvs, lit=lit)
    b.face([(x - hw, y1, zf), (x + hw, y1, zf), (x + hw, y1, zb), (x - hw, y1, zb)], (0, 1, 0), 'dark_metal', uvs=uvs, lit=lit)
    b.face([(x - hw, y0, zb), (x + hw, y0, zb), (x + hw, y0, zf), (x - hw, y0, zf)], (0, -1, 0), 'dark_metal', uvs=uvs, lit=lit)
    b.face([(x - hw, y0, zb), (x - hw, y0, zf), (x - hw, y1, zf), (x - hw, y1, zb)], (-1, 0, 0), 'dark_metal', uvs=uvs, lit=lit)
    b.face([(x + hw, y0, zf), (x + hw, y0, zb), (x + hw, y1, zb), (x + hw, y1, zf)], (1, 0, 0), 'dark_metal', uvs=uvs, lit=lit)


def _add_side_livery_panels(b: SceneBuilder, half_w: float, y0: float, y1: float, z_rear: float, z_front: float, region: str):
    """Attach explicit clamped [0..1] upright livery panels on both +X and -X sides of a vehicle,
    with inward return flanges piercing the chassis so `crossing_joints` fuses them into 1 grounded assembly."""
    uvs = [(0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)]
    xo = half_w + 0.016
    xi = half_w - 0.06
    # +X side (viewer facing -X has +Z front on left, -Z rear on right)
    b.face([(xo, y0, z_front), (xo, y0, z_rear), (xo, y1, z_rear), (xo, y1, z_front)], (1, 0, 0), region, uvs=uvs)
    b.face([(xi, y1, z_front), (xo, y1, z_front), (xo, y1, z_rear), (xi, y1, z_rear)], (0, 1, 0), 'white_clean', uvs=uvs)
    b.face([(xo, y0, z_front), (xi, y0, z_front), (xi, y0, z_rear), (xo, y0, z_rear)], (0, -1, 0), 'white_clean', uvs=uvs)

    # -X side (viewer facing +X has -Z rear on left, +Z front on right)
    b.face([(-xo, y0, z_rear), (-xo, y0, z_front), (-xo, y1, z_front), (-xo, y1, z_rear)], (-1, 0, 0), region, uvs=uvs)
    b.face([(-xo, y1, z_front), (-xi, y1, z_front), (-xi, y1, z_rear), (-xo, y1, z_rear)], (0, 1, 0), 'white_clean', uvs=uvs)
    b.face([(-xi, y0, z_front), (-xo, y0, z_front), (-xo, y0, z_rear), (-xi, y0, z_rear)], (0, -1, 0), 'white_clean', uvs=uvs)


def _add_police_cruiser(b: SceneBuilder, grader: SiteGrader, cx: float, cz: float, front_xz: tuple[float, float], is_van: bool = False):
    """Build a standard Chinese blue-and-white police sedan or patrol van with full-UV side liveries."""
    y_pad = grader.local_y(cx, cz)
    pf = b.set_frame(origin=(cx, y_pad, cz), front_xz=front_xz)

    L = 4.76 if is_van else 4.52
    W = 1.88 if is_van else 1.80
    chassis_h = 0.84 if is_van else 0.62
    cabin_h = 0.80 if is_van else 0.54
    cabin_l = 3.16 if is_van else 2.16
    cabin_z = -0.28 if is_van else -0.16
    wheel_r = 0.33

    # Grounding keel touching slab (`y = 0.004 m`)
    b.box(0.0, 0.004, 0.0, W * 0.68, 0.30, L * 0.66, 'tire_black', collide=True, bottom=True)

    # White lower body + full-height clamped side livery panels (`警察 POLICE / 桂 C · 1108 警`)
    b.box(0.0, 0.24, 0.0, W, chassis_h, L, 'white_clean', cap_region='white_clean', collide=True, bottom=True)
    _add_side_livery_panels(b, W * 0.5, 0.26, 0.24 + chassis_h - 0.02, -L * 0.46, L * 0.46, 'police_car_side')

    # Distinctly stepped front/rear PSB blue bumpers (non-coplanar, >= 5 cm offset from body faces!)
    b.box(0.0, 0.21, L * 0.5 - 0.10, W + 0.06, 0.28, 0.32, 'police_blue', bottom=True)
    b.box(0.0, 0.21, -L * 0.5 + 0.10, W + 0.06, 0.30, 0.32, 'police_blue', bottom=True)

    # Upper cabin with neutral smoked glass (inset cleanly inside lower body so zero coplanar Z-fighting)
    cabin_y0 = 0.24 + chassis_h - 0.06
    b.box(0.0, cabin_y0, cabin_z, W * 0.84, cabin_h + 0.06, cabin_l, 'cabin_glass', cap_region='white_clean', bottom=True)

    # Roof red/blue police lightbar (`_lit` at night)
    roof_y = 0.24 + chassis_h + cabin_h
    b.box(0.0, roof_y - 0.04, cabin_z + 0.15, 1.10, 0.10, 0.28, 'dark_metal', bottom=True)
    b.box(-0.28, roof_y + 0.05, cabin_z + 0.15, 0.48, 0.11, 0.24, 'red_lit', lit=True, bottom=True)
    b.box(0.28, roof_y + 0.05, cabin_z + 0.15, 0.48, 0.11, 0.24, 'blue_lit', lit=True, bottom=True)

    if b.detail:
        for sx in (-W * 0.33, W * 0.33):
            b.box(sx, 0.54, L * 0.5 + 0.02, 0.34, 0.16, 0.08, 'warm_lit', lit=True, bottom=True)
            b.box(sx, 0.56, -L * 0.5 - 0.02, 0.34, 0.16, 0.08, 'red_lit', lit=True, bottom=True)
        for sx in (-W * 0.48, W * 0.48):
            for sz in (-L * 0.31, L * 0.31):
                b.box(sx, 0.004, sz, 0.22, wheel_r * 1.90, wheel_r * 1.90, 'tire_black', bottom=True)

    b.restore_frame(pf)


def _add_iron_cavalry_moto(b: SceneBuilder, grader: SiteGrader, cx: float, cz: float, front_xz: tuple[float, float]):
    """Build a Guilin Traffic Police Iron-Cavalry (`交警铁骑`) motorcycle with full-UV upright side liveries."""
    y_pad = grader.local_y(cx, cz)
    pf = b.set_frame(origin=(cx, y_pad, cz), front_xz=front_xz)

    b.box(0.0, 0.004, 0.0, 0.26, 0.38, 1.56, 'tire_black', collide=True, bottom=True)
    b.box(0.0, 0.004, 0.66, 0.18, 0.58, 0.58, 'tire_black', bottom=True)
    b.box(0.0, 0.004, -0.66, 0.20, 0.58, 0.58, 'tire_black', bottom=True)

    # Main white fairing + explicit clamped side livery panels (`桂林交警铁骑`)
    b.box(0.0, 0.34, 0.08, 0.54, 0.54, 1.36, 'white_clean', cap_region='white_clean', bottom=True)
    _add_side_livery_panels(b, 0.27, 0.36, 0.86, -0.56, 0.72, 'moto_cavalry_side')

    # Front cowl + windshield + headlight
    b.box(0.0, 0.60, 0.62, 0.50, 0.42, 0.38, 'police_blue', cap_region='white_clean', bottom=True)
    if b.detail:
        b.box(0.0, 0.96, 0.58, 0.42, 0.36, 0.08, 'cabin_glass', bottom=True)
        b.box(0.0, 0.76, 0.82, 0.24, 0.14, 0.08, 'warm_lit', lit=True, bottom=True)
        for sx in (-0.34, 0.34):
            b.box(sx, 0.48, -0.54, 0.18, 0.34, 0.48, 'white_clean', bottom=True)
        b.box(0.0, 0.80, -0.68, 0.42, 0.28, 0.38, 'white_clean', cap_region='police_blue', bottom=True)
        b.cylinder_y(0.18, 0.80, 0.68, -0.78, 0.025, 'dark_metal', sections=5)
        b.cylinder_y(0.18, 1.46, 0.14, -0.78, 0.065, 'blue_lit', sections=6, lit=True)

    b.restore_frame(pf)


def _add_traffic_cone(b: SceneBuilder, grader: SiteGrader, lx: float, lz: float):
    y0 = grader.local_y(lx, lz)
    b.box(lx, y0 + 0.004, lz, 0.36, 0.05, 0.36, 'tire_black', bottom=True)
    b.cylinder_y(lx, y0 + 0.04, 0.58, lz, 0.11, 'cone_orange', sections=6 if b.detail else 4)


# ---------------------------------------------------------------------------
# Main Landmark Scene Assembly
# ---------------------------------------------------------------------------
def build_zhongqu_police(b: SceneBuilder):
    grader = SiteGrader(b.surface)
    oy = grader.oy

    # 0. Road-blended courtyard, Yiren Rd colonnade porch & Libin Rd Iron-Cavalry apron
    _build_courtyard_paving(b, grader)

    # -----------------------------------------------------------------------
    # 1. Rongcheng Police Station (`way/675586428`, 5F, CMAB 17.25 m -> world 169.1 m)
    # -----------------------------------------------------------------------
    y_b1_2f = round(157.05 - oy, 4)      # +5.44 m local (> +3.8 m clear above Yiren Rd porch)
    y_b1_band1 = round(157.95 - oy, 4)   # PSB blue 2F waistband (covers local y=6.0 m audit slice)
    y_b1_roof = round(168.40 - oy, 4)    # Main 5F cornice
    y_b1_top = round(169.15 - oy, 4)     # PSB blue top parapet

    # 1a. Recessed 1F colonnaded base (`B1_1F_PTS`, `y_top = y_b1_2f + 0.06` piercing 2F soffit for crossing_joints, no internal top cap!)
    _grounded_prism(b, grader, B1_1F_PTS, y_b1_2f + 0.06, 'granite_dark', cap_region=None, tile_u=3.0)
    # 1b. Road-setback upper massing (`B1_UPPER_PTS`) with sealed downward `(0, -1, 0)` colonnade ceiling soffit!
    _grounded_prism(
        b, grader, B1_UPPER_PTS, y_b1_band1, 'police_blue',
        cap_region=None, bottom_cap_region='white_clean', y_bot_fixed=y_b1_2f, tile_u=3.2,
    )
    _grounded_prism(
        b, grader, B1_UPPER_PTS, y_b1_roof, 'white_tile_wall',
        cap_region=None, y_bot_fixed=y_b1_band1, tile_u=3.4, tile_v=5.25,
    )
    _grounded_prism(
        b, grader, B1_UPPER_PTS, y_b1_top, 'police_blue',
        cap_region='roof_conc', y_bot_fixed=y_b1_roof, tile_u=3.2,
    )

    # 1c. North Yiren Rd No. 1-4 Setback Colonnade (6 sidewalk piers, zero road encroachment, clear 13.7m center bay!)
    # Edge `(-51.33, -18.97) -> (7.19, -8.21)` faces NNE `(10.76, -58.52)` toward Yiren Rd
    n_mid_x, n_mid_z = (-51.33 + 7.19) * 0.5, (-18.97 - 8.21) * 0.5
    n_dx, n_dz = 7.19 - (-51.33), -8.21 - (-18.97)
    f_b1n = b.set_frame(origin=(n_mid_x, 0.0, n_mid_z), front_xz=(n_dz, -n_dx))

    for px in (-24.6, -15.8, -7.2, 7.2, 15.8, 24.6):
        lp = b.xf((float(px), 0.0, -0.46))
        yp = grader.footing_y(lp[0], lp[2], 0.08)
        b.box(float(px), yp, -0.46, 0.68, y_b1_2f - yp + 0.08, 0.68, 'granite_dark', collide=True, bottom=True)

    # Main 15.6 m `桂林市公安局秀峰分局榕城派出所` illuminated fascia on 2F waistband
    _mounted_sign(b, 0.0, y_b1_2f + 0.72, 0.0, 15.6, 1.28, 'sign_rongcheng_main', protrude=0.20, embed=0.20, lit=True)

    # Stepped central roof pediment + Civic Star-Shield Emblem (`警务盾星徽`)
    b.box(0.0, y_b1_top - 0.15, -0.58, 11.6, 2.15, 1.25, 'white_clean', cap_region='police_blue', bottom=True)
    _mounted_sign(b, 0.0, y_b1_top + 0.92, 0.045, 1.72, 1.72, 'emblem_medallion', protrude=0.14, embed=0.22, lit=True)

    # Recessed 1F Reception Hall (`z = -2.05 m` on B1_1F wall), unobstructed at `px = 0.0`!
    y_porch = grader.local_y(n_mid_x, n_mid_z)
    yb_hall_n = grader.footing_y(n_mid_x, n_mid_z, 0.08)
    b.box(0.0, yb_hall_n, -2.05, 9.2, y_porch + 3.12 - yb_hall_n, 0.36, 'dark_metal', bottom=True)
    _mounted_sign(b, 0.0, y_porch + 1.56, -1.87, 8.8, 2.84, 'hall_interior', protrude=0.05, embed=0.24, lit=True)

    # Mount `110` lightbox onto inner-west colonnade pier (`px = -7.2`, front face `z = -0.12`)
    _mounted_sign(b, -7.2, y_porch + 1.88, -0.12, 0.76, 1.74, 'sign_110_box', protrude=0.12, embed=0.24, lit=True)

    # Grounded freestanding legal-education bulletin board in east colonnade bay (`px = +11.5`)
    lp_bul_l = b.xf((10.0, 0.0, -1.65))
    lp_bul_r = b.xf((13.0, 0.0, -1.65))
    yb_l = grader.footing_y(lp_bul_l[0], lp_bul_l[2], 0.08)
    yb_r = grader.footing_y(lp_bul_r[0], lp_bul_r[2], 0.08)
    b.box(10.0, yb_l, -1.65, 0.14, y_porch + 2.45 - yb_l, 0.14, 'dark_metal', collide=True, bottom=True)
    b.box(13.0, yb_r, -1.65, 0.14, y_porch + 2.45 - yb_r, 0.14, 'dark_metal', collide=True, bottom=True)
    b.box(11.5, y_porch + 0.85, -1.65, 3.45, 1.68, 0.22, 'dark_metal', bottom=True)
    _mounted_sign(b, 11.5, y_porch + 1.69, -1.54, 3.32, 1.56, 'sign_bulletin', protrude=0.06, embed=0.18, lit=False)
    b.restore_frame(f_b1n)

    # 1d. South Courtyard Command Facade of Rongcheng Police Station
    s_mid_x, s_mid_z = (5.05 - 53.35) * 0.5, (2.63 - 8.77) * 0.5
    s_dx, s_dz = -53.35 - 5.05, -8.77 - 2.63
    f_b1s = b.set_frame(origin=(s_mid_x, 0.0, s_mid_z), front_xz=(s_dz, -s_dx))
    y_ct_n = grader.local_y(s_mid_x, s_mid_z)
    b.box(-4.0, y_ct_n + 3.35, 0.85, 11.4, 0.42, 2.05, 'police_blue', cap_region='dark_metal', bottom=True)
    _mounted_sign(b, -4.0, y_b1_2f + 0.68, 0.0, 11.2, 1.05, 'sign_rongcheng_main', protrude=0.18, embed=0.20, lit=True)
    yb_hall_s = grader.footing_y(s_mid_x, s_mid_z, 0.08)
    b.box(-4.0, yb_hall_s, 0.08, 7.6, y_ct_n + 3.04 - yb_hall_s, 0.34, 'dark_metal', bottom=True)
    _mounted_sign(b, -4.0, y_ct_n + 1.52, 0.25, 7.2, 2.76, 'hall_interior', protrude=0.05, embed=0.24, lit=True)
    if b.detail:
        for ax_x in (-21.0, -14.5, 8.5, 16.0):
            for fl_y in (y_b1_band1 + 1.4, y_b1_band1 + 4.9, y_b1_band1 + 8.4):
                b.box(ax_x, fl_y, 0.14, 0.92, 0.64, 0.48, 'white_clean', bottom=True)
    b.restore_frame(f_b1s)

    # -----------------------------------------------------------------------
    # 2. Zhongqu Traffic Police Squadron (`way/675586430`, 5F stepped L-wing, world 167.4 m)
    # -----------------------------------------------------------------------
    y_b2_2f = round(156.85 - oy, 4)
    y_b2_band = round(157.82 - oy, 4)
    y_b2_roof = round(166.70 - oy, 4)
    y_b2_top = round(167.45 - oy, 4)

    _grounded_prism(b, grader, B2_1F_PTS, y_b2_2f + 0.06, 'granite_dark', cap_region=None, tile_u=3.0)
    _grounded_prism(
        b, grader, B2_UPPER_PTS, y_b2_band, 'police_blue',
        cap_region=None, bottom_cap_region='white_clean', y_bot_fixed=y_b2_2f, tile_u=3.2,
    )
    _grounded_prism(
        b, grader, B2_UPPER_PTS, y_b2_roof, 'traffic_glass_wall',
        cap_region=None, y_bot_fixed=y_b2_band, tile_u=3.5, tile_v=4.45,
    )
    _grounded_prism(
        b, grader, B2_UPPER_PTS, y_b2_top, 'police_blue',
        cap_region='roof_conc', y_bot_fixed=y_b2_roof, tile_u=3.2,
    )

    # 2a. NE Frontage `(22.34, -5.56) -> (35.35, 3.18)` facing Yiren Rd × Libin Rd intersection
    ne_mx, ne_mz = (22.34 + 35.35) * 0.5, (-5.56 + 3.18) * 0.5
    f_b2ne = b.set_frame(origin=(ne_mx, 0.0, ne_mz), front_xz=(8.74, -13.01))
    _mounted_sign(b, 0.0, y_b2_2f + 0.66, 0.0, 12.2, 1.18, 'sign_traffic_main', protrude=0.20, embed=0.20, lit=True)
    b.box(0.0, y_b2_top - 0.15, -0.58, 7.6, 1.85, 1.15, 'white_clean', cap_region='police_blue', bottom=True)
    _mounted_sign(b, 0.0, y_b2_top + 0.76, 0.04, 1.48, 1.48, 'emblem_medallion', protrude=0.14, embed=0.22, lit=True)
    b.cylinder_y(0.0, y_b2_top - 0.15, 5.65, -2.4, 0.14, 'dark_metal', sections=6)
    if b.detail:
        b.box(0.0, y_b2_top + 3.8, -2.4, 1.35, 0.14, 0.36, 'white_clean', bottom=True)
        b.cylinder_y(0.0, y_b2_top + 5.42, 0.24, -2.4, 0.08, 'red_lit', sections=6, lit=True)
    b.restore_frame(f_b2ne)

    # 2b. SE Frontage `(37.10, 4.93) -> (15.48, 26.31)` overlooking Iron-Cavalry Motorcycle Bays
    se_mx, se_mz = (37.10 + 15.48) * 0.5, (4.93 + 26.31) * 0.5
    f_b2se = b.set_frame(origin=(se_mx, 0.0, se_mz), front_xz=(21.38, 21.62))
    y_apron = grader.local_y(se_mx, se_mz)
    _mounted_sign(b, 0.0, y_b2_2f + 0.66, 0.0, 13.4, 1.16, 'sign_traffic_main', protrude=0.20, embed=0.20, lit=True)
    # Recessed 1F doors along B2_1F SE wall (`z = -1.55 m` under B2 2F overhang)
    yb_apron = grader.footing_y(se_mx, se_mz, 0.08)
    b.box(-3.6, yb_apron, -1.45, 5.0, y_apron + 2.82 - yb_apron, 0.32, 'dark_metal', bottom=True)
    _mounted_sign(b, -3.6, y_apron + 1.42, -1.29, 4.7, 2.56, 'hall_interior', protrude=0.05, embed=0.22, lit=True)
    b.box(3.6, yb_apron, -1.45, 5.0, y_apron + 2.82 - yb_apron, 0.32, 'dark_metal', bottom=True)
    _mounted_sign(b, 3.6, y_apron + 1.42, -1.29, 4.7, 2.56, 'hall_interior', protrude=0.05, embed=0.22, lit=True)
    b.restore_frame(f_b2se)

    # -----------------------------------------------------------------------
    # 3. South Duty Wing (`4f12b2be`, Libin Rd No. 3, 3F, world 162.35 m)
    # -----------------------------------------------------------------------
    y_b3_top = round(162.35 - oy, 4)
    _grounded_prism(b, grader, B3_SOUTH_PTS, y_b3_top - 0.55, 'beige_annex_wall', cap_region=None, tile_u=3.2, tile_v=4.8)
    _grounded_prism(b, grader, B3_SOUTH_PTS, y_b3_top, 'police_blue', cap_region='roof_conc', y_bot_fixed=y_b3_top - 0.55, tile_u=3.2)
    f_b3 = b.set_frame(origin=(1.45, 0.0, 43.21), front_xz=(12.65, 11.42))
    y_b3g = grader.footing_y(1.45, 43.21, -0.10)
    _mounted_sign(b, 0.0, y_b3_top - 1.35, 0.0, 7.6, 0.96, 'sign_south_duty', protrude=0.16, embed=0.18, lit=True)
    _mounted_sign(b, -2.2, y_b3g + 2.1, 0.0, 3.1, 1.52, 'sign_bulletin', protrude=0.12, embed=0.18, lit=False)
    b.restore_frame(f_b3)

    # -----------------------------------------------------------------------
    # 4. West Fast-Handling & Equipment Locker Wing (`8a366675`, 3F, world 162.45 m)
    # -----------------------------------------------------------------------
    y_b4_top = round(162.45 - oy, 4)
    _grounded_prism(b, grader, B4_WEST_PTS, y_b4_top - 0.55, 'beige_annex_wall', cap_region=None, tile_u=3.2, tile_v=4.8)
    _grounded_prism(b, grader, B4_WEST_PTS, y_b4_top, 'police_blue', cap_region='roof_conc', y_bot_fixed=y_b4_top - 0.55, tile_u=3.2)

    eq_mx, eq_mz = (-23.46 - 20.52) * 0.5, (23.69 + 15.07) * 0.5
    f_b4e = b.set_frame(origin=(eq_mx, 0.0, eq_mz), front_xz=(8.62, 2.94))
    y_eq = grader.local_y(eq_mx, eq_mz)
    b.box(0.0, y_eq + 3.02, 0.95, 7.8, 0.34, 2.15, 'police_blue', cap_region='dark_metal', bottom=True)
    # Raised +0.40 m (`y_eq + 4.22`) so lime-green subtitle bar clears canopy cleanly!
    _mounted_sign(b, 0.0, y_eq + 4.22, 0.0, 7.4, 1.02, 'sign_equip_hall', protrude=0.18, embed=0.18, lit=True)
    yb_eq = grader.footing_y(eq_mx, eq_mz, 0.08)
    b.box(0.0, yb_eq, 0.06, 6.4, y_eq + 2.90 - yb_eq, 0.32, 'dark_metal', bottom=True)
    _mounted_sign(b, 0.0, y_eq + 1.46, 0.22, 6.0, 2.64, 'hall_interior', protrude=0.05, embed=0.22, lit=True)
    # Violence-Scale-A compliant Volunteer Hi-Vis Vest Rack & Traffic Cone Stack
    lp_rk = b.xf((-2.1, 0.0, 1.15))
    y_rk = grader.local_y(lp_rk[0], lp_rk[2]) - 0.04
    b.box(-2.1, y_rk, 1.15, 1.35, 1.58, 0.44, 'dark_metal', collide=True, bottom=True)
    b.box(-2.1, y_rk + 0.68, 1.15, 1.16, 0.72, 0.54, 'lime_vest', bottom=True)
    b.restore_frame(f_b4e)
    for cz_off in (-1.2, -0.5, 0.2):
        _add_traffic_cone(b, grader, eq_mx + 1.35, eq_mz + cz_off)

    # -----------------------------------------------------------------------
    # 5. Courtyard EV Cruiser Charging & Dispatch Pavilion (`ca4acda4`, 2F, world 158.55 m)
    # -----------------------------------------------------------------------
    y_b5_top = round(158.55 - oy, 4)
    _grounded_prism(b, grader, B5_PAVILION_PTS, y_b5_top - 0.45, 'white_clean', cap_region=None, tile_u=2.6)
    _grounded_prism(b, grader, B5_PAVILION_PTS, y_b5_top, 'police_blue', cap_region='roof_conc', y_bot_fixed=y_b5_top - 0.45, tile_u=2.6)
    for ch_x, ch_z in ((-6.1, 20.4), (-7.4, 19.4)):
        yc = grader.local_y(ch_x, ch_z)
        b.box(ch_x, yc - 0.04, ch_z, 0.52, 1.76, 0.38, 'police_blue', cap_region='white_clean', collide=True, bottom=True)
        if b.detail:
            b.box(ch_x, yc + 1.05, ch_z, 0.36, 0.38, 0.44, 'blue_lit', lit=True, bottom=True)

    # -----------------------------------------------------------------------
    # 6. Southeast Libin Rd Main Dispatch Gateway, Guardhouse & Boom Barrier
    # -----------------------------------------------------------------------
    gx, gz = 11.2, 31.2
    y_gate = grader.local_y(gx, gz)
    f_gate = b.set_frame(origin=(gx, y_gate, gz), front_xz=(0.72, 0.69))

    for sx in (-4.9, 4.9):
        lp_pier = b.xf((sx, 0.0, 0.0))
        y_pier_bot = min(-0.18, grader.local_y(lp_pier[0], lp_pier[2]) - y_gate - 0.08)
        b.box(sx, y_pier_bot, 0.0, 1.15, 5.25 - y_pier_bot, 1.25, 'granite_dark', cap_region='police_blue', collide=True, bottom=True)
        b.box(sx, 3.85, 0.0, 1.24, 0.72, 1.32, 'police_blue', bottom=True)

    b.box(0.0, 4.95, 0.0, 11.4, 1.22, 1.18, 'police_blue', cap_region='roof_conc', bottom=True)
    _mounted_sign(b, 0.0, 5.56, 0.59, 9.6, 1.04, 'sign_gate_arch', protrude=0.06, embed=0.22, lit=True)
    _mounted_sign(b, 0.0, 5.56, -0.59, 9.6, 1.04, 'sign_gate_arch', protrude=0.06, embed=0.22, lit=True, flip_z=True)

    lp_gh = b.xf((-6.55, 0.0, -0.65))
    y_gh_bot = min(-0.18, grader.local_y(lp_gh[0], lp_gh[2]) - y_gate - 0.08)
    b.box(-6.55, y_gh_bot, -0.65, 2.35, 2.80 - y_gh_bot, 2.45, 'white_clean', cap_region='police_blue', collide=True, bottom=True)
    b.box(-6.55, 2.35, -0.65, 2.50, 0.45, 2.60, 'police_blue', bottom=True)
    b.box(-6.55, 1.05, 0.56, 1.65, 1.12, 0.16, 'cabin_glass', bottom=True)
    _mounted_sign(b, -4.9, 2.45, 0.625, 1.05, 0.62, 'sign_no_park', protrude=0.05, embed=0.18, lit=False)

    lp_bm = b.xf((-3.85, 0.0, 0.35))
    y_bm_bot = grader.local_y(lp_bm[0], lp_bm[2]) - y_gate - 0.05
    b.box(-3.85, y_bm_bot, 0.35, 0.44, 1.18, 0.40, 'police_blue', cap_region='yellow_mark', collide=True, bottom=True)
    b.box(-3.72, y_bm_bot + 0.90, 0.35, 0.14, 3.65, 0.10, 'boom_stripe', bottom=True)

    if b.detail:
        for sx in (-4.9, 4.9):
            b.cylinder_y(sx, 5.10, 0.28, 0.44, 0.12, 'blue_lit' if sx > 0 else 'red_lit', sections=6, lit=True)
    b.restore_frame(f_gate)

    # Slope-conforming yellow cross-hatch `出警通道` apron box strictly inside `grader.road_world`
    _add_mark_strip(b, grader, 8.2, 32.8, 13.4, 27.6, 0.18, 'yellow_mark')
    _add_mark_strip(b, grader, 9.8, 34.4, 15.0, 29.2, 0.18, 'yellow_mark')
    _add_mark_strip(b, grader, 8.2, 32.8, 9.8, 34.4, 0.18, 'yellow_mark')
    _add_mark_strip(b, grader, 13.4, 27.6, 15.0, 29.2, 0.18, 'yellow_mark')
    _add_mark_strip(b, grader, 8.2, 32.8, 15.0, 29.2, 0.13, 'yellow_mark')
    _add_mark_strip(b, grader, 9.8, 34.4, 13.4, 27.6, 0.13, 'yellow_mark')

    # -----------------------------------------------------------------------
    # 7. Corner `桂林交警 · 漓滨执勤岗` Kiosk + 6 Roadside Iron-Cavalry Bays
    # -----------------------------------------------------------------------
    kx, kz = 33.8, 7.6
    yk = grader.local_y(kx, kz)
    f_kiosk = b.set_frame(origin=(kx, yk, kz), front_xz=(0.76, 0.65))
    b.box(0.0, 0.004, 0.0, 3.0, 2.75, 2.5, 'white_clean', collide=True, bottom=True)
    b.box(0.0, 0.92, 1.28, 2.35, 1.18, 0.10, 'cabin_glass', bottom=True)
    b.box(0.0, 0.92, -1.28, 2.35, 1.18, 0.10, 'cabin_glass', bottom=True)
    b.box(0.0, 2.32, 0.0, 3.36, 0.54, 2.82, 'police_blue', bottom=True)
    b.box(0.0, 2.86, 0.0, 3.56, 0.15, 3.02, 'dark_metal', bottom=True)
    _mounted_sign(b, 0.0, 2.58, 1.41, 3.22, 0.48, 'sign_kiosk_jj', protrude=0.05, embed=0.18, lit=True)
    if b.detail:
        b.cylinder_y(-0.82, 3.01, 0.20, 0.25, 0.13, 'red_lit', sections=6, lit=True)
        b.cylinder_y(0.82, 3.01, 0.20, 0.25, 0.13, 'blue_lit', sections=6, lit=True)
    b.restore_frame(f_kiosk)

    for idx in range(6):
        mx = 30.8 - idx * 2.15
        mz = 12.6 + idx * 2.15
        _add_mark_strip(b, grader, mx - 0.65, mz - 1.45, mx + 1.05, mz + 0.25, 0.09, 'white_mark')
        if idx < 4:
            _add_iron_cavalry_moto(b, grader, mx + 0.22, mz - 0.52, front_xz=(0.71, 0.71))
        else:
            _add_mark_strip(b, grader, mx + 0.45, mz - 0.10, mx + 1.10, mz - 0.75, 0.11, 'yellow_mark')

    _add_traffic_cone(b, grader, 32.2, 10.8)
    _add_traffic_cone(b, grader, 32.9, 10.1)

    # -----------------------------------------------------------------------
    # 8. Courtyard Police Cruiser Fleet (4 Marked Bays + Dispatch Chevron Lane)
    # -----------------------------------------------------------------------
    cruiser_bays = [
        (-17.2, 3.2, False, True),   # Bay 1: Police Sedan #1
        (-10.6, 4.5, False, True),   # Bay 2: Police Sedan #2
        (-3.8, 5.8, True, True),     # Bay 3: Police Patrol Van / SUV
        (2.8, 12.8, False, False),   # Bay 4: Open Dispatch Launch Bay (`dispatchVehicleSpawn`)
    ]
    for bx, bz, is_van, occupied in cruiser_bays:
        _add_mark_strip(b, grader, bx - 1.45, bz - 2.2, bx - 0.65, bz + 2.3, 0.09, 'white_mark')
        _add_mark_strip(b, grader, bx + 1.45, bz - 2.2, bx + 2.25, bz + 2.3, 0.09, 'white_mark')
        if occupied:
            _add_police_cruiser(b, grader, bx + 0.4, bz + 0.1, front_xz=(0.19, 0.98), is_van=is_van)
        else:
            _add_mark_strip(b, grader, bx - 0.6, bz - 0.4, bx + 0.5, bz + 1.2, 0.13, 'yellow_mark')
            _add_mark_strip(b, grader, bx + 1.4, bz - 0.1, bx + 0.5, bz + 1.2, 0.13, 'yellow_mark')

    for wx_t, wz_t, th in ((-19.5, 9.2, 8.8), (-1.2, 31.0, 8.4)):
        yt = grader.local_y(wx_t, wz_t)
        b.box(wx_t, yt + 0.004, wz_t, 1.35, 0.22, 1.35, 'granite_dark', cap_region='bark', collide=True, bottom=True)
        b.tree_cluster(wx_t, yt + 0.02, wz_t, h=th, spread=3.4, foliage='foliage', bark='bark')


def build_metadata_extras(lm_surface) -> dict:
    """Build structured gameplay & dispatch network metadata for `public/landmarks/zhongqu_police.json`."""
    grader = SiteGrader(lm_surface)
    ox, oy, oz = grader.ox, grader.oy, grader.oz

    def pt_meta(lx: float, lz: float, yaw_deg: float, **extra):
        wx, wz = round(ox + lx, 3), round(oz + lz, 3)
        wy = round(oy + grader.local_y(lx, lz), 3)
        lat, lon = xz2ll(wx, wz)
        return {
            'local': [round(lx, 3), round(wy - oy, 3), round(lz, 3)],
            'world': [wx, wy, wz],
            'wgs84': [round(lon, 6), round(lat, 6)],
            'yawDeg': round(yaw_deg, 1),
            **extra,
        }

    return {
        'sites': {
            'policeStation': {
                'name': '桂林市公安局秀峰分局榕城派出所',
                'address': '桂林市秀峰区依仁路1-4号',
                'osmWay': 'way/675586428',
                'cmabHeightM': 17.25,
                **pt_meta(-22.1, -13.6, 11.0),
            },
            'trafficPoliceOutpost': {
                'name': '桂林市公安局交通警察支队秀峰大队·中区执勤中队',
                'address': '桂林市秀峰区依仁路与漓滨路交汇口（联动漓滨路3号）',
                'osmWay': 'way/675586430',
                'cmabHeightM': 15.85,
                **pt_meta(26.3, 15.6, 135.0),
            },
        },
        'interactionPoints': {
            'alarmReceptionTrigger': pt_meta(
                -22.1, -14.6, 191.0,
                radiusM=2.8,
                label='榕城派出所 24h 接警大厅 / 警务联动台',
            ),
            'equipmentLockerTrigger': pt_meta(
                -20.4, 19.3, 251.0,
                radiusM=2.6,
                label='警务装备领用室 · 交通快处中心',
                violenceScale='A',
                items=['volunteer_vest', 'traffic_whistle', 'safety_cone', 'cavalry_helmet'],
            ),
            'dispatchVehicleSpawn': pt_meta(
                3.2, 12.9, 136.0,
                clearanceM=4.95,
                gatewayWorld=[round(ox + 11.2, 3), round(oy + grader.local_y(11.2, 31.2), 3), round(oz + 31.2, 3)],
                exitRoadWay='way/675174045',
                label='制式警车院内快速发车位（经漓滨路出警通道）',
            ),
            'dispatchMotoSpawn': pt_meta(
                22.4, 20.5, 135.0,
                exitRoadWay='way/675099990',
                label='桂林交警铁骑路侧快速发车泊位',
            ),
        },
        'parkingBays': [
            pt_meta(-16.8, 3.3, 169.0, id='cruiser_bay_1', kind='police_sedan', occupied=True),
            pt_meta(-10.2, 4.6, 169.0, id='cruiser_bay_2', kind='police_sedan', occupied=True),
            pt_meta(-3.4, 5.9, 169.0, id='cruiser_bay_3', kind='police_van', occupied=True),
            pt_meta(3.2, 12.9, 136.0, id='cruiser_bay_4', kind='police_cruiser_spawn', occupied=False),
            *[
                pt_meta(
                    31.02 - i * 2.15,
                    12.08 + i * 2.15,
                    135.0,
                    id=f'iron_cavalry_bay_{i + 1}',
                    kind='traffic_police_moto',
                    occupied=(i < 4),
                )
                for i in range(6)
            ],
        ],
        'dispatchNetwork': {
            'linkedPosts': [
                {
                    'id': 'shizijie_traffic_kiosk',
                    'name': '十字街东北角「桂林交警」蓝白岗亭',
                    'source': 'pipeline/landmarks/shizijie.py',
                    'world': [-852.55, 151.65, -172.03],
                    'corridor': '依仁路 -> 中山中路 -> 十字街',
                },
                {
                    'id': 'jiefang_bridge_west_post',
                    'name': '解放桥西桥头交警与辅警劝导岗',
                    'source': 'pipeline/landmarks/jiefang_bridge.py',
                    'world': [-415.0, 151.9, 64.0],
                    'corridor': '漓滨路 (way/675174045) 直达解放桥西引道',
                },
                {
                    'id': 'central_square_police_station',
                    'name': '中心广场警务工作站',
                    'world': [-946.5, 153.8, 169.8],
                    'corridor': '依仁路西段 -> 中心广场',
                },
                {
                    'id': 'xiufeng_lijun_traffic_post',
                    'name': '秀峰交警大队丽君执勤岗',
                    'world': [-1764.5, 154.2, -256.5],
                    'corridor': '解放西路 -> 信义路 × 丽君路',
                },
            ],
            'gameplayConsumers': ['IDOK-282', 'IDOK-300', 'IDOK-319', 'IDOK-393', 'IDOK-394'],
        },
    }


if __name__ == '__main__':
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    lm_surf = _bootstrap_surface()
    atlas_img, atlas_rects = make_zhongqu_police_atlas()
    export_landmark_glb(
        out_dir / f'{LANDMARK_ID}.glb',
        atlas_img,
        atlas_rects,
        build_zhongqu_police,
        mat_prefix=LANDMARK_ID,
        lit_emissive=(0.82, 0.78, 0.70),
        surface=lm_surf,
        double_sided=False,
    )
    # Match `pipeline/pack_landmarks.py:465` (`f"{entry['id']}.meta.json"`) so repacking preserves all gameplay metadata!
    (out_dir / f'{LANDMARK_ID}.meta.json').write_text(
        json.dumps(build_metadata_extras(lm_surf), ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
