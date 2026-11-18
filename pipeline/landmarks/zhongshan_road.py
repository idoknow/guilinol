"""Middle Zhongshan Road Streetscape (中山中路街景: 阳桥—中心广场—十字街段).

Anchor [110.2903834, 25.2790956] (-968.0, 100.0) spans the 430 m arterial
corridor of Middle Zhongshan Rd (OSM way/258911170 northbound, way/259016852 &
way/259020518 southbound) from Yangqiao (way/191185446, way/701820462) north to
Weixiaotang / Shizijie.

Hand-authored street frontages replace procedural extrusions on OSM & Overture
parcels with heights estimated against 4.2 m double-decker buses in the 2024
Yangqiao Commons series (00..11-2024.jpg) and 2018–2024 street views:
- West side: commercial block way/675593163 (6F / 20.6 m), Bagui Mansion
  (八桂大厦, way/264328067, 6F / 23.2 m podium + 11F / 38.4 m north tower),
  Yangqiao white-tiled Jinma block (Overture 09ade280..., 8F / 27.2 m with dark
  '金马大厦' shaft & blue rooftop sign in 00..07-2024.jpg).
- East side: shopfront blocks way/679990110 (5F / 17.6 m), way/679990111
  (5F / 18.4 m), L-shaped colonnade hotel way/264904810 (6F / 21.6 m), gateway
  retail way/675591854 (4F / 15.2 m), and Yangqiao east podium + hotel tower
  way/675586420 (3F / 12.2 m molded podium + 7F / 24.8 m tower).
- Streetscape: central green hedge median with topiary shrubs & 5-globe lamps,
  redwood bike-lane flower planters (89188-Guilin.jpg), camphor street trees
  with red lanterns, 4 bus shelters (十字街中心广场站 / 阳桥站), and overhead
  blue road sign gantry.
"""
import math
import numpy as np

from nikoniko import Builder, export_landmark


WEST_NORTH_675593163 = [
    (-30.97, -93.55), (-13.31, -88.25), (-6.34, -88.73), (-0.73, -91.13),
    (5.76, -95.91), (24.48, -157.39), (7.19, -162.58), (1.02, -142.31),
    (-27.69, -150.93), (-34.01, -130.18), (-4.79, -121.41), (-9.04, -107.46),
    (-25.25, -112.34),
]

WEST_BAGUI_264328067 = [
    (-48.51, 94.53), (-72.72, 86.87), (-64.33, 60.69),
    (-82.04, 54.62), (-44.00, -66.77), (-1.31, -52.66),
]

WEST_JINMA_OV = [
    (-84.53, 195.61), (-48.10, 101.30), (-60.73, 95.25),
    (-89.22, 174.20), (-100.55, 170.46), (-107.07, 188.11),
]

EAST_679990110 = [
    (76.25, -176.64), (93.93, -171.39), (82.96, -134.93), (65.27, -140.18),
]

EAST_679990111 = [
    (82.12, -132.17), (76.37, -112.98), (70.06, -91.91),
    (52.37, -97.14), (58.67, -118.12), (64.44, -137.42),
]

EAST_264904810 = [
    (52.07, -80.70), (54.96, -83.12), (58.45, -83.50), (90.19, -73.36),
    (95.43, -89.55), (114.96, -83.30), (100.16, -37.58), (58.80, -50.99),
    (52.51, -32.03), (37.86, -36.80),
]

EAST_675591854 = [
    (36.14, -30.97), (52.13, -25.63), (47.69, -12.70), (70.28, -5.69),
    (64.11, 12.63), (32.68, 2.14), (29.50, -0.73), (28.14, -4.54), (28.70, -9.00),
]

EAST_YANGQIAO_675586420 = [
    (-23.12, 171.54), (-17.27, 170.23), (26.55, 193.83), (24.97, 197.70),
    (16.25, 205.63), (11.70, 204.61), (-19.42, 234.59), (-6.59, 249.57),
    (-14.86, 257.54), (-47.91, 221.97), (-48.81, 219.14), (-48.44, 216.04),
    (-46.64, 212.92),
]

# Corridor centerline points (local x, z relative to anchor (-968, 100))
# North (-155) sits on 151.5 m Shizijie grade (local y=-2.3); z >= -58 sits on 153.8 m (local y=0)
ROAD_AXIS = [
    (61.5, -198.0),
    (49.5, -160.0),
    (36.8, -120.0),
    (19.8, -62.0),
    (2.5, -6.0),
    (-15.5, 52.0),
    (-30.5, 102.0),
    (-48.5, 160.0),
    (-66.5, 212.0),
]


def _local_ground_y(z):
    """Smooth transition from Shizijie 151.5 m (y=-2.3) north of z=-58 to 153.8 m (y=0)."""
    if z >= -54.0:
        return 0.0
    if z <= -70.0:
        return -2.3
    return -2.3 * (-54.0 - z) / 16.0


def _street_facade(m: Builder, p0, p1, nx_sign, y0, ground_h, total_h, wall_mat, sign_cols, bays, canopy=True):
    """Hand-authored street frontage with shop band, rain canopy, sign fascia & upper bays."""
    dx, dz = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dz)
    if length < 5.0:
        return
    ux, uz = dx / length, dz / length
    nx, nz = -uz * nx_sign, ux * nx_sign
    yaw = math.atan2(nx, nz)
    mx, mz = (p0[0] + p1[0]) / 2.0 + nx * 0.30, (p0[1] + p1[1]) / 2.0 + nz * 0.30

    m.pose = (mx, y0, mz, yaw)
    # Shop cornice, upper glazed/window plane, roof parapet
    m.box(0, ground_h - 0.2, 0.16, length + 0.3, 0.52, 0.72, wall_mat)
    m.box(0, ground_h + 0.32, 0.04, length - 0.6, total_h - ground_h - 1.05, 0.26, 'glass')
    m.box(0, total_h - 0.75, 0.18, length + 0.4, 0.78, 0.82, wall_mat)
    m.box(0, total_h + 0.03, 0.20, length + 0.55, 0.24, 0.96, 'dark')

    if not m.detail:
        m.pose = (0.0, 0.0, 0.0, 0.0)
        return

    bay_w = length / bays
    floors = max(2, round((total_h - ground_h - 0.8) / 3.35))
    fl_h = (total_h - ground_h - 1.05) / floors
    for i in range(bays + 1):
        lx = -length / 2.0 + i * bay_w
        m.box(lx, -1.8, 0.20, 0.58, total_h + 1.8, 0.58, wall_mat, collide=True)
        if i < bays:
            cx = lx + bay_w / 2.0
            # Storefront display glass & doorway mullion
            m.box(cx, 0.12, -0.04, bay_w - 0.68, 3.05, 0.20, 'glass')
            m.box(cx, 0.12, 0.08, 0.14, 2.95, 0.14, 'dark')
            if canopy:
                # Cantilevered shop rain canopy + tie rods
                m.box(cx, 3.08, 0.78, bay_w - 0.36, 0.15, 1.45, 'alum')
            sc = sign_cols[i % len(sign_cols)]
            m.box(cx, 3.32, 0.28, bay_w - 0.58, 0.88, 0.24, sc)
            for gx in (-0.72, 0.0, 0.72):
                if abs(gx) < bay_w * 0.33:
                    m.box(cx + gx, 3.58, 0.42, 0.32, 0.36, 0.07, 'white_lit')
            for fl in range(1, floors):
                m.box(cx, ground_h + 0.32 + fl * fl_h, 0.18, bay_w - 0.46, 0.38, 0.30, wall_mat)
    m.pose = (0.0, 0.0, 0.0, 0.0)


def _bus_shelter(m: Builder, x, y0, z, yaw):
    """Guilin Zhongshan Road modern transit bus shelter (89188-Guilin & 02-2024.jpg)."""
    m.pose = (x, y0, z, yaw)
    # Granite platform pad
    m.box(0, -0.4, 0, 2.8, 0.52, 11.6, 'pave', collide=True)
    # Four dark-bronze structural columns + cantilevered wave/flat canopy roof
    for sz in (-4.8, -1.6, 1.6, 4.8):
        m.beam([-0.85, 0.12, sz], [-0.85, 2.95, sz], 0.08, 'bronze', sections=6, collide=True)
    m.box(0.05, 2.95, 0, 2.75, 0.16, 11.4, 'alum')
    m.box(0.15, 3.11, 0, 2.55, 0.08, 11.1, 'white')
    # Illuminated route map & transit ad lightboxes along back + waiting bench
    for sz, col in ((-3.2, 'blue'), (0.0, 'white_lit'), (3.2, 'red')):
        m.box(-0.82, 0.55, sz, 0.18, 1.85, 2.45, 'dark', collide=True)
        if m.detail:
            m.box(-0.71, 0.68, sz, 0.05, 1.58, 2.22, col)
    # Passenger bench
    m.box(-0.25, 0.48, 0.0, 0.48, 0.08, 4.6, 'alum', collide=True)
    for bz in (-1.9, 0.0, 1.9):
        m.box(-0.25, 0.12, bz, 0.42, 0.36, 0.12, 'dark')
    # Tall bus-stop route totem ('100 / 11 / K99 路')
    m.box(0.85, 0.12, 5.25, 0.58, 2.85, 0.16, 'blue', collide=True)
    if m.detail:
        m.box(0.85, 2.25, 5.35, 0.44, 0.48, 0.05, 'white_lit')
        m.box(0.85, 1.35, 5.35, 0.44, 0.68, 0.05, 'white')
    m.pose = (0.0, 0.0, 0.0, 0.0)


def _median_segment(m: Builder, p0, p1):
    """Central green hedge median + topiary balls + 5-globe municipal lamps."""
    dx, dz = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dz)
    if length < 6.0:
        return
    yaw = math.atan2(dx, dz)
    mx, mz = (p0[0] + p1[0]) / 2.0, (p0[1] + p1[1]) / 2.0
    y0 = _local_ground_y(mz)

    m.pose = (mx, y0, mz, yaw)
    # Granite median curb + trimmed dark-green boxwood hedge + low central fence
    m.box(0, -0.5, 0, 2.55, 0.74, length, 'stone', collide=True)
    m.box(0, 0.24, 0, 2.05, 0.58, length - 1.2, 'hedge')
    m.box(0, 0.82, 0, 0.07, 0.38, length - 1.6, 'alum')

    if m.detail:
        # Rounded topiary shrubs & flowering crape-myrtle accents every 9 m (89188-Guilin.jpg)
        n_shrubs = max(1, int(length // 9.5))
        for i in range(n_shrubs):
            sz = -length / 2.0 + (i + 0.5) * (length / n_shrubs)
            m.cylinder_y(0, 0.78, 0.68, sz, 0.78, 'leaf' if i % 2 == 0 else 'hedge', sections=8)
            if i % 3 == 1:
                m.cylinder_y(0, 1.46, 0.32, sz, 0.52, 'red', sections=7)
    m.pose = (0.0, 0.0, 0.0, 0.0)

    # Place 5-globe streetlamps along the median every ~28 m
    n_lamps = max(1, int(length // 28.0))
    for i in range(n_lamps):
        t = (i + 0.5) / n_lamps
        lx = p0[0] + dx * t
        lz = p0[1] + dz * t
        m.cluster_lamp(lx, _local_ground_y(lz) + 0.22, lz, height=7.4, globes=5, collide=True)


def _planter_divider_run(m: Builder, p0, p1):
    """Redwood slat flower planter boxes separating motor & bike lanes (89188-Guilin.jpg)."""
    if not m.detail:
        return
    dx, dz = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dz)
    yaw = math.atan2(dx, dz)
    count = max(1, int(length // 6.5))
    for i in range(count):
        t = (i + 0.5) / count
        px, pz = p0[0] + dx * t, p0[1] + dz * t
        py = _local_ground_y(pz)
        m.pose = (px, py, pz, yaw)
        m.box(0, 0.0, 0, 0.62, 0.68, 2.8, 'wood', collide=True)
        m.box(0, 0.68, 0, 0.68, 0.06, 2.9, 'dark')
        m.box(0, 0.68, 0, 0.46, 0.22, 2.5, 'red' if i % 2 == 0 else 'hedge')
        if i % 2 == 0:
            m.cylinder_y(0, 0.88, 0.55, 0, 0.38, 'leaf', sections=6)
    m.pose = (0.0, 0.0, 0.0, 0.0)


def build_zhongshan_road(m: Builder):
    corridor_yaw = math.atan2(145.5, -434.8)  # Facing NNE along Zhongshan Middle Rd

    # ------------------------------------------------------------------
    # 1. West Frontage 1: Commercial Complex way/675593163 (6F / 20.6 m)
    # ------------------------------------------------------------------
    y_wn = -1.2
    m.prism(WEST_NORTH_675593163, y_wn - 2.0, 6.5, 'dark', collide=True, cap_mat='alum')
    m.prism(WEST_NORTH_675593163, y_wn + 4.5, 16.1, 'white', collide=True, cap_mat='roof')
    _street_facade(m, (-0.73, -91.13), (24.48, -157.39), 1, y_wn, 4.5, 20.6, 'white', ['blue', 'red', 'dark'], 9)

    # ------------------------------------------------------------------
    # 2. West Frontage 2: Bagui Mansion (八桂大厦, way/264328067)
    # Iconic 168 m commercial landmark (ctrip_sq/04.jpg & 07.jpg):
    # 6F beige-stone & blue-glass podium (23.2 m) + 11F north corner tower (38.4 m)
    # ------------------------------------------------------------------
    m.prism(WEST_BAGUI_264328067, -2.5, 7.3, 'dark', collide=True, cap_mat='beige')
    m.prism(WEST_BAGUI_264328067, 4.8, 18.4, 'beige', collide=True, cap_mat='roof')
    _street_facade(m, (-48.51, 94.53), (-1.31, -52.66), 1, 0.0, 4.8, 23.2, 'beige', ['red', 'blue', 'terra', 'dark'], 18)

    # Bagui Mansion 11-storey north-end signature tower crown (ctrip_sq/04.jpg left)
    m.pose = (-14.5, 0.0, -44.0, math.atan2(0.95, -0.31))
    m.box(0, 23.2, 0, 26.0, 14.2, 22.0, 'beige', collide=True)
    m.box(0, 24.0, 11.1, 21.5, 12.2, 0.35, 'glass')
    m.box(0, 37.4, 0, 27.2, 1.1, 23.2, 'alum')
    if m.detail:
        for bx in (-8.5, -2.8, 2.8, 8.5):
            m.box(bx, 23.8, 11.25, 0.72, 12.8, 0.45, 'beige')
        # Rooftop red '八桂大厦' signboard + architectural spire mast
        m.box(0, 38.5, 10.6, 9.6, 1.8, 0.28, 'red')
        for gx in (-3.0, -1.0, 1.0, 3.0):
            m.box(gx, 38.85, 10.78, 1.1, 1.1, 0.10, 'white_lit')
        m.beam([0, 38.5, 0], [0, 44.5, 0], 0.16, 'alum', sections=6)
    # South stepped 8-storey wing accent of Bagui Mansion
    m.pose = (-54.0, 0.0, 78.0, math.atan2(0.95, -0.31))
    m.box(0, 23.2, 0, 22.0, 6.8, 18.0, 'beige')
    m.box(0, 23.8, 9.1, 18.5, 5.4, 0.32, 'glass')
    m.pose = (0.0, 0.0, 0.0, 0.0)

    # ------------------------------------------------------------------
    # 3. West Frontage 3: Yangqiao White-Tiled Block & Jinma Shaft
    # (00..11-2024.jpg background: 8F white window grid + '和谐心理咨询中心'
    # blue sign + dark vertical '金马大厦' shaft with gold characters)
    # ------------------------------------------------------------------
    m.prism(WEST_JINMA_OV, -2.5, 7.0, 'dark', collide=True, cap_mat='white')
    m.prism(WEST_JINMA_OV, 4.5, 22.7, 'white', collide=True, cap_mat='roof')
    _street_facade(m, (-84.53, 195.61), (-48.10, 101.30), 1, 0.0, 4.5, 27.2, 'white', ['blue', 'red', 'dark'], 12)
    if m.detail:
        # Dark granite vertical shaft '金马大厦' + gold glyphs (04-2024.jpg) & blue rooftop fascia (01-2024.jpg)
        m.pose = (-64.5, 0.0, 144.0, math.atan2(0.94, -0.34))
        m.box(0, 5.0, 6.2, 3.6, 23.2, 0.85, 'dark')
        for gy in (24.2, 20.6, 17.0, 13.4):
            m.box(0, gy, 6.68, 1.45, 1.65, 0.12, 'yellow_pave')
        m.box(16.0, 27.2, 5.8, 15.5, 1.65, 0.28, 'blue')
        for gx in np.linspace(10.0, 22.0, 7):
            m.box(gx, 27.55, 5.98, 0.95, 0.92, 0.08, 'white_lit')
        m.pose = (0.0, 0.0, 0.0, 0.0)

    # ------------------------------------------------------------------
    # 4. East Frontages 1..4 (Shizijie S to Central Square NW)
    # ------------------------------------------------------------------
    # way/679990110 (sits on 151.5 m north transition -> y=-2.3)
    m.prism(EAST_679990110, -4.5, 6.6, 'dark', collide=True, cap_mat='beige')
    m.prism(EAST_679990110, 2.1, 13.2, 'white', collide=True, cap_mat='roof')
    _street_facade(m, (76.25, -176.64), (65.27, -140.18), 1, -2.3, 4.4, 17.6, 'white', ['red', 'blue'], 5)

    # way/679990111
    m.prism(EAST_679990111, -3.0, 7.4, 'dark', collide=True, cap_mat='white')
    m.prism(EAST_679990111, 4.4, 14.0, 'white', collide=True, cap_mat='roof')
    _street_facade(m, (64.44, -137.42), (52.37, -97.14), 1, 0.0, 4.4, 18.4, 'white', ['terra', 'blue', 'red'], 6)

    # way/264904810 (6F colonnade commercial/hotel podium, 桂林市区景色 photo)
    m.prism(EAST_264904810, -2.5, 7.3, 'dark', collide=True, cap_mat='beige')
    m.prism(EAST_264904810, 4.8, 16.8, 'beige', collide=True, cap_mat='roof')
    _street_facade(m, (52.07, -80.70), (37.86, -36.80), 1, 0.0, 4.8, 21.6, 'beige', ['red', 'dark', 'terra'], 6)

    # way/675591854 (4F gateway building at Yiren Rd / Central Square NW)
    m.prism(EAST_675591854, -2.5, 6.7, 'dark', collide=True, cap_mat='white')
    m.prism(EAST_675591854, 4.2, 11.0, 'white', collide=True, cap_mat='roof')
    _street_facade(m, (36.14, -30.97), (28.70, -9.00), 1, 0.0, 4.2, 15.2, 'white', ['blue', 'red'], 4)

    # ------------------------------------------------------------------
    # 5. East Frontage 5: Yangqiao East Molded Podium & Hotel Tower (way/675586420)
    # Seen on right of 00..08-2024.jpg: 3F horizontal-cornice podium + '(3楼)' red sign
    # ------------------------------------------------------------------
    m.prism(EAST_YANGQIAO_675586420, -2.5, 14.7, 'alum', collide=True, cap_mat='roof')
    _street_facade(m, (-23.12, 171.54), (-46.64, 212.92), 1, 0.0, 4.5, 12.2, 'alum', ['red', 'blue', 'dark'], 6)
    # 7-storey hotel block rising behind the 3-storey street podium
    m.pose = (-14.0, 0.0, 214.0, math.atan2(-0.92, 0.38))
    m.box(0, 12.2, 0, 32.0, 12.6, 22.0, 'beige', collide=True)
    m.box(0, 13.0, 11.1, 28.0, 10.8, 0.30, 'glass')
    if m.detail:
        for gx in (-2.4, -0.8, 0.8, 2.4):
            m.box(gx, 12.3, 14.5, 0.92, 1.15, 0.12, 'red_lit')
    m.pose = (0.0, 0.0, 0.0, 0.0)

    # ------------------------------------------------------------------
    # 6. Central Green Median Islands (with intersection gaps) + Planter Dividers
    # ------------------------------------------------------------------
    median_runs = [
        ((54.5, -176.0), (38.0, -124.0)),
        ((33.2, -108.0), (15.5, -50.0)),
        ((10.2, -32.0), (-8.5, 30.0)),
        ((-14.2, 48.0), (-32.0, 106.0)),
        ((-37.8, 125.0), (-64.5, 206.0)),
    ]
    for p0, p1 in median_runs:
        _median_segment(m, p0, p1)
        # Flanking redwood bike-lane flower planter boxes (offset +/- 9.8 m across road)
        dx, dz = p1[0] - p0[0], p1[1] - p0[1]
        ln = math.hypot(dx, dz)
        nx, nz = -dz / ln * 9.8, dx / ln * 9.8
        _planter_divider_run(m, (p0[0] + nx, p0[1] + nz), (p1[0] + nx, p1[1] + nz))
        _planter_divider_run(m, (p0[0] - nx, p0[1] - nz), (p1[0] - nx, p1[1] - nz))

    # ------------------------------------------------------------------
    # 7. Four Modern Bus Shelters (OSM 2642202462/2642202463 十字街中心广场站 + 阳桥站)
    # ------------------------------------------------------------------
    road_face_east = math.atan2(-0.95, 0.31)
    road_face_west = math.atan2(0.95, -0.31)
    # Shizijie / Central Square Bus Stops (north half)
    _bus_shelter(m, 50.8, _local_ground_y(-111.7), -111.7, road_face_east)
    _bus_shelter(m, 23.2, _local_ground_y(-135.0), -135.0, road_face_west)
    # Central Square / Yangqiao Bus Stops (south half, matching 89188-Guilin & 02-2024.jpg)
    _bus_shelter(m, -14.5, 0.0, 96.0, road_face_east)
    _bus_shelter(m, -72.0, 0.0, 178.0, road_face_west)

    # Overhead municipal blue road direction sign gantry at Yangqiao north approach (00..03-2024.jpg left)
    m.pose = (-50.5, 0.0, 196.0, math.atan2(-0.31, 0.95))
    m.cylinder_y(0, 0.0, 6.8, 0, 0.22, 'alum', sections=8 if m.detail else 5, collide=True)
    m.beam([0, 6.2, 0], [-9.2, 6.2, 0], 0.09, 'alum', sections=6)
    m.box(-4.8, 5.1, 0.14, 3.8, 2.05, 0.10, 'blue')
    if m.detail:
        m.box(-5.9, 5.45, 0.21, 0.18, 1.25, 0.04, 'white_lit')
        m.box(-4.2, 6.35, 0.21, 1.85, 0.26, 0.04, 'white_lit')
        m.box(-4.2, 5.75, 0.21, 1.65, 0.20, 0.04, 'white')
    m.pose = (0.0, 0.0, 0.0, 0.0)

    # ------------------------------------------------------------------
    # 8. Sidewalk Camphor & Banyan Street Trees with Festive Red Lanterns
    # ------------------------------------------------------------------
    if m.detail:
        for step in range(13):
            t = step / 12.0
            cx = 54.0 + (-64.0 - 54.0) * t
            cz = -174.0 + (204.0 - (-174.0)) * t
            gy = _local_ground_y(cz)
            # West sidewalk tree row (offset ~ -15.5 m perpendicular to road)
            m.street_tree(cx - 14.8, gy, cz - 4.6, height=8.8, spread=3.6, kind='camphor', lanterns=(step % 2 == 0), collide=True)
            # East sidewalk tree row (offset ~ +15.5 m perpendicular to road)
            m.street_tree(cx + 14.8, gy, cz + 4.6, height=8.8, spread=3.6, kind='camphor', lanterns=(step % 2 == 1), collide=True)


if __name__ == '__main__':
    export_landmark('zhongshan_road', build_zhongshan_road)
