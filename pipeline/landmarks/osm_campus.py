"""OSM-level campus builder (IDOK-80, Rock 11-21 口径 A).

Every structure comes from mapped data only:
- buildings: OSM / Overture footprints listed in the school module (no added blocks);
  floors, roof and colours are inferred and documented in ops 仓库 docs/layout/schools/<id>.md;
- sports: OSM `leisure=track` / `leisure=pitch` geometry only, non-overlapping;
- perimeter: the OSM campus outline inset 0.8 m and cut back from public roads and
  neighbouring footprints; one generalized street-side gate, always closed;
- greenery: generic trees in open ground, not matched tree by tree.
No guard post, turnstile, camera or building-use label is ever produced.
"""
import math

from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

from school_kit import SchoolBuilder, hole_free, mrr_stats

DEFAULT_PALETTE = {
    'wall_main':   '#ebe8e1',
    'wall_sub':    '#8fb0cc',
    'wall_accent': '#a9b0b8',
    'wall_base':   '#7d838a',
    'win_frame':   '#5f7f9f',
    'win_trim':    '#f4f3ef',
    'base_frame':  '#b9c0c8',
    'base_trim':   '#6c737b',
    'pave_grey':   '#c8c5bd',
    'pave_road':   '#a19e97',
    'pave_dark':   '#585c60',
    'granite':     '#b5b2aa',
    'roof_tile':   '#6c727a',
    'roof_blue':   '#8fb4d6',
    'track_red':   '#b4503f',
    'turf_a':      '#4f8e46',
    'turf_b':      '#427a3b',
    'court_a':     '#3f8a62',
    'court_b':     '#3f73b0',
    'cinnabar':    '#c0473a',
    'cream':       '#e2ddd2',
    'white':       '#f3f2ee',
    'dark_stone':  '#5a5f64',
    'steel':       '#a7aeb5',
    'has_ac':      True,
}


def palette(**over) -> dict:
    p = dict(DEFAULT_PALETTE)
    p.update(over)
    return p


def signs(name: str, en: str, emblem: str) -> dict:
    """Gate plaque carries the school name only."""
    return {
        'school_name': name, 'school_en': en,
        'gate_bg': '#eef0f2', 'gate_fg': '#a3251f', 'gate_sub_fg': '#55585c',
        'vert_bg': '#c9ccd0', 'vert_fg': '#1e1e1e', 'vert_text': name,
        'motto': '', 'led_title': name, 'emblem': emblem,
    }


def _gate(b: SchoolBuilder, p0, p1, clear_w: float):
    """Generalized street-side gate: two piers, name plaque, closed retractable gate."""
    mx, mz = (p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5
    yaw = math.atan2(-(p1[1] - p0[1]), p1[0] - p0[0])
    gy = b.ground(mx, mz)
    old = b.pose
    b.pose = (mx, 0.0, mz, yaw)
    half = clear_w * 0.5 + 0.7
    for sgn in (-1.0, 1.0):
        px = sgn * half
        b.box(px, gy - 0.03, 0.0, 1.4, 0.55, 1.4, 'dark_stone', cap_region='granite', collide=True)
        b.box(px, gy + 0.5, 0.0, 1.2, 3.4, 1.2, 'cream', cap_region='white', collide=True)
        b.box(px, gy + 3.9, 0.0, 1.4, 0.28, 1.4, 'wall_base', cap_region='white', bottom=True)
    if b.lod < 2:
        b.sign(half, gy + 2.3, 0.62, 0.4, 1.8, 'sign_vert', double_sided=True)
        b.sign(-half, gy + 2.6, 0.62, 1.1, 0.55, 'sign_gate', double_sided=True)
    b.retractable_gate(clear_w, gate_h=1.6, y0=gy)
    b.pose = old


def _edge_index(ring, edge):
    for i in range(len(ring)):
        a, c = ring[i], ring[(i + 1) % len(ring)]
        if (math.dist(a, edge[0]) < 0.6 and math.dist(c, edge[1]) < 0.6) or \
           (math.dist(a, edge[1]) < 0.6 and math.dist(c, edge[0]) < 0.6):
            return i
    raise ValueError('gate edge not on fence ring')


def _court_dims(sport: str, L: float, W: float) -> tuple[float, float]:
    """Fit the court inside its mapped rectangle (1.1 m apron each side)."""
    return max(6.0, L - 2.2), max(4.0, W - 2.2)


def build_campus(b: SchoolBuilder, *, fence, gate_edge, gate_t: float = 0.5, buildings, tracks=(), pitches=(),
                 floor_h: float = 3.4, roof: str = 'flat_rail', roofs: dict | None = None,
                 court_surface: str = 'court_a', tree_species=('camphor', 'osmanthus', 'banyan', 'camphor'),
                 tree_spacing: float = 13.0, max_trees: int = 36, gate_width: float = 7.6):
    roofs = roofs or {}
    b.ground_slab(fence, region='pave_grey', lift=0.025, edge_drop=0.04)
    ring = b._clean_ring_ccw(fence)
    ge = _edge_index(ring, gate_edge)
    p0, p1 = ring[ge], ring[(ge + 1) % len(ring)]
    if math.dist(p0, gate_edge[0]) > 0.6:  # ring was reversed to CCW
        gate_t = 1.0 - gate_t
    L = math.dist(p0, p1)
    half = min(0.45, (gate_width + 3.2) / L / 2)
    tc = min(max(gate_t, half + 0.02), 0.98 - half)
    t0, t1 = tc - half, tc + half
    # Where the outline runs along a building wall, the wall itself is the boundary.
    walls = unary_union([Polygon(r) for _, _, r in buildings]).buffer(1.0)
    skip = {i for i in range(len(ring)) if i != ge and
            walls.contains(Point(ring[i])) and walls.contains(Point(ring[(i + 1) % len(ring)])) and
            walls.contains(Point((ring[i][0] + ring[(i + 1) % len(ring)][0]) / 2,
                                 (ring[i][1] + ring[(i + 1) % len(ring)][1]) / 2))}
    b.perimeter_fence(fence, gate_edge=ge, gate_t0=t0, gate_t1=t1,
                      wall_h=2.3, base_reg='wall_base', post_reg='white', skip_edges=skip,
                      drop_steep_bays=True)
    q0 = (p0[0] + (p1[0] - p0[0]) * t0, p0[1] + (p1[1] - p0[1]) * t0)
    q1 = (p0[0] + (p1[0] - p0[0]) * t1, p0[1] + (p1[1] - p0[1]) * t1)
    _gate(b, q0, q1, gate_width)

    common = dict(wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame',
                  parapet_reg='wall_accent', top_parapet_reg='white')
    for i, (sid, floors, bring) in enumerate(buildings):
        r = roofs.get(sid, roofs.get(sid[:8], roof))
        kw = dict(common)
        if floors <= 2:
            kw = dict(wall_reg='win_wall', base_reg='win_base', win_frame_reg='win_frame')
        b.footprint_building(bring, bid=f'B{i + 1}', source_id=sid, floors=floors, floor_h=floor_h,
                             roof=r, instanced_windows=floors > 2, **kw)

    occupied = [Polygon(r).buffer(5.0) for _, _, r in buildings]
    for _, tring, holes in tracks:
        # The mapped OSM track band itself, terrain-following (no idealised stadium).
        band = Polygon(tring, holes)
        for q in hole_free(band):
            b.ground_slab(q, region='track_red', lift=0.045, edge_drop=0.04)
        for h in holes:
            infield = Polygon(h)
            if not any(infield.contains(Polygon(pr).centroid) for _, _, pr in pitches):
                for q in hole_free(infield.buffer(-0.3)):
                    b.ground_slab(q, region='turf_a', lift=0.05, edge_drop=0.04)
        occupied.append(Polygon(tring).buffer(2.0))
    for _, sport, pring in pitches:
        cx, cz, pl, pw, ang = mrr_stats(pring)
        w, d = _court_dims(sport, pl, pw)
        b.basketball_court(cx, cz, yaw=math.radians(ang), w=w, d=d, surface=court_surface,
                           apron='court_a', key_reg='cinnabar', lift=0.02, hoops=sport == 'basketball')
        occupied.append(Polygon(pring).buffer(2.0))

    # Gate forecourt stays clear; generic trees fill open ground on a jittered grid.
    gm = Point((q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2)
    occupied.append(gm.buffer(9.0))
    free = Polygon(ring).buffer(-2.2).difference(unary_union(occupied))
    if free.is_empty:
        return
    minx, minz, maxx, maxz = free.bounds
    n = 0
    zi = 0
    z = minz + tree_spacing * 0.5
    while z < maxz and n < max_trees:
        x = minx + tree_spacing * (0.5 + 0.5 * (zi % 2))
        while x < maxx and n < max_trees:
            jx = math.sin(x * 12.9898 + z * 78.233) * 2.0
            jz = math.cos(x * 39.346 + z * 11.135) * 2.0
            tx_, tz_ = x + jx, z + jz
            g_c = b.ground(tx_, tz_)
            flat_ok = all(abs(b.ground(tx_ + ox, tz_ + oz) - g_c) < 0.1
                          for ox, oz in ((0.5, 0), (-0.5, 0), (0, 0.5), (0, -0.5)))
            if flat_ok and free.contains(Point(tx_, tz_)):
                sp = tree_species[n % len(tree_species)]
                b.tree(x + jx, z + jz, species=sp, scale=0.86 + 0.08 * (n % 3),
                       yaw=((x * 0.37 + z * 0.21) % math.tau))
                n += 1
            x += tree_spacing
        z += tree_spacing
        zi += 1
