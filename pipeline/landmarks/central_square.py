"""Guilin Central Square (桂林中心广场: 音乐喷泉、石碑、小香港商业城、桂林市体育馆).

Anchor [110.2916053, 25.2779019] (-845.0, 232.0) covers the civic superblock
bounded by Middle Zhongshan Rd on the west, Yiren Rd on the north, Guilin
Gymnasium (OSM way/675177179) on the east, and Wenhua Palace /杉湖 north road on
the south, including the underground Xiao Xiang Gang Commercial Market
(小香港商业城, way/1521982963) and node/3121657314.

Proportions and heights follow OSM footprints and 2020–2026 aerial/ground
references (Ctrip 108723 aerials & ground views, 2026 Wikimedia Commons CC BY
4.0 Central Square Fire Station series):
- Guilin Gymnasium (way/675177179): faceted silver-white arena 18.6 m cornice /
  22.4 m standing-seam roof ridge, twin entrance stair pylons, 18.5 x 8.0 m LED
  screen, and rooftop '体 育 馆' gold lettering.
- Circular Musical Fountain Plaza: 80 m granite inlay circle, concentric dry
  fountain nozzle rings & water jets (restored Oct 2024), crescent lawns, two
  18 m lattice floodlight masts, and 5-globe post lamps with banner frames.
- Xiao Xiang Gang Underground Mall: two steel-framed glass pyramid skylights,
  four sunken granite stair portals ('小香港商业城'), geodesic dome skylight,
  and silver ventilation turrets.
- West Axial Promenade: 5-step dark red granite flagpole plinth (21 m mast),
  22 x 34 m floral-emblem parterre, 2x4 symmetric shrub planters, rows of date
  palms, '桂林山水甲天下' karst boulder stele, flanking halls (Holiday Inn
  gabled block, NE white hall way/1493030771, SE sports annex way/675106655),
  and the 2-storey Central Square Fire Rescue Station (00-2026.jpg).
"""
import math
import numpy as np
import trimesh

from nikoniko import Builder, export_landmark


GYM_675177179 = [
    (96.69, 5.58), (113.64, 11.96), (133.55, 19.54), (154.44, 28.21),
    (158.32, 18.14), (165.29, 20.26), (133.92, 106.08), (126.98, 103.58),
    (129.29, 97.46), (114.52, 92.37), (113.73, 95.02), (107.91, 93.18),
    (87.73, 85.92), (69.09, 79.39), (73.10, 68.32), (76.85, 57.96),
    (89.71, 23.86), (93.68, 13.47),
]

NE_HALL_1493030771 = [
    (133.83, -40.68), (124.21, -9.46), (173.00, 7.47), (182.53, -21.01),
]

SE_ANNEX_675106655 = [
    (90.51, 102.12), (125.32, 127.11), (111.90, 168.48), (51.20, 140.05), (64.88, 100.76),
]


# Civic square master axis: WNW -> ESE along (+0.938, +0.346), perpendicular to Zhongshan Rd
AXIS_YAW = math.atan2(-0.938, -0.346)  # Local +z points WNW toward Zhongshan Middle Rd


def _ax_pt(along_east, across_south):
    """Convert square-axial coordinates (0 at anchor; +along toward Gym ESE) to local (x, z)."""
    ex, ez = 0.938, 0.346
    sx, sz = -0.346, 0.938
    return along_east * ex + across_south * sx, along_east * ez + across_south * sz


def _glass_pyramid(m: Builder, cx, cz, yaw, base_w=7.6, h=4.6):
    """Louvre-style steel-framed glass pyramid skylight over Xiao Xiang Gang (ctrip_sq/04.jpg)."""
    m.pose = (cx, 0.0, cz, yaw)
    m.box(0, 0.0, 0, base_w + 0.8, 0.52, base_w + 0.8, 'dark', collide=True)
    hw = base_w / 2.0
    apex = (0.0, 0.52 + h, 0.0)
    corners = [(-hw, 0.52, -hw), (hw, 0.52, -hw), (hw, 0.52, hw), (-hw, 0.52, hw)]
    for i in range(4):
        c0 = corners[i]
        c1 = corners[(i + 1) % 4]
        m.mesh([c0, c1, apex], [[0, 1, 2]], 'glass')
        if m.detail:
            m.beam(c0, apex, 0.055, 'alum', sections=4)
            for frac in (0.35, 0.68):
                p0 = [c0[k] + (apex[k] - c0[k]) * frac for k in range(3)]
                p1 = [c1[k] + (apex[k] - c1[k]) * frac for k in range(3)]
                m.beam(p0, p1, 0.038, 'alum', sections=4)
    m.pose = (0.0, 0.0, 0.0, 0.0)


def _underground_portal(m: Builder, cx, cz, yaw):
    """Sunken granite stairwell entrance to '小香港商业城' underground mall (ctrip_sq/00.jpg)."""
    m.pose = (cx, 0.0, cz, yaw)
    # Three-sided granite balustrade parapet (open on +z side with descending steps)
    m.box(-2.45, 0.0, 0.0, 0.36, 1.08, 8.6, 'stone', collide=True)
    m.box(2.45, 0.0, 0.0, 0.36, 1.08, 8.6, 'stone', collide=True)
    m.box(0.0, 0.0, -4.15, 5.26, 1.08, 0.36, 'stone', collide=True)
    # Dark stairwell throat & walkable top steps + blue '小香港商业城' archway header
    m.box(0.0, 0.02, -1.2, 4.5, 0.08, 5.6, 'dark')
    for st in range(4):
        m.box(0.0, 0.04, 3.6 - st * 0.75, 4.5, 0.08, 0.72, 'pave', collide=True)
    # Portal signboard arch at back/entry
    m.beam([-2.25, 0.0, -3.8], [-2.25, 3.1, -3.8], 0.14, 'alum', sections=6, collide=True)
    m.beam([2.25, 0.0, -3.8], [2.25, 3.1, -3.8], 0.14, 'alum', sections=6, collide=True)
    m.box(0.0, 2.55, -3.8, 5.1, 0.86, 0.28, 'blue')
    if m.detail:
        for gx in np.linspace(-1.6, 1.6, 6):
            m.box(gx, 2.78, -3.62, 0.34, 0.38, 0.06, 'white_lit')
    m.pose = (0.0, 0.0, 0.0, 0.0)


def _lattice_floodlight_mast(m: Builder, cx, cz):
    """18 m white steel lattice plaza floodlight tower (ctrip_sq/00.jpg north & south flanks)."""
    m.box(cx, 0.0, cz, 1.6, 0.75, 1.6, 'stone', collide=True)
    if not m.detail:
        m.beam([cx, 0.75, cz], [cx, 18.2, cz], 0.32, 'white', sections=5, collide=True)
        m.box(cx, 18.2, cz, 2.2, 0.85, 0.8, 'white_lit')
        return
    for sx in (-0.48, 0.48):
        for sz in (-0.48, 0.48):
            m.beam([cx + sx, 0.75, cz + sz], [cx + sx * 0.55, 18.0, cz + sz * 0.55], 0.065, 'white', sections=4, collide=True)
    for lv in range(1, 9):
        y = 0.75 + lv * 2.1
        sc = 1.0 - 0.42 * (lv / 9.0)
        m.box(cx, y, cz, 1.02 * sc, 0.07, 1.02 * sc, 'white')
    m.box(cx, 18.0, cz, 2.4, 0.75, 0.65, 'alum')
    for lx in (-0.8, 0.0, 0.8):
        m.box(cx + lx, 18.12, cz, 0.48, 0.44, 0.75, 'white_lit')


def _karst_stele(m: Builder, cx, cz, yaw):
    """'桂林山水甲天下' natural karst landscape stone stele on stepped granite plinth."""
    m.pose = (cx, 0.0, cz, yaw)
    m.box(0, 0.0, 0, 4.6, 0.36, 2.8, 'stone', collide=True)
    m.box(0, 0.36, 0, 3.6, 0.38, 2.0, 'dark', collide=True)
    # Sculpted jagged low-poly karst boulder silhouette
    boulder_profile = [
        (-1.45, -0.48), (1.42, -0.45), (1.55, 0.12),
        (1.18, 0.52), (-1.22, 0.48), (-1.58, 0.05),
    ]
    m.prism(boulder_profile, 0.74, 2.45, 'karst', collide=True, cap_mat='karst')
    upper_peak = [(-1.05, -0.36), (0.95, -0.34), (0.68, 0.36), (-0.82, 0.34)]
    m.prism(upper_peak, 3.19, 0.95, 'karst')
    m.box(-0.22, 4.14, 0.0, 0.95, 0.42, 0.48, 'karst')
    if m.detail:
        # Vertical engraved cinnabar-red calligraphy strokes ('桂林山水甲天下') on front & back
        for side in (-1, 1):
            fz = side * 0.53
            for idx, gy in enumerate(np.linspace(3.45, 1.15, 7)):
                m.box(0.08 * ((idx % 2) - 0.5), gy, fz, 0.42, 0.24, 0.06, 'red')
    m.pose = (0.0, 0.0, 0.0, 0.0)


def _fire_station(m: Builder, cx, cz, yaw):
    """2-storey Guilin Central Square Fire Rescue Station (2026 Commons 00..02-2026.jpg)."""
    m.pose = (cx, 0.0, cz, yaw)
    # Main grey 2-storey station box (15.6 m wide x 8.4 m high x 10.5 m deep)
    m.box(0, -1.5, 0, 15.6, 9.9, 10.5, 'alum', collide=True)
    # Signature red & royal-blue horizontal fascia ('中国消防救援 CHINA FIRE AND RESCUE')
    m.box(0, 4.55, 5.32, 15.8, 0.92, 0.22, 'red')
    m.box(0, 4.22, 5.32, 15.8, 0.33, 0.22, 'blue')
    # Left closed burgundy roller shutter + right red horizontal louver panel + open middle bay
    m.box(-4.8, 0.1, 5.26, 4.4, 4.05, 0.12, 'terra')
    m.box(5.2, 2.35, 5.26, 3.8, 1.80, 0.12, 'red')
    m.box(0.3, 0.1, 3.2, 4.8, 4.0, 3.8, 'dark')
    # Vertical wooden plaque between bays ('桂林市秀峰区中心广场消防救援站')
    m.box(-2.35, 0.95, 5.36, 0.46, 2.65, 0.10, 'yellow_pave')
    if m.detail:
        # Upper 2nd-floor windows + rooftop training canopy frame + parked red fire truck cab
        for wx in (-4.6, 0.2, 4.4):
            m.box(wx, 5.85, 5.28, 2.4, 1.65, 0.10, 'glass')
        m.box(0, 9.35, 1.2, 15.0, 0.16, 7.2, 'alum')
        for px in (-6.5, -2.2, 2.2, 6.5):
            m.beam([px, 8.4, 4.4], [px, 9.35, 4.4], 0.08, 'alum', sections=4)
            m.beam([px, 8.4, -2.0], [px, 9.35, -2.0], 0.08, 'alum', sections=4)
        for gx in np.linspace(-5.8, 5.8, 9):
            m.box(gx, 4.82, 5.46, 0.42, 0.38, 0.05, 'yellow_pave')
        # Low-poly red rescue truck nose peeking out of central bay (00-2026.jpg)
        m.box(0.3, 0.45, 3.8, 2.25, 2.15, 3.2, 'red')
        m.box(0.3, 1.45, 5.42, 1.95, 0.78, 0.08, 'glass')
        m.box(0.3, 2.62, 4.6, 1.35, 0.18, 0.35, 'blue_lit')
    m.pose = (0.0, 0.0, 0.0, 0.0)


def build_central_square(m: Builder):
    # ------------------------------------------------------------------
    # 1. Master Granite Civic Plaza Deck (covering -125..+95 along axis)
    # ------------------------------------------------------------------
    plaza_ring = [
        _ax_pt(-118.0, -68.0),
        _ax_pt(92.0, -68.0),
        _ax_pt(92.0, 68.0),
        _ax_pt(-118.0, 68.0),
    ]
    m.prism(plaza_ring, -2.2, 2.26, 'pave', collide=True, cap_mat='pave')

    # ------------------------------------------------------------------
    # 2. Circular Musical Fountain Assembly Plaza (center at along=+22, across=0)
    # 80 m diameter circular pink-beige & grey granite court + musical fountain
    # ------------------------------------------------------------------
    fcx, fcz = _ax_pt(22.0, 0.0)
    m.cylinder_y(fcx, 0.06, 0.04, fcz, 39.5, 'beige', sections=32 if m.detail else 14)
    m.cylinder_y(fcx, 0.10, 0.03, fcz, 35.5, 'pave', sections=32 if m.detail else 14)
    # Central musical fountain basin & concentric illuminated water-jet rings (restored Oct 2024)
    m.cylinder_y(fcx, 0.13, 0.08, fcz, 12.5, 'dark', sections=24 if m.detail else 10)
    m.cylinder_y(fcx, 0.21, 0.06, fcz, 9.2, 'glass', sections=20 if m.detail else 10)
    # Central vertical water spire + concentric fountain jets (translucent blue/white lit)
    m.cylinder_y(fcx, 0.25, 5.6, fcz, 0.36, 'white_lit', sections=8 if m.detail else 5)
    if m.detail:
        for ring_r, jet_h, count in ((3.6, 3.6, 8), (7.4, 2.2, 14)):
            for i in range(count):
                ang = i * (2 * math.pi / count)
                jx = fcx + math.cos(ang) * ring_r
                jz = fcz + math.sin(ang) * ring_r
                m.cylinder_y(jx, 0.24, jet_h, jz, 0.16, 'white_lit', sections=6)
                m.cylinder_y(jx, 0.21, 0.12, jz, 0.34, 'bronze', sections=6)

    # Crescent green lawns & sculpted topiary hedges framing North & South of the 80 m circle
    for side in (-1, 1):
        crescent = []
        for ang in np.linspace(-0.95, 0.95, 9 if m.detail else 4):
            crescent.append(_ax_pt(22.0 + math.sin(ang) * 41.5, side * (math.cos(ang) * 41.5)))
        crescent.extend([
            _ax_pt(62.0, side * 56.0),
            _ax_pt(-18.0, side * 56.0),
        ])
        m.prism(crescent, 0.06, 0.24, 'stone', collide=True, cap_mat='hedge')
        if m.detail:
            # Sculpted dark-green ornamental hedge ribbon on each lawn (ctrip_sq/00.jpg)
            for seg in range(-2, 3):
                hx, hz = _ax_pt(22.0 + seg * 11.5, side * (46.5 - abs(seg) * 1.8))
                m.cylinder_y(hx, 0.30, 0.65, hz, 2.4, 'leaf', sections=8)

    # Two 18 m white steel lattice floodlight towers on North & South flanks (ctrip_sq/00.jpg)
    for side in (-1, 1):
        tx, tz = _ax_pt(-22.0, side * 54.0)
        _lattice_floodlight_mast(m, tx, tz)

    # Ring of classic 5-globe post lamps on stone bench planters around plaza
    if m.detail:
        for side in (-1, 1):
            for along in (-56.0, -34.0, -14.0, 8.0, 36.0, 56.0):
                across = side * (18.5 if along < -8.0 else 41.5)
                lx, lz = _ax_pt(along, across)
                m.box(lx, 0.06, lz, 2.4, 0.46, 2.4, 'stone', collide=True)
                m.box(lx, 0.52, lz, 1.8, 0.22, 1.8, 'hedge')
                m.cluster_lamp(lx, 0.52, lz, height=6.6, globes=5, collide=True)

    # ------------------------------------------------------------------
    # 3. West Axial Promenade: Flagpole Plinth, Floral Parterre & Karst Stele
    # ------------------------------------------------------------------
    # 5-step dark red-granite flagpole plinth + 21 m tapered silver mast (ctrip_sq/05.jpg)
    fpx, fpz = _ax_pt(-26.0, 0.0)
    m.pose = (fpx, 0.06, fpz, AXIS_YAW)
    for step in range(5):
        w = 6.8 - step * 0.85
        m.box(0, step * 0.18, 0, w, 0.18, w, 'red', collide=True)
    m.beam([0, 0.90, 0], [0, 21.5, 0], 0.13, 'alum', sections=8, collide=True)
    m.pose = (0.0, 0.0, 0.0, 0.0)

    # Rectangular central parterre (-58 m along axis) with 6-petal floral topiary emblem (ctrip_sq/00.jpg)
    pcx, pcz = _ax_pt(-58.0, 0.0)
    m.pose = (pcx, 0.06, pcz, AXIS_YAW)
    m.box(0, 0.0, 0, 19.5, 0.36, 32.0, 'stone', collide=True)
    m.box(0, 0.36, 0, 17.8, 0.16, 30.2, 'hedge' if not m.detail else 'wood')
    if m.detail:
        # Outer green hedge border + central 6-petal flower topiary
        for sx in (-8.2, 8.2):
            m.box(sx, 0.52, 0, 1.4, 0.48, 29.6, 'hedge')
        for sz in (-14.2, 14.2):
            m.box(0, 0.52, sz, 17.8, 0.48, 1.4, 'hedge')
        m.cylinder_y(0, 0.52, 0.55, 0, 2.2, 'yellow_pave', sections=10)
        for petal in range(6):
            ang = petal * math.pi / 3.0
            m.cylinder_y(math.cos(ang) * 4.4, 0.52, 0.48, math.sin(ang) * 4.4, 2.35, 'hedge', sections=8)
    m.pose = (0.0, 0.0, 0.0, 0.0)

    # Symmetric 2x3 square shrub planters flanking the west parterre (ctrip_sq/00.jpg bottom)
    if m.detail:
        for side in (-1, 1):
            for row in (-46.0, -60.0, -74.0):
                for col in (24.0, 36.0):
                    bx, bz = _ax_pt(row, side * col)
                    m.pose = (bx, 0.06, bz, AXIS_YAW)
                    m.box(0, 0.0, 0, 6.6, 0.38, 6.6, 'stone', collide=True)
                    m.box(0, 0.38, 0, 5.8, 0.24, 5.8, 'hedge')
                    m.cylinder_y(0, 0.62, 1.15, 0, 1.85, 'leaf', sections=7)
                    m.pose = (0.0, 0.0, 0.0, 0.0)

    # '桂林山水甲天下' natural karst boulder stele facing Zhongshan Middle Rd & central axis
    stx, stz = _ax_pt(-84.0, 0.0)
    _karst_stele(m, stx, stz, AXIS_YAW)

    # ------------------------------------------------------------------
    # 4. Xiao Xiang Gang Underground Mall Skylights, Portals & Dome
    # ------------------------------------------------------------------
    # Twin steel-and-glass pyramid skylights (ctrip_sq/04.jpg & 07.jpg)
    for side in (-1, 1):
        px, pz = _ax_pt(-38.0, side * 28.0)
        _glass_pyramid(m, px, pz, AXIS_YAW, base_w=7.8, h=4.8)
        if m.detail:
            # Symmetrical sunken underground commercial street stairwells
            ux, uz = _ax_pt(-22.0, side * 26.5)
            _underground_portal(m, ux, uz, AXIS_YAW + (0.0 if side > 0 else math.pi))
            ux2, uz2 = _ax_pt(-78.0, side * 19.5)
            _underground_portal(m, ux2, uz2, AXIS_YAW)

    # Green geodesic spherical skylight dome on NW edge (ctrip_sq/00.jpg bottom-left & 05.jpg left)
    dx_dome, dz_dome = _ax_pt(-32.0, -56.0)
    ico = trimesh.creation.icosphere(subdivisions=2 if m.detail else 1, radius=4.2)
    dome_v = ico.vertices.copy()
    dome_v[:, 1] = np.maximum(0.0, dome_v[:, 1] * 0.85) + 0.15
    dome_v[:, 0] += dx_dome
    dome_v[:, 2] += dz_dome
    m.mesh(dome_v, ico.faces, 'glass', collide=True)
    m.cylinder_y(dx_dome, 0.06, 0.45, dz_dome, 4.4, 'dark', sections=12, collide=True)

    # Double rows of Canary Island date palms along North & South promenades (ctrip_sq/00.jpg & 01.jpg)
    if m.detail:
        for side in (-1, 1):
            for along in np.linspace(-92.0, 12.0, 8):
                tx, tz = _ax_pt(along, side * 50.5)
                m.street_tree(tx, 0.08, tz, height=9.6, spread=3.8, kind='palm', collide=True)

    # ------------------------------------------------------------------
    # 5. Guilin Gymnasium (桂林市体育馆, exact OSM way/675177179)
    # ------------------------------------------------------------------
    m.prism(GYM_675177179, -2.2, 6.2, 'stone', collide=True, cap_mat='alum')
    m.prism(GYM_675177179, 4.0, 14.6, 'alum', collide=True, cap_mat='roof')
    # Pitched standing-seam arena roof ridge + grand west LED portal facing plaza
    gcx, gcz = _ax_pt(96.5, 16.5)
    m.pose = (gcx, 0.0, gcz, AXIS_YAW)
    # Sloped upper arena crown
    crown_v = [
        (-36.0, 18.6, -24.0), (36.0, 18.6, -24.0), (36.0, 18.6, 24.0), (-36.0, 18.6, 24.0),
        (-26.0, 22.6, 0.0), (26.0, 22.6, 0.0),
    ]
    m.mesh(crown_v, [[0, 4, 5], [0, 5, 1], [1, 5, 2], [2, 5, 4], [2, 4, 3], [3, 4, 0]], 'roof')

    # Grand West Entrance Steps, Twin Stair Pylons, Giant LED Screen & '体育馆' Gold Letters (ctrip_sq/03.jpg)
    for st in range(7):
        m.box(0, st * 0.17, 29.8 - st * 0.65, 24.0, 0.18, 0.72, 'pave', collide=True)
    for side in (-1, 1):
        m.box(side * 13.8, 0.0, 26.5, 6.4, 20.2, 6.2, 'alum', collide=True)
        m.box(side * 13.8, 1.2, 29.7, 4.2, 3.6, 0.25, 'dark')
    # Giant black framed LED screen + red slogan banner + rooftop gold '体 育 馆'
    m.box(0, 4.8, 25.8, 19.6, 9.4, 0.85, 'dark')
    m.box(0, 5.25, 26.28, 18.4, 8.4, 0.16, 'screen_lit')
    m.box(0, 15.2, 25.6, 20.5, 1.35, 0.35, 'alum')
    if m.detail:
        for bx in np.linspace(-8.0, 8.0, 10):
            m.box(bx, 15.5, 25.82, 0.75, 0.78, 0.08, 'red')
        for gx in (-4.8, 0.0, 4.8):
            m.box(gx, 18.8, 24.8, 1.65, 1.85, 0.26, 'yellow_pave')
            m.box(gx, 19.1, 24.96, 1.35, 0.32, 0.08, 'white_lit')
    m.pose = (0.0, 0.0, 0.0, 0.0)

    # ------------------------------------------------------------------
    # 6. Flanking North & South Civic/Commercial Halls + Fire Rescue Station
    # ------------------------------------------------------------------
    # NW Holiday Inn Express dark-brown gabled hotel block along Yiren Rd (ctrip_sq/00.jpg left & 05.jpg)
    hcx, hcz = _ax_pt(-54.0, -76.0)
    m.pose = (hcx, 0.0, hcz, AXIS_YAW + math.pi / 2.0)
    m.box(0, -2.0, 0, 56.0, 22.8, 16.5, 'wood', collide=True)
    m.box(0, 4.5, 8.35, 52.0, 14.8, 0.28, 'glass')
    m.box(0, 20.8, 0, 57.2, 1.8, 17.4, 'roof')
    if m.detail:
        for px in np.linspace(-24.0, 24.0, 9):
            m.box(px, 0.0, 8.45, 0.75, 20.8, 0.45, 'dark')
        m.box(4.0, 22.6, 8.0, 14.0, 1.6, 0.24, 'hedge')
    m.pose = (0.0, 0.0, 0.0, 0.0)

    # NE Institutional Hall (way/1493030771, ctrip_sq/00.jpg upper-left & 03.jpg left)
    m.prism(NE_HALL_1493030771, -2.0, 15.8, 'white', collide=True, cap_mat='roof')
    m.prism(NE_HALL_1493030771, 13.8, 1.9, 'terra', collide=False, cap_mat='roof')

    # SE Sports Annex (way/675106655, ctrip_sq/00.jpg upper-right & 03.jpg right)
    m.prism(SE_ANNEX_675106655, -2.0, 16.4, 'white', collide=True, cap_mat='roof')

    # Guilin Central Square Fire Rescue Station on NE lane (2026 Commons 00..02-2026.jpg)
    fsx, fsz = _ax_pt(52.0, -68.0)
    _fire_station(m, fsx, fsz, AXIS_YAW + math.pi)


if __name__ == '__main__':
    export_landmark('central_square', build_central_square)
