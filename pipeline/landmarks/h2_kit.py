"""Modular H2 campus builder with LOD0/LOD1/LOD2, instancing, IDOK-71 trees, and sloped grounding."""
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.spatial import Delaunay
from shapely import make_valid
from shapely.geometry import LineString, MultiPolygon, Point, Polygon
import trimesh
from trimesh.visual import ColorVisuals, TextureVisuals
from trimesh.visual.material import PBRMaterial

from world_surface import LandmarkSurface, Surface


def _rgba(hex_or_rgb, alpha=255):
    if isinstance(hex_or_rgb, str):
        s = hex_or_rgb.lstrip('#')
        return np.array([int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), alpha], dtype=np.uint8)
    arr = list(hex_or_rgb)
    if len(arr) == 3:
        arr.append(alpha)
    return np.array(arr, dtype=np.uint8)


def colorize(mesh: trimesh.Trimesh, color, alpha=255) -> trimesh.Trimesh:
    c = _rgba(color, alpha)
    m = mesh.copy()
    m.visual = ColorVisuals(m, face_colors=np.tile(c, (len(m.faces), 1)))
    return m


def merge_meshes(meshes):
    valid = [m for m in meshes if m is not None and len(m.faces) > 0]
    if not valid:
        return None
    if len(valid) == 1:
        return valid[0]
    return trimesh.util.concatenate(valid)


def _oriented_box(x0, z0, x1, z1, y0, y1, thickness, color):
    """Vertical prism/wall segment between (x0,z0) and (x1,z1)."""
    dx, dz = x1 - x0, z1 - z0
    length = math.hypot(dx, dz)
    if length < 1e-4:
        return None
    nx, nz = -dz / length * (thickness / 2), dx / length * (thickness / 2)
    pts = [(x0 + nx, z0 + nz), (x1 + nx, z1 + nz), (x1 - nx, z1 - nz), (x0 - nx, z0 - nz)]
    poly = Polygon(pts)
    return _extrude_flat(poly, y0, y1, color)


def _extrude_flat(poly: Polygon, y0: float, y1: float, color, alpha=255):
    if poly.is_empty or y1 <= y0 + 1e-3:
        return None
    # Note: Shapely (x, z) -> trimesh extrude_polygon builds in XY plane with +Z extrusion.
    # Rotate -90 deg around X maps (X, Y, Z) -> (X, Z, -Y), wait:
    # Let's place Shapely (x, -z) in 2D, extrude along +Z by (y1 - y0), then swap Y and Z cleanly!
    coords = list(poly.exterior.coords)
    if len(coords) < 4:
        return None
    p2 = Polygon([(x, -z) for x, z in coords], [[(hx, -hz) for hx, hz in hole.coords] for hole in poly.interiors])
    if not p2.is_valid:
        p2 = make_valid(p2)
        if p2.geom_type != 'Polygon':
            p2 = max(p2.geoms, key=lambda g: g.area)
    m = trimesh.creation.extrude_polygon(p2, height=float(y1 - y0))
    # Currently (x_2d, y_2d=-z, z_extr=0..h). Map to (x, y0 + z_extr, -y_2d):
    v = m.vertices.copy()
    m.vertices = np.column_stack([v[:, 0], y0 + v[:, 2], -v[:, 1]])
    m.fix_normals()
    return colorize(m, color, alpha)


def _poly_ground_bounds(poly: Polygon, ls: LandmarkSurface):
    pts = list(poly.exterior.coords)[:-1] + [poly.representative_point().coords[0]]
    ys = [ls.ground(x, z) for x, z in pts]
    return min(ys), max(ys)


def triangulate_sloped_cap(poly: Polygon, ls: LandmarkSurface, y_offset=0.04, step=4.0, skirt_depth=0.0, color='#a0a49e'):
    """Triangulate horizontal surface following ls.ground(x, z) + y_offset, with optional down-skirt."""
    if poly.is_empty or poly.area < 0.05:
        return None
    if poly.geom_type == 'MultiPolygon':
        parts = [triangulate_sloped_cap(g, ls, y_offset, step, skirt_depth, color) for g in poly.geoms]
        return merge_meshes(parts)
    minx, minz, maxx, maxz = poly.bounds
    raw_ring = list(poly.exterior.coords)[:-1]
    ring = []
    for i in range(len(raw_ring)):
        ax, az = raw_ring[i]
        bx, bz = raw_ring[(i + 1) % len(raw_ring)]
        ring.append((ax, az))
        d = math.hypot(bx - ax, bz - az)
        if step and d > step:
            n = int(math.ceil(d / step))
            for k in range(1, n):
                t = k / n
                ring.append((ax + (bx - ax) * t, az + (bz - az) * t))
    pts = list(ring)
    if step and (maxx - minx > step or maxz - minz > step):
        xs = np.arange(minx + step * 0.5, maxx, step)
        zs = np.arange(minz + step * 0.5, maxz, step)
        for gx in xs:
            for gz in zs:
                if poly.contains(Point(gx, gz)):
                    pts.append((float(gx), float(gz)))
    pts_arr = np.asarray(pts, dtype=np.float64)
    if len(pts_arr) < 3:
        return None
    tri = Delaunay(pts_arr)
    faces = []
    for a, b, c in tri.simplices:
        cx = (pts_arr[a, 0] + pts_arr[b, 0] + pts_arr[c, 0]) / 3.0
        cz = (pts_arr[a, 1] + pts_arr[b, 1] + pts_arr[c, 1]) / 3.0
        if poly.contains(Point(cx, cz)):
            # Ensure upward normal (+Y) in X-Y-Z where Z is south: cross(b-a, c-a)_y > 0 means CCW in (x,-z)
            # In (x, z) screen coords, det = (bx-ax)*(cz-az) - (bz-az)*(cx-ax);
            # (p1-p0) x (p2-p0) y-component is -(dx1*dz2 - dz1*dx2). So keep det < 0 for +Y normal:
            dx1, dz1 = pts_arr[b, 0] - pts_arr[a, 0], pts_arr[b, 1] - pts_arr[a, 1]
            dx2, dz2 = pts_arr[c, 0] - pts_arr[a, 0], pts_arr[c, 1] - pts_arr[a, 1]
            if dx1 * dz2 - dz1 * dx2 < 0:
                faces.append([a, b, c])
            else:
                faces.append([a, c, b])
    if not faces:
        return None
    ys = np.array([ls.ground(x, z) + y_offset for x, z in pts_arr], dtype=np.float64)
    verts = np.column_stack([pts_arr[:, 0], ys, pts_arr[:, 1]])
    meshes = [colorize(trimesh.Trimesh(vertices=verts, faces=np.asarray(faces, dtype=np.int32), process=False), color)]
    if skirt_depth > 0:
        n = len(ring)
        sv, sf = [], []
        for i in range(n):
            x0, z0 = ring[i]
            x1, z1 = ring[(i + 1) % n]
            y0_t, y1_t = ls.ground(x0, z0) + y_offset, ls.ground(x1, z1) + y_offset
            y0_b, y1_b = ls.ground(x0, z0) - skirt_depth, ls.ground(x1, z1) - skirt_depth
            base = len(sv)
            sv.extend([(x0, y0_t, z0), (x1, y1_t, z1), (x1, y1_b, z1), (x0, y0_b, z0)])
            sf.extend([[base, base + 2, base + 1], [base, base + 3, base + 2]])
        if sf:
            meshes.append(colorize(trimesh.Trimesh(vertices=np.asarray(sv), faces=np.asarray(sf), process=False), color))
    return merge_meshes(meshes)


def sloped_wall_strip(points_xz, width, y_lo_rel, y_hi_rel, ls: LandmarkSurface, color, seg_max=4.0, closed=False):
    """Build a continuous ground-following prismatic wall along polyline points_xz."""
    if len(points_xz) < 2:
        return None
    pts = list(points_xz)
    if closed and pts[0] != pts[-1]:
        pts.append(pts[0])
    # Subdivide long segments to follow ground slope cleanly
    sub = [pts[0]]
    for i in range(len(pts) - 1):
        ax, az = pts[i]
        bx, bz = pts[i + 1]
        d = math.hypot(bx - ax, bz - az)
        n = max(1, int(math.ceil(d / seg_max)))
        for k in range(1, n + 1):
            t = k / n
            sub.append((ax + (bx - ax) * t, az + (bz - az) * t))
    hw = width / 2.0
    m = len(sub)
    left_pts, right_pts = [], []
    for i, (x, z) in enumerate(sub):
        if closed and (i == 0 or i == m - 1):
            px, pz = sub[-2]
            nx_, nz_ = sub[1]
            dx1, dz1 = x - px, z - pz
            dx2, dz2 = nx_ - x, nz_ - z
        else:
            p = sub[max(0, i - 1)]
            nx_p = sub[min(m - 1, i + 1)]
            dx1, dz1 = x - p[0], z - p[1]
            dx2, dz2 = nx_p[0] - x, nx_p[1] - z
        l1 = math.hypot(dx1, dz1)
        l2 = math.hypot(dx2, dz2)
        tx = (dx1 / l1 if l1 > 1e-5 else 0.0) + (dx2 / l2 if l2 > 1e-5 else 0.0)
        tz = (dz1 / l1 if l1 > 1e-5 else 0.0) + (dz2 / l2 if l2 > 1e-5 else 0.0)
        tl = math.hypot(tx, tz)
        if tl < 1e-5:
            tx, tz = 1.0, 0.0
        else:
            tx /= tl
            tz /= tl
        nx, nz = -tz, tx
        # Limit miter extension on tight corners
        if l1 > 1e-5 and l2 > 1e-5:
            u1x, u1z = -dz1 / l1, dx1 / l1
            dot = max(0.35, nx * u1x + nz * u1z)
            scale = min(1.8, 1.0 / dot)
        else:
            scale = 1.0
        left_pts.append((x + nx * hw * scale, z + nz * hw * scale))
        right_pts.append((x - nx * hw * scale, z - nz * hw * scale))

    verts, faces = [], []
    for i in range(m - 1):
        lx0, lz0 = left_pts[i]
        lx1, lz1 = left_pts[i + 1]
        rx0, rz0 = right_pts[i]
        rx1, rz1 = right_pts[i + 1]
        g0 = ls.ground(sub[i][0], sub[i][1])
        g1 = ls.ground(sub[i + 1][0], sub[i + 1][1])
        b0, t0 = g0 + y_lo_rel, g0 + y_hi_rel
        b1, t1 = g1 + y_lo_rel, g1 + y_hi_rel
        v0 = len(verts)
        verts.extend([
            (lx0, b0, lz0), (lx1, b1, lz1), (lx1, t1, lz1), (lx0, t0, lz0),
            (rx0, b0, rz0), (rx1, b1, rz1), (rx1, t1, rz1), (rx0, t0, rz0),
        ])
        # Top (3-2-6-7), Left (0-1-2-3), Right (5-4-7-6), Bottom (4-5-1-0)
        faces.extend([
            [v0 + 3, v0 + 2, v0 + 6], [v0 + 3, v0 + 6, v0 + 7],
            [v0 + 0, v0 + 1, v0 + 2], [v0 + 0, v0 + 2, v0 + 3],
            [v0 + 5, v0 + 4, v0 + 7], [v0 + 5, v0 + 7, v0 + 6],
            [v0 + 4, v0 + 5, v0 + 1], [v0 + 4, v0 + 1, v0 + 0],
        ])
    if not closed:
        # Cap start & end
        v0 = 0
        faces.extend([[v0 + 0, v0 + 3, v0 + 7], [v0 + 0, v0 + 7, v0 + 4]])
        vl = (m - 2) * 8
        faces.extend([[vl + 1, vl + 5, vl + 6], [vl + 1, vl + 6, vl + 2]])
    mesh = trimesh.Trimesh(vertices=np.asarray(verts), faces=np.asarray(faces), process=True)
    mesh.fix_normals()
    return colorize(mesh, color)


def make_text_sign(text: str, width: float, height: float, depth: float,
                   bg_color='#f2ede2', fg_color='#9c221d', border_color='#856e4d',
                   sub_text: str = '', accent_badge: bool = True) -> trimesh.Trimesh:
    """Create a horizontal textured sign box facing +Z in its local frame (caller transforms it)."""
    px_w = max(512, int(round(width * 96)))
    px_h = max(128, int(round(height * 96)))
    img = Image.new('RGB', (px_w, px_h), bg_color)
    draw = ImageDraw.Draw(img)
    if border_color:
        draw.rectangle([2, 2, px_w - 3, px_h - 3], outline=border_color, width=max(2, px_h // 28))

    font_path = '/System/Library/Fonts/STHeiti Medium.ttc'
    if not Path(font_path).exists():
        font_path = '/System/Library/Fonts/Hiragino Sans GB.ttc'
    main_size = int(px_h * (0.48 if sub_text else 0.62))
    try:
        font = ImageFont.truetype(font_path, main_size)
    except Exception:
        font = ImageFont.load_default()
    y_main = int(px_h * (0.36 if sub_text else 0.50))
    x_shift = int(px_h * 0.45) if accent_badge else 0
    if accent_badge:
        r = int(px_h * 0.24)
        cx, cy = int(px_h * 0.42), y_main
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill='#2e6b4f', outline=fg_color, width=max(2, r // 7))
    draw.text((px_w // 2 + x_shift // 2, y_main), text, fill=fg_color, font=font, anchor='mm')
    if sub_text:
        try:
            sfont = ImageFont.truetype(font_path, max(12, int(px_h * 0.16)))
        except Exception:
            sfont = font
        draw.text((px_w // 2, int(px_h * 0.79)), sub_text, fill='#4a3d35', font=sfont, anchor='mm')

    # Front face (+Z) samples full texture upright; trimesh flips V on export (v_glb = 1 - v),
    # so v = +y/h + 0.5 maps top (+h/2) to v_glb = 0 (top of PIL image).
    box = trimesh.creation.box([width, height, depth])
    v = box.vertices
    uv = np.zeros((len(v), 2), dtype=np.float32)
    uv[:, 0] = np.clip((v[:, 0] / width) + 0.5, 0.01, 0.99)
    uv[:, 1] = np.clip((v[:, 1] / height) + 0.5, 0.01, 0.99)
    # Collapse back vertices (z < 0) to top-left border pixel so back looks plain bg/border
    back = v[:, 2] < 0
    uv[back, 0] = 0.015
    uv[back, 1] = 0.985
    mat = PBRMaterial(baseColorTexture=img, roughnessFactor=0.72, metallicFactor=0.05)
    box.visual = TextureVisuals(uv=uv, material=mat)
    return box


def _rot_y_matrix(tx, ty, tz, yaw_rad):
    c, s = math.cos(yaw_rad), math.sin(yaw_rad)
    return np.array([
        [c, 0.0, s, tx],
        [0.0, 1.0, 0.0, ty],
        [-s, 0.0, c, tz],
        [0.0, 0.0, 0.0, 1.0],
    ], dtype=np.float64)


def make_window_proto(w=1.6, h=1.45, frame_col='#b8b4aa', glass_col='#3c5569'):
    """Single reusable window bay prototype (origin centered on facade plane, +Z outward)."""
    f = colorize(trimesh.creation.box([w, h, 0.14]), frame_col)
    g = colorize(trimesh.creation.box([w - 0.18, h - 0.20, 0.08]), glass_col)
    g.apply_translation([0, 0, 0.04])
    sill = colorize(trimesh.creation.box([w + 0.10, 0.10, 0.22]), '#cfcac0')
    sill.apply_translation([0, -h / 2 - 0.02, 0.04])
    return merge_meshes([f, g, sill])


def make_hoop_proto(pole_col='#245c3c', board_col='#eef2f5'):
    """Single vertex-connected basketball hoop prototype (origin at base bottom y=0, facing +Z)."""
    verts = []
    faces = []
    fcols = []

    def add_ring_lofts(rings, colors_per_seg):
        base_idx = len(verts)
        k = len(rings[0])
        for r in rings:
            verts.extend(r)
        for s_idx in range(len(rings) - 1):
            c = _rgba(colors_per_seg[s_idx])
            r0 = base_idx + s_idx * k
            r1 = r0 + k
            for j in range(k):
                jn = (j + 1) % k
                faces.extend([[r0 + j, r1 + j, r1 + jn], [r0 + j, r1 + jn, r0 + jn]])
                fcols.extend([c, c])
        # Cap bottom & top
        cb = _rgba(colors_per_seg[0])
        ct = _rgba(colors_per_seg[-1])
        faces.extend([[base_idx, base_idx + 2, base_idx + 1], [base_idx, base_idx + 3, base_idx + 2]])
        fcols.extend([cb, cb])
        top = base_idx + (len(rings) - 1) * k
        faces.extend([[top, top + 1, top + 2], [top, top + 2, top + 3]])
        fcols.extend([ct, ct])

    def rect_xy(cx, y0, y1, cz, hw):
        return [(cx - hw, y0, cz), (cx + hw, y0, cz), (cx + hw, y1, cz), (cx - hw, y1, cz)]

    def rect_xz(cx, cy, cz, hw, hd):
        return [(cx - hw, cy, cz - hd), (cx + hw, cy, cz - hd), (cx + hw, cy, cz + hd), (cx - hw, cy, cz + hd)]

    # Base plate -> upright post -> arm neck -> backboard -> rim (one unified vertex-connected skeleton)
    # 1. Upright base + post (connected quad prism):
    add_ring_lofts([
        rect_xz(0, 0.0, -0.35, 0.32, 0.32),
        rect_xz(0, 0.10, -0.35, 0.32, 0.32),
        rect_xz(0, 0.12, -0.35, 0.09, 0.09),
        rect_xz(0, 3.22, -0.35, 0.08, 0.08),
        rect_xz(0, 3.36, -0.35, 0.08, 0.08),
    ], [pole_col] * 4)

    # 2. Horizontal arm bridging from post (overlapping at z=-0.35..0.88) seamlessly into backboard and rim!
    # Share vertices between arm front end, backboard back, target square, and rim extension:
    b_idx = len(verts)
    rings_arm = [
        rect_xy(0, 3.22, 3.36, -0.35, 0.08),  # inside post top
        rect_xy(0, 3.22, 3.36, 0.87, 0.08),   # back of board
        rect_xy(0, 2.88, 3.93, 0.87, 0.90),   # board back flare
        rect_xy(0, 2.88, 3.93, 0.93, 0.90),   # board front
        rect_xy(0, 3.04, 3.46, 0.93, 0.30),   # target patch
        rect_xy(0, 3.04, 3.46, 0.95, 0.30),   # target patch front
        rect_xy(0, 3.03, 3.08, 0.95, 0.16),   # rim neck
        rect_xy(0, 3.03, 3.08, 1.38, 0.22),   # rim hoop loop front
    ]
    add_ring_lofts(rings_arm, [pole_col, board_col, board_col, '#b53a2e', '#b53a2e', '#d1512d', '#d1512d'])

    # Weld coinciding vertices on post/arm interface? Even simpler: snap 2 triangles from ring_arm[0] to post[3] by reusing post vertex indices
    # Actually connect arm vertex b_idx+0 to post vertex 12 (both inside (-0.08, 3.22, -0.35)): build bridging tri sharing exact vertex index 12!
    # Connect vertex index 12 (post ring3) with arm base b_idx (arm ring0) via zero-area hinge tri or shared vertex coord + process=True
    verts_arr = np.asarray(verts, dtype=np.float64)
    # Vertex b_idx+0 and index 12+... share identical coords (-0.08, 3.22, -0.27..-0.43)?
    # Make ring_arm[0] literally match ring_post[3] at z=-0.27 (-0.35+0.08) so merge_vertices merges them cleanly!
    # Let's snap post front vertices y=3.22..3.36, z=-0.27 directly to arm[0]:
    rings_arm_first_z = -0.35 + 0.08
    for j, (vx, vy, vz) in enumerate([
        (-0.08, 3.22, -0.27), (0.08, 3.22, -0.27), (0.08, 3.36, -0.27), (-0.08, 3.36, -0.27)
    ]):
        verts_arr[b_idx + j] = (vx, vy, vz)
    # Also ensure post ring 3 & 4 share those corner coords at z=-0.27:
    # post ring 3 is indices 12..15: (cx-0.08, 3.22, -0.43), (cx+0.08, 3.22, -0.43), (cx+0.08, 3.22, -0.27), (cx-0.08, 3.22, -0.27)
    # ring 4 is indices 16..19 at y=3.36 -> corners 18, 19 at z=-0.27 match verts_arr[b_idx+2], verts_arr[b_idx+3]!
    mesh = trimesh.Trimesh(vertices=verts_arr, faces=np.asarray(faces, dtype=np.int32), process=False)
    mesh.visual = ColorVisuals(mesh, face_colors=np.asarray(fcols, dtype=np.uint8))
    mesh.merge_vertices(merge_tex=False, merge_norm=False)
    return mesh


def make_tree_proto(species='camphor', height=8.5, crown_r=3.6, detail='lod0', seed=1):
    """Single vertex-connected IDOK-71 species tree (root to multi-lobed crown, 0 detached parts)."""
    rng = np.random.default_rng(seed)
    palettes = {
        'camphor': ('#42633c', '#4c7045'),
        'banyan': ('#4d6d3e', '#597b49'),
        'osmanthus': ('#547743', '#61854d'),
        'virens': ('#658442', '#70904c'),
        'bischofia': ('#5f6e40', '#6d7c4c'),
        'conifer': ('#3a5738', '#446341'),
        'palm': ('#4d713d', '#5c8248'),
    }
    c0, c1 = palettes.get(species, palettes['camphor'])
    bark = '#5a4636'
    foot = -0.14

    if species == 'palm':
        nsec = 6 if detail != 'lod2' else 5
        trings = 5 if detail == 'lod0' else 3
        verts, faces, fcols = [], [], []
        # Trunk stack
        for ri in range(trings + 1):
            t = ri / trings
            yy = foot + t * (height * 0.85 - foot)
            rr = 0.24 * (1.0 - 0.35 * t)
            for k in range(nsec):
                a = 2 * math.pi * k / nsec
                verts.append((rr * math.cos(a), yy, rr * math.sin(a)))
        for ri in range(trings):
            r0, r1 = ri * nsec, (ri + 1) * nsec
            for k in range(nsec):
                kn = (k + 1) % nsec
                faces.extend([[r0 + k, r1 + k, r1 + kn], [r0 + k, r1 + kn, r0 + kn]])
                fcols.extend([_rgba(bark), _rgba(bark)])
        # Top cap vertex
        apex_idx = len(verts)
        verts.append((0.0, height * 0.87, 0.0))
        top_ring = trings * nsec
        for k in range(nsec):
            kn = (k + 1) % nsec
            faces.append([top_ring + k, apex_idx, top_ring + kn])
            fcols.append(_rgba(c0))
        # Connected radiating palm fronds sharing apex/top_ring vertices (two-sided leaf)
        segs = 3 if detail == 'lod0' else 2
        for k in range(nsec):
            kn = (k + 1) % nsec
            ang = 2 * math.pi * (k + 0.5) / nsec
            prev_l, prev_r = top_ring + k, top_ring + kn
            for s in range(1, segs + 1):
                f = s / segs
                dist = crown_r * 0.95 * f
                drop = crown_r * 0.36 * (f ** 1.8)
                w = 0.34 * math.sin(math.pi * (0.2 + 0.75 * (1.0 - f))) + 0.06
                cx, cy, cz = dist * math.cos(ang), height * 0.86 + 0.35 * math.sin(math.pi * f * 0.7) - drop, dist * math.sin(ang)
                nx, nz = -math.sin(ang) * w, math.cos(ang) * w
                il, ir = len(verts), len(verts) + 1
                verts.extend([(cx - nx, cy, cz - nz), (cx + nx, cy, cz + nz)])
                col = _rgba(c0 if k % 2 == 0 else c1)
                faces.extend([[prev_l, ir, prev_r], [prev_l, il, ir], [prev_l, prev_r, ir], [prev_l, ir, il]])
                fcols.extend([col, col, col, col])
                prev_l, prev_r = il, ir
        m = trimesh.Trimesh(vertices=np.asarray(verts), faces=np.asarray(faces), process=False)
        m.visual = ColorVisuals(m, face_colors=np.asarray(fcols))
        return m

    if species == 'conifer':
        nsec = 7 if detail == 'lod0' else 5
        tiers = 4 if detail == 'lod0' else (3 if detail == 'lod1' else 1)
        # Single continuous lathed ring stack: root -> trunk -> undulating tiered whorls -> apex
        profile = [(foot, 0.28), (height * 0.28, 0.16)]
        for t in range(tiers):
            f0 = t / max(1, tiers)
            y_base = height * (0.28 + 0.58 * f0)
            y_tip = height * (0.28 + 0.58 * ((t + 0.85) / max(1, tiers)))
            r_outer = crown_r * (1.0 - 0.52 * f0)
            profile.append((y_base, r_outer))
            profile.append((y_tip, r_outer * 0.28))
        verts, faces, fcols = [], [], []
        for idx, (yy, rr) in enumerate(profile):
            for k in range(nsec):
                a = 2 * math.pi * k / nsec
                verts.append((rr * math.cos(a), yy, rr * math.sin(a)))
        for ri in range(len(profile) - 1):
            r0, r1 = ri * nsec, (ri + 1) * nsec
            col = _rgba(bark if ri == 0 else (c0 if (ri // 2) % 2 == 0 else c1))
            for k in range(nsec):
                kn = (k + 1) % nsec
                faces.extend([[r0 + k, r1 + k, r1 + kn], [r0 + k, r1 + kn, r0 + kn]])
                fcols.extend([col, col])
        apex_idx = len(verts)
        verts.append((0.0, height * 1.02, 0.0))
        top_r = (len(profile) - 1) * nsec
        for k in range(nsec):
            kn = (k + 1) % nsec
            faces.append([top_r + k, apex_idx, top_r + kn])
            fcols.append(_rgba(c0))
        m = trimesh.Trimesh(vertices=np.asarray(verts), faces=np.asarray(faces), process=False)
        m.visual = ColorVisuals(m, face_colors=np.asarray(fcols))
        return m

    # Broadleaf multi-lobed IDOK-71 canopy continuously lofted from root flare (1 connected manifold!)
    nsec = 12 if detail == 'lod0' else (8 if detail == 'lod1' else 6)
    nlat = 7 if detail == 'lod0' else (4 if detail == 'lod1' else 3)
    # Lobe harmonic directions for sculptural organic IDOK-71 cluster look
    lobe_dirs = []
    n_lobes = 5
    for li in range(n_lobes):
        la = 2 * math.pi * li / n_lobes + float(rng.uniform(-0.2, 0.2))
        lobe_dirs.append((math.cos(la), float(rng.uniform(-0.15, 0.45)), math.sin(la)))
    lobe_dirs.append((0.0, 1.0, 0.0))

    trunk_top = height * 0.46
    crown_cy = height * 0.68
    crown_h = height * 0.36
    trunk_rings = [(foot, crown_r * 0.09 + 0.14), (trunk_top * 0.65, crown_r * 0.06 + 0.10), (trunk_top, crown_r * 0.08 + 0.12)]
    verts, faces, fcols = [], [], []
    for yy, rr in trunk_rings:
        for k in range(nsec):
            a = 2 * math.pi * k / nsec
            verts.append((rr * math.cos(a), yy, rr * math.sin(a)))

    # Canopy latitude rings seamlessly continuing from top trunk ring
    for lat_i in range(nlat):
        phi = -0.38 * math.pi + (0.82 * math.pi) * (lat_i / max(1, nlat - 1))
        cp, sp = math.cos(phi), math.sin(phi)
        for k in range(nsec):
            th = 2 * math.pi * k / nsec
            ux, uy, uz = cp * math.cos(th), sp, cp * math.sin(th)
            lobe_boost = max(ux * lx + uy * ly + uz * lz for lx, ly, lz in lobe_dirs)
            lobe_mod = 0.78 + 0.32 * max(0.0, lobe_boost) ** 2
            rx = crown_r * ux * lobe_mod
            ry = crown_h * uy * lobe_mod
            rz = crown_r * uz * lobe_mod
            verts.append((rx, max(trunk_top - 0.15, crown_cy + ry), rz))

    total_rings = len(trunk_rings) + nlat
    for ri in range(total_rings - 1):
        r0, r1 = ri * nsec, (ri + 1) * nsec
        is_bark = ri < len(trunk_rings) - 1
        for k in range(nsec):
            kn = (k + 1) % nsec
            col = _rgba(bark if is_bark else (c0 if (ri + k) % 2 == 0 else c1))
            faces.extend([[r0 + k, r1 + k, r1 + kn], [r0 + k, r1 + kn, r0 + kn]])
            fcols.extend([col, col])
    # Top cap apex
    apex_idx = len(verts)
    verts.append((0.0, crown_cy + crown_h * 1.05, 0.0))
    top_r = (total_rings - 1) * nsec
    for k in range(nsec):
        kn = (k + 1) % nsec
        faces.append([top_r + k, apex_idx, top_r + kn])
        fcols.append(_rgba(c1))
    m = trimesh.Trimesh(vertices=np.asarray(verts), faces=np.asarray(faces), process=False)
    m.visual = ColorVisuals(m, face_colors=np.asarray(fcols))
    return m


class CampusScene:
    """Collects lod0 / lod1 / lod2 meshes, shared instanced nodes, and lightweight collision hulls."""

    def __init__(self, landmark_id: str):
        self.id = landmark_id
        self.ls = LandmarkSurface(Surface(), landmark_id)
        self.buckets = {
            'lod0': {},  # mat_tag -> [mesh]
            'lod1': {},
            'lod2': {},
        }
        self.protos = {}  # (lod, name) -> trimesh
        self.instances = []  # (lod, proto_name, matrix4)
        self.signs = []  # (name, trimesh) rendered inside lod0
        self.colliders = []  # trimesh put inside collision_campus

    def add(self, lod: str, tag: str, mesh):
        if mesh is not None and len(mesh.faces) > 0:
            # Consolidate vertex-colored static geometry into <= 3 draw-call groups per LOD
            if tag.startswith(('ground', 'track', 'court', 'key')):
                group = 'ground'
            elif tag.startswith('glass'):
                group = 'glass'
            else:
                group = 'solid'
            self.buckets[lod].setdefault(group, []).append(mesh)

    def add_collider(self, mesh):
        if mesh is not None and len(mesh.faces) > 0:
            self.colliders.append(mesh)

    def register_proto(self, lod: str, name: str, mesh: trimesh.Trimesh):
        self.protos[(lod, name)] = mesh

    def add_instance(self, lod: str, name: str, x: float, y: float, z: float, yaw: float = 0.0, scale: float = 1.0):
        T = _rot_y_matrix(x, y, z, yaw)
        if abs(scale - 1.0) > 1e-4:
            S = np.diag([scale, scale, scale, 1.0])
            T = T @ S
        self.instances.append((lod, name, T))

    def add_tree(self, species: str, x: float, z: float, scale: float = 1.0, yaw: float = 0.0):
        y = self.ls.ground(x, z)
        for lod in ('lod0', 'lod1', 'lod2'):
            pname = f'{lod}_tree_{species}'
            if (lod, pname) not in self.protos:
                seed = sum(ord(ch) * (idx + 1) for idx, ch in enumerate(species)) % 997
                self.register_proto(lod, pname, make_tree_proto(species, detail=lod, seed=seed))
            self.add_instance(lod, pname, x, y, z, yaw=yaw, scale=scale)

    def add_building(self, poly: Polygon, floors: int, floor_h: float = 3.2,
                     wall_color='#eae6dc', band_color='#b6b0a4', roof_color='#7e8388',
                     roof_type='parapet', gallery_edges=(), window_edges=(),
                     window_col='#3c5569', frame_col='#c8c3b8', base_band=0.9,
                     collide=True, lod0_win_step=3.2):
        """Build a faithful multi-storey campus block across LOD0/1/2 + collider."""
        if poly.is_empty:
            return
        g_min, g_max = _poly_ground_bounds(poly, self.ls)
        foot_y = g_min - 0.16
        ground_y = g_max  # lowest visible floor slab starts above terrain high side? No: start walls at foot_y up to g_max + H
        # Use average ground around perimeter for floor datum so stories match real elevation
        pts = list(poly.exterior.coords)[:-1]
        g_avg = sum(self.ls.ground(px, pz) for px, pz in pts) / len(pts)
        top_y = max(g_max + 2.2, g_avg + floors * floor_h)

        # Core body (in lod0/1/2 + collider)
        body = _extrude_flat(poly, foot_y, top_y, wall_color)
        self.add('lod0', f'wall_{wall_color}', body)
        self.add('lod1', f'wall_{wall_color}', _extrude_flat(poly, foot_y, top_y, wall_color))
        self.add('lod2', f'wall_{wall_color}', _extrude_flat(poly, foot_y, top_y, wall_color))
        if collide:
            c_poly = poly.buffer(-0.04)
            if not c_poly.is_empty:
                self.add_collider(_extrude_flat(c_poly, foot_y, top_y, wall_color))

        # Horizontal plinth base band & roof parapet / pitched roof
        plinth = _extrude_flat(poly.buffer(0.06, join_style='mitre'), foot_y, g_max + base_band, band_color)
        self.add('lod0', f'band_{band_color}', plinth)
        self.add('lod1', f'band_{band_color}', _extrude_flat(poly.buffer(0.04, join_style='mitre'), foot_y, g_max + base_band, band_color))

        if roof_type == 'parapet':
            parapet = _extrude_flat(poly.buffer(0.10, join_style='mitre'), top_y - 0.35, top_y + 0.55, band_color)
            cap = _extrude_flat(poly.buffer(-0.28, join_style='mitre'), top_y, top_y + 0.08, roof_color)
            self.add('lod0', f'band_{band_color}', parapet)
            self.add('lod0', f'roof_{roof_color}', cap)
            self.add('lod1', f'roof_{roof_color}', _extrude_flat(poly.buffer(0.08, join_style='mitre'), top_y - 0.15, top_y + 0.45, roof_color))
            self.add('lod2', f'roof_{roof_color}', _extrude_flat(poly.buffer(0.05, join_style='mitre'), top_y, top_y + 0.35, roof_color))
        elif roof_type == 'stepped_hip':
            # Pitched trim eaves + inner flat roof (as seen on 13th Middle east block)
            for tier, (buf, h0, h1) in enumerate(((0.45, -0.15, 0.42), (-0.15, 0.42, 0.92), (-0.75, 0.92, 1.35))):
                rp = poly.buffer(buf, join_style='mitre')
                if not rp.is_empty:
                    m_r = _extrude_flat(rp, top_y + h0, top_y + h1, roof_color)
                    self.add('lod0', f'roof_{roof_color}', m_r)
                    if tier in (0, 2):
                        self.add('lod1', f'roof_{roof_color}', m_r.copy())
            self.add('lod2', f'roof_{roof_color}', _extrude_flat(poly.buffer(0.30, join_style='mitre'), top_y, top_y + 0.95, roof_color))

        # Edge-based open corridor galleries (shadow recess + horizontal railings) & instanced windows
        if ('lod0', 'win_std') not in self.protos:
            self.register_proto('lod0', 'win_std', make_window_proto(1.65, min(1.55, floor_h * 0.48), frame_col, window_col))
        if ('lod1', 'win_simple') not in self.protos:
            self.register_proto('lod1', 'win_simple', colorize(trimesh.creation.box([1.65, min(1.45, floor_h * 0.46), 0.10]), window_col))

        # Ensure ring orientation: Polygon exterior in (x, z) -> compute outward normal via signed area
        ring = list(poly.exterior.coords)[:-1]
        # signed area in (x,z)
        sa = sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring)))
        # If sa > 0 (CCW in +X/+Z), outward edge (dx, dz) normal is (dz, -dx); if sa < 0, (-dz, dx)
        sign_out = 1.0 if sa > 0 else -1.0

        for idx in range(len(ring)):
            ax, az = ring[idx]
            bx, bz = ring[(idx + 1) % len(ring)]
            elen = math.hypot(bx - ax, bz - az)
            if elen < 2.2:
                continue
            out_x = sign_out * (bz - az) / elen
            out_z = sign_out * -(bx - ax) / elen
            # Local +Z points along outward normal (out_x, out_z):
            yaw = math.atan2(out_x, out_z)

            if idx in gallery_edges:
                # Open external corridor deck slabs + parapet railing + corridor dark shadow backing + columns
                for fl in range(floors):
                    fy = g_avg + fl * floor_h
                    if fy < g_max - 0.3 and fl == 0:
                        continue
                    # Dark recessed corridor backdrop strip
                    back = _oriented_box(ax + out_x * 0.05, az + out_z * 0.05, bx + out_x * 0.05, bz + out_z * 0.05,
                                         fy + 0.15, fy + floor_h - 0.30, 0.16, '#2e353b')
                    self.add('lod0', 'corridor_dark', back)
                    self.add('lod1', 'corridor_dark', back.copy())
                    if fl > 0:
                        # Projecting slab & solid lower parapet + top bar
                        slab = _oriented_box(ax + out_x * 0.65, az + out_z * 0.65, bx + out_x * 0.65, bz + out_z * 0.65,
                                             fy - 0.10, fy + 0.92, 1.15, wall_color)
                        rail = _oriented_box(ax + out_x * 1.12, az + out_z * 1.12, bx + out_x * 1.12, bz + out_z * 1.12,
                                             fy + 0.92, fy + 1.06, 0.12, band_color)
                        self.add('lod0', f'wall_{wall_color}', slab)
                        self.add('lod0', f'band_{band_color}', rail)
                        self.add('lod1', f'wall_{wall_color}', slab.copy())
                # Structural corridor columns
                ncols = max(2, int(round(elen / 5.5)))
                for c in range(ncols + 1):
                    t = 0.04 + 0.92 * (c / ncols)
                    cx, cz = ax + (bx - ax) * t + out_x * 1.05, az + (bz - az) * t + out_z * 1.05
                    c_g = self.ls.ground(cx, cz)
                    col_m = colorize(trimesh.creation.box([0.32, top_y - (c_g - 0.12), 0.32]), wall_color)
                    col_m.apply_translation([cx, (c_g - 0.12 + top_y) / 2, cz])
                    self.add('lod0', f'wall_{wall_color}', col_m)
                    self.add('lod1', f'wall_{wall_color}', col_m.copy())
            elif idx in window_edges:
                nbays = max(1, int(math.floor((elen - 1.4) / lod0_win_step)))
                for b in range(nbays):
                    t = (b + 0.5) / nbays
                    px = ax + (bx - ax) * t + out_x * 0.02
                    pz = az + (bz - az) * t + out_z * 0.02
                    lg = self.ls.ground(px, pz)
                    for fl in range(floors):
                        wy = g_avg + fl * floor_h + floor_h * 0.54
                        if wy - 0.8 < lg:
                            continue
                        self.add_instance('lod0', 'win_std', px, wy, pz, yaw=yaw)
                        if fl % 2 == 0 and b % 2 == 0:
                            self.add_instance('lod1', 'win_simple', px, wy, pz, yaw=yaw)

    def add_perimeter_wall(self, loop_pts, gate_gap=None, wall_h=1.05, post_step=3.2,
                           base_col='#e2ddd0', rail_col='#2d3439', collide=True):
        """Continuous sloped masonry wall + instanced railing bars, omitting optional gate_gap=(gx0,gz0,gx1,gz1)."""
        pts = list(loop_pts)
        if pts[0] != pts[-1]:
            pts.append(pts[0])
        # Split polygon into segments, skipping the gate span if provided
        segments = []
        cur = [pts[0]]
        gap_line = LineString([(gate_gap[0], gate_gap[1]), (gate_gap[2], gate_gap[3])]) if gate_gap else None
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            seg = LineString([a, b])
            if gap_line and seg.distance(gap_line.centroid) < 0.8 * gap_line.length and abs(seg.length) > 1.0:
                # Project gap start/end onto seg
                s0 = seg.project(Point(gate_gap[0], gate_gap[1]))
                s1 = seg.project(Point(gate_gap[2], gate_gap[3]))
                lo, hi = min(s0, s1), max(s0, s1)
                if lo > 0.3:
                    p_lo = seg.interpolate(lo).coords[0]
                    cur.append(p_lo)
                    segments.append(cur)
                else:
                    if len(cur) >= 2:
                        segments.append(cur)
                cur = []
                if hi < seg.length - 0.3:
                    p_hi = seg.interpolate(hi).coords[0]
                    cur = [p_hi, b]
                else:
                    cur = [b]
            else:
                cur.append(b)
        if len(cur) >= 2:
            segments.append(cur)

        if ('lod0', 'fence_post') not in self.protos:
            post_m = colorize(trimesh.creation.box([0.07, 1.05, 0.07]), rail_col)
            post_m.apply_translation([0, 0.525, 0])
            self.register_proto('lod0', 'fence_post', post_m)
        if ('lod0', 'masonry_pier') not in self.protos:
            pier_m = colorize(trimesh.creation.box([0.38, 2.25, 0.38]), base_col)
            pier_m.apply_translation([0, 1.05, 0])
            self.register_proto('lod0', 'masonry_pier', pier_m)

        for seg_pts in segments:
            # Masonry lower wall (-0.12 to +wall_h)
            base_m = sloped_wall_strip(seg_pts, 0.28, -0.14, wall_h, self.ls, base_col, seg_max=4.0, closed=False)
            self.add('lod0', 'wall_base', base_m)
            self.add('lod1', 'wall_base', base_m.copy())
            self.add('lod2', 'wall_base', base_m.copy())
            # Top horizontal iron rail
            top_rail = sloped_wall_strip(seg_pts, 0.08, wall_h + 0.92, wall_h + 1.02, self.ls, rail_col, seg_max=4.0, closed=False)
            mid_rail = sloped_wall_strip(seg_pts, 0.06, wall_h + 0.12, wall_h + 0.20, self.ls, rail_col, seg_max=4.0, closed=False)
            self.add('lod0', 'fence_rail', merge_meshes([top_rail, mid_rail]))
            self.add('lod1', 'fence_rail', top_rail.copy())
            if collide:
                self.add_collider(sloped_wall_strip(seg_pts, 0.22, -0.14, wall_h + 1.15, self.ls, rail_col, seg_max=4.0, closed=False))

            # Instanced masonry piers + fence vertical bars
            line = LineString(seg_pts)
            d = 0.0
            while d <= line.length + 1e-3:
                px, pz = line.interpolate(min(d, line.length)).coords[0]
                g = self.ls.ground(px, pz)
                self.add_instance('lod0', 'masonry_pier', px, g, pz)
                d += 7.5
            # Railing balusters
            bd = 0.35
            while bd < line.length - 0.2:
                px, pz = line.interpolate(bd).coords[0]
                g = self.ls.ground(px, pz)
                self.add_instance('lod0', 'fence_post', px, g + wall_h - 0.05, pz)
                bd += 0.45

    def add_closed_gate(self, p0, p1, outward_vec, school_name: str, sub_name: str = '',
                        pier_col='#dcd6c6', gate_col='#c9cfd4', header_col='#7c2420',
                        plaque_side='right', plaque_text='', plaque_sub='', plaque_w=8.5, plaque_h=2.4):
        """Closed main street gate with NO guardhouse, turnstile, or CCTV."""
        x0, z0 = p0
        x1, z1 = p1
        dx, dz = x1 - x0, z1 - z0
        w = math.hypot(dx, dz)
        ux, uz = dx / w, dz / w
        yaw = math.atan2(outward_vec[0], outward_vec[1])
        g0, g1 = self.ls.ground(x0, z0), self.ls.ground(x1, z1)
        g_mid = (g0 + g1) * 0.5
        mx, mz = (x0 + x1) * 0.5, (z0 + z1) * 0.5

        # Gate piers
        for px, pz, pg in ((x0, z0, g0), (x1, z1, g1)):
            pier = colorize(trimesh.creation.box([0.75, 3.6, 0.75]), pier_col)
            pier.apply_transform(_rot_y_matrix(px, pg + 1.68, pz, yaw))
            self.add('lod0', 'gate_pier', pier)
            self.add('lod1', 'gate_pier', pier.copy())
            self.add_collider(pier.copy())

        # Overhead portal header beam (if span <= 14 m)
        beam = colorize(trimesh.creation.box([w + 0.8, 0.72, 0.58]), header_col)
        beam.apply_transform(_rot_y_matrix(mx, g_mid + 3.65, mz, yaw))
        self.add('lod0', 'gate_beam', beam)
        self.add('lod1', 'gate_beam', beam.copy())
        self.add('lod2', 'gate_beam', beam.copy())

        # Closed gate barrier: bottom sill + top rail + dense closed bars (100% impassable)
        if ('lod0', 'gate_bar') not in self.protos:
            bar = colorize(trimesh.creation.box([0.07, 1.55, 0.07]), gate_col)
            bar.apply_translation([0, 0.85, 0])
            self.register_proto('lod0', 'gate_bar', bar)
        n_bars = max(8, int((w - 0.8) / 0.28))
        for k in range(n_bars):
            t = 0.06 + 0.88 * (k / max(1, n_bars - 1))
            bx, bz = x0 + dx * t, z0 + dz * t
            self.add_instance('lod0', 'gate_bar', bx, self.ls.ground(bx, bz), bz, yaw=yaw)

        gate_rail_b = sloped_wall_strip([p0, p1], 0.14, 0.05, 0.24, self.ls, gate_col, seg_max=3.0)
        gate_rail_t = sloped_wall_strip([p0, p1], 0.12, 1.52, 1.66, self.ls, gate_col, seg_max=3.0)
        self.add('lod0', 'gate_rail', merge_meshes([gate_rail_b, gate_rail_t]))
        self.add('lod1', 'gate_rail', sloped_wall_strip([p0, p1], 0.16, 0.0, 1.66, self.ls, gate_col, seg_max=4.0))
        self.add_collider(sloped_wall_strip([p0, p1], 0.35, -0.15, 2.20, self.ls, gate_col, seg_max=4.0))

        # School name plaque sign on beam or adjacent culture wall
        if plaque_text:
            # Place adjacent along p1->ux direction if plaque_w given
            if plaque_side == 'right':
                cx, cz = x1 + ux * (plaque_w * 0.5 + 0.55), z1 + uz * (plaque_w * 0.5 + 0.55)
            elif plaque_side == 'left':
                cx, cz = x0 - ux * (plaque_w * 0.5 + 0.55), z0 - uz * (plaque_w * 0.5 + 0.55)
            else:
                cx, cz = mx, mz
            cg = self.ls.ground(cx, cz)
            # Wall behind culture plaque
            cwall = colorize(trimesh.creation.box([plaque_w + 0.4, plaque_h + 0.5, 0.46]), '#e7e1d4')
            cwall.apply_transform(_rot_y_matrix(cx, cg + (plaque_h + 0.2) / 2, cz, yaw))
            self.add('lod0', 'gate_pier', cwall)
            self.add('lod1', 'gate_pier', cwall.copy())
            self.add_collider(cwall.copy())
            sign = make_text_sign(plaque_text, plaque_w, plaque_h * 0.44, 0.10, sub_text=plaque_sub)
            sy = cg + plaque_h * 0.78 if plaque_side != 'beam' else g_mid + 3.65
            so = _rot_y_matrix(cx + outward_vec[0] * 0.24, sy, cz + outward_vec[1] * 0.24, yaw)
            sign.apply_transform(so)
            self.signs.append((f'sign_{self.id}_gate', sign))
        else:
            sign = make_text_sign(school_name, min(7.5, max(4.2, w * 0.75)), 0.68, 0.10, sub_text=sub_name)
            sign.apply_transform(_rot_y_matrix(mx + outward_vec[0] * 0.30, g_mid + 3.65, mz + outward_vec[1] * 0.30, yaw))
            self.signs.append((f'sign_{self.id}_gate', sign))

    def add_court(self, poly: Polygon, court_col='#2c734e', key_col='#2c588e', include_hoops=True,
                  court_line_w=0.14):
        """Basketball/sports court aligned to poly's long axis, terrain-conforming, with instanced hoops."""
        self.add('lod0', f'court_{court_col}', triangulate_sloped_cap(poly, self.ls, y_offset=0.11, step=3.0, skirt_depth=0.09, color=court_col))
        self.add('lod1', f'court_{court_col}', triangulate_sloped_cap(poly, self.ls, y_offset=0.11, step=5.5, skirt_depth=0.09, color=court_col))
        self.add('lod2', f'court_{court_col}', triangulate_sloped_cap(poly, self.ls, y_offset=0.11, step=10.0, skirt_depth=0.0, color=court_col))

        pts = list(poly.exterior.coords)[:-1]
        if len(pts) < 4:
            return
        # Find longest edge axis
        mrr = poly.minimum_rotated_rectangle
        mc = list(mrr.exterior.coords)[:-1]
        edges = [(mc[i], mc[(i + 1) % 4], math.hypot(mc[(i + 1) % 4][0] - mc[i][0], mc[(i + 1) % 4][1] - mc[i][1])) for i in range(4)]
        long_e = max(edges, key=lambda e: e[2])
        short_e = min(edges, key=lambda e: e[2])
        ux, uz = (long_e[1][0] - long_e[0][0]) / long_e[2], (long_e[1][1] - long_e[0][1]) / long_e[2]
        vx, vz = -uz, ux
        cx, cz = poly.centroid.x, poly.centroid.y
        L, W = long_e[2], short_e[2]
        half_L, half_W = L * 0.45, W * 0.43

        def pt(a, b):
            return (cx + ux * a + vx * b, cz + uz * a + vz * b)

        # Center circle (blue/key_col) + two paint keys
        c_poly = Polygon([pt(2.0 * math.cos(2 * math.pi * k / 12), 2.0 * math.sin(2 * math.pi * k / 12)) for k in range(12)])
        self.add('lod0', f'key_{key_col}', triangulate_sloped_cap(c_poly, self.ls, y_offset=0.122, step=2.0, color=key_col))
        for sgn in (-1, 1):
            kp = Polygon([
                pt(sgn * half_L, -2.3), pt(sgn * (half_L - 5.2), -2.3),
                pt(sgn * (half_L - 5.2), 2.3), pt(sgn * half_L, 2.3),
            ])
            self.add('lod0', f'key_{key_col}', triangulate_sloped_cap(kp, self.ls, y_offset=0.122, step=2.5, color=key_col))

        # White perimeter & centerline strips
        border = [pt(-half_L, -half_W), pt(half_L, -half_W), pt(half_L, half_W), pt(-half_L, half_W)]
        self.add('lod0', 'court_line', sloped_wall_strip(border, court_line_w, 0.11, 0.135, self.ls, '#f3f4f2', seg_max=3.5, closed=True))
        self.add('lod0', 'court_line', sloped_wall_strip([pt(0, -half_W), pt(0, half_W)], court_line_w, 0.11, 0.135, self.ls, '#f3f4f2', seg_max=3.5))

        if include_hoops:
            if ('lod0', 'bb_hoop') not in self.protos:
                self.register_proto('lod0', 'bb_hoop', make_hoop_proto())
            if ('lod1', 'bb_hoop_s') not in self.protos:
                self.register_proto('lod1', 'bb_hoop_s', colorize(trimesh.creation.box([1.6, 3.6, 0.25]), '#245c3c'))
            for sgn in (-1, 1):
                hx, hz = pt(sgn * (half_L + 0.45), 0.0)
                hg = self.ls.ground(hx, hz)
                # Facing inward (-sgn * u)
                yaw = math.atan2(-sgn * ux, -sgn * uz)
                self.add_instance('lod0', 'bb_hoop', hx, hg, hz, yaw=yaw)
                self.add_instance('lod1', 'bb_hoop_s', hx, hg + 1.8, hz, yaw=yaw)

    def add_rostrum(self, cx, cz, width, depth, height, yaw, wall_col='#e4ded0', trim_col='#9c2b25', face_text=''):
        """Campus raised rostrum / flagpole stage (no guardhouse/CCTV)."""
        c, s = math.cos(yaw), math.sin(yaw)
        pts = []
        for dx, dz in ((-width / 2, -depth / 2), (width / 2, -depth / 2), (width / 2, depth / 2), (-width / 2, depth / 2)):
            pts.append((cx + dx * c + dz * s, cz - dx * s + dz * c))
        poly = Polygon(pts)
        g_min, g_max = _poly_ground_bounds(poly, self.ls)
        base = _extrude_flat(poly, g_min - 0.14, g_max + height, wall_col)
        top_trim = _extrude_flat(poly.buffer(0.10, join_style='mitre'), g_max + height - 0.12, g_max + height + 0.06, trim_col)
        self.add('lod0', f'wall_{wall_col}', base)
        self.add('lod0', f'trim_{trim_col}', top_trim)
        self.add('lod1', f'wall_{wall_col}', base.copy())
        self.add('lod2', f'wall_{wall_col}', base.copy())
        self.add_collider(base.copy())
        # Twin side stairs stepping down onto ground
        for side in (-1, 1):
            for st in range(3):
                step_w = 1.6
                sx = cx + side * (width / 2 + 0.55 + st * 0.45) * c
                sz = cz - side * (width / 2 + 0.55 + st * 0.45) * s
                sh = height * (1.0 - (st + 0.5) / 3.2)
                sm = colorize(trimesh.creation.box([0.50, sh + 0.15, step_w]), '#cbc5b8')
                sm.apply_transform(_rot_y_matrix(sx, self.ls.ground(sx, sz) + (sh - 0.12) / 2, sz, yaw))
                self.add('lod0', 'rostrum_stair', sm)
        # Flagpole behind center of rostrum: flag extrudes directly from pole shaft vertices (1 connected mesh!)
        fx = cx - (depth * 0.35) * s
        fz = cz - (depth * 0.35) * c
        fg = self.ls.ground(fx, fz) + height
        nsec = 6
        pole_rings = [fg - 0.10, fg + 8.35, fg + 9.35, fg + 9.55]
        pverts, pfaces, pfcols = [], [], []
        for yy in pole_rings:
            for k in range(nsec):
                a = 2 * math.pi * k / nsec
                pverts.append((fx + 0.055 * math.cos(a), yy, fz + 0.055 * math.sin(a)))
        for ri in range(len(pole_rings) - 1):
            r0, r1 = ri * nsec, (ri + 1) * nsec
            for k in range(nsec):
                kn = (k + 1) % nsec
                pfaces.extend([[r0 + k, r1 + k, r1 + kn], [r0 + k, r1 + kn, r0 + kn]])
                pfcols.extend([_rgba('#cfd4d9'), _rgba('#cfd4d9')])
        # Flag leaf directly anchored on pole ring 1 (y=8.35) & ring 2 (y=9.35) at vertex k=0
        i_bot, i_top = 1 * nsec, 2 * nsec
        fl_bot, fl_top = len(pverts), len(pverts) + 1
        pverts.extend([
            (fx + 1.48 * c, fg + 8.35, fz - 1.48 * s),
            (fx + 1.48 * c, fg + 9.35, fz - 1.48 * s),
        ])
        pfaces.extend([[i_bot, fl_bot, fl_top], [i_bot, fl_top, i_top], [i_bot, fl_top, fl_bot], [i_bot, i_top, fl_top]])
        pfcols.extend([_rgba('#c82b24')] * 4)
        flag_pole = trimesh.Trimesh(vertices=np.asarray(pverts), faces=np.asarray(pfaces), process=False)
        flag_pole.visual = ColorVisuals(flag_pole, face_colors=np.asarray(pfcols))
        self.add('lod0', 'flagpole', flag_pole)

    def export(self, out_path: Path):
        scene = trimesh.Scene()
        for lod in ('lod0', 'lod1', 'lod2'):
            scene.graph.update(lod, matrix=np.eye(4))
            for tag, list_m in sorted(self.buckets[lod].items()):
                merged = merge_meshes(list_m)
                if merged is not None:
                    scene.add_geometry(merged, node_name=f'{lod}_{tag}', geom_name=f'{lod}_{tag}_g', parent_node_name=lod)
        if self.signs:
            for sname, smesh in self.signs:
                scene.add_geometry(smesh, node_name=sname, geom_name=f'{sname}_g', parent_node_name='lod0')
        # Add instanced prototype nodes sharing one geometry object per (lod, proto_name)
        for idx, (lod, pname, mat) in enumerate(self.instances):
            proto = self.protos[(lod, pname)]
            scene.add_geometry(proto, node_name=f'{lod}_{pname}_{idx}', geom_name=f'proto_{lod}_{pname}',
                               parent_node_name=lod, transform=mat)
        if self.colliders:
            c_merged = merge_meshes(self.colliders)
            if c_merged is not None:
                scene.add_geometry(c_merged, node_name='collision_campus', geom_name='collision_campus_g')
        raw_glb = scene.export(file_type='glb', include_normals=True)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(_patch_glb_materials(raw_glb))


def _patch_glb_materials(raw: bytes) -> bytes:
    """Assign low-metallic matte/glass PBR materials to ColorVisuals primitives without material."""
    import json
    import struct

    magic, version, _ = struct.unpack('<III', raw[:12])
    assert magic == 0x46546C67 and version == 2
    json_len, json_type = struct.unpack('<II', raw[12:20])
    assert json_type == 0x4E4F534A
    gltf = json.loads(raw[20:20 + json_len].decode('utf-8'))
    rest = raw[20 + json_len:]

    mats = gltf.setdefault('materials', [])
    solid_idx = len(mats)
    mats.append({
        'name': 'h2_solid',
        'pbrMetallicRoughness': {
            'baseColorFactor': [1.0, 1.0, 1.0, 1.0],
            'metallicFactor': 0.04,
            'roughnessFactor': 0.88,
        },
    })
    glass_idx = len(mats)
    mats.append({
        'name': 'h2_glass',
        'pbrMetallicRoughness': {
            'baseColorFactor': [1.0, 1.0, 1.0, 1.0],
            'metallicFactor': 0.18,
            'roughnessFactor': 0.25,
        },
    })
    for mesh in gltf.get('meshes', []):
        is_glass = 'glass' in (mesh.get('name') or '').lower()
        for prim in mesh.get('primitives', []):
            if 'material' not in prim:
                prim['material'] = glass_idx if is_glass else solid_idx

    j_bytes = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    pad = (-len(j_bytes)) % 4
    j_bytes += b' ' * pad
    total_len = 12 + 8 + len(j_bytes) + len(rest)
    return struct.pack('<III', magic, version, total_len) + struct.pack('<II', len(j_bytes), json_type) + j_bytes + rest
