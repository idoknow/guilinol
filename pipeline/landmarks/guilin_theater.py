"""Guilin Theater / Lijiang Opera House (桂林剧院 / 漓江歌剧院, way/1466385147).

Full 360-degree multi-view reconstruction per IDOK-70 (M2.6-25):
  - True "Blooming Osmanthus" (盛开桂花) 4-petal geometry:
      * Strict 90-degree orthogonal cross symmetry (`-154°, -64°, +26°, +116°`) with a concave-sided
        rounded-square outer plan matching vertical aerial imagery (`opera_3.jpg` & Esri WV03 `2024-12-24`).
      * Center is LOW (`y = +21.8 m` with a small white conical cap & dark oculus dot), while all 4
        smooth pure-white elliptical petals sweep UPWARD to soaring tips (`NW +31.8 m`, `NE +28.0 m`,
        `SE +29.5 m`, `SW +27.6 m` — all within 13% of the `+31.6 m` benchmark).
      * Beneath each upward-flaring petal tip opens a tall parabolic arch ("eye") revealing recessed
        full-height deep grey-blue mullioned glass curtain walls (`arch_glass`, glowing warm amber at
        night via `uNight` without altering daytime dark-blue glass) flanked by raked white mega-columns.
      * Between adjacent petals, 4 saddle valleys plunge smoothly down to the podium roof (`+10.8 m`),
        clad in cool blue-slate diamond-lattice glass (`valley_glass`), with raised white ribs kept
        strictly on the smooth elliptical petal borders and the outer tubular space-truss arch rims.
  - Preserves Rock's approved West Bank riverfront view (`01` / `02`, silhouette height diff <= 2.3%
    vs `main`), South "Flower Bud" Concert Hall, karst-perforated wave podium, East skybridge, and
    shared-material North Plaza / riverside embankment with 0 grounding failures.
"""
import math
from pathlib import Path
import sys

import mapbox_earcut
import numpy as np
from PIL import Image, ImageDraw
import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parent))
from m26_16_kit import SceneBuilder, bucket_to_trimesh, landmark_surface

# Exact manifest anchor of OSM way/1466385147: (-100.11794, 154.45, 269.73290)
LOCAL_FOOTPRINT = [
    (9.60, -46.87), (-1.52, -36.40), (-12.63, -29.89), (-24.60, -26.22),
    (-39.43, -22.53), (-44.01, -18.55), (-45.12, -15.17), (-42.84, -4.97),
    (-33.17, 15.78), (-30.87, 29.56), (-25.87, 39.38), (-17.88, 43.83),
    (-5.88, 42.61), (3.92, 37.23), (13.35, 33.07), (31.83, 27.69),
    (39.85, 22.59), (45.62, 14.50), (44.86, 11.11), (41.45, 5.50),
    (35.25, -1.87), (31.26, -12.63), (28.81, -27.91), (26.00, -43.75),
    (21.15, -49.28), (14.81, -49.94),
]

# Exact orthogonal symmetry center & 4 orthogonal petal axes (-154, -64, +26, +116 deg):
CROWN_X = 2.50
CROWN_Z = -2.50
THETA0 = math.radians(-154.0)

# Soaring petal tip heights [NW riverfront, NE north plaza, SE east rear, SW southwest]:
PETAL_TIPS = (31.80, 28.00, 29.50, 27.60)
Y_CENTER = 21.80
Y_VALLEY_EAVE = 10.80


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

    # 1. Blue-grey diamond-lattice glass grid-shell for saddle valleys (`valley_glass`) (0, 0, 384, 256)
    # Cool slate-blue glass base + crisp fine white/silver diagonal diamond lattice (no heavy vertical stripes!)
    rects['valley_glass'] = (0, 0, 384, 256)
    dr.rectangle((0, 0, 383, 255), fill=(86, 114, 142))
    # Subtle glass panel tonal variation inside diamond cells
    for gy in range(0, 256, 32):
        dr.rectangle((0, gy, 383, gy + 14), fill=(94, 122, 150))
    # Crisp fine white-silver diamond grid lines (45-degree single-layer steel space-grid)
    step_d = 32
    for d in range(-256, 640, step_d):
        dr.line((d, 0, d + 256, 255), fill=(214, 228, 242), width=2)
        dr.line((d, 255, d + 256, 0), fill=(214, 228, 242), width=2)
    # Clip any overflow outside (0, 0, 384, 256) before drawing neighbours
    # 2. Pure smooth pearl-white osmanthus petal surface (`petal_white`) (384, 0, 256, 256)
    rects['petal_white'] = (384, 0, 256, 256)
    dr.rectangle((384, 0, 639, 255), fill=(249, 251, 254))
    # Ultra-subtle clean panel hairlines so pure white reads smooth and sculptural, never striped
    for sx in range(416, 640, 48):
        dr.line((sx, 0, sx, 255), fill=(240, 244, 249), width=1)
    for sy in range(32, 256, 48):
        dr.line((384, sy, 639, sy), fill=(240, 244, 249), width=1)

    # 3. Exposed white 3D tubular space-frame arch truss (`arch_truss`) (640, 0, 384, 192)
    rects['arch_truss'] = (640, 0, 384, 192)
    dr.rectangle((640, 0, 1023, 191), fill=(54, 70, 88))
    for tx in range(640, 1024, 32):
        dr.line((tx, 0, min(1023, tx + 32), 191), fill=(246, 250, 254), width=4)
        dr.line((min(1023, tx + 32), 0, tx, 191), fill=(246, 250, 254), width=4)
    for ty in (6, 95, 185):
        dr.line((640, ty, 1023, ty), fill=(252, 254, 255), width=6)

    # 4. Karst-mountain perforated white aluminium podium facade (`mountain_panel`) (0, 256, 512, 192)
    rects['mountain_panel'] = (0, 256, 512, 192)
    dr.rectangle((0, 256, 511, 447), fill=(242, 245, 248))
    for px in range(0, 512):
        h1 = 360 - int(36 * math.sin(px * 2 * math.pi / 256.0 + 0.4) ** 2 + 18 * math.sin(px * 2 * math.pi / 128.0))
        h2 = 382 - int(28 * math.cos(px * 2 * math.pi / 192.0 - 0.6) ** 2)
        if px % 2 == 0:
            dr.line((px, h1, px, 422), fill=(192, 200, 204), width=1)
            dr.line((px, h2, px, 422), fill=(162, 172, 178), width=1)
    dr.rectangle((0, 420, 511, 447), fill=(32, 48, 66))
    for gx in range(0, 512, 32):
        dr.line((gx, 256, gx, 419), fill=(212, 218, 224), width=1)
        dr.line((gx, 420, gx, 447), fill=(112, 134, 154), width=2)
    for gy in (308, 364):
        dr.line((0, gy, 511, gy), fill=(214, 220, 226), width=1)

    # 5. Deep grey-blue parabolic arch glass curtain wall (`arch_glass`) (512, 256, 256, 256)
    # Exact deep grey-blue glazing matching Rock photo #48, Baike East & Sina North views!
    rects['arch_glass'] = (512, 256, 256, 256)
    dr.rectangle((512, 256, 767, 511), fill=(28, 46, 68))
    for gy in range(256, 512, 42):
        dr.rectangle((512, gy, 767, gy + 6), fill=(20, 34, 52))
    for gx in range(524, 768, 20):
        dr.line((gx, 256, gx, 511), fill=(88, 114, 140), width=2)
    for gy in range(276, 512, 21):
        dr.line((512, gy, 767, gy), fill=(72, 96, 122), width=1)

    # 6. Concert Hall ("Flower Bud") louvered clerestory & perforated white facade (`bud_facade`) (768, 192, 256, 192)
    rects['bud_facade'] = (768, 192, 256, 192)
    dr.rectangle((768, 192, 1023, 383), fill=(243, 246, 250))
    for px in range(768, 1024, 2):
        hm = 342 - int(22 * math.sin((px - 768) * 2 * math.pi / 128.0) ** 2)
        dr.line((px, hm, px, 380), fill=(198, 206, 212), width=1)
    dr.rectangle((768, 210, 1023, 294), fill=(36, 54, 74))
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

    # 8. Exact World Shared Sidewalk Granite (`shared_sidewalk`, 0x999894) (0, 512, 256, 256)
    rects['shared_sidewalk'] = (0, 512, 256, 256)
    rng_sw = np.random.default_rng(202)
    lum_sw = 0.99 + 0.014 * _tileable_noise(256, 8, rng_sw) + 0.014 * rng_sw.normal(0.0, 1.0, (256, 256))
    yy, xx = np.mgrid[0:256, 0:256]
    lum_sw += (((xx // 64) * 37 + (yy // 64) * 73) % 11 - 5) * 0.004
    lum_sw[(xx % 64 < 2) | (yy % 64 < 2)] -= 0.075
    base_sw = np.array([0x99, 0x98, 0x94], dtype=np.float64)
    arr_sw = np.clip(np.rint(lum_sw[..., None] * base_sw), 0, 255).astype(np.uint8)
    im.paste(Image.fromarray(arr_sw, mode='RGB'), (0, 512))

    # 9. Exact World Shared Stone Embankment (`shared_bank`, 0x8f897b) (256, 512, 256, 256)
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

    swatches = [
        ('rib_white',     (512, 512, 128, 128), (252, 254, 255)),
        ('podium_wall',   (640, 512, 128, 128), (238, 242, 246)),
        ('dark_stone',    (768, 512, 128, 128), ( 78,  86,  96)),
        ('oculus_glass',  (896, 512, 128, 128), ( 40,  58,  76)),
        ('rail_stone',    (512, 640, 128, 128), (217, 213, 202)),
        ('pav_wall',      (640, 640, 128, 128), (214, 208, 192)),
        ('pav_wood',      (768, 640, 128, 128), (108,  82,  62)),
        ('gray_tile',     (896, 640, 128, 128), ( 78,  86,  92)),
        ('warm_lit',      (  0, 768, 128, 128), (246, 212, 140)),
        ('foliage_dark',  (128, 768, 128, 128), ( 44,  74,  44)),
        ('foliage_mid',   (256, 768, 128, 128), ( 62,  94,  56)),
        ('grass_island',  (384, 768, 128, 128), (118, 146, 102)),
        ('amber_flood',   (512, 768, 128, 128), (236, 198, 132)),
        ('bark',          (640, 768, 128, 128), ( 92,  80,  68)),
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


def _petal_tip_interp(phi: float) -> float:
    p = phi % (2.0 * math.pi)
    q = p / (0.5 * math.pi)
    k0 = int(math.floor(q)) % 4
    k1 = (k0 + 1) % 4
    t = q - math.floor(q)
    w = 0.5 - 0.5 * math.cos(math.pi * t)
    return PETAL_TIPS[k0] * (1.0 - w) + PETAL_TIPS[k1] * w


def _outer_radius(phi: float) -> float:
    # Plump concave-sided rounded square (`opera_3_north_up.jpg`!):
    # R_tip = 51.5 m along the 4 orthogonal petals, R_valley = 34.3 m at the 4 concave waists
    return 43.8 + 8.6 * math.cos(4.0 * phi) - 0.9 * math.cos(8.0 * phi)


def _roof_surface_y(s: float, phi: float) -> float:
    """Base height of the 4-petal 'Blooming Osmanthus' shell at normalized radius `s in [0, 1]`."""
    s_c = min(1.0, max(0.0, s))
    y_tip = _petal_tip_interp(phi)
    p = 0.5 + 0.5 * math.cos(4.0 * phi)  # 1 along 4 petal axes, 0 along 4 valley axes

    # Center low (21.8 m) -> soaring petal tip (27.6 .. 31.8 m)
    y_spine = Y_CENTER + (y_tip - Y_CENTER) * (s_c ** 1.12) + 1.20 * math.sin(math.pi * (s_c ** 0.85))
    # Center (21.8 m) -> plunging saddle valley down to podium roof (10.8 m)
    y_valley = Y_CENTER - (Y_CENTER - Y_VALLEY_EAVE) * (s_c ** 1.28)

    exp_arch = 1.35 + 0.65 * (s_c ** 1.2)
    ly = y_valley + (y_spine - y_valley) * (p ** exp_arch)

    # Small central white conical cap (`s < 0.08`)
    if s_c < 0.08:
        cone_t = 1.0 - s_c / 0.08
        ly += 1.55 * (cone_t ** 1.35)
    return ly


def _roof_point_polar(s: float, theta: float):
    phi = theta - THETA0
    r_out = _outer_radius(phi)
    r = s * r_out
    lx = CROWN_X + r * math.cos(theta)
    lz = CROWN_Z + r * math.sin(theta)
    ly = _roof_surface_y(s, phi)
    return np.array([lx, ly, lz], dtype=np.float64), 0.5 + 0.5 * math.cos(4.0 * phi)


def _roof_point_xy(lx: float, lz: float) -> float:
    dx, dz = lx - CROWN_X, lz - CROWN_Z
    r = math.hypot(dx, dz)
    theta = math.atan2(dz, dx)
    phi = theta - THETA0
    s = r / max(1e-6, _outer_radius(phi))
    return _roof_surface_y(s, phi)


def _grounded_ribbon_wall(b: SceneBuilder, ring_xz, y_top: float, region: str, cap_region: str = None,
                          tile: float = 4.2, collide: bool = False, y_bot_fn=None):
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

    bud_calyx_ring = _ellipse_ring(-0.50, 53.50, rx=17.4, rz=19.0, rot_deg=-8.0, n=32 if b.detail else 16)
    _grounded_ribbon_wall(
        b, bud_calyx_ring, 10.60, 'bud_facade', cap_region='dark_stone', tile=5.0,
        collide=False, y_bot_fn=lambda x, z: 3.30
    )

    bud_upper_ring = _ellipse_ring(-0.50, 53.50, rx=15.6, rz=17.2, rot_deg=-8.0, n=32 if b.detail else 16)
    _grounded_ribbon_wall(
        b, bud_upper_ring, 13.85, 'rib_white', cap_region='petal_white', tile=4.0,
        collide=False, y_bot_fn=lambda x, z: 10.50
    )

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
            b.face(quad[::-1], (0, 1, 0), 'petal_white', tile=5.0)

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
    # 3. CONTINUOUS WAVE-TERRACED WHITE PODIUM RIBBONS (y > 3.30 m)
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

    if b.detail:
        for k in range(len(tier2_ring)):
            pa, pb = tier2_ring[k], tier2_ring[(k + 1) % len(tier2_ring)]
            nrm = (pb[1] - pa[1], 0.0, pa[0] - pb[0])
            b.face(
                [(pa[0], 6.46, pa[1]), (pb[0], 6.46, pb[1]), (pb[0], 6.66, pb[1]), (pa[0], 6.66, pa[1])],
                nrm, 'amber_flood', tile=2.0, lit=True
            )

    # =========================================================================
    # 4. NORTH GRAND ENTRANCE STEPS & EAST ELEVATED GLASS SKYBRIDGE
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
            b.face([(xa, ya - 0.08, zb), (xb, yb - 0.08, zb), (xb, yb - 0.08, za), (xa, ya - 0.08, za)], (0.0, -1.0, 0.0), 'rib_white', tile=3.0)
    b.restore_frame(p_bridge)

    # =========================================================================
    # 5. BLOOMING 4-PETAL ROOF: DIAMOND-GLASS SADDLE VALLEYS + 4 SMOOTH PURE-WHITE OVAL PETALS!
    # =========================================================================
    ns = 18 if b.detail else 9
    nt = 96 if b.detail else 40
    ss = np.linspace(0.032, 1.0, ns + 1)
    ts = np.linspace(-math.pi, math.pi, nt + 1)

    pts_grid = np.zeros((ns + 1, nt + 1, 3), dtype=np.float64)
    p_grid = np.zeros((ns + 1, nt + 1), dtype=np.float64)
    for i, sv in enumerate(ss):
        for j, tv in enumerate(ts):
            pt, pv = _roof_point_polar(sv, tv)
            pts_grid[i, j] = pt
            p_grid[i, j] = pv
        pts_grid[i, nt] = pts_grid[i, 0]
        p_grid[i, nt] = p_grid[i, 0]

    # 5a. Small central white conical cap + dark skylight oculus dot (`s in [0, 0.07]`)
    crown_apex = np.array([CROWN_X, Y_CENTER + 1.58, CROWN_Z], dtype=np.float64)
    for j in range(nt):
        p0 = pts_grid[0, j]
        p1 = pts_grid[0, j + 1]
        b.face([crown_apex, p1, p0], (0.0, 1.0, 0.0), 'oculus_glass', tile=2.0, lit=True)
        p_c0 = pts_grid[1, j] + np.array([0.0, 0.08, 0.0])
        p_c1 = pts_grid[1, j + 1] + np.array([0.0, 0.08, 0.0])
        b.face([p0, p1, p_c1, p_c0], (0.0, 1.0, 0.0), 'petal_white', tile=4.0)

    # 5b. Continuous base shell in blue-grey diamond-lattice glass (`valley_glass`, NO dense radial white ribs!)
    for i in range(ns):
        for j in range(nt):
            p00, p10 = pts_grid[i, j], pts_grid[i + 1, j]
            p11, p01 = pts_grid[i + 1, j + 1], pts_grid[i, j + 1]
            nrm = np.cross(p10 - p00, p01 - p00)
            if nrm[1] < 0:
                nrm = -nrm
            b.face([p00, p10, p11, p01], nrm, 'valley_glass', tile=8.5, lit=False)

    # 5c. 4 ORTHOGONAL, PLUMP, PURE-WHITE SMOOTH ELLIPTICAL PETALS + CRISP WHITE BORDER RIBS!
    # Parameterized directly in each petal's `(u_along, w_frac)` coordinates so every oval petal
    # has a 100% smooth curved outline (zero grid stair-stepping!), pure white smooth interior,
    # and a clean raised white border rib along its rim!
    nu_p = 14 if b.detail else 7
    nw_p = 12 if b.detail else 6
    u_vals = np.linspace(2.2, 41.8, nu_p + 1)
    w_vals = np.linspace(-1.0, 1.0, nw_p + 1)

    for k_pet in range(4):
        ang_k = THETA0 + k_pet * (0.5 * math.pi)
        ca, sa = math.cos(ang_k), math.sin(ang_k)
        p_surf = np.zeros((nu_p + 1, nw_p + 1, 3), dtype=np.float64)

        for iu, u_al in enumerate(u_vals):
            u_norm = (u_al - 22.0) / 19.8  # in [-1, +1]
            stem_taper = 0.68 + 0.32 * (0.5 + 0.5 * u_norm)
            half_w = 14.0 * stem_taper * math.sqrt(max(0.002, 1.0 - u_norm * u_norm))
            for iw, wf in enumerate(w_vals):
                u_perp = wf * half_w
                lx = CROWN_X + u_al * ca - u_perp * sa
                lz = CROWN_Z + u_al * sa + u_perp * ca
                base_y = _roof_point_xy(lx, lz)
                # Smooth pillowed pure-white shell: +0.02 m at rim (physically joined < 0.035 m!) rising to +0.34 m along center!
                pillow = 0.02 + 0.32 * (1.0 - wf * wf) * math.sqrt(max(0.0, 1.0 - u_norm * u_norm))
                p_surf[iu, iw] = (lx, base_y + pillow, lz)

        for iu in range(nu_p):
            for iw in range(nw_p):
                q00, q10 = p_surf[iu, iw], p_surf[iu + 1, iw]
                q11, q01 = p_surf[iu + 1, iw + 1], p_surf[iu, iw + 1]
                nrm = np.cross(q10 - q00, q01 - q00)
                if nrm[1] < 0:
                    nrm = -nrm
                b.face([q00, q10, q11, q01], nrm, 'petal_white', tile=10.0, lit=False)

        # Crisp white border rib (`rib_white`) strictly outlining each smooth elliptical petal!
        if b.detail:
            for side_idx in (0, nw_p):
                sgn = -1.0 if side_idx == 0 else 1.0
                for iu in range(nu_p):
                    e0, e1 = p_surf[iu, side_idx], p_surf[iu + 1, side_idx]
                    tang = e1 - e0
                    lt = np.linalg.norm(tang)
                    if lt < 1e-4:
                        continue
                    ut = tang / lt
                    out_w = np.array([-sa * sgn, 0.0, ca * sgn])
                    r_in0 = e0 - out_w * 0.16 + np.array([0.0, 0.18, 0.0])
                    r_in1 = e1 - out_w * 0.16 + np.array([0.0, 0.18, 0.0])
                    r_out0 = e0 + out_w * 0.14 - np.array([0.0, 0.02, 0.0])
                    r_out1 = e1 + out_w * 0.14 - np.array([0.0, 0.02, 0.0])
                    if side_idx == 0:
                        b.face([r_out0, r_out1, r_in1, r_in0], (out_w[0] * 0.5, 0.85, out_w[2] * 0.5), 'rib_white', tile=2.0)
                    else:
                        b.face([r_in0, r_in1, r_out1, r_out0], (out_w[0] * 0.5, 0.85, out_w[2] * 0.5), 'rib_white', tile=2.0)

    # 5d. 360-DEGREE OUTER ARCH RIMS: EXPOSED WHITE TUBULAR SPACE-FRAME TRUSS & EAVE TRIM!
    for j in range(nt):
        p0 = pts_grid[ns, j]
        p1 = pts_grid[ns, j + 1]
        mid = 0.5 * (p0 + p1)
        out_dir = np.array([mid[0] - CROWN_X, 0.0, mid[2] - CROWN_Z])
        out_dir /= max(1e-6, np.linalg.norm(out_dir))
        pm = 0.5 * (p_grid[ns, j] + p_grid[ns, j + 1])
        # Deep sculptural space-truss arch inside all 4 parabolic petal arches; sleek white fascia in valleys
        drop = 0.95 + 1.45 * (pm ** 1.4)
        inset = 0.85 + 1.20 * (pm ** 1.4)
        b0 = p0 - out_dir * inset - np.array([0.0, drop, 0.0])
        b1 = p1 - out_dir * inset - np.array([0.0, drop, 0.0])
        b.face([b0, b1, p1, p0], (out_dir[0], 0.18, out_dir[2]), 'arch_truss',
               uvs=[(0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)], lit=False)
        # Crisp bright-white outer arch chord tube
        lip0 = p0 + out_dir * 0.15 - np.array([0.0, 0.34, 0.0])
        lip1 = p1 + out_dir * 0.15 - np.array([0.0, 0.34, 0.0])
        top0 = p0 + out_dir * 0.15 + np.array([0.0, 0.12, 0.0])
        top1 = p1 + out_dir * 0.15 + np.array([0.0, 0.12, 0.0])
        b.face([lip0, lip1, top1, top0], (out_dir[0], 0.3, out_dir[2]), 'rib_white', tile=3.0, lit=False)

    # =========================================================================
    # 6. FOUR RECESSED FULL-HEIGHT DARK-BLUE GLASS ARCHES ("EYES") & 8 RAKED WHITE MEGA-COLUMNS!
    # =========================================================================
    # Recessed at s = 0.68 so each upward-flaring petal tip frames a deep, unmistakable parabolic
    # arch opening filled with deep grey-blue glass (`arch_glass`).
    # In the central arch bays (`pm > 0.55`), `lit=True` uses the EXACT SAME `arch_glass` dark-blue
    # texture (`baseColorTexture` = deep grey-blue in daytime!) while glowing warm amber at night (`uNight=1`)!
    s_wall_idx = max(2, int(round(ns * 0.68)))
    for j in range(nt):
        r0 = pts_grid[s_wall_idx, j]
        r1 = pts_grid[s_wall_idx, j + 1]
        y_top0 = max(9.6, r0[1] - 0.10)
        y_top1 = max(9.6, r1[1] - 0.10)
        bx0 = CROWN_X + (r0[0] - CROWN_X) * 0.92
        bz0 = CROWN_Z + (r0[2] - CROWN_Z) * 0.92
        bx1 = CROWN_X + (r1[0] - CROWN_X) * 0.92
        bz1 = CROWN_Z + (r1[2] - CROWN_Z) * 0.92
        tx0, tz0 = r0[0], r0[2]
        tx1, tz1 = r1[0], r1[2]
        out_n = (0.5 * (tx0 + tx1) - CROWN_X, 0.06, 0.5 * (tz0 + tz1) - CROWN_Z)
        pm = 0.5 * (p_grid[s_wall_idx, j] + p_grid[s_wall_idx, j + 1])
        is_arch_eye_glow = pm > 0.54
        b.face(
            [(bx0, 8.90, bz0), (bx1, 8.90, bz1), (tx1, y_top1, tz1), (tx0, y_top0, tz0)],
            out_n, 'arch_glass', tile=4.4, lit=is_arch_eye_glow
        )

        # 8 sculpted white structural raked mega-columns flanking the 4 grand parabolic arches!
        if b.detail:
            if 0.36 <= pm <= 0.50:
                dx0, dz0 = tx0 - CROWN_X, tz0 - CROWN_Z
                ln0 = max(1e-6, math.hypot(dx0, dz0))
                ux, uz = dx0 / ln0, dz0 / ln0
                px_n, pz_n = -uz, ux
                p_bot_l = (bx0 - px_n * 0.85 + ux * 1.1, 6.40, bz0 - pz_n * 0.85 + uz * 1.1)
                p_bot_r = (bx0 + px_n * 0.85 + ux * 1.1, 6.40, bz0 + pz_n * 0.85 + uz * 1.1)
                p_top_l = (tx0 - px_n * 0.52 + ux * 0.55, y_top0, tz0 - pz_n * 0.52 + uz * 0.55)
                p_top_r = (tx0 + px_n * 0.52 + ux * 0.55, y_top0, tz0 + pz_n * 0.52 + uz * 0.55)
                b.face([p_bot_l, p_bot_r, p_top_r, p_top_l], (ux, 0.1, uz), 'podium_wall', tile=3.0)
                b.face([(bx0, 6.40, bz0), p_bot_l, p_top_l, (tx0, y_top0, tz0)], (-px_n, 0.0, -pz_n), 'podium_wall', tile=3.0)
                b.face([p_bot_r, (bx0, 6.40, bz0), (tx0, y_top0, tz0), p_top_r], (px_n, 0.0, pz_n), 'podium_wall', tile=3.0)
            elif pm > 0.52 and j % 3 == 0:
                # Subtle dark-silver curtain wall vertical mullion fins inside the 4 glass arches
                dx0, dz0 = tx0 - CROWN_X, tz0 - CROWN_Z
                ln0 = max(1e-6, math.hypot(dx0, dz0))
                ux, uz = dx0 / ln0, dz0 / ln0
                b.face(
                    [(bx0, 8.90, bz0), (bx0 + ux * 0.18, 8.90, bz0 + uz * 0.18),
                     (tx0 + ux * 0.18, y_top0, tz0 + uz * 0.18), (tx0, y_top0, tz0)],
                    (-uz, 0.0, ux), 'dark_stone', tile=2.0
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


def export_theater(out_glb: Path):
    """Export `guilin_theater.glb` where `_lit` uses pure `emissiveFactor` (no `emissiveTexture`),
    so daytime (`uNight=0`) preserves 100% authentic deep grey-blue arch glass (`arch_glass`),
    while night (`uNight=1`) radiates warm interior amber glow from inside the 4 arch openings!
    """
    image, rects = make_theater_atlas()
    atlas_size = image.width
    hi = SceneBuilder(rects, atlas_size=atlas_size, lod=0, collide=True)
    lo = SceneBuilder(rects, atlas_size=atlas_size, lod=1, collide=False)
    hi.surface = lo.surface = landmark_surface(out_glb.stem)
    build_guilin_theater(hi)
    build_guilin_theater(lo)

    scene = trimesh.Scene()
    base = scene.graph.base_frame
    for lod_name, b in (('lod0', hi), ('lod1', lo)):
        scene.graph.update(frame_from=base, frame_to=lod_name)
        m_atlas = bucket_to_trimesh(
            b.atlas, image, 'guilin_theater_atlas', (0, 0, 0), 0.14, 0.52, double_sided=True
        )
        if m_atlas is not None:
            scene.add_geometry(m_atlas, node_name=f'{lod_name}_atlas', parent_node_name=lod_name)
        m_lit = bucket_to_trimesh(
            b.lit, image, 'guilin_theater_lit', (0.28, 0.21, 0.12), 0.10, 0.45, double_sided=True
        )
        if m_lit is not None:
            # Detach emissiveTexture so emissiveFactor alone drives warm amber glow at night (`uNight=1`),
            # while daytime (`uNight=0`) displays exact `baseColorTexture` (`arch_glass` deep grey-blue)!
            m_lit.visual.material.emissiveTexture = None
            scene.add_geometry(m_lit, node_name=f'{lod_name}_lit', parent_node_name=lod_name)

    if hi.hit.faces:
        m_hit = trimesh.Trimesh(
            vertices=np.asarray(hi.hit.pos, np.float32),
            faces=np.asarray(hi.hit.faces, np.int64),
            process=False,
        )
        scene.add_geometry(m_hit, node_name='collision_body')

    image.save(out_glb.parent / 'guilin_theater_atlas.png')
    scene.export(out_glb)
    n0 = len(hi.atlas) + len(hi.lit)
    n1 = len(lo.atlas) + len(lo.lit)
    print(f'{out_glb.stem}: lod0={n0} tris, lod1={n1} tris, collision={len(hi.hit)} tris')


if __name__ == '__main__':
    export_theater(Path(sys.argv[1]) / 'guilin_theater.glb')
