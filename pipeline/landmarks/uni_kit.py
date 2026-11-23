"""University campus kit (IDOK-165).

Photo-driven facade generator for whole university campuses. Every building keeps
its exact OSM / Overture footprint; a per-building spec chooses the facade
grammar seen in the reference photos:

- ``punched``  individual windows in a solid wall (older teaching blocks, dorms)
- ``ribbon``   continuous window bands between proud white spandrels
- ``grid``     deep white brise-soleil grid (fins + floor slabs), 1980s blocks
- ``curtain``  blue-green glass with mullions (newer halls, stair towers)
- ``pilaster`` punched windows framed by proud pilasters (classical 1950s blocks)

No guard post, turnstile, camera or access-control element is ever produced.
Built on ``g3_kit.Builder`` so the output shares the school atlas/export path.
"""
import math

import numpy as np
from shapely.geometry import Polygon


def ccw(ring):
    pts = np.asarray(ring, dtype=np.float64)
    if len(pts) >= 2 and np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    area2 = np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1])
    return pts if area2 > 0 else pts[::-1]


def edges(pts, min_len=3.0):
    """Yield (a, b, length, unit tangent, outward normal) for each long-enough edge."""
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        L = float(math.hypot(b[0] - a[0], b[1] - a[1]))
        if L < min_len:
            continue
        u = ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
        nrm = ((b[1] - a[1]) / L, (a[0] - b[0]) / L)
        yield i, a, b, L, u, nrm


def quad(b, p0, p1, y0, y1, off, nrm, region, lit=False, tile=2.4):
    """Vertical quad between plan points p0->p1 pushed ``off`` metres along nrm.

    Facade layers stay a few cm off the wall so the grounding audit still reads them
    as wall-mounted; campus GLBs are packed with 16-bit positions (landmarks.json
    ``positionBits``) so these offsets survive quantisation (IDOK-165)."""
    ox, oz = nrm[0] * off, nrm[1] * off
    b.face([(p0[0] + ox, y0, p0[1] + oz), (p1[0] + ox, y0, p1[1] + oz),
            (p1[0] + ox, y1, p1[1] + oz), (p0[0] + ox, y1, p0[1] + oz)],
           (nrm[0], 0.0, nrm[1]), region, lit=lit, tile=tile)


def slab(b, a, c, y0, h, depth, nrm, region, cap=None):
    """Proud horizontal band along an edge (front, top and bottom faces + ends)."""
    d = depth
    a2 = (a[0] + nrm[0] * d, a[1] + nrm[1] * d)
    c2 = (c[0] + nrm[0] * d, c[1] + nrm[1] * d)
    y1 = y0 + h
    quad(b, a, c, y0, y1, d, nrm, region)
    b.face([(a[0], y1, a[1]), (c[0], y1, c[1]), (c2[0], y1, c2[1]), (a2[0], y1, a2[1])][::-1],
           (0, 1, 0), cap or region)
    b.face([(a[0], y0, a[1]), (c[0], y0, c[1]), (c2[0], y0, c2[1]), (a2[0], y0, a2[1])],
           (0, -1, 0), region)


def footing(b, pts):
    """Bottom height so a small element touches the lowest ground under its corners."""
    return min(b.surface.ground(float(x), float(z)) for x, z in pts) - 0.04


def pose_footing(b, x, z, w, d):
    """Footing height (pose-local y) for a pose-local box centred at (x, z)."""
    oy = b.pose[1]
    gs = []
    for sx in (-w / 2, w / 2):
        for sz in (-d / 2, d / 2):
            wx, _, wz = b._xf((x + sx, 0.0, z + sz))
            gs.append(b.surface.ground(float(wx), float(wz)))
    return min(gs) - oy - 0.04


def fin(b, p, y0, h, depth, width, u, nrm, region, foot=False):
    """Proud vertical fin / pilaster centred on plan point p.

    ``foot``: every bottom corner follows the ground under it (steep campus slopes)."""
    hw = width / 2
    a = (p[0] - u[0] * hw, p[1] - u[1] * hw)
    c = (p[0] + u[0] * hw, p[1] + u[1] * hw)
    a2 = (a[0] + nrm[0] * depth, a[1] + nrm[1] * depth)
    c2 = (c[0] + nrm[0] * depth, c[1] + nrm[1] * depth)
    y1 = y0 + h
    g = (lambda q: b.surface.ground(float(q[0]), float(q[1])) - 0.04) if foot else (lambda q: y0)
    A, C, A2, C2 = ((q[0], g(q), q[1]) for q in (a, c, a2, c2))
    T = lambda q: (q[0], y1, q[2])
    b.face([A2, C2, T(C2), T(A2)], (nrm[0], 0, nrm[1]), region)
    b.face([A, A2, T(A2), T(A)], (-u[0], 0, -u[1]), region)
    b.face([C2, C, T(C), T(C2)], (u[0], 0, u[1]), region)
    b.face([T(A), T(A2), T(C2), T(C)], (0, 1, 0), region)


def ground_range(b, pts):
    gs = [b.surface.ground(float(x), float(z)) for x, z in pts]
    if len(pts) >= 3:
        c = Polygon(pts).representative_point()
        gs.append(b.surface.ground(c.x, c.y))
    return min(gs), max(gs)


def building(b, ring, *, floors, fh=3.5, style='punched', wall='white', accent='white', trim='granite',
             plinth='granite', roof='flat', roof_tile='silver_roof', bay=3.6, win_w=None, win_h=1.7,
             parapet=0.9, holes=(), skip_edges=(), roof_box=True):
    """Extrude one exact footprint with a photo-matched facade. Returns (y_base, y_top)."""
    pts = ccw(ring)
    g_lo, g_hi = ground_range(b, pts)
    base = g_hi + 0.15              # ground-floor slab sits just above the highest corner
    top = base + floors * fh
    b.prism(pts, g_lo - 0.4, base - g_lo + 0.4, plinth, cap_region=plinth, tile=2.0, footing=True, holes=holes)
    body = 'glass' if style == 'curtain' else wall
    b.prism(pts, base, top - base, body, cap_region=roof_tile, collide=True, holes=holes)
    if parapet > 0:
        b.prism(pts, top, parapet, accent if style != 'curtain' else 'white', cap_region=roof_tile, holes=holes)
    if roof_box and b.detail and floors >= 4 and Polygon(pts).area > 500:
        c = Polygon(pts, [list(map(tuple, h)) for h in holes]).buffer(-4.0)
        if not c.is_empty and c.geom_type == 'Polygon' and c.area > 40:
            # stair/lift overrun on the roof
            r = c.representative_point()
            b.box(r.x, top + max(parapet, 0.0), r.y, 6.0, 3.2, 5.0, wall, cap_region=roof_tile)

    if b.lod >= 1:
        # LOD1: one glass band per floor per long edge (cheap)
        for i, a, c, L, u, nrm in edges(pts, 6.0):
            if i in skip_edges:
                continue
            ins = min(1.2, L * 0.1)
            p0 = (a[0] + u[0] * ins, a[1] + u[1] * ins)
            p1 = (c[0] - u[0] * ins, c[1] - u[1] * ins)
            for f in range(floors):
                y = base + f * fh + 0.95
                quad(b, p0, p1, y, y + win_h, 0.05, nrm, 'glass', lit=True)
        return base, top

    for i, a, c, L, u, nrm in edges(pts, 3.0):
        if i in skip_edges:
            continue
        nb = max(1, int(round(L / bay)))
        step = L / nb
        ww = win_w or step * 0.58
        if style == 'curtain':
            for k in range(1, nb):
                p = (a[0] + u[0] * k * step, a[1] + u[1] * k * step)
                fin(b, p, base, top - base, 0.12, 0.12, u, nrm, 'steel', foot=True)
            for f in range(1, floors):
                slab(b, a, c, base + f * fh - 0.12, 0.24, 0.10, nrm, 'steel')
            continue
        if style == 'grid':
            for k in range(nb + 1):
                p = (a[0] + u[0] * k * step, a[1] + u[1] * k * step)
                fin(b, p, base, top - base, 0.75, 0.28, u, nrm, accent, foot=True)
            for f in range(1, floors + 1):
                slab(b, a, c, base + f * fh - 0.22, 0.22, 0.75, nrm, accent)
            for f in range(floors):
                y = base + f * fh + 0.85
                quad(b, a, c, y, y + fh - 1.25, 0.05, nrm, 'glass', lit=True)
            continue
        if style == 'ribbon':
            for f in range(floors):
                y = base + f * fh
                quad(b, (a[0] + u[0] * 0.6, a[1] + u[1] * 0.6), (c[0] - u[0] * 0.6, c[1] - u[1] * 0.6),
                     y + 1.0, y + 1.0 + win_h, 0.05, nrm, 'glass', lit=True)
                slab(b, a, c, y + fh - 0.45 if f < floors - 1 else y + fh - 0.3, 0.55 if f < floors - 1 else 0.3,
                     0.32, nrm, accent)
            for k in range(1, nb, 2):
                p = (a[0] + u[0] * k * step, a[1] + u[1] * k * step)
                fin(b, p, base, top - base, 0.06, 0.22, u, nrm, wall, foot=True)
            continue
        if style == 'balcony':
            # dorm blocks: continuous balconies with solid parapets on the long faces
            if L >= 14.0:
                for f in range(1, floors):
                    y = base + f * fh
                    slab(b, a, c, y - 0.18, 0.18, 1.3, nrm, trim)
                    quad(b, a, c, y, y + 1.05, 1.3, nrm, accent)
                    quad(b, a, c, y + 1.05, y + fh - 0.25, 0.05, nrm, 'glass', lit=True)
                for k in range(0, nb + 1, 2):
                    p = (a[0] + u[0] * k * step, a[1] + u[1] * k * step)
                    fin(b, p, base + fh - 0.18, top - base - fh, 1.3, 0.24, u, nrm, wall)
                continue
        # punched / pilaster / panel
        for f in range(floors):
            y = base + f * fh + 0.95
            for k in range(nb):
                m = (a[0] + u[0] * (k + 0.5) * step, a[1] + u[1] * (k + 0.5) * step)
                p0 = (m[0] - u[0] * ww / 2, m[1] - u[1] * ww / 2)
                p1 = (m[0] + u[0] * ww / 2, m[1] + u[1] * ww / 2)
                quad(b, p0, p1, y, y + win_h, 0.05, nrm, 'glass', lit=True)
            if style == 'panel':
                # coloured panels between the paired windows (pink tile bands, GUET teaching blocks)
                for k in range(nb + 1):
                    m = (a[0] + u[0] * k * step, a[1] + u[1] * k * step)
                    pw = max(0.4, (step - ww) * 0.8)
                    p0 = (m[0] - u[0] * pw / 2, m[1] - u[1] * pw / 2)
                    p1 = (m[0] + u[0] * pw / 2, m[1] + u[1] * pw / 2)
                    quad(b, p0, p1, y - 0.2, y + win_h + 0.2, 0.03, nrm, accent)
            # continuous sill line
            slab(b, a, c, y - 0.16, 0.14, 0.08, nrm, trim)
        if style == 'pilaster':
            for k in range(0, nb + 1, 2):
                p = (a[0] + u[0] * k * step, a[1] + u[1] * k * step)
                fin(b, p, base, top - base, 0.28, 0.7, u, nrm, accent, foot=True)
        # floor band below parapet
        slab(b, a, c, top - 0.35, 0.35, 0.12, nrm, accent)
    if roof == 'hip' and b.detail is not None:
        hip_roof(b, pts, top + max(parapet, 0.0) - 0.02, roof_tile)
    return base, top


def hip_roof(b, pts, y0, tile):
    """Hipped tile roof over the footprint's minimum rotated rectangle."""
    mrr = Polygon(pts).minimum_rotated_rectangle
    cs = list(mrr.exterior.coords)[:4]
    e0 = math.dist(cs[0], cs[1]); e1 = math.dist(cs[1], cs[2])
    if e0 < e1:
        cs = cs[1:] + cs[:1]
        e0, e1 = e1, e0
    (x0, z0), (x1, z1), (x2, z2), (x3, z3) = cs
    o = 0.0   # no overhang: an eave hanging past the wall top has no physical support (grounding audit)
    cx, cz = (x0 + x2) / 2, (z0 + z2) / 2
    ux, uz = (x1 - x0) / e0, (z1 - z0) / e0
    vx, vz = (x3 - x0) / e1, (z3 - z0) / e1
    hl, hw = e0 / 2 + o, e1 / 2 + o
    rise = min(3.2, e1 * 0.22)
    ridge = max(0.5, hl - hw)
    P = lambda s, t, y: (cx + ux * s + vx * t, y, cz + uz * s + vz * t)
    c = [P(-hl, -hw, y0), P(hl, -hw, y0), P(hl, hw, y0), P(-hl, hw, y0)]
    r0, r1 = P(-ridge, 0, y0 + rise), P(ridge, 0, y0 + rise)
    up = lambda n: (n[0], 0.6, n[1])
    b.face([c[1], c[0], r0, r1], up((-vx, -vz)), tile, tile=2.0)
    b.face([c[3], c[2], r1, r0], up((vx, vz)), tile, tile=2.0)
    b.face([c[0], c[3], r0], up((-ux, -uz)), tile, tile=2.0)
    b.face([c[2], c[1], r1], up((ux, uz)), tile, tile=2.0)
    for p, q in zip(c, c[1:] + c[:1]):
        b.face([p, q, (q[0], q[1] - 0.35, q[2]), (p[0], p[1] - 0.35, p[2])][::-1], (0, 0, 1), 'white', tile=2.0)


def ring_arc(b, cx, cz, y, r, thick, h, a0, a1, region, n=24):
    """Flat curved band (e.g. the library's ring canopy) as a thin annular sector."""
    for k in range(n):
        t0 = a0 + (a1 - a0) * k / n
        t1 = a0 + (a1 - a0) * (k + 1) / n
        o0 = (cx + math.cos(t0) * (r + thick / 2), cz + math.sin(t0) * (r + thick / 2))
        o1 = (cx + math.cos(t1) * (r + thick / 2), cz + math.sin(t1) * (r + thick / 2))
        i0 = (cx + math.cos(t0) * (r - thick / 2), cz + math.sin(t0) * (r - thick / 2))
        i1 = (cx + math.cos(t1) * (r - thick / 2), cz + math.sin(t1) * (r - thick / 2))
        b.face([(o0[0], y + h, o0[1]), (o1[0], y + h, o1[1]), (i1[0], y + h, i1[1]), (i0[0], y + h, i0[1])][::-1],
               (0, 1, 0), region)
        b.face([(o0[0], y, o0[1]), (o1[0], y, o1[1]), (i1[0], y, i1[1]), (i0[0], y, i0[1])], (0, -1, 0), region)
        nm = (math.cos((t0 + t1) / 2), math.sin((t0 + t1) / 2))
        b.face([(o0[0], y, o0[1]), (o1[0], y, o1[1]), (o1[0], y + h, o1[1]), (o0[0], y + h, o0[1])][::-1],
               (nm[0], 0, nm[1]), region)
        b.face([(i0[0], y, i0[1]), (i1[0], y, i1[1]), (i1[0], y + h, i1[1]), (i0[0], y + h, i0[1])],
               (-nm[0], 0, -nm[1]), region)
