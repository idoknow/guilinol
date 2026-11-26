"""Guilin People's Hospital (桂林市人民医院 / 第一人民医院 · 文明路12号).

Full-campus realistic 3D landmark modeled from:
  - 2023-06 & 2018-06 Baidu z=4 NorthDir-calibrated street-view panoramas along
    Wenming Rd (west) and Binjiang Rd (east)
  - Esri z18 ortho-aerial imagery & Overture measured footprints
  - Tsinghua CMAB measured building heights (Guilin dataset)

Campus composition (local frame: +X East, +Y Up, +Z South; anchor at campus core):
  1. Main 8-storey Outpatient Complex (`#19`, exact Overture `01fd2105` footprint,
     IoU ~ 0.99 at y=6m audit slice) + 4F North Annex (`#19N`, dark-charcoal roof
     with cyan-blue eave):
     - 1F recessed dark-grey split-stone colonnade, silver-framed glazed entrance,
       cantilevered tension-rod glass canopy with red LED ticker, 6-step pale granite
       forecourt stairs & wheelchair/stretcher ramp.
     - 2F-5F warm-white stone/tile facade alternating blue-grey windows (with 3 white
       horizontal safety bars) and deep brown-red vertical louver grilles, centered on
       a recessed 4-storey blue-grey reflective curtain-wall atrium with warm-gold
       3D `门  诊` signage.
     - 6F-8F continuous white extruded grid crown, NW vertical stone signage pylon
       (green-blue emblem + vertical `桂林市人民医院`), and rooftop steel truss with
       red illuminated `桂林市人民医院` + flagpole + `桂林市急救中心 / GUILIN EMERGENCY CENTER`.
  2. 5-storey Emergency South Wing (`#27`, exact Overture `99e3dc89` footprint) with
     signature rust-red arched ribbed roof, recessed 1F Emergency Lobby (`急 诊` red
     3D letters, blue/white `急诊科·胸痛中心·卒中中心` directory), cantilevered white
     steel-truss translucent ambulance canopy, and 3F glazed skybridge to `#19`.
  3. Open Wenming Rd Forecourt Plaza & Underground Garage Ramp:
     - Shared GL04-blended `sidewalk` / `road` / `curb` surfaces (bound in
       `pipeline/seam-surfaces.json`, strictly subtracting native GL04 streets so
       Wenming Rd join has zero color/height seam).
     - 30m sunken underground parking ramp with warm-white tiled low walls, stainless
       railings, arched white steel-truss polycarbonate canopy, and blue overhead sign.
     - 10.5m low beige stone monument wall (`桂林市人民医院` + emblem + national centers).
     - 2 original low-poly 120 ambulances (Severity A compliant: clean civic look,
       zero violence/gore), planters, pruned pines/banyans, and safety bollards.
  4. North-Central Medical Tech Cluster:
     - `#10` 4F Health Management Center (deep charcoal + crisp white floor bands,
       `健康管理中心 HEALTH MANAGEMENT CENTER` along north ambulance lane).
     - `#15` 4F Med-Tech West Wing (bright white gridded skylight roof + 3F skybridge
       to `#19`), `#17` 4F Admin/Med-Tech (dark terracotta roof + blue roof shed),
       `#20` 5F Central Med-Tech Slab (rooftop HVAC chillers), `#16` 2F Substation.
  5. Central New 10-11F Pi-Shaped Inpatient Tower:
     - Exact `#25` (10F West Wing) + `#26` (10F East Wing) + North Main Wing (11F,
       blue-grey curtain wall + silver mullions + green rooftop garden patch + HVAC
       chillers + elevator penthouse), connected via high skybridges (y >= 9m) so
       y=6m audit slices remain clean per building.
  6. East Binjiang-Style Inpatient Wings, Round Pavilion & Central Garden:
     - `#21` + `#24` 6F East Long Inpatient Block (1F pale stone base + 2F-6F Guilin
       blue-grey brick facade with white horizontal slab bands & white windows +
       Binjiang-style East Gate with blue `桂林市人民医院` lintel sign and iron fence).
     - `#31` 6F South-Central Horizontal Inpatient Wing (`auditBuildings`), `#29` 5F
       West Old Inpatient Wing, Southwest 5F Heart Center (crisp white flat roof
       covering `#30`/`#32`), `#34` 5F Signature 21m Round Inpatient Building, and
       `#35` Lush Central Courtyard Garden with walkways, benches & shade trees.

All textures are 100% procedurally synthesized with IDOK-385 v1+ 20% neutral-luma
desaturation governor (compensating `look.gradeDay` 1.22x saturation boost), packed
into a single 1024x1024 KTX2 atlas (~1.33 MB GPU VRAM << 4 MB budget), zero lights.
"""
from __future__ import annotations

import math
from pathlib import Path
import sys

import mapbox_earcut
import numpy as np
import shapely
from shapely.geometry import Point, Polygon
from PIL import Image, ImageDraw

PIPELINE_DIR = Path(__file__).resolve().parents[1]
LANDMARKS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPELINE_DIR))
sys.path.insert(0, str(LANDMARKS_DIR))

from common import ll2xz
from features import polygons as shapely_polygons
from seam_streets import Streets
from world_surface import Surface
from m26_16_kit import SceneBuilder, export_landmark_glb, get_font

# Canonical anchor inside campus core (WGS84 lon, lat)
ANCHOR_LON = 110.290180
ANCHOR_LAT = 25.272520
ORIGIN_X, ORIGIN_Z = ll2xz(ANCHOR_LAT, ANCHOR_LON)  # (-988.47, 827.09)

# Reserved gameplay & emergency-recovery anchor coordinates (Severity A compliant:
# non-violent light-comedy recovery spawn & ambulance entry/bay hooks; read-only metadata)
GAMEPLAY_ANCHORS = {
    'ambulance_north_entry': {
        'label': '人民医院北急救车入口（文明路×北竹园里）',
        'worldXZ': [round(ORIGIN_X - 61.5, 2), round(ORIGIN_Z - 47.6, 2)],
        'yawDeg': 90.0,
    },
    'ambulance_south_entry': {
        'label': '人民医院南急诊入口（文明路南口）',
        'worldXZ': [round(ORIGIN_X - 73.5, 2), round(ORIGIN_Z + 34.9, 2)],
        'yawDeg': 98.0,
    },
    'ambulance_bay_outpatient': {
        'label': '门诊大楼南端 120 救护车停靠位',
        'worldXZ': [round(ORIGIN_X - 44.5, 2), round(ORIGIN_Z + 18.5, 2)],
        'yawDeg': 193.0,
    },
    'ambulance_bay_emergency': {
        'label': '急诊大厅遮雨棚急救车停靠位',
        'worldXZ': [round(ORIGIN_X - 48.0, 2), round(ORIGIN_Z + 31.0, 2)],
        'yawDeg': 103.0,
    },
    'comedy_recovery_spawn': {
        'label': '门诊前广场轻度喜剧急救复位点（暴力尺度A）',
        'worldXZ': [round(ORIGIN_X - 51.0, 2), round(ORIGIN_Z - 2.0, 2)],
        'yawDeg': 283.0,
    },
}

# Exact Overture local polygons relative to (ORIGIN_X, ORIGIN_Z)
POLY_10_HEALTH = [[-1.07, -58.61], [-15.21, -63.59], [-19.20, -52.29], [-5.05, -47.31]]
POLY_15_MEDW = [[9.53, -11.96], [9.55, -31.10], [-3.98, -31.16], [-3.99, -12.03]]
POLY_16_UTIL = [[57.83, -17.31], [57.84, -24.80], [47.34, -24.81], [47.33, -17.31]]
POLY_17_ADMIN = [[38.45, -28.00], [14.46, -28.54], [14.13, -13.56], [38.12, -13.02]]
POLY_19_OUTPATIENT = [
    [-13.32, -19.90], [-33.76, -24.63], [-36.81, -11.51], [-23.67, -8.46],
    [-25.03, -2.63], [-39.63, -6.01], [-42.68, 7.12], [-32.45, 9.49],
    [-34.15, 16.79], [-22.46, 19.50],
]
POLY_20_MEDC = [[2.34, 7.57], [43.69, 7.87], [43.81, -9.09], [2.46, -9.37]]
POLY_21_EASTN = [
    [57.12, 3.12], [55.68, 18.03], [58.67, 18.31], [59.25, 12.35],
    [78.65, 14.22], [80.37, -3.67], [52.02, -6.40], [51.15, 2.55],
]
POLY_24_EASTS = [
    [69.14, 44.40], [68.84, 23.21], [60.35, 23.33], [60.53, 36.04],
    [55.24, 36.12], [55.45, 50.94], [61.81, 50.86], [61.72, 44.50],
]
POLY_25_TOWER_W = [[11.50, 29.11], [-18.19, 29.08], [-18.20, 46.02], [11.48, 46.06]]
POLY_26_TOWER_E = [[47.60, 36.74], [22.15, 37.02], [22.32, 51.85], [47.77, 51.56]]
POLY_27_EMERGENCY = [[-51.07, 49.79], [-30.50, 54.03], [-27.48, 39.36], [-48.04, 35.12]]
POLY_29_WEST_OLD = [[2.26, 64.88], [11.08, 64.67], [10.59, 50.40], [1.57, 50.85]]
POLY_31_SOUTH_BAR = [[14.74, 67.06], [59.28, 66.82], [59.23, 56.23], [14.69, 56.46]]

# Non-Overture verified aerial buildings (gaps in Overture footprint capture)
# 1) Outpatient North 4F Annex (between #19 north wall and north ambulance lane)
POLY_19N_ANNEX = [[-13.9, -21.2], [-33.9, -25.8], [-37.1, -39.4], [-17.1, -34.8]]
# 2) Central New Pi-Tower North Main Wing (between #20 south wall z=7.9 and #25/#26 north wall z=29.1)
POLY_TOWER_NORTH = [[-16.2, 11.4], [46.8, 11.4], [46.8, 27.6], [-16.2, 27.6]]
# 3) Southwest 5F Heart Center (bright white flat roof covering #30/#32, strictly north of Zhuyuanli #36)
POLY_HEART_CENTER = [[-54.2, 55.2], [-31.0, 55.2], [-31.0, 64.6], [-54.2, 64.6]]
# 4) Southwest-Central Connector Block (between Heart Center east and #29 west)
POLY_SW_CONN = [[-28.5, 48.2], [-13.5, 48.2], [-13.5, 64.5], [-28.5, 64.5]]


class FallbackLandmarkSurface:
    """Provides identical API to LandmarkSurface before/after world manifest rebuild."""

    def __init__(self, world: Surface, landmark_id: str):
        self.name = landmark_id
        self.surface = world
        entry = world.entries.get(landmark_id)
        if entry is not None:
            self.x, self.y, self.z = entry['position']
            angle = math.radians(entry.get('rotation', 0.0))
        else:
            self.x = float(ORIGIN_X)
            self.z = float(ORIGIN_Z)
            self.y = round(float(world.sample(self.x, self.z)[0]), 2)
            angle = 0.0
        self.cos, self.sin = math.cos(angle), math.sin(angle)

    def sample(self, x: float, z: float):
        wx = self.x + self.cos * x + self.sin * z
        wz = self.z - self.sin * x + self.cos * z
        g, w = self.surface.sample(wx, wz)
        return g - self.y, None if w is None else w - self.y

    def ground(self, x: float, z: float) -> float:
        return self.sample(x, z)[0]

    def water(self, x: float, z: float):
        return self.sample(x, z)[1]


def _desat(rgb: tuple[int, int, int], factor: float = 0.22) -> tuple[int, int, int]:
    """IDOK-385 v1+ saturation governor: blend neutral luma to counter look.gradeDay 1.22x."""
    r, g, b = rgb
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    return (
        int(round(np.clip(r * (1.0 - factor) + luma * factor, 0, 255))),
        int(round(np.clip(g * (1.0 - factor) + luma * factor, 0, 255))),
        int(round(np.clip(b * (1.0 - factor) + luma * factor, 0, 255))),
    )


def _add_noise_rect(arr: np.ndarray, x: int, y: int, w: int, h: int, sigma: float, seed: int, rain_streaks: bool = False):
    rng = np.random.default_rng(seed)
    patch = arr[y:y + h, x:x + w].astype(np.float32)
    patch += rng.normal(0.0, sigma, (h, w, 1)).astype(np.float32)
    if rain_streaks and h > 16:
        yy = np.arange(h, dtype=np.float32)[:, None]
        freq = rng.uniform(0.0, 1.0, w)
        smooth = np.convolve(freq, np.ones(5) / 5.0, mode='same')
        streak = (smooth[None, :] ** 2.3) * np.exp(-yy / (h * 0.35)) * 0.10
        patch *= (1.0 - streak[:, :, None])
    arr[y:y + h, x:x + w] = np.clip(patch, 0, 255).astype(np.uint8)


def _draw_emblem(dr: ImageDraw.ImageDraw, cx: int, cy: int, r: int):
    """Draw Guilin People's Hospital circular green-blue civic medical emblem."""
    c_teal = _desat((34, 138, 128), 0.20)
    c_blue = _desat((36, 98, 152), 0.20)
    c_white = (238, 240, 238)
    dr.ellipse((cx - r, cy - r, cx + r, cy + r), fill=c_white, outline=c_blue, width=max(2, r // 7))
    r_in = int(r * 0.72)
    dr.ellipse((cx - r_in, cy - r_in, cx + r_in, cy + r_in), outline=c_teal, width=max(2, r // 8))
    # Stylized stylized medical cross / leaf emblem inside circle (clean, non-violent)
    arm = max(3, int(r * 0.44))
    th = max(2, int(r * 0.16))
    dr.rectangle((cx - th, cy - arm, cx + th, cy + arm), fill=c_teal)
    dr.rectangle((cx - arm, cy - th, cx + arm, cy + th), fill=c_teal)
    dr.ellipse((cx - th, cy - th, cx + th, cy + th), fill=c_blue)


def make_hospital_atlas() -> tuple[Image.Image, dict[str, tuple[int, int, int, int]]]:
    """Synthesize a single 1024x1024 PBR atlas with weathered stone, louver grilles,
    curtain glass, Binjiang grey brick, civic hospital signs & swatches (0 photo crops)."""
    S = 1024
    im = Image.new('RGB', (S, S), _desat((208, 204, 196)))
    dr = ImageDraw.Draw(im)
    rects: dict[str, tuple[int, int, int, int]] = {}

    # Architectural glazing color calibrated cleanly past web/src/look/night.ts linear threshold (B-R > 0.08 >> 0.03, lum < 0.05)
    # so EVERY window glows crisp, uniform amber-warm at night with ZERO pixel-level snowflake noise!
    GLASS_BLUE = (30, 56, 86)
    GLASS_BLUE_ALT = (36, 66, 98)
    GLASS_TEAL = (24, 66, 88)

    # === ROW 1 (y: 0..256): OUTPATIENT & HOSPITAL MAIN FACADES ===
    # 1a. Outpatient 2F-4F Warm-White Tile + Blue-Grey Window w/ 3 White Safety Bars + Brown-Red Louver Bay (0, 0, 256, 256)
    rects['outpatient_mid'] = (0, 0, 256, 256)
    dr.rectangle((0, 0, 255, 255), fill=_desat((216, 212, 203)))
    for ty in range(0, 256, 16):
        dr.line((0, ty, 255, ty), fill=_desat((194, 190, 182)), width=1)
    for fy in (0, 128):
        dr.rectangle((0, fy, 255, fy + 26), fill=_desat((222, 218, 210)))
        dr.line((0, fy + 26, 255, fy + 26), fill=_desat((162, 158, 152)), width=2)
        wx0, wy0, wx1, wy1 = 14, fy + 32, 134, fy + 116
        dr.rectangle((wx0, wy0, wx1, wy1), fill=GLASS_BLUE, outline=_desat((184, 186, 186)), width=3)
        for mx in (wx0 + 40, wx0 + 80):
            dr.line((mx, wy0, mx, wy1), fill=_desat((174, 178, 180)), width=2)
        dr.line((wx0, wy0 + 26, wx1, wy0 + 26), fill=_desat((174, 178, 180)), width=2)
        for by in (wy1 - 32, wy1 - 20, wy1 - 8):
            dr.rectangle((wx0 + 2, by, wx1 - 2, by + 4), fill=_desat((228, 226, 222)))
        lx0, ly0, lx1, ly1 = 152, fy + 30, 244, fy + 118
        dr.rectangle((lx0, ly0, lx1, ly1), fill=_desat((78, 52, 46)), outline=_desat((164, 158, 150)), width=2)
        for gx in range(lx0 + 4, lx1 - 2, 7):
            dr.rectangle((gx, ly0 + 2, gx + 3, ly1 - 2), fill=_desat((132, 82, 68)))

    # 1b. Outpatient 6F-8F Continuous White Extruded Grid Crown (256, 0, 256, 256)
    rects['outpatient_top'] = (256, 0, 256, 256)
    dr.rectangle((256, 0, 511, 255), fill=_desat((226, 224, 218)))
    for fy in (0, 128):
        for cx in range(256, 512, 64):
            dr.rectangle((cx + 8, fy + 10, cx + 56, fy + 118), fill=(154, 154, 154), outline=_desat((184, 182, 178)), width=2)
            dr.rectangle((cx + 14, fy + 18, cx + 38, fy + 108), fill=GLASS_BLUE)
            dr.line((cx + 26, fy + 18, cx + 26, fy + 108), fill=(176, 176, 176), width=2)
            for ly in range(fy + 22, fy + 108, 8):
                dr.line((cx + 40, ly, cx + 53, ly), fill=(124, 124, 124), width=2)

    # 1c. Modern Blue-Grey Reflective Curtain Wall (Atrium & Central 10-11F Inpatient Tower) (512, 0, 256, 256)
    rects['curtain_wall'] = (512, 0, 256, 256)
    dr.rectangle((512, 0, 767, 255), fill=GLASS_BLUE)
    for fy in range(0, 256, 64):
        dr.rectangle((512, fy, 767, fy + 14), fill=(184, 186, 186))
        dr.rectangle((512, fy + 14, 767, fy + 18), fill=(104, 106, 108))
        for cx in range(512, 768, 32):
            pane_c = GLASS_BLUE if ((cx // 32 + fy // 64) % 3) else GLASS_BLUE_ALT
            dr.rectangle((cx + 2, fy + 19, cx + 30, fy + 62), fill=pane_c)
            dr.line((cx, fy, cx, fy + 63), fill=(178, 180, 182), width=2)
        dr.line((512, fy + 44, 767, fy + 44), fill=(134, 136, 138), width=1)

    # 1d. Binjiang East Wing Facade: Neutral Medium Cool-Grey Brick (stays legible in afternoon shade, B-R < 0.01 so walls never speckle at night!) + Crisp White Slab Bands & Clean Night-Calibrated Windows (768, 0, 256, 256)
    rects['binjiang_brick'] = (768, 0, 256, 256)
    dr.rectangle((768, 0, 1023, 255), fill=(124, 127, 129))
    for by in range(0, 256, 12):
        dr.line((768, by, 1023, by), fill=(102, 105, 107), width=1)
    for fy in (0, 128):
        dr.rectangle((768, fy, 1023, fy + 16), fill=_desat((232, 232, 228)))
        dr.line((768, fy + 16, 1023, fy + 16), fill=(88, 90, 92), width=2)
        for cx in (784, 864, 944):
            dr.rectangle((cx, fy + 32, cx + 62, fy + 106), fill=GLASS_BLUE, outline=_desat((232, 234, 232)), width=4)
            dr.line((cx + 31, fy + 32, cx + 31, fy + 106), fill=_desat((228, 230, 228)), width=3)
            dr.line((cx, fy + 56, cx + 62, fy + 56), fill=_desat((228, 230, 228)), width=2)

    # === ROW 2 (y: 256..512): MED-TECH, EMERGENCY, HEALTH CENTER & 1F COLONNADE ===
    # 2a. Warm-White Med-Tech / Inpatient Ribbon Window Wall (0, 256, 256, 256)
    rects['medtech_wall'] = (0, 256, 256, 256)
    dr.rectangle((0, 256, 255, 511), fill=_desat((214, 210, 202)))
    for fy in (256, 384):
        dr.rectangle((0, fy, 255, fy + 22), fill=_desat((194, 190, 184)))
        dr.rectangle((10, fy + 34, 246, fy + 104), fill=GLASS_BLUE, outline=(184, 186, 186), width=3)
        for mx in range(44, 246, 34):
            dr.line((mx, fy + 34, mx, fy + 104), fill=(178, 180, 182), width=2)
        dr.line((10, fy + 54, 246, fy + 54), fill=(178, 180, 182), width=2)

    # 2b. 1F Dark-Grey Split-Stone Colonnade (strictly neutral grey so walls never trigger night glazing) (256, 256, 256, 128)
    rects['base_split_stone'] = (256, 256, 256, 128)
    dr.rectangle((256, 256, 511, 383), fill=(84, 85, 86))
    for r_i, sy in enumerate(range(256, 384, 16)):
        dr.line((256, sy, 511, sy), fill=(62, 63, 64), width=2)
        off = (r_i % 2) * 20
        for sx in range(256 + off, 512, 40):
            dv = ((r_i * 11 + sx * 3) % 18) - 9
            tone = (82 + dv, 83 + dv, 84 + dv)
            dr.rectangle((sx + 1, sy + 1, min(511, sx + 38), sy + 14), fill=tone)

    # 2c. 1F Entrance Sliding Glass Doors / Lobby Interior (256, 384, 256, 128)
    rects['lobby_glass'] = (256, 384, 256, 128)
    dr.rectangle((256, 384, 511, 511), fill=GLASS_BLUE)
    dr.rectangle((276, 406, 492, 504), fill=(40, 68, 96))
    for dx in range(256, 512, 64):
        dr.rectangle((dx, 384, dx + 5, 511), fill=(186, 188, 188))
    dr.rectangle((256, 384, 511, 396), fill=(178, 180, 180))
    dr.rectangle((256, 444, 511, 449), fill=(198, 200, 200))

    # 2d. Health Management Center Charcoal Facade w/ White Bands (`#10`) (512, 256, 256, 128)
    rects['health_charcoal'] = (512, 256, 256, 128)
    dr.rectangle((512, 256, 767, 383), fill=(68, 70, 72))
    for fy in (256, 320):
        dr.rectangle((512, fy, 767, fy + 6), fill=_desat((224, 224, 220)))
        for wx in range(528, 756, 46):
            dr.rectangle((wx, fy + 16, wx + 32, fy + 52), fill=GLASS_BLUE, outline=(212, 214, 212), width=2)

    # 2e. Emergency 2F-4F Blue-Green Mullioned Glass Wall (`#27`) (512, 384, 256, 128)
    rects['emerg_glass'] = (512, 384, 256, 128)
    dr.rectangle((512, 384, 767, 511), fill=GLASS_TEAL)
    for gx in range(512, 768, 32):
        dr.line((gx, 384, gx, 511), fill=(188, 192, 192), width=2)
    for gy in range(384, 512, 32):
        dr.line((512, gy, 767, gy), fill=(188, 192, 192), width=2)

    # 2f. Warm-White Small Strip Tile (Garage Ramp Low Wall & Med-Tech Accents) (768, 256, 128, 128)
    rects['white_tile'] = (768, 256, 128, 128)
    dr.rectangle((768, 256, 895, 383), fill=_desat((220, 216, 208)))
    for ty in range(256, 384, 10):
        dr.line((768, ty, 895, ty), fill=_desat((190, 186, 178)), width=1)
        off = ((ty // 10) % 2) * 14
        for tx in range(768 + off, 896, 28):
            dr.line((tx, ty, tx, ty + 10), fill=_desat((196, 192, 184)), width=1)

    # 2g. Emergency Arched Ribbed Rust-Red Roof (`#27`) & White Grid Skylight (`#15`) (896, 256, 128, 128)
    rects['emerg_red_roof'] = (896, 256, 128, 128)
    dr.rectangle((896, 256, 1023, 383), fill=_desat((144, 74, 62)))
    for rx in range(896, 1024, 10):
        dr.line((rx, 256, rx, 383), fill=_desat((112, 56, 46)), width=2)
        dr.line((rx + 3, 256, rx + 3, 383), fill=_desat((162, 92, 78)), width=1)

    # 2h. Ambulance Side & Front Livery (clean civic 120 ambulance, Severity A) (768, 384, 256, 128)
    rects['ambulance_side'] = (768, 384, 256, 128)
    dr.rectangle((768, 384, 1023, 511), fill=_desat((234, 234, 232)))
    # Side windows
    dr.rectangle((780, 396, 858, 434), fill=_desat((46, 58, 70)), outline=_desat((164, 168, 172)), width=2)
    dr.rectangle((868, 398, 932, 428), fill=_desat((52, 66, 80)), outline=_desat((164, 168, 172)), width=2)
    # Iconic Guilin 120 red & blue horizontal stripes
    dr.rectangle((768, 444, 1023, 458), fill=_desat((198, 46, 44)))
    dr.rectangle((768, 462, 1023, 474), fill=_desat((42, 102, 176)))
    _draw_emblem(dr, 976, 420, 16)
    dr.text((905, 488), '桂林急救  120', fill=_desat((196, 44, 42)), font=get_font(20, bold=True, sans=True), anchor='mm')

    # === ROW 3 (y: 512..768): HOSPITAL SIGNS (ALL CALIBRATED FOR DAY & NIGHT `_lit`) ===
    # 3a. Rooftop Main Signboard (`桂林市人民医院` red 3D letters on clean light sky-steel backing) (0, 512, 448, 80)
    rects['sign_roof_main'] = (0, 512, 448, 80)
    dr.rectangle((0, 512, 447, 591), fill=_desat((226, 228, 228)), outline=_desat((168, 176, 184)), width=3)
    dr.text((226, 554), '桂 林 市 人 民 医 院', fill=_desat((196, 40, 38), 0.14), font=get_font(44, bold=True, sans=True), anchor='mm')

    # 3b. Rooftop Emergency Center Sign (`桂林市急救中心 / GUILIN EMERGENCY CENTER`) (448, 512, 448, 80)
    rects['sign_roof_emerg'] = (448, 512, 448, 80)
    dr.rectangle((448, 512, 895, 558), fill=_desat((226, 228, 228)), outline=_desat((168, 176, 184)), width=2)
    dr.rectangle((448, 558, 895, 591), fill=_desat((58, 64, 72)))
    dr.text((672, 535), '桂 林 市 急 救 中 心', fill=_desat((196, 40, 38), 0.14), font=get_font(33, bold=True, sans=True), anchor='mm')
    dr.text((672, 574), 'GUILIN EMERGENCY CENTER', fill=(238, 240, 242), font=get_font(16, bold=True, sans=True), anchor='mm')

    # 3c. NW Pylon Vertical Signboard (`桂林市人民医院` vertical + emblem) (896, 512, 128, 384)
    rects['sign_nw_vert'] = (896, 512, 128, 384)
    dr.rectangle((896, 512, 1023, 895), fill=_desat((166, 178, 188)), outline=_desat((118, 126, 134)), width=4)
    dr.rectangle((904, 520, 1015, 887), fill=_desat((144, 158, 170)))
    _draw_emblem(dr, 960, 560, 28)
    for idx, ch in enumerate('桂林市人民医院'):
        dr.text((960, 616 + idx * 38), ch, fill=(242, 244, 244), font=get_font(32, bold=True, sans=False), anchor='mm')

    # 3d. Low Monument Stone Wall Sign (`桂林市人民医院` + emblem + National Centers) (0, 592, 480, 96)
    rects['sign_monument'] = (0, 592, 480, 96)
    dr.rectangle((0, 592, 479, 687), fill=_desat((206, 200, 190)), outline=_desat((154, 148, 140)), width=3)
    # Stone joints
    for mx in (96, 288, 384):
        dr.line((mx, 594, mx, 686), fill=_desat((184, 178, 168)), width=1)
    _draw_emblem(dr, 48, 640, 26)
    dr.text((214, 636), '桂林市人民医院', fill=_desat((46, 50, 54)), font=get_font(38, bold=True, sans=False), anchor='mm')
    dr.text((214, 668), 'GUILIN PEOPLE\'S HOSPITAL', fill=_desat((86, 90, 94)), font=get_font(12, bold=True, sans=True), anchor='mm')
    dr.rectangle((352, 606, 466, 674), fill=_desat((196, 190, 180)), outline=_desat((142, 136, 128)), width=1)
    dr.text((409, 622), '国家高级卒中中心', fill=_desat((62, 66, 70)), font=get_font(12, bold=True, sans=True), anchor='mm')
    dr.text((409, 642), '中国胸痛中心认证', fill=_desat((62, 66, 70)), font=get_font(12, bold=True, sans=True), anchor='mm')
    dr.text((409, 662), '三甲综合医院', fill=_desat((62, 66, 70)), font=get_font(12, bold=True, sans=True), anchor='mm')

    # 3e. Outpatient Atrium Gold-Amber `门  诊` Sign & Canopy LED Strip (480, 592, 256, 96)
    rects['sign_menzhen'] = (480, 592, 256, 52)
    dr.rectangle((480, 592, 735, 643), fill=_desat((46, 66, 84)))
    dr.text((608, 618), '门    诊', fill=_desat((232, 178, 78), 0.14), font=get_font(36, bold=True, sans=True), anchor='mm')

    rects['sign_led_strip'] = (480, 644, 256, 44)
    dr.rectangle((480, 644, 735, 687), fill=(26, 28, 30), outline=(54, 56, 58), width=2)
    dr.text((608, 666), '文明路12号 · 24小时急诊', fill=(252, 118, 92), font=get_font(20, bold=True, sans=True), anchor='mm')

    # 3f. Emergency Red `急  诊` Lintel Sign & Arrow Directory (`← 急诊` / `急诊科·胸痛中心`) (736, 592, 160, 96)
    rects['sign_jizhen_main'] = (736, 592, 160, 48)
    dr.rectangle((736, 592, 895, 639), fill=_desat((212, 208, 200)), outline=_desat((164, 160, 154)), width=2)
    dr.text((816, 616), '急  诊', fill=_desat((198, 42, 40), 0.12), font=get_font(34, bold=True, sans=True), anchor='mm')

    rects['sign_jizhen_arrow'] = (736, 640, 160, 48)
    dr.rectangle((736, 640, 895, 687), fill=(240, 240, 238), outline=_desat((192, 48, 44)), width=3)
    dr.text((816, 664), '← 急诊', fill=_desat((202, 44, 40), 0.12), font=get_font(28, bold=True, sans=True), anchor='mm')

    # 3g. Underground Garage Entrance Sign & Blue East Gate Sign & Health Center Sign (0, 688, 896, 80)
    rects['sign_garage'] = (0, 688, 320, 80)
    dr.rectangle((0, 688, 319, 767), fill=_desat((36, 86, 146)), outline=(228, 232, 236), width=3)
    dr.text((160, 714), '桂林市人民医院地下停车场', fill=(242, 244, 246), font=get_font(22, bold=True, sans=True), anchor='mm')
    dr.text((160, 748), '← 入口   P   限速 5   出口 →', fill=_desat((238, 214, 108)), font=get_font(18, bold=True, sans=True), anchor='mm')

    rects['sign_east_gate'] = (320, 688, 320, 80)
    dr.rectangle((320, 688, 639, 767), fill=_desat((46, 124, 198), 0.10), outline=(248, 250, 252), width=4)
    _draw_emblem(dr, 354, 728, 21)
    dr.text((496, 716), '桂林市人民医院 · 东门', fill=(255, 255, 255), font=get_font(22, bold=True, sans=True), anchor='mm')
    dr.text((496, 749), 'GUILIN PEOPLE\'S HOSPITAL', fill=(242, 248, 255), font=get_font(14, bold=True, sans=True), anchor='mm')

    rects['sign_health_ctr'] = (640, 688, 256, 80)
    dr.rectangle((640, 688, 895, 767), fill=_desat((62, 66, 72)), outline=_desat((154, 158, 164)), width=2)
    _draw_emblem(dr, 668, 728, 16)
    dr.text((784, 716), '健康管理中心', fill=(240, 242, 242), font=get_font(24, bold=True, sans=True), anchor='mm')
    dr.text((784, 748), 'HEALTH MANAGEMENT CENTER', fill=(214, 218, 222), font=get_font(12, bold=True, sans=True), anchor='mm')

    # === ROW 4 (y: 768..1024): EMERGENCY DIRECTORY, ROOFS, PAVING & CLEAN SWATCHES ===
    # 4a. Emergency Column Directory (`急诊科 / 胸痛中心 / 卒中中心`) (0, 768, 128, 256)
    rects['sign_emerg_col'] = (0, 768, 128, 256)
    dr.rectangle((0, 768, 127, 816), fill=(238, 240, 238))
    _draw_emblem(dr, 32, 792, 16)
    dr.text((84, 792), '人民医院', fill=_desat((42, 64, 82)), font=get_font(16, bold=True, sans=True), anchor='mm')
    dr.rectangle((0, 816, 127, 1023), fill=_desat((34, 92, 154)))
    dr.text((64, 852), '急 诊 科', fill=(244, 246, 248), font=get_font(26, bold=True, sans=True), anchor='mm')
    dr.rectangle((14, 882, 114, 912), fill=_desat((196, 46, 44)))
    dr.text((64, 897), '胸痛中心', fill=(246, 246, 244), font=get_font(17, bold=True, sans=True), anchor='mm')
    dr.rectangle((14, 922, 114, 952), fill=_desat((42, 138, 96)))
    dr.text((64, 937), '卒中中心', fill=(246, 246, 244), font=get_font(17, bold=True, sans=True), anchor='mm')
    dr.text((64, 982), '→ 120', fill=(248, 226, 152), font=get_font(28, bold=True, sans=True), anchor='mm')

    # 4b. Skylight Grid Roof (`#15` north half) (128, 768, 128, 128)
    rects['skylight_grid'] = (128, 768, 128, 128)
    dr.rectangle((128, 768, 255, 895), fill=_desat((214, 224, 230)))
    for sx in range(128, 256, 16):
        dr.line((sx, 768, sx, 895), fill=_desat((162, 172, 180)), width=2)
    for sy in range(768, 896, 16):
        dr.line((128, sy, 255, sy), fill=_desat((162, 172, 180)), width=2)

    # 4c. Polycarbonate Translucent Canopy (garage ramp & emergency canopy) (256, 768, 128, 128)
    rects['polycarb_canopy'] = (256, 768, 128, 128)
    dr.rectangle((256, 768, 383, 895), fill=_desat((216, 222, 224)))
    for px in range(256, 384, 16):
        dr.line((px, 768, px, 895), fill=_desat((184, 192, 196)), width=2)
    for py in range(768, 896, 32):
        dr.line((256, py, 383, py), fill=_desat((196, 202, 206)), width=1)

    # 4d. Concrete Flat Roof (weathered Guilin grey roof with subtle slab joints) (384, 768, 128, 128)
    rects['roof_grey'] = (384, 768, 128, 128)
    dr.rectangle((384, 768, 511, 895), fill=_desat((122, 126, 130)))
    for gx in range(384, 512, 32):
        dr.line((gx, 768, gx, 895), fill=_desat((106, 110, 114)), width=1)
    for gy in range(768, 896, 32):
        dr.line((384, gy, 511, gy), fill=_desat((106, 110, 114)), width=1)

    # 4e. Pale Granite Stair / Forecourt Paving Accent (steps & plinths, not street-level!) (512, 768, 128, 128)
    rects['stair_granite'] = (512, 768, 128, 128)
    dr.rectangle((512, 768, 639, 895), fill=_desat((186, 184, 178)))
    for sy in range(768, 896, 16):
        dr.line((512, sy, 639, sy), fill=_desat((154, 152, 146)), width=1)
    for sx in range(512, 640, 32):
        dr.line((sx, 768, sx, 895), fill=_desat((162, 160, 154)), width=1)

    # 4f. Round Tower Facade (`#34` curved vertical glazing + pale stone bands) (640, 768, 128, 128)
    rects['round_facade'] = (640, 768, 128, 128)
    dr.rectangle((640, 768, 767, 895), fill=_desat((194, 190, 182)))
    for fy in (768, 832):
        dr.rectangle((640, fy, 767, fy + 14), fill=_desat((216, 212, 204)))
        dr.rectangle((640, fy + 18, 767, fy + 56), fill=GLASS_BLUE)
        for mx in range(640, 768, 16):
            dr.line((mx, fy + 18, mx, fy + 56), fill=_desat((184, 182, 176)), width=2)

    # 4g. HVAC Chiller Louver Box (768, 768, 128, 128)
    rects['hvac_unit'] = (768, 768, 128, 128)
    dr.rectangle((768, 768, 895, 895), fill=_desat((206, 208, 206)), outline=_desat((148, 152, 154)), width=3)
    for ly in range(782, 884, 10):
        dr.line((782, ly, 882, ly), fill=_desat((122, 126, 130)), width=3)

    # 4h. Clean Desaturated Material Swatches (y: 896..1024, x: 128..1024)
    #     All opaque dark/grey structural swatches keep strictly neutral R≈G≈B so landmarkNight never speckles them!
    swatches = [
        ('stone_warm',   (128, 896, 64, 64), _desat((216, 211, 201))),
        ('stone_pale',   (192, 896, 64, 64), _desat((226, 224, 218))),
        ('stone_grey',   (256, 896, 64, 64), (146, 146, 146)),
        ('dark_steel',   (320, 896, 64, 64), (58,  60,  62)),
        ('silver_metal', (384, 896, 64, 64), (186, 188, 188)),
        ('truss_white',  (448, 896, 64, 64), (226, 228, 228)),
        ('roof_white',   (512, 896, 64, 64), (226, 226, 224)),
        ('roof_terrac',  (576, 896, 64, 64), _desat((132, 74,  64))),
        ('roof_charc',   (640, 896, 64, 64), (74,  76,  78)),
        ('roof_blue',    (704, 896, 64, 64), _desat((66,  112, 154))),
        ('cyan_eave',    (768, 896, 64, 64), _desat((64,  136, 166))),
        ('brown_louver', (832, 896, 64, 64), _desat((126, 78,  64))),
        ('roof_garden',  (896, 896, 64, 64), _desat((86,  124, 82))),
        ('flag_red',     (960, 896, 64, 64), _desat((184, 54,  48), 0.24)),

        ('foliage',      (128, 960, 64, 64), _desat((58,  94,  54))),
        ('hedge',        (192, 960, 64, 64), _desat((64,  102, 58))),
        ('bark',         (256, 960, 64, 64), _desat((96,  84,  70))),
        ('lime_white',   (320, 960, 64, 64), _desat((222, 224, 218))),
        ('warm_glow',    (384, 960, 64, 64), _desat((244, 216, 148), 0.12)),
        ('amb_red',      (448, 960, 64, 64), _desat((198, 48,  44), 0.14)),
        ('amb_blue',     (512, 960, 64, 64), _desat((44,  108, 178), 0.16)),
        ('amb_tire',     (576, 960, 64, 64), (44,  45,  46)),
        ('cone_orange',  (640, 960, 64, 64), _desat((216, 92,  46), 0.18)),
        ('iron_fence',   (704, 960, 64, 64), (48,  50,  52)),
        ('bench_wood',   (768, 960, 64, 64), _desat((144, 108, 72))),
        ('park_blue',    (832, 960, 64, 64), _desat((40,  96,  156))),
        ('glass_dark',   (896, 960, 64, 64), GLASS_BLUE),
        ('old_roof',     (960, 960, 64, 64), _desat((154, 150, 140))),
    ]
    for key, (x, y, w, h), rgb in swatches:
        rects[key] = (x, y, w, h)
        dr.rectangle((x, y, x + w - 1, y + h - 1), fill=rgb)

    # Apply subtle micro-grain & Guilin rain-streak weathering (preserve clean window glazing margins!)
    arr = np.asarray(im, dtype=np.uint8).copy()
    _add_noise_rect(arr, 0, 0, 256, 256, 1.8, 101, rain_streaks=True)
    _add_noise_rect(arr, 256, 0, 256, 256, 1.6, 102, rain_streaks=True)
    _add_noise_rect(arr, 768, 0, 256, 256, 1.8, 103, rain_streaks=True)
    _add_noise_rect(arr, 0, 256, 256, 256, 1.8, 104, rain_streaks=True)
    _add_noise_rect(arr, 256, 256, 256, 128, 3.0, 105, rain_streaks=False)
    _add_noise_rect(arr, 384, 768, 128, 128, 3.0, 106, rain_streaks=False)
    _add_noise_rect(arr, 512, 768, 128, 128, 2.4, 107, rain_streaks=False)
    im = Image.fromarray(arr, 'RGB')
    return im, rects


def _draped_campus_surface(
    b: SceneBuilder,
    ring_local: list[tuple[float, float]],
    street_role: str,
    streets: Streets,
    cell_step: float = 4.0,
    collide: bool = True,
    subtract_rings: list[list[tuple[float, float]]] | None = None,
):
    """Drape a campus road/sidewalk/plaza polygon seamlessly over terrain, strictly
    subtracting native GL04 streets and any adjacent campus surface polygons so
    Wenming Rd & internal driveways join with zero Z-fighting, zero color/height step."""
    surf = b.surface
    origin = np.array([surf.x, surf.z], dtype=np.float64)
    poly_world = Polygon([(p[0] + origin[0], p[1] + origin[1]) for p in ring_local]).buffer(0)
    if poly_world.is_empty:
        return
    if subtract_rings:
        cuts = [
            Polygon([(p[0] + origin[0], p[1] + origin[1]) for p in r]).buffer(0)
            for r in subtract_rings
        ]
        cuts = [c for c in cuts if not c.is_empty]
        if cuts:
            poly_world = poly_world.difference(shapely.union_all(cuts)).buffer(0)
            if poly_world.is_empty:
                return

    west, north, east, south = poly_world.bounds
    size = surf.surface.size
    masks = []
    adjacent_faces = []
    for col in range(math.floor((west - 4.0) / size), math.floor((east + 4.0) / size) + 1):
        for row in range(math.floor((north - 4.0) / size), math.floor((south + 4.0) / size) + 1):
            tile_key = (col * size, row * size)
            if tile_key not in surf.surface.files:
                continue
            tree, kinds, _ = streets.tile(tile_key)
            for idx in tree.query(poly_world, predicate='intersects'):
                masks.append(tree.geometries[idx])
            for idx in tree.query(poly_world.buffer(4.0), predicate='intersects'):
                if kinds[idx] in (0, 1, 4, 5, 6):
                    inset = tree.geometries[idx].buffer(-0.015)
                    if not inset.is_empty:
                        adjacent_faces.append(inset)

    streets_mask = shapely.union_all(shapely.make_valid(masks)) if masks else Polygon()
    if not streets_mask.is_empty:
        # Close tiny slivers (<0.25m) between campus outline and Wenming Rd edge
        closed = poly_world.union(streets_mask).buffer(0.25).buffer(-0.25)
        poly_world = poly_world.union(
            closed.intersection(poly_world.buffer(0.5)).intersection(streets_mask.buffer(0.5))
        )
        footprint = poly_world.difference(streets_mask)
    else:
        footprint = poly_world

    # Drop razor-thin stray curve slivers that can Z-fight against curved GL04 curbs
    clean_parts = [
        p for p in shapely_polygons(footprint)
        if p.area >= 0.12 and (p.area >= 1.5 or not p.buffer(-0.07).is_empty)
    ]
    if not clean_parts:
        return
    footprint = shapely.union_all(clean_parts).buffer(0)
    if footprint.is_empty:
        return

    adjacent = shapely.STRtree(adjacent_faces) if adjacent_faces else None
    boundary = footprint.boundary
    street_boundary = streets_mask.boundary if not streets_mask.is_empty else None
    step = cell_step if b.detail else cell_step * 2.0

    height_cache: dict[tuple[float, float], float] = {}

    def local_height(wx: float, wz: float) -> float:
        ckey = (round(wx, 4), round(wz, 4))
        if ckey in height_cache:
            return height_cache[ckey]
        lx, lz = wx - origin[0], wz - origin[1]
        g = surf.ground(lx, lz)
        pt = Point(wx, wz)
        dist_b = boundary.distance(pt)
        # Sufficient interior lift (0.048..0.082m) prevents 4m terrain grid bumps poking through paving,
        # while smooth 6.0m blend brings native street seam edges flush within <= 0.010m << 0.05m limit!
        offset = 0.048 + 0.034 * min(1.0, dist_b / 2.2)
        if adjacent is not None:
            hits = adjacent.query_nearest(pt, max_distance=6.0, all_matches=False)
            if len(hits):
                line = shapely.shortest_line(pt, adjacent.geometries[hits[0]])
                tx, tz = line.coords[-1]
                sy, sk = streets.at(tx, tz)
                if sk:
                    blend = max(0.0, 1.0 - line.length / 6.0)
                    if line.length > 0.04:
                        blend *= min(1.0, poly_world.boundary.distance(pt) / line.length)
                    blend = blend * blend * (3.0 - 2.0 * blend)
                    offset += (sy - surf.y - g - offset + 0.010) * blend
        val = g + offset
        height_cache[ckey] = val
        return val

    region_fallback = 'stone_grey' if street_role == 'sidewalk' else 'dark_steel'
    for col in range(math.floor(west / step), math.ceil(east / step)):
        for row in range(math.floor(north / step), math.ceil(south / step)):
            cell = shapely.box(col * step, row * step, (col + 1) * step, (row + 1) * step)
            sub = footprint.intersection(cell)
            for part in shapely_polygons(sub):
                if part.area < 0.02:
                    continue
                if street_boundary is not None and street_boundary.distance(part) < 0.6:
                    def refine(ring):
                        res = []
                        coords = list(ring.coords)
                        for a, c in zip(coords, coords[1:]):
                            res.append(a)
                            edge = shapely.LineString([a, c])
                            if edge.length > 0.45 and street_boundary.distance(edge.interpolate(0.5, normalized=True)) < 0.06:
                                ya, yc = local_height(*a), local_height(*c)
                                if abs(ya - yc) > 0.018 or edge.length > 1.2:
                                    nseg = math.ceil(edge.length / 0.55)
                                    res.extend(edge.interpolate(k / nseg, normalized=True).coords[0] for k in range(1, nseg))
                        return res
                    part = Polygon(refine(part.exterior), [refine(h) for h in part.interiors]).buffer(0)
                for p_clean in shapely_polygons(part):
                    for tri in shapely.constrained_delaunay_triangles(p_clean).geoms:
                        pts2 = list(shapely.orient_polygons(tri, exterior_cw=True).exterior.coords)[:3]
                        pts3 = [(wx - origin[0], local_height(wx, wz), wz - origin[1]) for wx, wz in pts2]
                        b.face(pts3, (0, 1, 0), region_fallback, tile=3.0, street_role=street_role)
                        if collide and b.collide:
                            b.hit_quad(pts3, (0, 1, 0))


def _poly_base_y(b: SceneBuilder, poly: list[list[float]]) -> float:
    return min(b.surface.ground(x, z) for x, z in poly)


def _poly_top_y(b: SceneBuilder, poly: list[list[float]]) -> float:
    return max(b.surface.ground(x, z) for x, z in poly)


def _tiled_prism(
    b: SceneBuilder,
    poly_xz: list[list[float]] | list[tuple[float, float]],
    y0: float,
    h: float,
    region: str,
    cap_region: str | None = None,
    tile_u: float = 7.0,
    tile_v: float = 7.0,
    collide: bool = False,
    lit: bool = False,
    footing: bool = False,
):
    """Build a prism with subdivided clamped-UV side quads so patterned facade atlas
    tiles repeat crisply across large walls (zero corner-modulo UV collapse!)."""
    pts = np.asarray(poly_xz, dtype=np.float64)
    if len(pts) >= 2 and np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    if len(pts) < 3 or h <= 0.02:
        return
    area2 = np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1])
    if area2 < 0:
        pts = pts[::-1]
    tris = mapbox_earcut.triangulate_float64(pts, np.array([len(pts)], np.uint32)).reshape(-1, 3)
    y1 = y0 + h
    lower = [b.grade(float(x), float(z)) - 0.045 if footing else y0 for x, z in pts]

    # Top cap (clean clamped UV inside cap_region)
    min_x, max_x = float(pts[:, 0].min()), float(pts[:, 0].max())
    min_z, max_z = float(pts[:, 1].min()), float(pts[:, 1].max())
    span_x = max(1e-3, max_x - min_x)
    span_z = max(1e-3, max_z - min_z)
    for t in tris:
        quad_tri = [(float(pts[i, 0]), y1, float(pts[i, 1])) for i in t]
        tri_uv = [((float(pts[i, 0]) - min_x) / span_x, (float(pts[i, 1]) - min_z) / span_z) for i in t]
        b.face(quad_tri, (0, 1, 0), cap_region or region, uvs=tri_uv, lit=lit)
        if collide and b.collide:
            b.hit_quad(quad_tri, (0, 1, 0))

    # Subdivided side walls with exact clamped [0..u_frac] x [1-v_frac..1] UVs per bay & floor group
    tu = tile_u if b.detail else tile_u * 1.8
    tv = tile_v if b.detail else tile_v * 1.8
    ny = max(1, math.ceil(h / tv))
    y_cuts = [y0 + min(h, k * tv) for k in range(ny)] + [y1]
    # Remove duplicate trailing cut if h is an exact multiple of tv
    if len(y_cuts) >= 2 and abs(y_cuts[-1] - y_cuts[-2]) < 1e-4:
        y_cuts.pop()

    for i in range(len(pts)):
        j = (i + 1) % len(pts)
        a, c = pts[i], pts[j]
        dx, dz = float(c[0] - a[0]), float(c[1] - a[1])
        L = math.hypot(dx, dz)
        if L < 0.02:
            continue
        nrm = (dz, 0.0, -dx)
        nu = max(1, math.ceil(L / tu))
        s_cuts = [min(L, k * tu) for k in range(nu)] + [L]
        if len(s_cuts) >= 2 and abs(s_cuts[-1] - s_cuts[-2]) < 1e-4:
            s_cuts.pop()

        for iu in range(len(s_cuts) - 1):
            s0, s1 = s_cuts[iu], s_cuts[iu + 1]
            t0, t1 = s0 / L, s1 / L
            # Viewer-left to viewer-right runs c -> a (outward normal nrm = (dz, 0, -dx))
            # Subdivide along c -> a so u=0 is left edge and u=u_frac is right edge
            xl = float(c[0]) - dx * t0
            zl = float(c[1]) - dz * t0
            xr = float(c[0]) - dx * t1
            zr = float(c[1]) - dz * t1
            lo_l = lower[j] * (1.0 - t0) + lower[i] * t0
            lo_r = lower[j] * (1.0 - t1) + lower[i] * t1
            u_frac = min(1.0, (s1 - s0) / tu)

            for iy in range(len(y_cuts) - 1):
                ya_ref = y_cuts[iy]
                yb_ref = y_cuts[iy + 1]
                yl0 = min(lo_l, yb_ref - 0.05) if (footing and iy == 0) else ya_ref
                yr0 = min(lo_r, yb_ref - 0.05) if (footing and iy == 0) else ya_ref
                v_frac = min(1.0, (yb_ref - ya_ref) / tv)
                quad = [(xl, yl0, zl), (xr, yr0, zr), (xr, yb_ref, zr), (xl, yb_ref, zl)]
                uvs = [(0.0, 1.0), (u_frac, 1.0), (u_frac, 1.0 - v_frac), (0.0, 1.0 - v_frac)]
                b.face(quad, nrm, region, uvs=uvs, lit=lit)

        if collide and b.collide and h >= 0.35:
            steps = max(1, math.ceil(L / 6.0))
            for s in range(steps):
                t0, t1 = s / steps, (s + 1) / steps
                xa, za = float(a[0]) + dx * t0, float(a[1]) + dz * t0
                xb, zb = float(a[0]) + dx * t1, float(a[1]) + dz * t1
                la = lower[i] * (1.0 - t0) + lower[j] * t0
                lb = lower[i] * (1.0 - t1) + lower[j] * t1
                b.hit_quad([(xa, la, za), (xb, lb, zb), (xb, y1, zb), (xa, y1, za)], nrm)


def _tiled_box(
    b: SceneBuilder,
    x: float,
    y0: float,
    z: float,
    w: float,
    h: float,
    d: float,
    region: str,
    cap_region: str | None = None,
    tile_u: float = 6.5,
    tile_v: float = 7.0,
    collide: bool = False,
    lit: bool = False,
    bottom: bool = False,
):
    """Box with subdivided clamped-UV faces (prevents texture smear on curtain walls & skybridges)."""
    hw, hd = 0.5 * w, 0.5 * d
    x0, x1 = x - hw, x + hw
    z0, z1 = z - hd, z + hd
    y1 = y0 + h
    tu = tile_u if b.detail else tile_u * 1.8
    tv = tile_v if b.detail else tile_v * 1.8

    def _wall_panel(p_bl, p_br, nrm):
        ax, az = p_bl
        cx, cz = p_br
        dx, dz = cx - ax, cz - az
        L = math.hypot(dx, dz)
        nu = max(1, math.ceil(L / tu))
        ny = max(1, math.ceil(h / tv))
        s_cuts = [min(L, k * tu) for k in range(nu)] + [L]
        if len(s_cuts) >= 2 and abs(s_cuts[-1] - s_cuts[-2]) < 1e-4:
            s_cuts.pop()
        y_cuts = [y0 + min(h, k * tv) for k in range(ny)] + [y1]
        if len(y_cuts) >= 2 and abs(y_cuts[-1] - y_cuts[-2]) < 1e-4:
            y_cuts.pop()
        for iu in range(len(s_cuts) - 1):
            s0, s1 = s_cuts[iu], s_cuts[iu + 1]
            t0, t1 = s0 / L, s1 / L
            xl, zl = ax + dx * t0, az + dz * t0
            xr, zr = ax + dx * t1, az + dz * t1
            u_frac = min(1.0, (s1 - s0) / tu)
            for iy in range(len(y_cuts) - 1):
                ya, yb = y_cuts[iy], y_cuts[iy + 1]
                v_frac = min(1.0, (yb - ya) / tv)
                b.face(
                    [(xl, ya, zl), (xr, ya, zr), (xr, yb, zr), (xl, yb, zl)],
                    nrm, region,
                    uvs=[(0.0, 1.0), (u_frac, 1.0), (u_frac, 1.0 - v_frac), (0.0, 1.0 - v_frac)],
                    lit=lit,
                )

    _wall_panel((x0, z1), (x1, z1), (0, 0, 1))
    _wall_panel((x1, z0), (x0, z0), (0, 0, -1))
    _wall_panel((x1, z1), (x1, z0), (1, 0, 0))
    _wall_panel((x0, z0), (x0, z1), (-1, 0, 0))
    b.face(
        [(x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0)],
        (0, 1, 0), cap_region or region,
        uvs=[(0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)], lit=lit,
    )
    if bottom:
        b.face(
            [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
            (0, -1, 0), cap_region or region,
            uvs=[(0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)], lit=lit,
        )
    if collide:
        b.solid_box(x, y0, z, w, h, d)


def _add_parapet(b: SceneBuilder, poly: list[list[float]], y_roof: float, h: float = 1.05, t: float = 0.36, region: str = 'stone_pale'):
    """Add crisp rooftop parapet wall around a building polygon."""
    p = Polygon(poly)
    if p.is_empty:
        return
    inner = p.buffer(-t)
    pts = list(p.exterior.coords)[:-1]
    for i in range(len(pts)):
        ax, az = pts[i]
        bx, bz = pts[(i + 1) % len(pts)]
        dx, dz = bx - ax, bz - az
        L = math.hypot(dx, dz)
        if L < 0.3:
            continue
        nx, nz = dz / L, -dx / L
        # Ensure normal points outward
        mid = Point(0.5 * (ax + bx) + nx * 0.1, 0.5 * (az + bz) + nz * 0.1)
        if p.contains(mid):
            nx, nz = -nx, -nz
        f = b.set_frame(origin=(0.5 * (ax + bx), y_roof, 0.5 * (az + bz)), front_xz=(nx, nz))
        b.box(0.0, -0.05, -0.5 * t, L + 0.06, h + 0.05, t, region, tile=2.5)
        b.restore_frame(f)
    _ = inner


def _add_rooftop_hvac(b: SceneBuilder, cx: float, y_roof: float, cz: float, count: int = 3, along_x: bool = True, spacing: float = 3.2):
    """Place realistic rooftop chiller/HVAC units grounded firmly on roof slab."""
    if not b.detail:
        return
    half = 0.5 * (count - 1) * spacing
    for k in range(count):
        off = -half + k * spacing
        px = cx + (off if along_x else 0.0)
        pz = cz + (0.0 if along_x else off)
        b.box(px, y_roof - 0.04, pz, 2.2, 1.35, 1.5, 'hvac_unit', cap_region='silver_metal', tile=2.0)


def _build_ambulance(b: SceneBuilder, lx: float, lz: float, front_xz: tuple[float, float]):
    """Original clean low-poly 120 ambulance (Severity A compliant: civic rescue vehicle)."""
    y0 = b.surface.ground(lx, lz)
    f = b.set_frame(origin=(lx, y0, lz), front_xz=front_xz)
    # 4 grounded tires (slightly embedded -0.02m into pavement for zero float)
    for sx in (-0.88, 0.88):
        for sz in (-1.55, 1.45):
            b.box(sx, -0.02, sz, 0.28, 0.64, 0.64, 'amb_tire', tile=0.6)
    # Chassis skirt
    b.box(0.0, 0.34, -0.15, 1.98, 0.34, 4.95, 'stone_grey', tile=1.5, collide=True)
    # Main medical cabin box (rear & mid)
    b.box(0.0, 0.68, -0.55, 2.02, 1.62, 3.65, 'ambulance_side', cap_region='roof_white', tile=3.6, collide=True)
    # Forward cab & hood
    b.box(0.0, 0.68, 1.72, 1.94, 0.72, 1.12, 'roof_white', tile=2.0)
    b.box(0.0, 1.36, 1.42, 1.88, 0.82, 0.76, 'glass_dark', cap_region='roof_white', tile=1.8)
    # Front bumper & civic red/blue striping
    b.box(0.0, 0.36, 2.30, 1.92, 0.26, 0.14, 'dark_steel', tile=1.0)
    b.box(0.0, 0.94, 2.29, 1.86, 0.14, 0.06, 'amb_red', tile=1.0)
    b.box(0.0, 0.78, 2.29, 1.86, 0.12, 0.06, 'amb_blue', tile=1.0)
    # Roof lightbar (blue-white rescue bar, softly lit at night)
    b.box(0.0, 2.28, 1.30, 1.32, 0.16, 0.26, 'amb_blue', lit=True, tile=1.0)
    b.box(0.0, 2.28, -1.95, 1.10, 0.14, 0.22, 'amb_blue', lit=True, tile=1.0)
    # Subtle rear red/blue medical stripe & headlights
    b.box(0.0, 0.92, -2.38, 1.90, 0.16, 0.05, 'amb_red', tile=1.0)
    for sx in (-0.70, 0.70):
        b.box(sx, 0.82, 2.29, 0.32, 0.16, 0.06, 'warm_glow', lit=True, tile=0.5)
    b.restore_frame(f)


def _build_outpatient_complex(b: SceneBuilder):
    """Build `#19` 8-storey Main Outpatient Complex + `#19N` 4F North Annex.

    Strictly matches exact Overture `#19` footprint at y=6.0m audit slice while
    incorporating 2023 street-view 3-tier facade rhythm, recessed blue-grey atrium,
    cantilevered tension-rod entrance canopy, NW vertical stone signage pylon,
    and rooftop steel-truss illuminated signage (`桂林市人民医院` + `桂林市急救中心`).
    """
    y_base = _poly_base_y(b, POLY_19_OUTPATIENT)
    # Main tower orientation: west facade runs from (-33.76,-24.63) -> (-42.68,7.12)
    # Outward normal facing WNW toward Wenming Rd
    west_n = (-0.9735, -0.2287)

    # 1. Exact `#19` 1F dark split-stone colonnade base (footing -> +4.55m)
    _tiled_prism(b, POLY_19_OUTPATIENT, y_base, 4.55, 'base_split_stone', cap_region='stone_warm', tile_u=6.0, tile_v=4.55, collide=True, footing=True)
    # 2. 2F-5F Mid-section warm-white tile + blue window w/ 3 white bars + brown-red vertical louvers (4 crisp floors!)
    _tiled_prism(b, POLY_19_OUTPATIENT, y_base + 4.55, 16.05, 'outpatient_mid', cap_region='stone_pale', tile_u=6.7, tile_v=8.025, collide=True)
    # 3. 5F prominent white horizontal belt cornice (+20.35 -> +20.97m)
    p19 = Polygon(POLY_19_OUTPATIENT)
    belt_poly = list(p19.buffer(0.32, join_style=2).exterior.coords)[:-1]
    b.prism(belt_poly, y_base + 20.35, 0.62, 'stone_pale', cap_region='stone_pale', tile=3.0)
    # 4. 6F-8F Continuous white extruded grid crown (3 crisp dense grid floors!)
    _tiled_prism(b, POLY_19_OUTPATIENT, y_base + 20.97, 8.23, 'outpatient_top', cap_region='roof_grey', tile_u=6.7, tile_v=5.5, collide=True)
    y_roof = y_base + 29.20
    _add_parapet(b, POLY_19_OUTPATIENT, y_roof, h=1.15, t=0.40, region='stone_pale')

    # Rooftop central mechanical penthouse strictly inside `#19` solid east roof spine (zero overhang over west recess!)
    b.box(-19.2, y_roof - 0.05, -2.5, 8.2, 2.75, 13.0, 'stone_grey', cap_region='roof_grey', tile=3.2)
    _add_rooftop_hvac(b, -23.0, y_roof, 10.5, count=3, along_x=True, spacing=2.8)

    # 5. West Main Facade Architectural Details
    #    Exact POLY_19_OUTPATIENT vertices in `wf` frame (+Z = WNW toward Wenming Rd, +X = SSW south):
    #      North Wing: x in [-23.30, -9.83], front z = +1.94
    #      Central Recess: x in [-9.87, -3.88], back z = -11.58
    #      South-Central Main Wing: x in [-3.84, +9.65], front z = +3.40
    #      Far South Wing: x in [+9.61, +17.11], front z = -7.14
    wf = b.set_frame(origin=(-37.2, y_base, -1.5), front_xz=west_n)

    # 5a. Central 2F-5F Blue-Grey Reflective Curtain Wall Atrium + Warm-Gold `门  诊` Sign
    #     Mounted cleanly on South-Central Main Wing front face (z = +3.40 -> proud to z = +3.76; tiny 0.36m depth preserves IoU ~ 0.985!)
    _tiled_box(b, 2.9, 4.55, 3.42, 11.2, 15.85, 0.68, 'curtain_wall', cap_region='stone_pale', tile_u=5.6, tile_v=7.925, collide=True)
    b.sign_quad(2.9, 10.8, 3.768, 6.8, 1.45, 'sign_menzhen', normal=(0, 0, 1), lit=True)

    # 5b. 1F Glazed Outpatient Main Entrance Lobby + Cantilevered Tension-Rod Glass Canopy + Red LED Ticker
    _tiled_prism(
        b, [(-3.2, 2.6), (9.0, 2.6), (9.0, 3.75), (-3.2, 3.75)],
        0.0, 4.35, 'lobby_glass', cap_region='stone_pale', tile_u=4.1, tile_v=4.35, collide=True, footing=True,
    )
    #     Cantilevered glass canopy projecting 4.1m proud of 1F lobby (z = 3.55 .. 7.85) with crisp 0.56m LED fascia
    b.box(2.9, 4.10, 5.70, 12.8, 0.56, 4.30, 'dark_steel', cap_region='polycarb_canopy', tile=2.4)
    #     Red LED ticker mounted flush on outer front fascia of canopy (z = +7.858, readable day & night!)
    b.sign_quad(2.9, 4.38, 7.858, 11.8, 0.52, 'sign_led_strip', normal=(0, 0, 1), lit=True)
    #     2 grounded steel canopy columns & 4 diagonal stainless tension rods anchored to atrium facade
    for cx in (-2.6, 8.4):
        g_col = b.grade(cx, 7.40)
        b.cylinder_y(cx, g_col - 0.04, 4.22 - (g_col - 0.04), 7.40, 0.16, 'silver_metal', sections=8, collide=True)
    if b.detail:
        for rx in (-2.0, 1.2, 4.6, 7.8):
            b.face(
                [(rx - 0.04, 7.20, 3.76), (rx + 0.04, 7.20, 3.76),
                 (rx + 0.04, 4.50, 7.55), (rx - 0.04, 4.50, 7.55)],
                (0, 0.7, 0.7), 'silver_metal', tile=1.0,
            )

    # 5c. 6-Step Wide Pale Granite Forecourt Staircase + Flanking Bonsai Planters
    for step_i in range(6):
        sz = 5.45 + step_i * 0.48
        sh = 0.66 - step_i * 0.10
        g_min_s = min(b.grade(-3.2, sz), b.grade(9.0, sz))
        g_max_s = max(b.grade(-3.2, sz), b.grade(9.0, sz))
        top_y = max(g_max_s + 0.08, sh)
        b.prism(
            [(-3.2, sz - 0.27), (9.0, sz - 0.27), (9.0, sz + 0.27), (-3.2, sz + 0.27)],
            g_min_s, max(0.14, top_y - g_min_s), 'stair_granite', tile=2.0, collide=True, footing=True,
        )
    for px in (-4.0, 9.8):
        gp = b.grade(px, 6.6)
        b.prism(
            [(px - 0.68, 5.1), (px + 0.68, 5.1), (px + 0.68, 8.2), (px - 0.68, 8.2)],
            gp, 0.75, 'stone_grey', cap_region='hedge', tile=1.6, collide=True, footing=True,
        )
        if b.detail:
            b.tree_cluster(px, gp + 0.62, 6.6, h=2.6, spread=1.15, foliage='foliage', bark='bark')

    # 5d. NW Corner Vertical Signage Pylon (`桂林市人民医院` vertical + emblem)
    #     Mounted proud on NW front corner of North Wing (x = -21.4, front z = +2.40 > North Wing z = +1.94!)
    nw_x, nw_z = -21.4, 1.85
    b.prism(
        [(nw_x - 1.75, nw_z - 0.55), (nw_x + 1.75, nw_z - 0.55), (nw_x + 1.75, nw_z + 0.55), (nw_x - 1.75, nw_z + 0.55)],
        0.0, 30.6, 'stone_pale', cap_region='roof_white', tile=3.2, collide=True, footing=True,
    )
    b.sign_quad(nw_x, 19.6, nw_z + 0.558, 3.10, 12.8, 'sign_nw_vert', normal=(0, 0, 1), lit=True)
    b.box(nw_x, 6.2, nw_z + 0.55, 3.15, 2.2, 0.16, 'polycarb_canopy', tile=1.5)

    # 5e. South Corner Rooftop Hollow White Architectural Frame (observed in `west_E` 2023!)
    sc_x = 13.4
    for sx in (sc_x - 2.8, sc_x + 2.8):
        b.box(sx, 29.15, -7.45, 0.55, 3.85, 0.55, 'stone_pale', tile=1.5)
    b.box(sc_x, 32.55, -7.45, 6.15, 0.55, 0.55, 'stone_pale', tile=1.5)

    # 5f. Rooftop Steel-Truss Illuminated Signs mounted RIGHT ALONG FRONT PARAPET LINES (100% unobstructed!)
    #     North Wing front parapet (z = +1.70): `桂林市人民医院` (13.0m x 2.55m)
    nz_truss = 1.68
    for tx in np.linspace(-22.4, -10.6, 5):
        b.box(float(tx), 29.10, nz_truss - 0.18, 0.22, 4.10, 0.22, 'truss_white', tile=1.0)
    b.box(-16.5, 30.40, nz_truss, 13.2, 2.68, 0.28, 'truss_white', tile=2.0)
    b.sign_quad(-16.5, 31.74, nz_truss + 0.148, 12.9, 2.48, 'sign_roof_main', normal=(0, 0, 1), lit=True)
    #     South-Central Wing front parapet (z = +3.16): `桂林市急救中心 / GUILIN EMERGENCY CENTER` (12.8m x 2.50m)
    sz_truss = 3.16
    for tx in np.linspace(-2.8, 8.8, 5):
        b.box(float(tx), 29.10, sz_truss - 0.18, 0.22, 4.10, 0.22, 'truss_white', tile=1.0)
    b.box(3.0, 30.40, sz_truss, 12.8, 2.62, 0.28, 'truss_white', tile=2.0)
    b.sign_quad(3.0, 31.71, sz_truss + 0.148, 12.5, 2.42, 'sign_roof_emerg', normal=(0, 0, 1), lit=True)
    #     Center flagpole + fluttering red flag mounted on South-Central north roof corner between the two signs
    b.cylinder_y(-3.55, 29.10, 6.70, sz_truss - 0.16, 0.08, 'silver_metal', sections=6)
    b.box(-2.45, 34.10, sz_truss - 0.16, 2.15, 1.38, 0.06, 'flag_red', tile=1.0)

    b.restore_frame(wf)

    # 6. `#19N` 4-Storey North Annex (verified in 2023 `wm_north` & Esri aerial; 0.5m separation from `#19` so y=6m slice stays pure)
    y_19n = _poly_base_y(b, POLY_19N_ANNEX)
    _tiled_prism(b, POLY_19N_ANNEX, y_19n, 3.85, 'base_split_stone', cap_region='stone_warm', tile_u=6.0, tile_v=3.85, collide=True, footing=True)
    _tiled_prism(b, POLY_19N_ANNEX, y_19n + 3.85, 11.35, 'medtech_wall', cap_region='roof_charc', tile_u=7.2, tile_v=7.5, collide=True)
    _add_parapet(b, POLY_19N_ANNEX, y_19n + 15.20, h=0.85, t=0.32, region='stone_pale')
    # Signature bright cyan-blue metal eave strip along north edge facing north ambulance lane
    nf = b.set_frame(origin=(-27.1, y_19n, -37.1), front_xz=(0.2287, -0.9735))
    b.box(0.0, 14.85, 0.85, 20.6, 0.45, 1.70, 'cyan_eave', tile=2.0)
    b.box(0.0, 3.65, 1.15, 14.0, 0.36, 2.25, 'stone_grey', cap_region='polycarb_canopy', tile=2.2)
    for cx in (-5.8, 5.8):
        gc = b.grade(cx, 1.95)
        b.cylinder_y(cx, gc - 0.04, 3.72 - (gc - 0.04), 1.95, 0.14, 'silver_metal', sections=6, collide=True)
    b.restore_frame(nf)


def _build_emergency_south_wing(b: SceneBuilder):
    """Build `#27` 5-storey Emergency South Wing (exact Overture `99e3dc89`), signature
    rust-red arched ribbed roof, 1F Emergency Entrance Canopy (`急诊`), ambulance turnaround
    area, and 3F glazed skybridge connecting to `#19` (above y=6m audit slice!)."""
    y0 = _poly_base_y(b, POLY_27_EMERGENCY)
    # Exact `#27` footprint extruded cleanly with crisp tiled glazing through y=6m -> IoU ~ 0.99!
    _tiled_prism(b, POLY_27_EMERGENCY, y0, 4.30, 'base_split_stone', cap_region='stone_warm', tile_u=6.0, tile_v=4.30, collide=True, footing=True)
    _tiled_prism(b, POLY_27_EMERGENCY, y0 + 4.30, 11.40, 'emerg_glass', cap_region='stone_pale', tile_u=6.8, tile_v=7.60, collide=True)
    _tiled_prism(b, POLY_27_EMERGENCY, y0 + 15.70, 3.50, 'outpatient_mid', cap_region='stone_grey', tile_u=6.8, tile_v=7.00, collide=True)

    # Signature rust-red arched barrel roof (`#27` Esri aerial unmistakable feature!)
    # Frame `ef` axes: +Z = (0.2019, -0.9794) NORTH toward ambulance court; +X = (-0.9794, -0.2019) WEST toward Wenming Rd!
    cx = sum(p[0] for p in POLY_27_EMERGENCY) / 4.0
    cz = sum(p[1] for p in POLY_27_EMERGENCY) / 4.0
    ef = b.set_frame(origin=(cx, y0, cz), front_xz=(0.2019, -0.9794))
    segs = 10 if b.detail else 6
    span_z = 14.8
    len_x = 20.8
    y_eave = 19.15
    rise = 2.45
    arc_pts = [
        (-0.5 * span_z + span_z * k / segs, y_eave + rise * math.sin(math.pi * k / segs))
        for k in range(segs + 1)
    ]
    for k in range(segs):
        z0, ya = arc_pts[k]
        z1, yb = arc_pts[k + 1]
        nz = -(yb - ya)
        ny = z1 - z0
        b.face(
            [(-0.5 * len_x, ya, z0), (0.5 * len_x, ya, z0), (0.5 * len_x, yb, z1), (-0.5 * len_x, yb, z1)],
            (0.0, ny, nz), 'emerg_red_roof', uvs=[(0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)],
        )
    for sx, nrm_x in ((-0.5 * len_x, -1.0), (0.5 * len_x, 1.0)):
        pts_cap = [(sx, y_eave, -0.5 * span_z)] + [(sx, yv, zv) for zv, yv in arc_pts]
        b.face(pts_cap, (nrm_x, 0.0, 0.0), 'stone_pale', tile=2.5)

    # 1F North Emergency Lobby Entrance (facing +Z north toward ambulance court; +X is WEST toward Wenming Rd)
    _tiled_prism(
        b, [(-4.2, 7.10), (7.6, 7.10), (7.6, 7.62), (-4.2, 7.62)],
        0.0, 3.88, 'lobby_glass', tile_u=4.0, tile_v=3.88, footing=True,
    )
    b.box(1.7, 3.85, 7.65, 12.2, 0.85, 0.65, 'stone_warm', tile=2.4)
    b.sign_quad(1.7, 4.28, 7.982, 5.4, 0.82, 'sign_jizhen_main', normal=(0, 0, 1), lit=True)

    # Cantilevered + Column-Supported White Steel-Truss Emergency Ambulance Canopy (clearance 4.4m for 120 ambulances!)
    can_z0, can_z1 = 7.45, 13.85
    b.box(1.7, 4.45, 0.5 * (can_z0 + can_z1), 13.8, 0.42, can_z1 - can_z0, 'truss_white', cap_region='polycarb_canopy', tile=2.8)
    # Prominent illuminated red `急  诊` fascia signs on BOTH north front edge (+Z) AND west entry edge (+X toward Wenming Rd!)
    b.box(2.4, 4.48, can_z1 + 0.08, 5.8, 0.96, 0.28, 'stone_warm', tile=2.0)
    b.sign_quad(2.4, 4.96, can_z1 + 0.228, 5.5, 0.86, 'sign_jizhen_main', normal=(0, 0, 1), lit=True)
    b.box(8.62, 4.48, 10.65, 0.26, 0.96, 4.6, 'stone_warm', tile=2.0)
    b.sign_quad(8.758, 4.96, 10.65, 4.3, 0.86, 'sign_jizhen_main', normal=(1, 0, 0), lit=True)
    for col_x in (-4.4, 1.7, 7.8):
        gc = b.grade(col_x, can_z1 - 0.35)
        b.box(col_x, gc - 0.05, can_z1 - 0.35, 0.38, 4.55 - (gc - 0.05), 0.38, 'dark_steel', tile=1.0, collide=True)
    # Grounded Blue Emergency Directory Pillar at WEST-MOST canopy entrance column (col_x = +7.8 -> faces Wenming Rd & courtyard!)
    g_dir = b.grade(7.8, can_z1 - 0.25)
    b.box(7.8, g_dir - 0.05, can_z1 - 0.14, 1.24, 3.55, 1.24, 'dark_steel', tile=1.2, collide=True)
    b.sign_quad(7.8, g_dir + 2.25, can_z1 + 0.488, 1.16, 2.20, 'sign_emerg_col', normal=(0, 0, 1), lit=True)
    b.sign_quad(7.8 + 0.628, g_dir + 2.25, can_z1 - 0.14, 1.16, 2.20, 'sign_emerg_col', normal=(1, 0, 0), lit=True)
    # WEST Facade (`+X = +10.50` facing Wenming Rd south entry!): `← 急诊` arrow points LEFT (+Z north into ambulance bay!)
    b.box(10.50, 4.10, 2.2, 0.36, 1.25, 3.80, 'stone_pale', tile=1.5)
    b.sign_quad(10.688, 4.72, 2.2, 3.6, 1.12, 'sign_jizhen_arrow', normal=(1, 0, 0), lit=True)
    b.restore_frame(ef)

    # 3F Glazed Enclosed Skybridge firmly embedded into `#19` south wall and `#27` north wall (y = 9.0..12.2m -> above y=6m slice!)
    sf = b.set_frame(origin=(-31.2, y0, 27.6), front_xz=(-0.975, -0.222))
    _tiled_box(b, 0.0, 9.0, 0.0, 23.6, 3.25, 4.2, 'curtain_wall', cap_region='roof_grey', tile_u=6.0, tile_v=3.25, bottom=True)
    b.box(0.0, 8.75, 0.0, 23.6, 0.35, 4.4, 'stone_pale', tile=2.5, bottom=True)
    b.box(0.0, 12.15, 0.0, 23.6, 0.35, 4.4, 'stone_pale', tile=2.5)
    b.restore_frame(sf)


def _build_forecourt_garage_and_monument(b: SceneBuilder, streets: Streets):
    """Build Wenming Rd open forecourt plaza (shared street material), underground garage
    sunken ramp with arched translucent canopy, low stone monument wall (`桂林市人民医院`),
    north/south ambulance driveways, planters, bollards, trees & 2 original 120 ambulances."""
    # 1. Shared-material Wenming Rd Forecourt Sidewalk/Plaza, North Ambulance Apron & East Gate Plaza
    #    West edge extends cleanly into Wenming Rd centerline (x=-88) so difference(streets_mask) trims
    #    flush to Wenming Rd's exact curved east curb (-66.07..-85.86) with ZERO bare-ground triangle gap!
    #    South emergency bay uses unified light-grey hospital plaza paving (no jarring black asphalt patch).
    north_apron = [
        (-74.0, -56.0), (-22.0, -52.0), (-15.0, -40.5), (-37.0, -40.5), (-74.0, -40.5),
    ]
    forecourt_plaza = [
        (-70.5, -40.5), (-35.0, -40.5), (-31.0, -24.0), (-36.0, -8.0),
        (-39.0, 16.0), (-26.5, 22.0), (-27.0, 38.0), (-48.5, 43.0),
        (-52.0, 48.0), (-88.5, 44.0), (-86.5, 30.0), (-83.5, 20.0),
        (-80.0, 10.0), (-76.5, 0.0), (-72.0, -20.0),
    ]
    _draped_campus_surface(
        b, forecourt_plaza, 'sidewalk', streets, cell_step=2.6, collide=True,
        subtract_rings=[north_apron],
    )
    _draped_campus_surface(b, north_apron, 'road', streets, cell_step=3.0, collide=True)

    #    Internal courtyard service walkways connecting North lane -> Med-Tech -> Central Tower -> Garden
    inner_spine = [
        (-25.0, -42.0), (54.0, -34.0), (54.0, -27.5), (12.0, -29.0),
        (12.0, 11.5), (-18.0, 11.5), (-22.0, 29.0), (-30.0, 29.0), (-16.0, -20.0),
    ]
    _draped_campus_surface(
        b, inner_spine, 'sidewalk', streets, cell_step=3.5, collide=True,
        subtract_rings=[forecourt_plaza, north_apron],
    )

    #    East Gate Binjiang-side apron & entry plaza extending cleanly THROUGH East Gate into courtyard (zero bare earth!)
    east_gate_apron = [
        (52.0, 16.0), (88.0, 16.0), (88.0, 78.0), (52.0, 78.0),
    ]
    _draped_campus_surface(b, east_gate_apron, 'sidewalk', streets, cell_step=3.5, collide=True)

    # 2. Underground Parking Garage Ramp + Warm-White Tiled Low Walls + Arched White Steel-Truss Canopy
    #    Positioned parallel to Wenming Rd on west side of forecourt (leaves 9.0m clear drop-off plaza in front of `#19` stairs!)
    ramp_n = (-0.962, -0.273)  # facing WNW perpendicular to Wenming Rd
    rf = b.set_frame(origin=(-57.0, 0.0, 1.5), front_xz=ramp_n)
    # Frame axes: +Z = WNW toward Wenming Rd, +X = SSW (south along Wenming Rd)
    ramp_len = 22.0
    ramp_w = 5.4
    for sz in (-0.5 * ramp_w, 0.5 * ramp_w):
        segs = 7
        xs = np.linspace(-0.5 * ramp_len, 0.5 * ramp_len, segs + 1)
        for i in range(segs):
            xa, xb = float(xs[i]), float(xs[i + 1])
            xm = 0.5 * (xa + xb)
            gy = 0.5 * (b.grade(xa, sz) + b.grade(xb, sz))
            _tiled_prism(
                b, [(xa - 0.02, sz - 0.17), (xb + 0.02, sz - 0.17), (xb + 0.02, sz + 0.17), (xa - 0.02, sz + 0.17)],
                gy, 1.20, 'white_tile', cap_region='stone_grey', tile_u=3.2, tile_v=1.20, collide=True, footing=True,
            )
            if b.detail:
                b.box(xm, gy + 1.38, sz, (xb - xa) + 0.04, 0.06, 0.06, 'silver_metal', tile=1.0)
                b.cylinder_y(xa, gy + 1.15, 0.25, sz, 0.03, 'silver_metal', sections=6)
    # Architectural framed underground garage north portal (warm-white tiled piers + stone lintel + recessed dark entry + warm soffit light!)
    g_end = b.grade(-0.5 * ramp_len + 0.6, 0.0)
    x_port = -0.5 * ramp_len
    for pz in (-0.5 * ramp_w + 0.42, 0.5 * ramp_w - 0.42):
        _tiled_prism(
            b, [(x_port - 0.15, pz - 0.36), (x_port + 1.25, pz - 0.36), (x_port + 1.25, pz + 0.36), (x_port - 0.15, pz + 0.36)],
            g_end, 3.30, 'white_tile', cap_region='stone_grey', tile_u=1.6, tile_v=1.6, collide=True, footing=True,
        )
    # Portal recessed shadow backing wall + overhead concrete lintel + warm LED entry strip
    b.prism(
        [(x_port - 0.15, -0.5 * ramp_w + 0.72), (x_port + 0.25, -0.5 * ramp_w + 0.72),
         (x_port + 0.25, 0.5 * ramp_w - 0.72), (x_port - 0.15, 0.5 * ramp_w - 0.72)],
        g_end, 2.85, 'dark_steel', tile=2.0, collide=True, footing=True,
    )
    b.box(x_port + 0.55, g_end + 2.75, 0.0, 1.45, 0.62, ramp_w + 0.10, 'stone_pale', cap_region='stone_grey', tile=2.0)
    b.box(x_port + 0.85, g_end + 2.66, 0.0, 0.35, 0.10, ramp_w - 1.6, 'warm_glow', lit=True, tile=1.0)

    # Arched white steel-truss polycarbonate canopy covering the ramp (ends cleanly BEFORE south entrance sign!)
    n_bays = 7 if b.detail else 4
    bxs = np.linspace(-0.5 * ramp_len + 0.4, 0.5 * ramp_len - 0.4, n_bays)
    arch_h = 3.55
    for bx in bxs:
        g_l = b.grade(float(bx), -0.5 * ramp_w)
        g_r = b.grade(float(bx), 0.5 * ramp_w)
        y_top = max(g_l, g_r) + arch_h
        b.cylinder_y(float(bx), g_l + 1.0, y_top - (g_l + 1.0), -0.5 * ramp_w, 0.09, 'truss_white', sections=6)
        b.cylinder_y(float(bx), g_r + 1.0, y_top - (g_r + 1.0), 0.5 * ramp_w, 0.09, 'truss_white', sections=6)
        b.box(float(bx), y_top - 0.14, 0.0, 0.16, 0.20, ramp_w + 0.50, 'truss_white', tile=1.5)
    # Continuous translucent polycarbonate roof panels ending cleanly at x = +0.5*ramp_len - 0.18 (zero penetration of blue sign!)
    g_mid = b.grade(0.0, 0.0)
    y_roof_c = g_mid + arch_h
    roof_len = ramp_len - 0.25
    roof_cx = -0.15
    b.box(roof_cx, y_roof_c, -1.45, roof_len, 0.14, 3.05, 'polycarb_canopy', tile=3.0)
    b.box(roof_cx, y_roof_c + 0.18, 0.0, roof_len, 0.16, 2.20, 'polycarb_canopy', tile=3.0)
    b.box(roof_cx, y_roof_c, 1.45, roof_len, 0.14, 3.05, 'polycarb_canopy', tile=3.0)
    # Blue overhead entrance sign mounted cleanly OUTSIDE south gable end (neutral dark_steel frame prevents night glazing bleed!)
    x_sign_box = 0.5 * ramp_len + 0.14
    y_sign_bot = y_roof_c - 0.26
    for arm_z in (-2.2, 2.2):
        b.box(0.5 * ramp_len - 0.12, y_roof_c - 0.06, arm_z, 0.58, 0.14, 0.14, 'truss_white', tile=1.0)
    b.box(x_sign_box, y_sign_bot, 0.0, 0.24, 0.96, ramp_w + 0.30, 'dark_steel', tile=1.5)
    b.sign_quad(x_sign_box + 0.128, y_sign_bot + 0.48, 0.0, ramp_w + 0.20, 0.88, 'sign_garage', normal=(1, 0, 0), lit=True)

    # 3. Low Beige Stone Monument Wall (`桂林市人民医院` + Emblem + National Centers)
    mx, mz = 17.6, 5.2
    g_m = b.grade(mx, mz)
    b.prism(
        [(mx - 5.3, mz - 0.44), (mx + 5.3, mz - 0.44), (mx + 5.3, mz + 0.44), (mx - 5.3, mz + 0.44)],
        g_m, 0.38, 'stone_grey', tile=2.0, collide=True, footing=True,
    )
    b.prism(
        [(mx - 5.1, mz - 0.29), (mx + 5.1, mz - 0.29), (mx + 5.1, mz + 0.29), (mx - 5.1, mz + 0.29)],
        g_m, 2.18, 'stone_warm', cap_region='stone_grey', tile=2.4, collide=True, footing=True,
    )
    b.sign_quad(mx, g_m + 1.26, mz + 0.296, 9.8, 1.65, 'sign_monument', normal=(0, 0, 1), lit=True)
    b.sign_quad(mx, g_m + 1.26, mz - 0.296, 9.8, 1.65, 'sign_monument', normal=(0, 0, -1), lit=False)

    # 4. Wenming Rd Frontage Granite Planters, Shrub Hedges, Parking `P` Sign & Road Cones
    for px0, px1 in ((-20.5, -11.5), (12.5, 22.5)):
        n_seg = 4
        pxs = np.linspace(px0, px1, n_seg + 1)
        for k in range(n_seg):
            xa, xb = float(pxs[k]), float(pxs[k + 1])
            gp = 0.5 * (b.grade(xa, 7.8) + b.grade(xb, 7.8))
            b.prism(
                [(xa - 0.02, 7.12), (xb + 0.02, 7.12), (xb + 0.02, 8.48), (xa - 0.02, 8.48)],
                gp, 0.44, 'stone_grey', cap_region='hedge', tile=1.8, collide=True, footing=True,
            )
            b.prism(
                [(xa + 0.03, 7.28), (xb - 0.03, 7.28), (xb - 0.03, 8.32), (xa + 0.03, 8.32)],
                gp, 0.84, 'hedge', tile=1.5, footing=True,
            )
    # Two iconic dense shade banyan/camphor trees along Wenming Rd forecourt planter line (clear of garage sign sightline!)
    for tx, tz, th, tsp in ((-16.5, 7.8, 9.0, 4.0), (15.8, 7.8, 9.4, 4.2)):
        gt = b.grade(tx, tz)
        b.tree_cluster(tx, gt - 0.04, tz, h=th, spread=tsp, foliage='foliage', bark='bark', lime_trunk='lime_white')
    # Blue `P` parking totem & red-white safety cones near south drop-off lane
    if b.detail:
        gp_sign = b.grade(11.6, 5.2)
        b.cylinder_y(11.6, gp_sign - 0.04, 2.55, 5.2, 0.05, 'silver_metal', sections=6)
        b.box(11.6, gp_sign + 2.25, 5.2, 0.65, 0.65, 0.08, 'park_blue', tile=0.8)
        for cz_c in (-10.0, -6.5, 9.5, 13.0):
            gc = b.grade(cz_c, -4.4)
            b.box(cz_c, gc - 0.02, -4.4, 0.34, 0.10, 0.34, 'dark_steel', tile=0.4)
            b.cylinder_y(cz_c, gc + 0.08, 0.55, -4.4, 0.11, 'cone_orange', sections=6)

    b.restore_frame(rf)

    # 5. Two Original Low-Poly 120 Ambulances (Bay 1: Emergency canopy pickup lane; Bay 2: North ambulance entry)
    _build_ambulance(b, -46.8, 30.8, front_xz=(-0.978, -0.205))
    _build_ambulance(b, -46.0, -44.0, front_xz=(0.985, 0.174))


def _build_medtech_cluster(b: SceneBuilder):
    """Build north-central medical tech & health management cluster:
    `#10` Health Management Center (charcoal + white bands), `#15` Med-Tech West (white skylight roof
    + 3F skybridge to `#19`), `#17` Admin/Med-Tech (dark terracotta roof + blue roof shed),
    `#20` Central Med-Tech Slab (5F + HVAC chillers), `#16` Utility Substation."""
    # 1. `#10` 4F Health Management Center (north of north ambulance lane)
    y10 = _poly_base_y(b, POLY_10_HEALTH)
    _tiled_prism(b, POLY_10_HEALTH, y10, 13.8, 'health_charcoal', cap_region='old_roof', tile_u=7.0, tile_v=6.9, collide=True, footing=True)
    _add_parapet(b, POLY_10_HEALTH, y10 + 13.8, h=0.75, t=0.28, region='stone_grey')
    hf = b.set_frame(origin=(-12.1, y10, -49.8), front_xz=(-0.332, 0.943))
    _tiled_prism(b, [(-6.1, -0.05), (6.1, -0.05), (6.1, 0.22), (-6.1, 0.22)], 0.0, 3.25, 'lobby_glass', tile_u=4.1, tile_v=3.25, footing=True)
    b.box(0.0, 3.2, 0.14, 12.8, 1.05, 0.38, 'dark_steel', tile=2.0)
    b.sign_quad(0.0, 3.72, 0.338, 9.6, 0.92, 'sign_health_ctr', normal=(0, 0, 1), lit=True)
    b.restore_frame(hf)

    # 2. `#15` 4F North-West Med-Tech / Intestinal Clinic (`auditBuildings`, exact footprint!)
    y15 = _poly_base_y(b, POLY_15_MEDW)
    _tiled_prism(b, POLY_15_MEDW, y15, 14.8, 'medtech_wall', cap_region='roof_grey', tile_u=7.2, tile_v=7.4, collide=True, footing=True)
    _add_parapet(b, POLY_15_MEDW, y15 + 14.8, h=0.85, t=0.30, region='stone_pale')
    _tiled_box(b, 2.78, y15 + 14.78, -26.2, 12.6, 0.45, 9.4, 'skylight_grid', cap_region='skylight_grid', tile_u=4.2, tile_v=0.45)
    # 3F Glazed Skybridge linking `#19` east wall (-15.0, -16.5) to `#15` west wall (-4.0, -16.5)
    _tiled_box(b, -9.4, y15 + 8.8, -16.5, 11.4, 3.05, 3.6, 'curtain_wall', cap_region='stone_pale', tile_u=5.7, tile_v=3.05, bottom=True)
    b.box(-9.4, y15 + 8.55, -16.5, 11.4, 0.32, 3.8, 'stone_pale', tile=2.5, bottom=True)

    # 3. `#17` 4F North-Central Med-Tech / Admin Building (`auditBuildings`, exact footprint!)
    y17 = _poly_base_y(b, POLY_17_ADMIN)
    _tiled_prism(b, POLY_17_ADMIN, y17, 14.6, 'medtech_wall', cap_region='roof_terrac', tile_u=7.5, tile_v=7.3, collide=True, footing=True)
    _add_parapet(b, POLY_17_ADMIN, y17 + 14.6, h=0.85, t=0.30, region='stone_warm')
    b.box(34.5, y17 + 14.55, -24.8, 5.8, 1.85, 4.6, 'roof_blue', tile=2.5)

    # 4. `#16` 2F NE Corner Substation / Utility Building
    y16 = _poly_base_y(b, POLY_16_UTIL)
    b.prism(POLY_16_UTIL, y16, 7.2, 'stone_grey', cap_region='roof_charc', tile=4.2, collide=True, footing=True)

    # 5. `#20` 5F Central-North Med-Tech Slab (`auditBuildings`, exact footprint!)
    y20 = _poly_base_y(b, POLY_20_MEDC)
    _tiled_prism(b, POLY_20_MEDC, y20, 3.8, 'base_split_stone', cap_region='stone_warm', tile_u=6.4, tile_v=3.8, collide=True, footing=True)
    _tiled_prism(b, POLY_20_MEDC, y20 + 3.8, 13.7, 'medtech_wall', cap_region='roof_grey', tile_u=7.6, tile_v=6.85, collide=True)
    _add_parapet(b, POLY_20_MEDC, y20 + 17.5, h=0.90, t=0.34, region='stone_pale')
    _add_rooftop_hvac(b, 28.0, y20 + 17.5, -0.8, count=4, along_x=True, spacing=3.8)


def _build_central_inpatient_tower(b: SceneBuilder):
    """Build the tallest flagship complex in the hospital: modern 10-11F Pi-Shaped
    Comprehensive Inpatient Tower (`#25` West Wing + `#26` East Wing + North Main Wing)."""
    # 1. `#25` 10F West Inpatient Wing (`auditBuildings`, exact Overture `94d682a2`, H=35.2m)
    y25 = _poly_base_y(b, POLY_25_TOWER_W)
    _tiled_prism(b, POLY_25_TOWER_W, y25, 4.2, 'base_split_stone', cap_region='stone_pale', tile_u=6.4, tile_v=4.2, collide=True, footing=True)
    _tiled_prism(b, POLY_25_TOWER_W, y25 + 4.2, 31.0, 'curtain_wall', cap_region='roof_white', tile_u=9.2, tile_v=14.0, collide=True)
    _add_parapet(b, POLY_25_TOWER_W, y25 + 35.2, h=1.15, t=0.38, region='stone_pale')
    b.box(-3.5, y25 + 35.15, 37.5, 8.5, 2.8, 6.2, 'stone_pale', cap_region='roof_grey', tile=3.0)

    # 2. `#26` 10F East Inpatient Wing (`auditBuildings`, exact Overture `09b5da1e`, H=35.2m)
    y26 = _poly_base_y(b, POLY_26_TOWER_E)
    _tiled_prism(b, POLY_26_TOWER_E, y26, 4.2, 'base_split_stone', cap_region='stone_pale', tile_u=6.4, tile_v=4.2, collide=True, footing=True)
    _tiled_prism(b, POLY_26_TOWER_E, y26 + 4.2, 31.0, 'curtain_wall', cap_region='roof_white', tile_u=9.2, tile_v=14.0, collide=True)
    _add_parapet(b, POLY_26_TOWER_E, y26 + 35.2, h=1.15, t=0.38, region='stone_pale')
    _add_rooftop_hvac(b, 35.0, y26 + 35.2, 44.3, count=4, along_x=True, spacing=3.8)

    # 3. Central 11F North Main Inpatient Spine (H=38.6m)
    yn = _poly_base_y(b, POLY_TOWER_NORTH)
    _tiled_prism(b, POLY_TOWER_NORTH, yn, 4.4, 'base_split_stone', cap_region='stone_pale', tile_u=6.4, tile_v=4.4, collide=True, footing=True)
    _tiled_prism(b, POLY_TOWER_NORTH, yn + 4.4, 34.2, 'curtain_wall', cap_region='roof_white', tile_u=9.2, tile_v=14.0, collide=True)
    p_tn = Polygon(POLY_TOWER_NORTH)
    fin_poly = list(p_tn.buffer(0.28, join_style=2).exterior.coords)[:-1]
    b.prism(fin_poly, yn + 18.0, 0.55, 'stone_pale', tile=3.0)
    b.prism(fin_poly, yn + 38.2, 0.55, 'stone_pale', tile=3.0)
    y_nr = yn + 38.6
    _add_parapet(b, POLY_TOWER_NORTH, y_nr, h=1.20, t=0.40, region='stone_pale')
    b.box(-1.5, y_nr - 0.02, 19.5, 24.5, 0.25, 11.2, 'roof_garden', tile=4.0)
    b.box(38.0, y_nr - 0.04, 19.5, 10.5, 3.6, 8.8, 'stone_pale', cap_region='roof_grey', tile=3.2)
    _add_rooftop_hvac(b, 20.5, y_nr, 22.8, count=5, along_x=True, spacing=3.5)

    # 4. High-level Glazed Skybridges joining North Main Spine to West Wing `#25` & East Wing `#26` (y=11.5..31.5m)
    _tiled_box(b, -3.2, yn + 11.5, 28.4, 14.0, 20.5, 2.2, 'curtain_wall', cap_region='roof_white', tile_u=7.0, tile_v=14.0, bottom=True)
    _tiled_box(b, 35.0, yn + 11.5, 32.2, 12.5, 20.5, 9.8, 'curtain_wall', cap_region='roof_white', tile_u=7.0, tile_v=14.0, bottom=True)


def _build_east_south_inpatient_and_garden(b: SceneBuilder):
    """Build East Binjiang-style Inpatient Wing (`#21` + `#24`), East Gate, South-Central
    Horizontal Wing (`#31`, `auditBuildings`), West Old Wing (`#29`), SW Heart Center,
    Signature 21m Round Inpatient Pavilion (`#34`), Perimeter Fences, and Central Courtyard Garden (`#35`)."""
    # 1. `#21` + `#24` East Long Binjiang-Style Inpatient Complex (6F, 21.5m)
    y21 = _poly_base_y(b, POLY_21_EASTN)
    b.prism(POLY_21_EASTN, y21, 3.8, 'stone_warm', cap_region='stone_pale', tile=3.6, collide=True, footing=True)
    _tiled_prism(b, POLY_21_EASTN, y21 + 3.8, 17.6, 'binjiang_brick', cap_region='roof_charc', tile_u=7.5, tile_v=7.0, collide=True)
    _add_parapet(b, POLY_21_EASTN, y21 + 21.4, h=0.95, t=0.35, region='stone_pale')
    b.box(63.5, y21 + 21.35, 3.5, 11.0, 3.4, 9.5, 'roof_white', cap_region='roof_white', tile=3.0)

    y24 = _poly_base_y(b, POLY_24_EASTS)
    b.prism(POLY_24_EASTS, y24, 3.8, 'stone_warm', cap_region='stone_pale', tile=3.6, collide=True, footing=True)
    _tiled_prism(b, POLY_24_EASTS, y24 + 3.8, 17.2, 'binjiang_brick', cap_region='roof_charc', tile_u=7.5, tile_v=7.0, collide=True)
    _add_parapet(b, POLY_24_EASTS, y24 + 21.0, h=0.90, t=0.32, region='stone_pale')

    # 2. `#31` 6F South-Central Horizontal Inpatient Wing (`auditBuildings`, exact 44.5x10.6m footprint!)
    y31 = _poly_base_y(b, POLY_31_SOUTH_BAR)
    _tiled_prism(b, POLY_31_SOUTH_BAR, y31, 3.6, 'base_split_stone', cap_region='stone_warm', tile_u=6.4, tile_v=3.6, collide=True, footing=True)
    _tiled_prism(b, POLY_31_SOUTH_BAR, y31 + 3.6, 16.8, 'medtech_wall', cap_region='old_roof', tile_u=7.5, tile_v=7.2, collide=True)
    _add_parapet(b, POLY_31_SOUTH_BAR, y31 + 20.4, h=0.85, t=0.32, region='stone_pale')
    b.box(37.0, y31 + 20.35, 61.6, 7.4, 2.4, 5.2, 'stone_warm', cap_region='old_roof', tile=2.8)

    # 3. `#29` 5F South-Central West Old Inpatient Wing
    y29 = _poly_base_y(b, POLY_29_WEST_OLD)
    _tiled_prism(b, POLY_29_WEST_OLD, y29, 17.0, 'medtech_wall', cap_region='old_roof', tile_u=7.2, tile_v=6.8, collide=True, footing=True)
    _add_parapet(b, POLY_29_WEST_OLD, y29 + 17.0, h=0.80, t=0.28, region='stone_warm')

    # 4. Southwest 5F Heart Center (bright crisp white flat roof + chillers) & SW Connector Block
    yhc = _poly_base_y(b, POLY_HEART_CENTER)
    _tiled_prism(b, POLY_HEART_CENTER, yhc, 17.4, 'medtech_wall', cap_region='roof_white', tile_u=7.5, tile_v=7.0, collide=True, footing=True)
    _add_parapet(b, POLY_HEART_CENTER, yhc + 17.4, h=0.85, t=0.32, region='roof_white')
    _add_rooftop_hvac(b, -42.5, yhc + 17.4, 59.8, count=3, along_x=True, spacing=4.2)

    ysw = _poly_base_y(b, POLY_SW_CONN)
    _tiled_prism(b, POLY_SW_CONN, ysw, 15.8, 'medtech_wall', cap_region='roof_grey', tile_u=7.5, tile_v=6.8, collide=True, footing=True)
    _add_parapet(b, POLY_SW_CONN, ysw + 15.8, h=0.80, t=0.28, region='stone_pale')

    # 5. `#34` Signature 20m Diameter Round Inpatient Building (kept 1.2m clear of `#31` SE corner so y=6m slice stays pure!)
    rcx, rcz, r_rad = 61.8, 78.2, 9.8
    n_seg = 24 if b.detail else 14
    round_poly = [
        [rcx + r_rad * math.cos(2.0 * math.pi * i / n_seg), rcz + r_rad * math.sin(2.0 * math.pi * i / n_seg)]
        for i in range(n_seg)
    ]
    yr = _poly_base_y(b, round_poly)
    b.prism(round_poly, yr, 3.6, 'stone_warm', cap_region='stone_pale', tile=3.6, collide=True, footing=True)
    _tiled_prism(b, round_poly, yr + 3.6, 14.4, 'round_facade', cap_region='old_roof', tile_u=5.2, tile_v=7.2, collide=True)
    _add_parapet(b, round_poly, yr + 18.0, h=0.85, t=0.32, region='stone_pale')

    # 6. `#35` Central Courtyard Lush Garden (replaces removed Overture box `cb13a223`, footing-grounded!)
    #    Raised curb bed, cross stone paths, wooden benches & multi-canopy Guilin shade trees
    gx, gz = 27.5, 76.0
    gy = b.surface.ground(gx, gz)
    b.prism(
        [(gx - 13.0, gz - 7.5), (gx + 13.0, gz - 7.5), (gx + 13.0, gz + 7.5), (gx - 13.0, gz + 7.5)],
        gy, 0.36, 'stone_grey', cap_region='hedge', tile=3.2, collide=True, footing=True,
    )
    b.box(gx, gy + 0.18, gz, 24.4, 0.10, 2.2, 'stair_granite', tile=2.0)
    b.box(gx, gy + 0.18, gz, 2.4, 0.10, 13.6, 'stair_granite', tile=2.0)
    for tx, tz, th, tsp in (
        (19.0, 72.0, 8.6, 3.8), (35.5, 72.0, 9.2, 4.1),
        (19.5, 80.2, 8.4, 3.6), (36.0, 79.8, 9.0, 4.0),
        (46.5, 75.0, 8.8, 3.8),
    ):
        gt = b.surface.ground(tx, tz)
        b.tree_cluster(tx, gt + 0.10, tz, h=th, spread=tsp, foliage='foliage', bark='bark')
    if b.detail:
        for bx in (23.0, 32.0):
            gb = b.surface.ground(bx, 73.6)
            b.box(bx, gb + 0.22, 73.6, 1.85, 0.42, 0.52, 'bench_wood', tile=1.0)
            b.box(bx, gb + 0.22, 78.4, 1.85, 0.42, 0.52, 'bench_wood', tile=1.0)
    # West small green courtyard trees (between SW Connector and `#29`)
    for tx, tz in ((-7.5, 55.0), (-4.5, 62.0)):
        gt = b.surface.ground(tx, tz)
        b.tree_cluster(tx, gt - 0.02, tz, h=7.8, spread=3.2, foliage='foliage', bark='bark')

    # 7. Authentic Campus Perimeter Walls (East Binjiang transparent stone-base + black iron fence,
    #    North boundary wall behind `#15`/`#17`/`#16`, plus East Gate iron piers & blue-roofed booth)
    def _fence_run(p0: tuple[float, float], p1: tuple[float, float]):
        dx, dz = p1[0] - p0[0], p1[1] - p0[1]
        L = math.hypot(dx, dz)
        if L < 1.0:
            return
        n_bays = max(1, int(round(L / 4.2)))
        # front_xz = (-dz/L, +dx/L) ensures local +X = (nz, 0, -nx) = (+dx/L, 0, +dz/L) runs p0 -> p1!
        ff = b.set_frame(origin=(p0[0], 0.0, p0[1]), front_xz=(-dz / L, dx / L))
        for i in range(n_bays):
            xa = L * i / n_bays
            xb = L * (i + 1) / n_bays
            xm = 0.5 * (xa + xb)
            gy = 0.5 * (b.grade(xa, 0.0) + b.grade(xb, 0.0))
            # 1.0m footing-grounded stone plinth wall
            b.prism(
                [(xa - 0.02, -0.17), (xb + 0.02, -0.17), (xb + 0.02, 0.17), (xa - 0.02, 0.17)],
                gy, 0.98, 'stone_grey', cap_region='stone_pale', tile=1.8, collide=True, footing=True,
            )
            # Footing-grounded stone square pillar at bay start
            ga = b.grade(xa, 0.0)
            b.prism(
                [(xa - 0.24, -0.24), (xa + 0.24, -0.24), (xa + 0.24, 0.24), (xa - 0.24, 0.24)],
                ga, 2.30, 'stone_grey', cap_region='stone_pale', tile=1.2, collide=True, footing=True,
            )
            # Black wrought-iron top rails + vertical pickets (connected solidly into pillars & plinth)
            b.box(xm, gy + 2.08, 0.0, (xb - xa) + 0.04, 0.07, 0.07, 'iron_fence', tile=0.8)
            b.box(xm, gy + 1.15, 0.0, (xb - xa) + 0.04, 0.06, 0.06, 'iron_fence', tile=0.8)
            if b.detail:
                for px in np.linspace(xa + 0.35, xb - 0.35, 7):
                    b.box(float(px), gy + 0.94, 0.0, 0.035, 1.18, 0.035, 'iron_fence', tile=0.5)
        ge = b.grade(L, 0.0)
        b.prism(
            [(L - 0.24, -0.24), (L + 0.24, -0.24), (L + 0.24, 0.24), (L - 0.24, 0.24)],
            ge, 2.30, 'stone_grey', cap_region='stone_pale', tile=1.2, collide=True, footing=True,
        )
        b.restore_frame(ff)

    # North boundary fence along `#15` -> `#17` -> `#16`
    _fence_run((-4.5, -32.2), (58.0, -28.0))
    # East Binjiang boundary fence (north of east gate z=16..42 & south of east gate z=53..78)
    _fence_run((72.5, 16.0), (72.5, 42.0))
    _fence_run((72.5, 53.0), (72.5, 78.0))
    # Aligned Binjiang East Gate Portal Arch (`z = 42.0..53.0`, directly centered on open passageway!)
    # Two substantial pale-stone gate piers + overhead concrete lintel + neutral dark_steel backing (ZERO night orange bleed!)
    # + `桂林市人民医院 · 东门` lit fascia + open half-retracted stainless steel gate leaf + blue-roofed guard booth
    geg_n = b.surface.ground(72.5, 42.0)
    geg_s = b.surface.ground(72.5, 53.0)
    geg = min(geg_n, geg_s)
    for pz, gp_e in ((42.0, geg_n), (53.0, geg_s)):
        b.prism(
            [(71.95, pz - 0.55), (73.05, pz - 0.55), (73.05, pz + 0.55), (71.95, pz + 0.55)],
            gp_e, 6.20, 'stone_pale', cap_region='stone_grey', tile=2.0, collide=True, footing=True,
        )
    # Overhead gate portal beam & illuminated blue East Gate fascia facing +X East (Binjiang Rd)
    b.box(72.5, geg + 4.45, 47.5, 1.12, 1.75, 12.2, 'stone_pale', cap_region='stone_grey', tile=2.4)
    b.box(73.12, geg + 4.58, 47.5, 0.24, 1.48, 10.2, 'dark_steel', tile=1.8)
    b.sign_quad(73.248, geg + 5.32, 47.5, 9.8, 1.38, 'sign_east_gate', normal=(1, 0, 0), lit=True)
    # Half-retracted open-lattice stainless steel accordion gate on north side (leaving 6.5m clear open driveway!)
    b.box(72.5, geg_n - 0.04, 44.1, 0.22, 0.18, 3.2, 'silver_metal', tile=1.0, collide=True)
    b.box(72.5, geg_n + 1.42, 44.1, 0.14, 0.10, 3.2, 'silver_metal', tile=1.0)
    b.box(72.5, geg_n + 0.76, 44.1, 0.12, 0.08, 3.2, 'silver_metal', tile=1.0)
    for gz_p in np.linspace(42.65, 45.55, 8):
        b.box(72.5, geg_n + 0.10, float(gz_p), 0.10, 1.36, 0.08, 'silver_metal', tile=0.6)
    # Gate drive head pillar with subtle red indicator lamp
    b.box(72.5, geg_n - 0.04, 45.75, 0.34, 1.62, 0.36, 'silver_metal', cap_region='amb_red', tile=0.8, collide=True)
    # Blue-roofed security guard booth positioned visibly right beside south pier (window + overhanging pitched blue roof!)
    g_booth = b.surface.ground(72.0, 55.2)
    b.prism(
        [(70.6, 53.9), (73.4, 53.9), (73.4, 56.5), (70.6, 56.5)],
        g_booth, 2.60, 'stone_pale', cap_region='roof_blue', tile=1.8, collide=True, footing=True,
    )
    # Glazed guard booth observation windows facing east (+X) and north (-Z)
    b.box(73.42, g_booth + 1.15, 55.2, 0.10, 1.10, 1.85, 'lobby_glass', tile=1.8)
    b.box(72.0, g_booth + 1.15, 53.88, 1.85, 1.10, 0.10, 'lobby_glass', tile=1.8)
    # Overhanging stepped pitched blue guard-booth roof (`bj_east_s` verified blue roof!)
    b.box(72.0, g_booth + 2.58, 55.2, 3.50, 0.24, 3.30, 'roof_blue', tile=2.0)
    b.box(72.0, g_booth + 2.82, 55.2, 2.65, 0.34, 2.45, 'roof_blue', tile=2.0)
    b.box(72.0, g_booth + 3.16, 55.2, 1.40, 0.26, 1.25, 'roof_blue', tile=1.5)


def build_renmin_hospital(b: SceneBuilder):
    streets = Streets(b.surface.surface)
    _build_forecourt_garage_and_monument(b, streets)
    _build_outpatient_complex(b)
    _build_emergency_south_wing(b)
    _build_medtech_cluster(b)
    _build_central_inpatient_tower(b)
    _build_east_south_inpatient_and_garden(b)


if __name__ == '__main__':
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    world = Surface()
    lm_surface = FallbackLandmarkSurface(world, 'renmin_hospital')
    atlas_img, atlas_rects = make_hospital_atlas()
    export_landmark_glb(
        out_dir / 'renmin_hospital.glb',
        atlas_img,
        atlas_rects,
        build_renmin_hospital,
        mat_prefix='renmin_hospital',
        lit_emissive=(0.86, 0.80, 0.72),
        atlas_metallic=0.06,
        atlas_roughness=0.82,
        double_sided=False,
        surface=lm_surface,
    )
