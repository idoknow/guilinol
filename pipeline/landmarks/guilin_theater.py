"""Guilin Theater / Lijiang Opera House (桂林剧院 / 漓江歌剧院, way/1466385147).

Full 360-degree multi-view reconstruction per IDOK-70 (M2.6-25), verified against:
  - West riverside front: Rock photos 46-48 & mobile screenshot (preserving the approved
    swept left wing, soaring central parabolic arch +31.6 m with white space-truss & dark
    curtain wall, radial white standing-seam ribs, swept right wing, and riverside 2F pavilion).
  - East rear & Linjiang Rd streetscape: Baidu Baike / aerial photos (`63286392`) & Esri WV03
    (`2024-12-24`) — soaring SE petal parabolic arch & mullioned curtain wall, flanking white
    raked mega-columns, east foyer canopy entrance, and elevated curved-glass pedestrian
    skybridge across Linjiang Rd (`way/682893309`).
  - North entrance plaza & drop-off loop: Sina aerial (`2022-09`) & OSM `way/258899680` /
    `way/1493001380-1382` — NE petal arch, sweeping north saddle canopy, grand entrance steps,
    shared world-sidewalk granite forecourt, and circular planted island.
  - South / Southwest side & "Flower Bud" Concert Hall: VJShi (`24605322`, `33532659`) & Esri
    WV03 — 3-storey elliptical Concert Hall (`(-0.5, +53.5)`, 891 seats) with louvered clerestory,
    calyx terrace collar, pure-white domed roof and smooth S-curved leaf skylight slot, wrapped by
    2-3 storey wave-terraced white perforated-aluminium podium ribbons with karst silhouettes.
  - All foundations sample finished world terrain (`b.grade(x, z)`) for zero grounding failures,
    while keeping `y = +2.0 m` section strictly aligned to `way/1466385147` (`IoU >= 0.99`).
"""
import math
from pathlib import Path
import sys

import mapbox_earcut
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from m26_16_kit import SceneBuilder, export_landmark_glb

# Exact manifest anchor of OSM way/1466385147: (-100.11794, 154.45, 269.73290)
# Exact 26-vertex ring of OSM way/1466385147 in landmark local (x, z) metres:
LOCAL_FOOTPRINT = [
    (9.60, -46.87), (-1.52, -36.40), (-12.63, -29.89), (-24.60, -26.22),
    (-39.43, -22.53), (-44.01, -18.55), (-45.12, -15.17), (-42.84, -4.97),
    (-33.17, 15.78), (-30.87, 29.56), (-25.87, 39.38), (-17.88, 43.83),
    (-5.88, 42.61), (3.92, 37.23), (13.35, 33.07), (31.83, 27.69),
    (39.85, 22.59), (45.62, 14.50), (44.86, 11.11), (41.45, 5.50),
    (35.25, -1.87), (31.26, -12.63), (28.81, -27.91), (26.00, -43.75),
    (21.15, -49.28), (14.81, -49.94),
]

# Crown central skylight oculus in local (x, z), measured on Esri WV03 2024-12-24:
CROWN_X = 7.20
CROWN_Z = -0.50

# 8 control rays around CROWN (alternating 4 Petals & 4 Saddle Valleys) in local (x, z):
_ROOF_STATIONS = [
    # (angle_deg, phase_deg, radius_m, eave_y, mid_ridge_y, is_petal)
    (-155.6,   0.0, 49.6, 31.60, 30.80, 1.0),  # NW Petal (River main parabolic arch!)
    (-110.2,  45.0, 42.6, 11.15, 23.40, 0.0),  # North-West / North Saddle Valley
    ( -58.1,  90.0, 53.6, 26.80, 27.60, 1.0),  # NE Petal (Swept-up Left Wing from river / North Arch!)
    ( -24.5, 135.0, 29.8, 11.90, 22.80, 0.0),  # East Saddle Valley (East entrance canopy)
    (  24.0, 180.0, 52.8, 27.00, 27.90, 1.0),  # SE Petal (Soaring East Rear Arch!)
    (  69.6, 225.0, 27.8, 12.40, 22.60, 0.0),  # South Saddle Valley (Meets Concert Hall)
    ( 113.9, 270.0, 49.8, 23.80, 26.20, 1.0),  # SW Petal (Swept-up Right Wing from river!)
    ( 162.3, 315.0, 39.6, 11.45, 23.10, 0.0),  # West Saddle Valley (Riverfront right valley)
]


def _tileable_noise(size: int, freq: int, rng: np.random.Generator) -> np.ndarray:
    grid = rng.normal(0.0, 1.0, (freq, freq))
    u = np.arange(size, dtype=np.float64) * freq / size
    i0 = np.floor(u).astype(int) % freq
    i1 = (i0 + 1) % freq
    f = u - np.floor(u)
    f = f * f * (3.0 - 2.0 * f)
    fx, fy = np.meshgrid(f, f)
    return (
        (grid[np.ix_(i0, i0)] * (1 - fx) + grid[np.ix_(i0, i1)] * fx) * (1 - fy)
        + (grid[np.ix_(i1, i0)] * (1 - fx) + grid[np.ix_(i1, i1)] * fx) * fy
    )


def make_theater_atlas():
    size = 1024
    im = Image.new('RGB', (size, size), (236, 242, 248))
    dr = ImageDraw.Draw(im)
    rects = {}

    # 1. Continuous Petal-to-Valley Roof Gradient (`roof_grad`) (0, 0, 512, 256)
    # u in [0.00 .. 0.44]: Cool blue-silver glazed single-layer grid-shell valley & purlins
    # u in [0.44 .. 0.56]: Crisp white aluminium border trim & transition band (zero stair-stepping!)
    # u in [0.56 .. 1.00]: Smooth pearl-white osmanthus-petal standing-seam aluminium shell
    rects['roof_grad'] = (0, 0, 512, 256)
    arr_rg = np.zeros((256, 512, 3), dtype=np.uint8)
    for x in range(512):
        u = x / 511.0
        if u < 0.44:
            # Glazed grid-shell valley with cool blue-slate glass & silver-white ribs
            m = x % 20
            if m < 8:
                col = np.array([92, 114, 138], dtype=np.float64)
            elif m < 15:
                col = np.array([164, 182, 200], dtype=np.float64)
            else:
                col = np.array([238, 245, 252], dtype=np.float64)
        elif u < 0.56:
            t = (u - 0.44) / 0.12
            c_rib = np.array([212, 222, 234], dtype=np.float64)
            c_prl = np.array([248, 251, 254], dtype=np.float64)
            col = c_rib * (1.0 - t) + c_prl * t
        else:
            col = np.array([247, 250, 253], dtype=np.float64)
            if x % 28 == 0:
                col = np.array([228, 234, 242], dtype=np.float64)
        arr_rg[:, x, :] = np.clip(col, 0, 255).astype(np.uint8)
    # Subtle horizontal purlin / standing-seam joints across the roof
    for ry in range(16, 256, 28):
        arr_rg[ry:ry + 2, :225, :] = np.clip(arr_rg[ry:ry + 2, :225, :].astype(int) - 18, 0, 255).astype(np.uint8)
        arr_rg[ry:ry + 1, 286:, :] = np.clip(arr_rg[ry:ry + 1, 286:, :].astype(int) - 10, 0, 255).astype(np.uint8)
    im.paste(Image.fromarray(arr_rg, mode='RGB'), (0, 0))

    # 2. Smooth pearl-white shell swatch (`roof_shell`) (512, 0, 128, 192)
    rects['roof_shell'] = (512, 0, 128, 192)
    dr.rectangle((512, 0, 639, 191), fill=(247, 250, 253))
    for sx in range(528, 640, 24):
        dr.line((sx, 0, sx, 191), fill=(228, 234, 242), width=1)
    for sy in range(20, 192, 24):
        dr.line((512, sy, 639, sy), fill=(230, 236, 244), width=1)

    # 3. Exposed white 3D tubular space-frame truss rim (`arch_truss`) (640, 0, 384, 192)
    rects['arch_truss'] = (640, 0, 384, 192)
    dr.rectangle((640, 0, 1023, 191), fill=(58, 72, 90))
    for tx in range(640, 1024, 32):
        dr.line((tx, 0, min(1023, tx + 32), 191), fill=(244, 248, 253), width=4)
        dr.line((min(1023, tx + 32), 0, tx, 191), fill=(244, 248, 253), width=4)
    for ty in (6, 95, 185):
        dr.line((640, ty, 1023, ty), fill=(250, 253, 255), width=6)

    # 4. Karst-mountain perforated white aluminium podium facade (`mountain_panel`) (0, 256, 512, 192)
    rects['mountain_panel'] = (0, 256, 512, 192)
    dr.rectangle((0, 256, 511, 447), fill=(242, 245, 248))
    for px in range(0, 512):
        h1 = 360 - int(36 * math.sin(px * 2 * math.pi / 256.0 + 0.4) ** 2 + 18 * math.sin(px * 2 * math.pi / 128.0))
        h2 = 382 - int(28 * math.cos(px * 2 * math.pi / 192.0 - 0.6) ** 2)
        if px % 2 == 0:
            dr.line((px, h1, px, 422), fill=(192, 200, 204), width=1)
            dr.line((px, h2, px, 422), fill=(162, 172, 178), width=1)
    dr.rectangle((0, 420, 511, 447), fill=(36, 52, 68))
    for gx in range(0, 512, 32):
        dr.line((gx, 256, gx, 419), fill=(212, 218, 224), width=1)
        dr.line((gx, 420, gx, 447), fill=(120, 140, 158), width=2)
    for gy in (308, 364):
        dr.line((0, gy, 511, gy), fill=(214, 220, 226), width=1)

    # 5. Deep grey-blue parabolic arch glass curtain wall (`arch_glass`) (512, 256, 256, 256)
    rects['arch_glass'] = (512, 256, 256, 256)
    dr.rectangle((512, 256, 767, 511), fill=(28, 44, 64))
    dr.rectangle((544, 310, 735, 456), fill=(44, 52, 64))
    for gy in range(256, 512, 42):
        dr.rectangle((512, gy, 767, gy + 6), fill=(20, 32, 48))
    for gx in range(524, 768, 20):
        dr.line((gx, 256, gx, 511), fill=(98, 122, 148), width=2)
    for gy in range(276, 512, 21):
        dr.line((512, gy, 767, gy), fill=(80, 104, 128), width=1)

    # 6. Concert Hall ("Flower Bud") louvered clerestory & perforated white facade (`bud_facade`) (768, 192, 256, 192)
    rects['bud_facade'] = (768, 192, 256, 192)
    dr.rectangle((768, 192, 1023, 383), fill=(242, 245, 249))
    # Subtle karst mountain perforation silhouette on lower drum (`opera_0.jpg` left!)
    for px in range(768, 1024, 2):
        hm = 342 - int(22 * math.sin((px - 768) * 2 * math.pi / 128.0) ** 2)
        dr.line((px, hm, px, 380), fill=(196, 204, 210), width=1)
    # Upper clerestory vertical white acoustic/sun louvers over dark blue glazing (`opera_0.jpg` & `opera_10.jpg`!)
    dr.rectangle((768, 210, 1023, 294), fill=(38, 56, 74))
    for lx in range(770, 1024, 8):
        dr.rectangle((lx, 208, lx + 3, 296), fill=(238, 243, 248))
    for sy in (208, 252, 296, 340):
        dr.line((768, sy, 1023, sy), fill=(198, 208, 218), width=2)

    # 7. Skybridge translucent blue-grey glass canopy (`skybridge_glass`) (768, 384, 256, 128)
    rects['skybridge_glass'] = (768, 384, 256, 128)
    dr.rectangle((768, 384, 1023, 511), fill=(124, 158, 184))
    for bx in range(768, 1024, 24):
        dr.line((bx, 384, bx, 511), fill=(236, 244, 250), width=3)
    for by in range(396, 512, 24):
        dr.line((768, by, 1023, by), fill=(206, 224, 238), width=2)

    # 8. Exact World Shared Sidewalk Granite (`shared_sidewalk`, 0x999894 * make_channel_image('sidewalk')) (0, 512, 256, 256)
    rects['shared_sidewalk'] = (0, 512, 256, 256)
    rng_sw = np.random.default_rng(202)
    lum_sw = 0.99 + 0.014 * _tileable_noise(256, 8, rng_sw) + 0.014 * rng_sw.normal(0.0, 1.0, (256, 256))
    yy, xx = np.mgrid[0:256, 0:256]
    lum_sw += (((xx // 64) * 37 + (yy // 64) * 73) % 11 - 5) * 0.004
    lum_sw[(xx % 64 < 2) | (yy % 64 < 2)] -= 0.075
    base_sw = np.array([0x99, 0x98, 0x94], dtype=np.float64)
    arr_sw = np.clip(np.rint(lum_sw[..., None] * base_sw), 0, 255).astype(np.uint8)
    im.paste(Image.fromarray(arr_sw, mode='RGB'), (0, 512))

    # 9. Exact World Shared Stone Embankment (`shared_bank`, 0x8f897b * make_channel_image('bank')) (256, 512, 256, 256)
    rects['shared_bank'] = (256, 512, 256, 256)
    rng_bk = np.random.default_rng(303)
    lum_bk = 0.99 + 0.022 * _tileable_noise(256, 8, rng_bk) + 0.016 * _tileable_noise(256, 32, rng_bk) + 0.012 * rng_bk.normal(0.0, 1.0, (256, 256))
    course = yy // 64
    shift = (course % 2) * 64
    lum_bk += ((course * 29 + (((xx + shift) % 256) // 128) * 53) % 9 - 4) * 0.006
    lum_bk[(yy % 64 < 3) | (((xx + shift) % 128) < 3)] -= 0.095
    base_bk = np.array([0x8F, 0x89, 0x7B], dtype=np.float64)
    arr_bk = np.clip(np.rint(lum_bk[..., None] * base_bk), 0, 255).astype(np.uint8)
    im.paste(Image.fromarray(arr_bk, mode='RGB'), (256, 512))

    # 10. Floodlit soffit & dark-tinted foyer glass that glows warm amber only at night (`uNight=1`)!
    rects['flood_white'] = (512, 512, 128, 128)
    dr.rectangle((512, 512, 639, 639), fill=(228, 234, 240))
    for fx in range(520, 640, 16):
        dr.line((fx, 512, fx, 639), fill=(202, 210, 220), width=2)

    rects['hall_warm'] = (640, 512, 128, 128)
    dr.rectangle((640, 512, 767, 639), fill=(48, 56, 68))
    dr.rectangle((652, 524, 755, 627), fill=(68, 62, 56))
    for hx in range(648, 768, 16):
        dr.line((hx, 512, hx, 639), fill=(92, 110, 128), width=2)
    for hy in range(528, 640, 22):
        dr.line((640, hy, 767, hy), fill=(76, 92, 110), width=1)

    swatches = [
        ('rib_white',     (768, 512, 128, 128), (252, 254, 255)),
        ('podium_wall',   (896, 512, 128, 128), (236, 240, 244)),
        ('dark_stone',    (512, 640, 128, 128), ( 78,  86,  96)),
        ('oculus_glass',  (640, 640, 128, 128), ( 44,  62,  78)),
        ('rail_stone',    (768, 640, 128, 128), (217, 213, 202)),  # 0xd9d5ca look.streets.railing
        ('pav_wall',      (896, 640, 128, 128), (214, 208, 192)),
        ('pav_wood',      (  0, 768, 128, 128), (108,  82,  62)),
        ('gray_tile',     (128, 768, 128, 128), ( 78,  86,  92)),
        ('warm_lit',      (256, 768, 128, 128), (248, 214, 142)),
        ('foliage_dark',  (384, 768, 128, 128), ( 44,  74,  44)),
        ('foliage_mid',   (512, 768, 128, 128), ( 62,  94,  56)),
        ('grass_island',  (640, 768, 128, 128), (118, 146, 102)),
        ('amber_flood',   (768, 768, 128, 128), (250, 212, 138)),
        ('bark',          (896, 768, 128, 128), ( 92,  80,  68)),
    ]
    for key, (x, y, w, h), rgb in swatches:
        rects[key] = (x, y, w, h)
        dr.rectangle((x, y, x + w - 1, y + h - 1), fill=rgb)
        if key == 'gray_tile':
            for rx in range(x + 8, x + w, 10):
                dr.line((rx, y, rx, y + h - 1), fill=(58, 64, 70), width=2)
        elif key == 'oculus_glass':
            dr.ellipse((x + 14, y + 14, x + w - 15, y + h - 15), outline=(218, 230, 242), width=5)

    return im, rects


def _interp_station(theta_rad: float):
    """Smooth periodic C1 cubic-hermite interpolation across the 8 petal/valley stations."""
    deg = math.degrees(theta_rad)
    while deg < -180.0:
        deg += 360.0
    while deg >= 180.0:
        deg -= 360.0

    pts = _ROOF_STATIONS
    n = len(pts)
    angs = [p[0] for p in pts]
    a0 = angs[-1] - 360.0
    a1 = angs[0]
    if deg >= angs[-1]:
        a0 = angs[-1]
        a1 = angs[0] + 360.0
        idx0, idx1 = n - 1, 0
    elif deg < angs[0]:
        idx0, idx1 = n - 1, 0
    else:
        for i in range(n - 1):
            if angs[i] <= deg < angs[i + 1]:
                idx0, idx1 = i, i + 1
                a0, a1 = angs[i], angs[i + 1]
                break

    t = (deg - a0) / max(1e-6, a1 - a0)
    w = 0.5 - 0.5 * math.cos(math.pi * t)
    s0, s1 = pts[idx0], pts[idx1]
    ph0 = s0[1]
    ph1 = s1[1] if idx1 > idx0 else s1[1] + 360.0
    phase_deg = ph0 + (ph1 - ph0) * t
    radius = s0[2] * (1.0 - w) + s1[2] * w
    y_eave = s0[3] * (1.0 - w) + s1[3] * w
    y_mid = s0[4] * (1.0 - w) + s1[4] * w
    petal_w = s0[5] * (1.0 - w) + s1[5] * w
    return math.radians(phase_deg), radius, y_eave, y_mid, petal_w


def _roof_point(s: float, theta: float):
    """3D point and continuous leaf-petal UV `u` on the 4-petal osmanthus dome (`s in [0, 1]`)."""
    phase, rad_max, y_eave, y_mid, _ = _interp_station(theta)
    r = s * rad_max
    x = CROWN_X + r * math.cos(theta)
    z = CROWN_Z + r * math.sin(theta)

    c4 = math.cos(4.0 * phase)
    petal_ness = max(0.0, c4)

    y_center = 28.60
    if s <= 0.48:
        u = s / 0.48
        ease = u * u * (3.0 - 2.0 * u)
        y_spine = y_center + (y_mid - y_center) * ease
        y_val = y_center + (y_mid - 2.6 - y_center) * (u ** 1.75)
    else:
        u = (s - 0.48) / 0.52
        y_spine = y_mid + (y_eave - y_mid) * (u ** 1.35)
        y_val = (y_mid - 2.6) + (y_eave - (y_mid - 2.6)) * (u ** 1.55)

    blend = petal_ness ** 1.25
    y = y_val * (1.0 - blend) + y_spine * blend

    # Continuous signed leaf margin distance -> smooth hardware-interpolated `petal_u` (zero jagged edges!)
    if s <= 0.060 or s >= 0.86:
        margin = -0.35
    else:
        sn = (s - 0.060) / (0.86 - 0.060)
        leaf_half_width = 0.90 * math.sin(math.pi * (sn ** 0.78))
        margin = c4 - (1.0 - leaf_half_width)

    # Map `margin` smoothly into `roof_grad` horizontal UV coordinate `petal_u in [0.06 .. 0.92]`
    t_leaf = min(1.0, max(0.0, (margin + 0.16) / 0.32))
    t_leaf = t_leaf * t_leaf * (3.0 - 2.0 * t_leaf)
    # In pure valley (`t_leaf == 0`), vary `u` slightly in `[0.04, 0.38]` for rich glazed grid texture
    valley_u = 0.04 + 0.34 * (0.5 + 0.5 * math.sin(12.0 * phase))
    petal_u = valley_u * (1.0 - t_leaf) + 0.86 * t_leaf

    if t_leaf > 0.01:
        y += 0.34 * t_leaf * math.sin(math.pi * min(1.0, max(0.0, (s - 0.060) / 0.80)))

    return np.array([x, y, z], dtype=np.float64), t_leaf, petal_u, c4


def _grounded_ribbon_wall(b: SceneBuilder, ring_xz, y_top: float, region: str, cap_region: str = None,
                          tile: float = 4.2, collide: bool = False, y_bot_fn=None):
    """Extrude a closed polygon from `y_bot_fn(x, z)` (defaulting to `b.grade(x, z) - 0.045`) up to `y_top`."""
    pts = np.asarray(ring_xz, dtype=np.float64)
    if len(pts) >= 2 and np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    area2 = np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1])
    if area2 < 0:
        pts = pts[::-1]
    lows = [y_bot_fn(x, z) if y_bot_fn is not None else (b.grade(x, z) - 0.045) for x, z in pts]
    tris = mapbox_earcut.triangulate_float64(pts, np.array([len(pts)], np.uint32)).reshape(-1, 3)
    cap = cap_region or region
    for t in tris:
        tri_top = [(pts[i, 0], y_top, pts[i, 1]) for i in t]
        b.face(tri_top, (0, 1, 0), cap, tile=tile)
        if collide and b.collide:
            b.hit_quad(tri_top, (0, 1, 0))
    if y_bot_fn is not None:
        for t in tris:
            tri_bot = [(pts[i, 0], lows[i], pts[i, 1]) for i in t[::-1]]
            b.face(tri_bot, (0, -1, 0), 'podium_wall', tile=tile)
    for i in range(len(pts)):
        j = (i + 1) % len(pts)
        pa, pb = pts[i], pts[j]
        nrm = (pb[1] - pa[1], 0.0, pa[0] - pb[0])
        seg_len = max(0.2, math.hypot(pb[0] - pa[0], pb[1] - pa[1]))
        quad = [(pa[0], lows[i], pa[1]), (pb[0], lows[j], pb[1]), (pb[0], y_top, pb[1]), (pa[0], y_top, pa[1])]
        if region in ('mountain_panel', 'bud_facade'):
            chunk_w = 12.0 if region == 'mountain_panel' else 8.0
            steps = max(1, int(round(seg_len / chunk_w)))
            for s_idx in range(steps):
                t0, t1 = s_idx / steps, (s_idx + 1) / steps
                xa, za = pa[0] + (pb[0] - pa[0]) * t0, pa[1] + (pb[1] - pa[1]) * t0
                xb, zb = pa[0] + (pb[0] - pa[0]) * t1, pa[1] + (pb[1] - pa[1]) * t1
                la = lows[i] + (lows[j] - lows[i]) * t0
                lb = lows[i] + (lows[j] - lows[i]) * t1
                b.face(
                    [(xa, la, za), (xb, lb, zb), (xb, y_top, zb), (xa, y_top, za)],
                    nrm,
                    region,
                    uvs=[(0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)],
                )
        else:
            b.face(quad, nrm, region, tile=tile)
        if collide and b.collide:
            steps = max(1, math.ceil(seg_len / 6.0))
            for s_idx in range(steps):
                t0, t1 = s_idx / steps, (s_idx + 1) / steps
                xa, za = pa[0] + (pb[0] - pa[0]) * t0, pa[1] + (pb[1] - pa[1]) * t0
                xb, zb = pa[0] + (pb[0] - pa[0]) * t1, pa[1] + (pb[1] - pa[1]) * t1
                la = lows[i] + (lows[j] - lows[i]) * t0
                lb = lows[i] + (lows[j] - lows[i]) * t1
                b.hit_quad([(xa, la, za), (xb, lb, zb), (xb, y_top, zb), (xa, y_top, za)], nrm)


def _ellipse_ring(cx, cz, rx, rz, rot_deg=-8.0, n=32):
    cr, sr = math.cos(math.radians(rot_deg)), math.sin(math.radians(rot_deg))
    pts = []
    for k in range(n):
        a = 2.0 * math.pi * k / n
        ex, ez = rx * math.cos(a), rz * math.sin(a)
        pts.append((cx + ex * cr - ez * sr, cz + ex * sr + ez * cr))
    return pts


def build_guilin_theater(b: SceneBuilder):
    # =========================================================================
    # 1. MAIN OPERA HOUSE LOWER PODIUM (Exact OSM `way/1466385147` at y = +2.0 m!)
    # =========================================================================
    _grounded_ribbon_wall(b, LOCAL_FOOTPRINT, 3.35, 'mountain_panel', cap_region='podium_wall', tile=4.2, collide=True)

    # =========================================================================
    # 2. SOUTH "FLOWER BUD" CONCERT HALL (891-seat elliptical secondary hall!)
    # =========================================================================
    bud_cx, bud_cz = -0.50, 55.20
    bud_base_ring = _ellipse_ring(bud_cx, bud_cz, rx=14.8, rz=9.8, rot_deg=-6.0, n=28 if b.detail else 16)
    _grounded_ribbon_wall(b, bud_base_ring, 3.45, 'mountain_panel', cap_region='podium_wall', collide=True)

    # Calyx outer ribbon collar wrapping Concert Hall (`opera_0.jpg` left & `opera_10.jpg` right!)
    bud_calyx_ring = _ellipse_ring(-0.50, 53.50, rx=17.4, rz=19.0, rot_deg=-8.0, n=32 if b.detail else 16)
    _grounded_ribbon_wall(
        b, bud_calyx_ring, 10.60, 'bud_facade', cap_region='dark_stone', tile=5.0,
        collide=False, y_bot_fn=lambda x, z: 3.30
    )
    # Dark-tinted clerestory glazing band on Concert Hall that glows warm at night (`uNight=1`)
    if b.detail:
        bud_glow_ring = _ellipse_ring(-0.50, 53.50, rx=17.43, rz=19.03, rot_deg=-8.0, n=32)
        for k in range(len(bud_glow_ring)):
            pa, pb = bud_glow_ring[k], bud_glow_ring[(k + 1) % len(bud_glow_ring)]
            nrm = (pb[1] - pa[1], 0.0, pa[0] - pb[0])
            b.face(
                [(pa[0], 8.75, pa[1]), (pb[0], 8.75, pb[1]), (pb[0], 9.75, pb[1]), (pa[0], 9.75, pa[1])],
                nrm, 'hall_warm', tile=2.5, lit=True
            )

    # Inner stepped "Flower Bud" upper white shell (`y = +10.50 .. +13.95 m`)
    bud_upper_ring = _ellipse_ring(-0.50, 53.50, rx=15.6, rz=17.2, rot_deg=-8.0, n=32 if b.detail else 16)
    _grounded_ribbon_wall(
        b, bud_upper_ring, 13.85, 'rib_white', cap_region='roof_shell', tile=4.0,
        collide=False, y_bot_fn=lambda x, z: 10.50
    )

    # Smooth domed "Flower Bud" crown + crisp S-curved leaf skylight groove (`opera_3.jpg`!)
    n_bud_r = 5 if b.detail else 2
    n_bud_a = 36 if b.detail else 16
    cr8, sr8 = math.cos(math.radians(-8.0)), math.sin(math.radians(-8.0))
    for ir in range(n_bud_r):
        s0, s1 = ir / n_bud_r, (ir + 1) / n_bud_r
        for ia in range(n_bud_a):
            a0, a1 = 2 * math.pi * ia / n_bud_a, 2 * math.pi * (ia + 1) / n_bud_a
            quad = []
            for sr_v, av in ((s0, a0), (s1, a0), (s1, a1), (s0, a1)):
                ex, ez = 15.6 * sr_v * math.cos(av), 17.2 * sr_v * math.sin(av)
                lx = -0.50 + ex * cr8 - ez * sr8
                lz = 53.50 + ex * sr8 + ez * cr8
                ly = 13.85 + 1.25 * (1.0 - sr_v ** 1.85)
                quad.append((lx, ly, lz))
            b.face(quad[::-1], (0, 1, 0), 'roof_shell', tile=5.0)

    # Smooth parametric S-curved leaf skylight ribbon inlaid across the "Flower Bud" dome (zero jaggedness!)
    n_slot = 18 if b.detail else 8
    for ks in range(n_slot):
        u0, u1 = -0.86 + 1.72 * ks / n_slot, -0.86 + 1.72 * (ks + 1) / n_slot
        ez0, ez1 = u0 * 16.5, u1 * 16.5
        ex0 = 3.1 * math.sin(u0 * math.pi * 0.92)
        ex1 = 3.1 * math.sin(u1 * math.pi * 0.92)
        hw0 = 2.05 * math.cos(u0 * math.pi * 0.54)
        hw1 = 2.05 * math.cos(u1 * math.pi * 0.54)
        p_sl = []
        for ex_c, ez_c, sgn in ((ex0, ez0, -hw0), (ex0, ez0, hw0), (ex1, ez1, hw1), (ex1, ez1, -hw1)):
            ex_p = ex_c + sgn
            sr_eq = min(1.0, math.hypot(ex_p / 15.6, ez_c / 17.2))
            lx = -0.50 + ex_p * cr8 - ez_c * sr8
            lz = 53.50 + ex_p * sr8 + ez_c * cr8
            ly = 13.91 + 1.25 * (1.0 - sr_eq ** 1.85)
            p_sl.append((lx, ly, lz))
        b.face(p_sl, (0, 1, 0), 'oculus_glass', tile=3.0, lit=True)

    # =========================================================================
    # 3. CONTINUOUS WAVE-TERRACED WHITE PODIUM RIBBONS (y > 3.30 m, wrapping Hall + Bud!)
    # =========================================================================
    tier2_ring = [
        (10.5, -48.5), (-3.0, -39.5), (-16.0, -33.0), (-31.0, -28.0),
        (-43.5, -21.0), (-47.5, -11.0), (-45.5, 4.0), (-39.5, 21.0),
        (-31.5, 38.0), (-23.5, 53.0), (-17.5, 66.5), (-7.0, 73.5),
        (5.5, 73.0), (15.5, 65.5), (19.5, 52.0), (21.5, 37.5),
        (34.0, 29.0), (42.5, 22.5), (46.5, 13.5), (42.0, 3.5),
        (35.5, -4.0), (31.5, -15.0), (29.5, -30.0), (26.0, -45.0), (19.5, -50.2),
    ]
    _grounded_ribbon_wall(
        b, tier2_ring, 6.65, 'mountain_panel', cap_region='shared_sidewalk', tile=2.0,
        collide=False, y_bot_fn=lambda x, z: 3.30
    )
    tier3_ring = [(x * 0.90 + 1.2, z * 0.86) for x, z in LOCAL_FOOTPRINT]
    _grounded_ribbon_wall(
        b, tier3_ring, 9.65, 'arch_glass', cap_region='podium_wall', tile=4.2,
        collide=False, y_bot_fn=lambda x, z: 6.60
    )
    tier3_cap_ring = [(x * 0.92 + 1.0, z * 0.88) for x, z in LOCAL_FOOTPRINT]
    _grounded_ribbon_wall(
        b, tier3_cap_ring, 10.35, 'rib_white', cap_region='dark_stone', tile=4.0,
        collide=False, y_bot_fn=lambda x, z: 9.60
    )

    # Warm night architectural strip lighting tucked along Tier 1, Tier 2 & Tier 3 ribbons (`sohu_2024_00.jpg`!)
    if b.detail:
        for ring_l, y_lo, y_hi in ((tier2_ring, 6.38, 6.66), (tier3_cap_ring, 10.08, 10.36)):
            for k in range(len(ring_l)):
                pa, pb = ring_l[k], ring_l[(k + 1) % len(ring_l)]
                nrm = (pb[1] - pa[1], 0.0, pa[0] - pb[0])
                b.face(
                    [(pa[0], y_lo, pa[1]), (pb[0], y_lo, pb[1]), (pb[0], y_hi, pb[1]), (pa[0], y_hi, pa[1])],
                    nrm, 'amber_flood', tile=2.0, lit=True
                )

    # =========================================================================
    # 4. NORTH & EAST GRAND ENTRANCE STEPS, CANOPIES & ELEVATED EAST SKYBRIDGE!
    # =========================================================================
    p_north = b.set_frame(origin=(8.0, 0.0, -45.5), front_xz=(-0.42, -0.91))
    for step_i in range(5):
        z_out = 1.2 + (4 - step_i) * 1.15
        w_st = 24.0 + (4 - step_i) * 1.6
        y_top_s = 0.34 * (step_i + 1)
        x0, x1 = -w_st / 2.0, w_st / 2.0
        z0, z1 = -1.5, z_out
        step_poly = [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]
        _grounded_ribbon_wall(b, step_poly, y_top_s, 'rail_stone', cap_region='shared_sidewalk', tile=2.0, collide=False)
    b.restore_frame(p_north)

    # Elevated Curved-Glass Skybridge across Linjiang Rd (`opera_0.jpg`!)
    p_bridge = b.set_frame(origin=(35.5, 0.0, 13.5), front_xz=(0.91, 0.41))
    blen = 22.5
    bw = 5.4
    b.box(0.0, 5.85, blen / 2.0 - 2.0, bw, 0.45, blen + 2.0, 'rib_white', cap_region='shared_sidewalk', tile=2.0, collide=False, bottom=True)
    for sx in (-bw / 2.0 + 0.12, bw / 2.0 - 0.12):
        b.box(sx, 6.30, blen / 2.0 - 1.5, 0.16, 1.15, blen + 1.0, 'skybridge_glass', tile=2.5, collide=False)
    n_arch = 8 if b.detail else 4
    n_span = 6 if b.detail else 3
    for iz in range(n_span):
        za = -1.5 + (blen + 1.5) * iz / n_span
        zb = -1.5 + (blen + 1.5) * (iz + 1) / n_span
        for ix in range(n_arch):
            ua, ub = -1.0 + 2.0 * ix / n_arch, -1.0 + 2.0 * (ix + 1) / n_arch
            xa, xb = ua * (bw * 0.56), ub * (bw * 0.56)
            ya = 7.45 + 1.55 * (1.0 - ua * ua)
            yb = 7.45 + 1.55 * (1.0 - ub * ub)
            b.face([(xa, ya, za), (xb, yb, za), (xb, yb, zb), (xa, ya, zb)], (0.3 * (ua + ub), 1.0, 0.0), 'skybridge_glass', tile=3.0)
            b.face([(xa, ya - 0.08, zb), (xb, yb - 0.08, zb), (xb, yb - 0.08, za), (xa, ya - 0.08, za)], (0.0, -1.0, 0.0), 'flood_white', tile=3.0, lit=True)
    b.restore_frame(p_bridge)

    # =========================================================================
    # 5. FOUR-PETAL "BLOOMING OSMANTHUS" SINGLE-LAYER GRID-SHELL DOME!
    # =========================================================================
    ns = 16 if b.detail else 8
    nt = 96 if b.detail else 40
    ss = np.linspace(0.060, 1.0, ns + 1)
    ts = np.linspace(-math.pi, math.pi, nt + 1)

    pts_grid = np.zeros((ns + 1, nt + 1, 3), dtype=np.float64)
    leaf_grid = np.zeros((ns + 1, nt + 1), dtype=np.float64)
    u_grid = np.zeros((ns + 1, nt + 1), dtype=np.float64)
    c4_grid = np.zeros((ns + 1, nt + 1), dtype=np.float64)

    for i, sv in enumerate(ss):
        for j, tv in enumerate(ts):
            pt, t_lf, pu, c4 = _roof_point(sv, tv)
            pts_grid[i, j] = pt
            leaf_grid[i, j] = t_lf
            u_grid[i, j] = pu
            c4_grid[i, j] = c4
        pts_grid[i, nt] = pts_grid[i, 0]
        leaf_grid[i, nt] = leaf_grid[i, 0]
        u_grid[i, nt] = u_grid[i, 0]
        c4_grid[i, nt] = c4_grid[i, 0]

    # Central circular skylight oculus cap (`s in [0, 0.060]`, diameter ~4.2 m)
    crown_c = np.array([CROWN_X, 28.55, CROWN_Z], dtype=np.float64)
    for j in range(nt):
        p0 = pts_grid[0, j]
        p1 = pts_grid[0, j + 1]
        b.face([crown_c, p1, p0], (0.0, 1.0, 0.0), 'oculus_glass', tile=4.0, lit=True)
        b.face([p0, p1, p1 + np.array([0, 0.22, 0]), p0 + np.array([0, 0.22, 0])], (CROWN_X - p0[0], 0.5, CROWN_Z - p0[2]), 'rib_white', tile=2.0)

    # Main doubly-curved 4-petal dome surface (smooth per-vertex `roof_grad` UV — zero stair-step jaggedness!)
    for i in range(ns):
        s0, s1 = ss[i], ss[i + 1]
        for j in range(nt):
            p00, p10 = pts_grid[i, j], pts_grid[i + 1, j]
            p11, p01 = pts_grid[i + 1, j + 1], pts_grid[i, j + 1]
            nrm = np.cross(p10 - p00, p01 - p00)
            if nrm[1] < 0:
                nrm = -nrm

            u00, u10 = u_grid[i, j], u_grid[i + 1, j]
            u11, u01 = u_grid[i + 1, j + 1], u_grid[i, j + 1]
            b.face(
                [p00, p01, p11, p10],
                nrm,
                'roof_grad',
                uvs=[(u00, s0), (u01, s0), (u11, s1), (u10, s1)],
                lit=False,
            )

            # Continuous 360-degree underside floodlit overhang soffit (`s >= 0.72`)
            if s0 >= 0.70:
                inward0 = np.array([CROWN_X - p00[0], 0.0, CROWN_Z - p00[2]])
                inward0 /= max(1e-6, np.linalg.norm(inward0))
                off = np.array([inward0[0] * 0.40, -0.95, inward0[2] * 0.40])
                q00, q10, q11, q01 = p00 + off, p10 + off, p11 + off, p01 + off
                b.face([q00, q10, q11, q01], (-inward0[0] * 0.45, -0.85, -inward0[2] * 0.45), 'flood_white', tile=5.0, lit=True)

    # 5b. 3D GEOMETRIC RAISED BRIGHT-WHITE RADIAL STANDING-SEAM RIBS (`rib_white`) IN ALL 4 DIRECTIONS!
    if b.detail:
        rib_hw = 0.11
        rib_h = 0.27
        for j in range(0, nt, 2):
            for i in range(1, ns):
                if leaf_grid[i, j] > 0.65 and leaf_grid[i + 1, j] > 0.65:
                    continue
                c0, c1 = pts_grid[i, j], pts_grid[i + 1, j]
                tang_t = pts_grid[i, (j + 1) % nt] - pts_grid[i, (j - 1) % nt]
                lt = np.linalg.norm(tang_t)
                ut = tang_t / lt if lt > 1e-6 else np.array([1.0, 0.0, 0.0])
                tang_s = c1 - c0
                nrm = np.cross(ut, tang_s)
                ln = np.linalg.norm(nrm)
                nrm = nrm / ln if ln > 1e-6 else np.array([0.0, 1.0, 0.0])
                if nrm[1] < 0:
                    nrm = -nrm
                # Feather rib height smoothly into the smooth white osmanthus petal shell!
                h0 = rib_h * (1.0 - 0.85 * leaf_grid[i, j])
                h1 = rib_h * (1.0 - 0.85 * leaf_grid[i + 1, j]) * (0.55 if i == ns - 1 else 1.0)
                bl0, br0 = c0 - ut * rib_hw, c0 + ut * rib_hw
                bl1, br1 = c1 - ut * rib_hw, c1 + ut * rib_hw
                tl0, tr0 = bl0 + nrm * h0, br0 + nrm * h0
                tl1, tr1 = bl1 + nrm * h1, br1 + nrm * h1
                b.face([tl0, tl1, tr1, tr0], nrm, 'rib_white', tile=2.0)
                b.face([bl0, bl1, tl1, tl0], -ut + 0.35 * nrm, 'rib_white', tile=2.0)
                b.face([tr0, tr1, br1, br0], ut + 0.35 * nrm, 'rib_white', tile=2.0)

    # 5c. 360-DEGREE SCULPTURAL WHITE FASCIA RIM & EXPOSED TUBULAR SPACE-FRAME ARCH TRUSS (`arch_truss`)
    for j in range(nt):
        p0 = pts_grid[ns, j]
        p1 = pts_grid[ns, j + 1]
        mid = 0.5 * (p0 + p1)
        out_dir = np.array([mid[0] - CROWN_X, 0.0, mid[2] - CROWN_Z])
        out_dir /= max(1e-6, np.linalg.norm(out_dir))
        c4_m = 0.5 * (c4_grid[ns, j] + c4_grid[ns, j + 1])
        drop = 1.35 + 1.25 * max(0.0, c4_m)
        inset = 1.05 + 0.85 * max(0.0, c4_m)
        b0 = p0 - out_dir * inset - np.array([0.0, drop, 0.0])
        b1 = p1 - out_dir * inset - np.array([0.0, drop, 0.0])
        b.face([b0, b1, p1, p0], (out_dir[0], 0.22, out_dir[2]), 'arch_truss',
               uvs=[(0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)], lit=False)
        lip0 = p0 + out_dir * 0.14 - np.array([0.0, 0.36, 0.0])
        lip1 = p1 + out_dir * 0.14 - np.array([0.0, 0.36, 0.0])
        top0 = p0 + out_dir * 0.14 + np.array([0.0, 0.12, 0.0])
        top1 = p1 + out_dir * 0.14 + np.array([0.0, 0.12, 0.0])
        b.face([lip0, lip1, top1, top0], (out_dir[0], 0.3, out_dir[2]), 'rib_white', tile=3.0, lit=(j % 2 == 0))

    # =========================================================================
    # 6. ALL-DIRECTION RECESSED PARABOLIC CURTAIN WALLS & 8 WHITE MEGA-COLUMNS!
    # =========================================================================
    s_wall_idx = max(2, int(round(ns * 0.80)))
    for j in range(nt):
        r0 = pts_grid[s_wall_idx, j]
        r1 = pts_grid[s_wall_idx, j + 1]
        y_top0 = max(9.8, r0[1] - 0.35)
        y_top1 = max(9.8, r1[1] - 0.35)
        bx0 = CROWN_X + (r0[0] - CROWN_X) * 0.86
        bz0 = CROWN_Z + (r0[2] - CROWN_Z) * 0.86
        bx1 = CROWN_X + (r1[0] - CROWN_X) * 0.86
        bz1 = CROWN_Z + (r1[2] - CROWN_Z) * 0.86
        tx0 = CROWN_X + (r0[0] - CROWN_X) * 0.94
        tz0 = CROWN_Z + (r0[2] - CROWN_Z) * 0.94
        tx1 = CROWN_X + (r1[0] - CROWN_X) * 0.94
        tz1 = CROWN_Z + (r1[2] - CROWN_Z) * 0.94
        out_n = (0.5 * (tx0 + tx1) - CROWN_X, 0.08, 0.5 * (tz0 + tz1) - CROWN_Z)
        b.face([(bx0, 9.20, bz0), (bx1, 9.20, bz1), (tx1, y_top1, tz1), (tx0, y_top0, tz0)],
               out_n, 'arch_glass', tile=4.6, lit=False)

        # Warm glowing foyer glazing panels inside the 4 grand parabolic arches (`opera_0.jpg`, `sohu_2024_00.jpg`!)
        if c4_grid[s_wall_idx, j] > 0.32 and y_top0 > 14.5 and j % 2 == 0:
            gx0 = bx0 + (tx0 - bx0) * 0.08
            gz0 = bz0 + (tz0 - bz0) * 0.08
            gx1 = bx1 + (tx1 - bx1) * 0.08
            gz1 = bz1 + (tz1 - bz1) * 0.08
            gx2 = bx1 + (tx1 - bx1) * 0.82
            gz2 = bz1 + (tz1 - bz1) * 0.82
            gx3 = bx0 + (tx0 - bx0) * 0.82
            gz3 = bz0 + (tz0 - bz0) * 0.82
            n_len = max(1e-6, math.hypot(out_n[0], out_n[2]))
            ox, oz = out_n[0] / n_len * 0.018, out_n[2] / n_len * 0.018
            yh0 = min(22.5, y_top0 - 2.6)
            yh1 = min(22.5, y_top1 - 2.6)
            b.face(
                [(gx0 + ox, 10.25, gz0 + oz), (gx1 + ox, 10.25, gz1 + oz),
                 (gx2 + ox, yh1, gz2 + oz), (gx3 + ox, yh0, gz3 + oz)],
                out_n, 'hall_warm', tile=4.0, lit=True
            )

        if b.detail:
            c4_here = c4_grid[s_wall_idx, j]
            if 0.14 <= c4_here <= 0.34:
                dx0, dz0 = tx0 - CROWN_X, tz0 - CROWN_Z
                ln0 = max(1e-6, math.hypot(dx0, dz0))
                ux, uz = dx0 / ln0, dz0 / ln0
                px_n, pz_n = -uz, ux
                p_bot_l = (bx0 - px_n * 0.85 + ux * 0.8, 6.40, bz0 - pz_n * 0.85 + uz * 0.8)
                p_bot_r = (bx0 + px_n * 0.85 + ux * 0.8, 6.40, bz0 + pz_n * 0.85 + uz * 0.8)
                p_top_l = (tx0 - px_n * 0.52 + ux * 0.45, y_top0, tz0 - pz_n * 0.52 + uz * 0.45)
                p_top_r = (tx0 + px_n * 0.52 + ux * 0.45, y_top0, tz0 + pz_n * 0.52 + uz * 0.45)
                b.face([p_bot_l, p_bot_r, p_top_r, p_top_l], (ux, 0.1, uz), 'podium_wall', tile=3.0)
                b.face([(bx0, 6.40, bz0), p_bot_l, p_top_l, (tx0, y_top0, tz0)], (-px_n, 0.0, -pz_n), 'podium_wall', tile=3.0)
                b.face([p_bot_r, (bx0, 6.40, bz0), (tx0, y_top0, tz0), p_top_r], (px_n, 0.0, pz_n), 'podium_wall', tile=3.0)
            elif j % 2 == 0:
                dx0, dz0 = tx0 - CROWN_X, tz0 - CROWN_Z
                ln0 = max(1e-6, math.hypot(dx0, dz0))
                ux, uz = dx0 / ln0, dz0 / ln0
                b.face(
                    [(bx0, 9.20, bz0), (bx0 + ux * 0.22, 9.20, bz0 + uz * 0.22),
                     (tx0 + ux * 0.22, y_top0, tz0 + uz * 0.22), (tx0, y_top0, tz0)],
                    (-uz, 0.0, ux), 'podium_wall', tile=2.0
                )

    # =========================================================================
    # 7. SHARED WORLD-MATERIAL NORTH FORECOURT PLAZA & CIRCULAR TREE ISLAND
    # =========================================================================
    north_apron = [
        (-28.0, -28.0), (-18.0, -48.0), (-2.0, -61.0), (18.0, -63.0),
        (36.0, -51.0), (41.0, -35.0), (31.0, -18.0), (12.0, -35.0),
    ]
    b.prism(north_apron, 0.0, 0.10, 'shared_sidewalk', cap_region='shared_sidewalk', tile=2.0, collide=False, paving=True)

    island_ring = _ellipse_ring(24.0, -90.0, rx=13.5, rz=13.5, rot_deg=0.0, n=20 if b.detail else 10)
    b.prism(island_ring, 0.0, 0.28, 'rail_stone', cap_region='grass_island', tile=3.0, collide=False, footing=True)
    for ox, oz, th, sp, fc in [
        (24.0, -90.0, 10.5, 4.6, 'foliage_dark'),
        (18.5, -87.5,  9.2, 3.8, 'foliage_mid'),
        (29.5, -88.0,  9.4, 3.9, 'foliage_dark'),
        (23.5, -95.5,  8.8, 3.6, 'foliage_mid'),
    ]:
        b.tree_cluster(ox, b.grade(ox, oz) - 0.04, oz, h=th, spread=sp, foliage=fc)

    # =========================================================================
    # 8. WEST RIVERSIDE SCENE (Preserved 2F grey-tiled pavilion, shared stone embankment & foliage!)
    # =========================================================================
    embankment_local = [
        (-80.9, -63.7), (-86.4, -51.7), (-90.4, -41.7), (-85.9, -29.7),
        (-81.9, -15.7), (-69.9,  -1.7), (-60.9,  10.3), (-47.9,   8.3),
        (-51.9, -21.7), (-57.9, -47.7), (-67.9, -63.7),
    ]
    _grounded_ribbon_wall(b, embankment_local, -5.15, 'shared_bank', cap_region='shared_sidewalk', tile=3.0, collide=True)

    shore_pts = embankment_local[:7]
    for idx in range(len(shore_pts) - 1):
        a, c = shore_pts[idx], shore_pts[idx + 1]
        dx, dz = c[0] - a[0], c[1] - a[1]
        seg = math.hypot(dx, dz)
        p_f = b.set_frame(origin=((a[0] + c[0]) / 2, -5.18, (a[1] + c[1]) / 2), front_xz=(-dz, dx))
        b.box(0.0, 0.0, 0.0, seg, 0.96, 0.28, 'rail_stone', tile=2.0)
        b.box(0.0, 0.12, 0.14, seg * 0.92, 0.20, 0.14, 'amber_flood', tile=2.0, lit=True)
        b.restore_frame(p_f)

    pav_origin = (-73.3, -5.18, -34.5)
    p_pav = b.set_frame(origin=pav_origin, front_xz=(-0.92, -0.39))
    pw, pd = 16.5, 9.2
    b.box(0.0, 0.0, 0.0, pw, 3.1, pd, 'pav_wall', tile=2.5, collide=True)
    b.box(0.0, 3.05, 0.25, pw + 1.4, 0.24, pd + 1.4, 'gray_tile', tile=1.8, bottom=True)
    b.box(0.0, 3.25, 0.0, pw - 0.8, 2.65, pd - 0.8, 'pav_wall', tile=2.5, collide=True)
    b.box(0.0, 3.30, pd / 2 + 0.15, pw, 0.85, 0.16, 'pav_wood', tile=1.5)
    for wx_off in (-4.8, -1.6, 1.6, 4.8):
        b.box(wx_off, 1.0, pd / 2 + 0.03, 2.1, 1.45, 0.08, 'warm_lit', tile=1.5, lit=True)
        b.box(wx_off, 3.9, pd / 2 - 0.38, 2.2, 1.40, 0.08, 'warm_lit', tile=1.5, lit=True)
    b.box(0, 5.82, 0, pw + 2.0, 0.18, pd + 1.8, 'pav_wood', bottom=True)
    rw, rd = pw + 2.0, pd + 1.8
    ry0, ry1 = 5.88, 6.88
    b.face([(-rw / 2, ry0, rd / 2), (rw / 2, ry0, rd / 2), (rw / 2 - 1.2, ry1, 0.0), (-rw / 2 + 1.2, ry1, 0.0)],
           (0.0, 0.85, 0.52), 'gray_tile', tile=2.0)
    b.face([(rw / 2, ry0, -rd / 2), (-rw / 2, ry0, -rd / 2), (-rw / 2 + 1.2, ry1, 0.0), (rw / 2 - 1.2, ry1, 0.0)],
           (0.0, 0.85, -0.52), 'gray_tile', tile=2.0)
    b.face([(-rw / 2, ry0, -rd / 2), (-rw / 2, ry0, rd / 2), (-rw / 2 + 1.2, ry1, 0.0)], (-0.8, 0.6, 0.0), 'gray_tile', tile=2.0)
    b.face([(rw / 2, ry0, rd / 2), (rw / 2, ry0, -rd / 2), (rw / 2 - 1.2, ry1, 0.0)], (0.8, 0.6, 0.0), 'gray_tile', tile=2.0)
    b.restore_frame(p_pav)

    trees_local = [
        (-58.8, -62.5, 11.2, 4.8, 'foliage_dark'),
        (-64.2, -52.0, 11.8, 5.0, 'foliage_mid'),
        (-66.5, -42.5, 11.0, 4.8, 'foliage_dark'),
        (-54.0, -30.5, 15.2, 3.6, 'foliage_dark'),
        (-47.5, -14.5, 15.4, 3.7, 'foliage_mid'),
        (-56.5,  -1.5, 12.2, 4.6, 'foliage_dark'),
        (-52.0,  11.0, 12.5, 4.8, 'foliage_mid'),
        (-44.0,  26.0, 11.6, 4.4, 'foliage_dark'),
        (-33.5,  46.0, 11.2, 4.2, 'foliage_mid'),
        (-24.5,  66.0, 10.8, 4.0, 'foliage_dark'),
    ]
    for lx, lz, th, tsp, fcol in trees_local:
        gy = b.grade(lx, lz) - 0.04
        if -86.0 <= lx <= -49.0 and -62.0 <= lz <= 9.0:
            gy = max(gy, -5.18)
        b.tree_cluster(lx, gy, lz, h=th, spread=tsp, foliage=fcol)


if __name__ == '__main__':
    out_dir = Path(sys.argv[1])
    atlas_img, atlas_rects = make_theater_atlas()
    export_landmark_glb(
        out_dir / 'guilin_theater.glb',
        atlas_img,
        atlas_rects,
        build_guilin_theater,
        mat_prefix='guilin_theater',
        lit_emissive=(1.45, 1.15, 0.72),
        atlas_metallic=0.14,
        atlas_roughness=0.52,
        double_sided=True,
    )
