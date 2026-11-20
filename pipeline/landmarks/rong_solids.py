import math
from contextlib import contextmanager

from c_kit import tube


@contextmanager
def align_front(builder, pivot, yaw, shift=(0, 0)):
    meshes = [*builder.parts.values(), builder.hit]
    starts = [len(mesh.pos) for mesh in meshes]
    yield
    cosine, sine = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    for mesh, start in zip(meshes, starts):
        for index in range(start, len(mesh.pos)):
            east, level, south = mesh.pos[index]
            east -= pivot[0]
            south -= pivot[1]
            mesh.pos[index] = (shift[0] + pivot[0] + cosine * east + sine * south, level, shift[1] + pivot[1] - sine * east + cosine * south)
            east, level, south = mesh.nrm[index]
            mesh.nrm[index] = (cosine * east + sine * south, level, -sine * east + cosine * south)


def loft(mesh, sections, region, sides=12):
    rings = []
    for east, level, south, rx, rz in sections:
        rings.append([(east + rx * math.cos(index * math.tau / sides), level, south + rz * math.sin(index * math.tau / sides)) for index in range(sides)])
    for lower, upper in zip(rings, rings[1:]):
        for index in range(sides):
            other = (index + 1) % sides
            angle = (index + .5) * math.tau / sides
            mesh.face([lower[index], upper[index], upper[other], lower[other]], (math.cos(angle), 0, math.sin(angle)), region, None)
    mesh.face(rings[0], (0, -1, 0), region, None)
    mesh.face(rings[-1], (0, 1, 0), region, None)


def oval(mesh, center, radii, region, sides=12):
    east, level, south = center
    rx, ry, rz = radii
    sections = []
    for angle in (-86, -54, -24, 7, 39, 68, 86):
        latitude = math.radians(angle)
        sections.append((east, level + ry * math.sin(latitude), south, rx * math.cos(latitude), rz * math.cos(latitude)))
    loft(mesh, sections, region, sides)


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


def _subdiv():
    v_out = list(_ICO_V0)
    cache = {}

    def mid(i, j):
        k = (i, j) if i < j else (j, i)
        if k in cache:
            return cache[k]
        ax, ay, az = v_out[i]
        bx, by, bz = v_out[j]
        mx, my, mz = (ax + bx) * .5, (ay + by) * .5, (az + bz) * .5
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


_ICO_V1, _ICO_F1 = _subdiv()


def _organic_blob(mesh, center, radii, region, seed, detail):
    """Irregular 15%-jittered 1-subdivision icosphere foliage mass (no flat bottom, no ring bands)."""
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
        p0, p1, p2 = pts[a], pts[b], pts[c]
        nx = (p1[1] - p0[1]) * (p2[2] - p0[2]) - (p1[2] - p0[2]) * (p2[1] - p0[1])
        ny = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2])
        nz = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0])
        ln = math.hypot(nx, ny, nz) or 1.0
        mesh.face([p0, p1, p2], (nx / ln, ny / ln, nz / ln), region, None)


def banyan(mesh, origin, height, crown, seed, detail, lobed=True, grade=None, join_forks=False):
    east, level, south = origin
    start = len(mesh.pos)
    scale = height / 14
    girth = scale * (2.15 if lobed else 1.45)
    loft(mesh, [
        (east, level, south, 0.92 * girth, 0.86 * girth),
        (east - .18 * scale, level + .95 * scale, south, 0.72 * girth, 0.68 * girth),
        (east + .15 * scale, level + 2.6 * scale, south - .12, 0.56 * girth, 0.52 * girth),
        (east + .08, level + height * .42, south + .10, 0.42 * girth, 0.44 * girth),
    ], 'bark', 10 if detail else 7)
    if lobed:
        # Fused multi-stem root buttresses merging into the main trunk (IMG_1310, IMG_1339)
        for rib in range(4):
            ra = rib * math.tau / 4 + seed * .37
            rc, rs = math.cos(ra), math.sin(ra)
            tube(
                mesh,
                (east + rc * .62 * girth, level, south + rs * .62 * girth),
                (east + rc * .24 * girth, level + height * .26, south + rs * .24 * girth),
                .26 * scale,
                'bark',
                6 if detail else 4,
            )
    for index in range(5):
        angle = index * math.tau / 5 + seed * .55
        cosine, sine = math.cos(angle), math.sin(angle)
        fork = (east + crown * .32 * cosine, level + height * .50, south + crown * .32 * sine)
        tip = (east + crown * .56 * cosine, level + height * .64, south + crown * .56 * sine)
        tube(mesh, (east, level + height * .29, south), fork, .42 * girth, 'bark', 7)
        tube(mesh, fork, tip, .24 * girth, 'bark', 6)
        if join_forks:
            # The thinner limb meets the side of the thicker limb at an angle.
            # Cover the open ring ends with a bark knuckle at the crotch.
            radius = .46*girth
            oval(mesh, fork, (radius, radius, radius), 'bark', 7)
        if detail and lobed:
            # Grounded thick secondary-trunk prop roots on two major limbs + bundled aerial root curtains
            if index in (1, 4):
                anchor = tuple(s + (e - s) * .48 for s, e in zip(fork, tip))
                tube(mesh, (anchor[0], anchor[1] + .12, anchor[2]), (anchor[0], level, anchor[2]), .21 * scale, 'bark', 6)
            bundle_anchor = tuple(s + (e - s) * .68 for s, e in zip(fork, tip))
            for k, drop_f in enumerate((.14, .22, .18)):
                ka = k * math.tau / 3 + index
                ax = bundle_anchor[0] + .16 * math.cos(ka)
                az = bundle_anchor[2] + .16 * math.sin(ka)
                # Overlap top +0.18m inside branch so grounding assembly joins cleanly
                tube(mesh, (ax, bundle_anchor[1] + .18, az), (ax, bundle_anchor[1] - height * drop_f, az), .036 * scale, 'bark', 4)

    # 8 overlapping irregular squashed-ellipsoid blobs forming an undulating continuous crown
    for index in range(8):
        if index < 6:
            phase = seed * .55 + index * math.tau / 6
            ctr = (
                east + crown * .48 * math.cos(phase),
                level + height * (.63 + .05 * math.sin(phase * 2)),
                south + crown * .48 * math.sin(phase),
            )
            radii = (crown * .44, height * (.20 + .02 * (index % 3)), crown * .40)
        elif index == 6:
            ctr = (east + .08 * crown, level + height * .76, south - .05 * crown)
            radii = (crown * .52, height * .23, crown * .48)
        else:
            ctr = (east - .06 * crown, level + height * .84, south + .04 * crown)
            radii = (crown * .38, height * .19, crown * .36)
        _organic_blob(mesh, ctr, radii, 'foliage', seed * 13 + index * 19 + 7, detail)

    if grade:
        for i in range(start, len(mesh.pos)):
            x, y, z = mesh.pos[i]
            if abs(y - level) < .02:
                mesh.pos[i] = (x, grade(x, z) - .06, z)


def torus(mesh, center, radius, thickness, depth, region, wobble=0, stretch=1, phase=0):
    east, level, south = center
    sides, bands = 22, 8

    def point(index, band):
        angle = index * math.tau / sides
        cross = band * math.tau / bands
        radial = radius * (1 + wobble * math.sin(3 * angle + phase)) + thickness * math.cos(cross)
        return east + radial * math.cos(angle), level + stretch * radial * math.sin(angle), south + depth * math.sin(cross) + wobble * math.cos(2 * angle + phase)

    for index in range(sides):
        for band in range(bands):
            angle = (index + .5) * math.tau / sides
            cross = (band + .5) * math.tau / bands
            mesh.face([point(index, band), point(index + 1, band), point(index + 1, band + 1), point(index, band + 1)],
                      (math.cos(angle) * math.cos(cross), math.sin(angle) * math.cos(cross), math.sin(cross)), region, None)
