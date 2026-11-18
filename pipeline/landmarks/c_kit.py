"""Shared mesh and atlas helpers for M2.6 group C landmarks.

Textures are painted here (never from photos) and saved to
public/textures/landmarks/c/atlas.png. Rects below are measured from the top
of the atlas; packed UVs flip v, because three.js reads glTF v from the bottom.
"""
import math
from pathlib import Path

import mapbox_earcut
import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFont

ATLAS = 1024
ROOT = Path(__file__).resolve().parents[2]
TEX_DIR = ROOT / 'public' / 'textures' / 'landmarks' / 'c'

# Pixel rects (x, y, w, h), y from the top of the atlas.
RECTS = {
    'ashlar': (0, 0, 256, 256),
    'rubble': (256, 0, 256, 256),
    'graytile': (512, 0, 256, 256),
    'blacktile': (768, 0, 256, 256),
    'yellow': (0, 256, 256, 192),
    'cream': (256, 256, 256, 192),
    'vermilion': (512, 256, 256, 192),
    'door': (768, 256, 256, 128),
    'white': (768, 384, 256, 64),
    'wood': (0, 448, 256, 192),
    'lattice': (256, 448, 256, 192),
    'granite': (512, 448, 256, 192),
    'foliage': (768, 448, 256, 192),
    'bark': (0, 640, 128, 128),
    'steel': (128, 640, 128, 128),
    'glaze': (256, 640, 128, 128),
    'brick': (384, 640, 128, 128),
    'glass': (512, 640, 128, 128),
    'soffit': (640, 640, 128, 128),
    # Plaques are 512 px wide so three characters stay readable from about 10 m.
    'sign_gate': (0, 768, 512, 128),
    'sign_school': (512, 768, 512, 128),
    'sign_lib': (0, 896, 640, 128),
    'sign_kui': (640, 896, 192, 128),
    'sign_hotel': (832, 896, 192, 128),
}


def _font(size, bold=False):
    """CJK face for the plaques. The bitmap default font has no Chinese glyphs, so a miss is a hard error."""
    noto = '/usr/share/fonts/opentype/noto'
    candidates = []
    if bold:
        candidates.append(('/System/Library/Fonts/Supplemental/Songti.ttc', 0))
    candidates.extend((
        (f'{noto}/NotoSerifCJK-Bold.ttc', 2),
        (f'{noto}/NotoSansCJK-Bold.ttc', 2),
        (f'{noto}/NotoSerifCJK-Regular.ttc', 2),
        ('/System/Library/Fonts/Supplemental/Songti.ttc', 0 if bold else 1),
        ('/System/Library/Fonts/Hiragino Sans GB.ttc', 0),
        ('/System/Library/Fonts/STHeiti Medium.ttc', 0),
    ))
    for path, index in candidates:
        if not Path(path).exists():
            continue
        try:
            return ImageFont.truetype(path, size, index=index)
        except OSError:
            try:
                return ImageFont.truetype(path, size, index=0)
            except OSError:
                continue
    raise SystemExit(
        'c_kit: no CJK font for landmark signs. '
        'Need NotoSerifCJK-Bold.ttc (or Songti); refusing ImageFont.load_default().'
    )


def _fill(img, rect, color):
    x, y, w, h = rect
    img[y:y + h, x:x + w] = color


def _bricks(img, rect, color, mortar, bw, bh, seed, moss=0, shade=16, neutral=False):
    x, y, w, h = rect
    rng = np.random.default_rng(seed)
    patch = np.empty((h, w, 3), np.uint8)
    patch[:] = mortar
    row = 0
    yy = 0
    while yy < h:
        offset = bw // 2 if row % 2 else 0
        xx = -offset
        while xx < w:
            if neutral:
                delta = int(rng.integers(-shade, shade + 1))
                jitter = np.array([delta, delta, delta])
            else:
                jitter = rng.integers(-shade, shade + 1, 3)
            x0, x1 = max(0, xx + 2), min(w, xx + bw - 1)
            y0, y1 = min(h, yy + 2), min(h, yy + bh - 1)
            if x1 > x0 and y1 > y0:
                patch[y0:y1, x0:x1] = np.clip(np.array(color) + jitter, 0, 255)
            xx += bw
        if moss and row % 3 == 0 and not neutral:
            for _ in range(moss):
                mx = int(rng.integers(0, w))
                my = min(h - 1, yy + bh - 1)
                patch[max(0, my - 1):min(h, my + 2), max(0, mx - 2):min(w, mx + 3)] = (118, 122, 118)
        yy += bh
        row += 1
    if neutral and moss:
        for _ in range(moss * 3):
            sw, sh = int(rng.integers(14, 34)), int(rng.integers(8, 18))
            sx = int(rng.integers(0, max(1, w - sw)))
            sy = int(rng.integers(0, max(1, h - sh)))
            patch[sy:sy + sh, sx:sx + sw] = np.clip(patch[sy:sy + sh, sx:sx + sw].astype(np.int16) - 32, 0, 255)
    img[y:y + h, x:x + w] = patch


def _noise(img, rect, amount, seed):
    x, y, w, h = rect
    rng = np.random.default_rng(seed)
    img[y:y + h, x:x + w] = np.clip(img[y:y + h, x:x + w].astype(np.int16) + rng.integers(-amount, amount + 1, (h, w, 3)), 0, 255)


def _rubble(img, rect):
    x, y, w, h = rect
    rng = np.random.default_rng(9)
    patch = np.full((h, w, 3), (108, 104, 96), np.uint8)
    for _ in range(70):
        bw, bh = int(rng.integers(36, 78)), int(rng.integers(22, 48))
        sx, sy = int(rng.integers(0, max(1, w - bw))), int(rng.integers(0, max(1, h - bh)))
        color = np.clip(np.array([176, 172, 160]) + rng.integers(-14, 12, 3), 0, 255)
        patch[sy + 2:sy + bh - 1, sx + 2:sx + bw - 1] = color
        if rng.random() < 0.35:
            patch[sy + bh - 3:sy + bh, sx:sx + bw] = (96, 112, 74)
    img[y:y + h, x:x + w] = patch


def _tiles(img, rect, color, dark, seed):
    x, y, w, h = rect
    rng = np.random.default_rng(seed)
    patch = np.empty((h, w, 3), np.uint8)
    patch[:] = dark
    bh, bw = 14, 22
    row = 0
    yy = 0
    while yy < h:
        offset = bw // 2 if row % 2 else 0
        xx = -offset
        while xx < w:
            shade = rng.integers(-10, 11)
            x0, x1 = max(0, xx + 1), min(w, xx + bw - 2)
            y0, y1 = min(h, yy + 1), min(h, yy + bh - 3)
            if x1 > x0 and y1 > y0:
                patch[y0:y1, x0:x1] = np.clip(np.array(color) + shade, 0, 255)
            xx += bw
        yy += bh
        row += 1
    img[y:y + h, x:x + w] = patch


def _studs(img, rect, base, stud):
    x, y, w, h = rect
    patch = np.empty((h, w, 3), np.uint8)
    patch[:] = base
    for row in range(5):
        for col in range(7):
            cx = int((col + 0.5) * w / 7)
            cy = int((row + 0.5) * h / 5)
            patch[max(0, cy - 3):cy + 4, max(0, cx - 3):cx + 4] = stud
    img[y:y + h, x:x + w] = patch


def _lattice(img, rect, base, bar):
    x, y, w, h = rect
    patch = np.empty((h, w, 3), np.uint8)
    patch[:] = base
    for i in range(1, 6):
        yy = int(i * h / 6)
        patch[max(0, yy - 2):yy + 3, :] = bar
    for i in range(1, 6):
        xx = int(i * w / 6)
        patch[:, max(0, xx - 2):xx + 3] = bar
    img[y:y + h, x:x + w] = patch


def _foliage(img, rect):
    x, y, w, h = rect
    rng = np.random.default_rng(11)
    patch = np.zeros((h, w, 3), np.uint8)
    patch[:] = (32, 58, 34)
    yy, xx = np.mgrid[0:h, 0:w]
    for _ in range(18):
        cx, cy = rng.integers(0, w), rng.integers(0, h)
        rad = rng.integers(w // 10, w // 4)
        color = rng.integers((40, 80, 36), (110, 150, 70))
        mask = (xx - cx) ** 2 + (yy - cy) ** 2 < rad ** 2
        patch[mask] = color
    img[y:y + h, x:x + w] = patch


def _sign(img, rect, text, fill, bg, size):
    x, y, w, h = rect
    mode = Image.fromarray(img[y:y + h, x:x + w])
    draw = ImageDraw.Draw(mode)
    draw.rectangle((0, 0, w - 1, h - 1), fill=bg)
    font = _font(size, bold=True)
    box = draw.textbbox((0, 0), text, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    draw.text(((w - tw) / 2 - box[0], (h - th) / 2 - box[1]), text, font=font, fill=fill, stroke_width=max(1, size // 18), stroke_fill=fill)
    img[y:y + h, x:x + w] = np.asarray(mode)


def paint_atlas():
    """Programmatic atlas. Colors are sampled from the group-C reference photos.

    Sunlit 古南门 roof median on raw/refs/gunanmen/00-2021.jpg is #58595b, plaza #989389,
    plaque stone on 02-2019.jpg is #bbb9b7. Overcast door shadow is #482a31; the sunlit
    leaves read as vermilion #8e3034. Yellow wall patches fall in tree shade, so the
    ochre #d2ae58 is taken from the lit upper wall of 00-2021.jpg. 系舟亭 roof median
    on 03-2019.jpg is #393943, column shade #431a1d lifted to #9a3832. Library wall
    #adaaa6 and column #a7a4a1 from 01-2019.jpg. School beam #c9c8cb, 奎光楼 wood
    #7a4038 (03-2019 lattice shadow #593d32, brick #8b887f).
    """
    img = np.zeros((ATLAS, ATLAS, 3), np.uint8)
    # Neutral limestone, about 0.5 x 0.3 m at the bastion's 2.6 m tile. Brightness only, ±8%.
    _bricks(img, RECTS['ashlar'], (186, 186, 184), (158, 158, 156), 50, 30, 3, moss=5, shade=14, neutral=True)
    _rubble(img, RECTS['rubble'])
    _tiles(img, RECTS['graytile'], (104, 108, 110), (72, 74, 76), 4)
    _tiles(img, RECTS['blacktile'], (58, 60, 64), (36, 38, 42), 5)
    _fill(img, RECTS['yellow'], (210, 174, 88))
    _noise(img, RECTS['yellow'], 8, 6)
    _fill(img, RECTS['cream'], (228, 222, 208))
    _noise(img, RECTS['cream'], 6, 7)
    _fill(img, RECTS['vermilion'], (150, 48, 46))
    _noise(img, RECTS['vermilion'], 7, 8)
    _studs(img, RECTS['door'], (142, 48, 52), (196, 164, 92))
    _bricks(img, RECTS['white'], (246, 246, 244), (226, 226, 224), 48, 24, 21, shade=4, neutral=True)
    _fill(img, RECTS['wood'], (122, 64, 56))
    _noise(img, RECTS['wood'], 8, 12)
    _lattice(img, RECTS['lattice'], (62, 36, 32), (148, 86, 72))
    _bricks(img, RECTS['granite'], (174, 176, 172), (158, 160, 156), 48, 32, 15, shade=6)
    _foliage(img, RECTS['foliage'])
    _fill(img, RECTS['bark'], (92, 74, 56))
    _noise(img, RECTS['bark'], 12, 16)
    _fill(img, RECTS['steel'], (150, 158, 164))
    _noise(img, RECTS['steel'], 6, 17)
    _tiles(img, RECTS['glaze'], (78, 128, 96), (48, 82, 64), 18)
    _bricks(img, RECTS['brick'], (150, 148, 140), (196, 194, 186), 28, 14, 19)
    # Dark glass in daylight. Night glow stays on the window_lit material; the engine scales it.
    _fill(img, RECTS['glass'], (42, 50, 58))
    _lattice(img, RECTS['glass'], (42, 50, 58), (78, 86, 94))
    sx, sy, sw, sh = RECTS['soffit']
    soffit = np.empty((sh, sw, 3), np.uint8)
    for i in range(0, sh, 16):
        soffit[i:i + 8] = (168, 54, 48)
        soffit[i + 8:i + 16] = (236, 230, 220)
    img[sy:sy + sh, sx:sx + sw] = soffit
    _sign(img, RECTS['sign_gate'], '古南门', (24, 92, 70), (214, 212, 204), 78)
    _sign(img, RECTS['sign_school'], '桂林中学', (154, 36, 34), (244, 242, 236), 72)
    _sign(img, RECTS['sign_lib'], '图书馆榕湖分部', (138, 42, 40), (244, 240, 232), 48)
    _sign(img, RECTS['sign_kui'], '奎光楼', (244, 236, 220), (122, 64, 52), 36)
    _sign(img, RECTS['sign_hotel'], '榕湖饭店', (168, 42, 40), (244, 240, 232), 32)
    return Image.fromarray(img)


def ensure_textures(folder=None):
    image = paint_atlas()
    TEX_DIR.mkdir(parents=True, exist_ok=True)
    image.save(TEX_DIR / 'atlas.png')
    if folder is not None:
        image.save(Path(folder) / 'atlas.png')
    return image


class Mesh:
    def __init__(self):
        self.pos, self.nrm, self.uv, self.faces = [], [], [], []
        self.detail = True

    def __len__(self):
        return len(self.faces)

    def _push(self, p, n, uv):
        self.pos.append((float(p[0]), float(p[1]), float(p[2])))
        self.nrm.append((float(n[0]), float(n[1]), float(n[2])))
        self.uv.append((float(uv[0]), float(uv[1])))
        return len(self.pos) - 1

    def face(self, pts, outward, region, tile=None, uvs=None):
        pts = [np.asarray(p, np.float64) for p in pts]
        if len(pts) < 3:
            return
        normal = np.cross(pts[1] - pts[0], pts[2] - pts[0])
        length = np.linalg.norm(normal)
        if length < 1e-8:
            return
        normal /= length
        if np.dot(normal, np.asarray(outward, np.float64)) < 0:
            pts = list(reversed(pts))
            if uvs is not None:
                uvs = list(reversed(uvs))
            normal = -normal
        if uvs is not None:
            local = [(float(u), float(v)) for u, v in uvs]
        else:
            helper = np.array([0.0, 1.0, 0.0]) if abs(normal[1]) < 0.85 else np.array([1.0, 0.0, 0.0])
            tangent = np.cross(helper, normal)
            tangent /= np.linalg.norm(tangent)
            bitangent = np.cross(normal, tangent)
            raw = [(float(np.dot(p, tangent)), float(np.dot(p, bitangent))) for p in pts]
            if tile is None:
                us, vs = [u for u, _ in raw], [v for _, v in raw]
                minu, maxu, minv, maxv = min(us), max(us), min(vs), max(vs)
                du, dv = max(maxu - minu, 1e-6), max(maxv - minv, 1e-6)
                local = [((u - minu) / du, (v - minv) / dv) for u, v in raw]
            else:
                local = [(u / tile, v / tile) for u, v in raw]
        x, y, w, h = RECTS[region]

        def pack(u, v):
            if tile is not None or uvs is not None:
                u, v = u % 1.0, v % 1.0
            # three.js samples glTF UVs with v = 0 at the bottom of the image.
            return ((x + u * w) / ATLAS, 1.0 - (y + v * h) / ATLAS)

        packed = [pack(u, v) for u, v in local]
        for index in range(1, len(pts) - 1):
            tri = (0, index, index + 1)
            ids = [self._push(pts[k], normal, packed[k]) for k in tri]
            self.faces.append(ids)


def solid(mesh, center, size, region='granite', cell=1.8):
    """Collision box. Faces are split so a character controller cannot tunnel one huge triangle."""
    cx, cy, cz = (float(v) for v in center)
    sx, sy, sz = (float(v) for v in size)

    def quads(fixed_axis, fixed, u_axis, u0, u1, v_axis, v0, v1, outward):
        nu = max(1, math.ceil(abs(u1 - u0) / cell))
        nv = max(1, math.ceil(abs(v1 - v0) / cell))
        for i in range(nu):
            for j in range(nv):
                uu0 = u0 + (u1 - u0) * i / nu
                uu1 = u0 + (u1 - u0) * (i + 1) / nu
                vv0 = v0 + (v1 - v0) * j / nv
                vv1 = v0 + (v1 - v0) * (j + 1) / nv

                def at(u, v):
                    point = [cx, cy, cz]
                    point[fixed_axis] = fixed
                    point[u_axis] = u
                    point[v_axis] = v
                    return tuple(point)

                mesh.face([at(uu0, vv0), at(uu1, vv0), at(uu1, vv1), at(uu0, vv1)], outward, region, cell)

    quads(0, cx + sx / 2, 2, cz - sz / 2, cz + sz / 2, 1, cy - sy / 2, cy + sy / 2, (1, 0, 0))
    quads(0, cx - sx / 2, 2, cz + sz / 2, cz - sz / 2, 1, cy - sy / 2, cy + sy / 2, (-1, 0, 0))
    quads(1, cy + sy / 2, 0, cx - sx / 2, cx + sx / 2, 2, cz + sz / 2, cz - sz / 2, (0, 1, 0))
    quads(1, cy - sy / 2, 0, cx - sx / 2, cx + sx / 2, 2, cz - sz / 2, cz + sz / 2, (0, -1, 0))
    quads(2, cz + sz / 2, 0, cx - sx / 2, cx + sx / 2, 1, cy - sy / 2, cy + sy / 2, (0, 0, 1))
    quads(2, cz - sz / 2, 0, cx + sx / 2, cx - sx / 2, 1, cy - sy / 2, cy + sy / 2, (0, 0, -1))


def box(mesh, center, size, region, tile=1.6, stretch=False):
    cx, cy, cz = center
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    x0, x1, y0, y1, z0, z1 = cx - hx, cx + hx, cy - hy, cy + hy, cz - hz, cz + hz
    faces = [
        ([(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)], (0, 1, 0)),
        ([(x0, y0, z1), (x1, y0, z1), (x1, y0, z0), (x0, y0, z0)], (0, -1, 0)),
        ([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], (1, 0, 0)),
        ([(x0, y0, z1), (x0, y1, z1), (x0, y1, z0), (x0, y0, z0)], (-1, 0, 0)),
        ([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], (0, 0, 1)),
        ([(x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0)], (0, 0, -1)),
    ]
    scale = None if stretch else tile
    for pts, outward in faces:
        mesh.face(pts, outward, region, scale)


def yaw_box(mesh, center, size, yaw, region, tile=1.6):
    cx, cy, cz = center
    hx, hy, hz = (np.array(size) / 2).tolist()
    c, s = math.cos(yaw), math.sin(yaw)
    corners = []
    for x, y, z in ((-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
                    (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)):
        corners.append((cx + x * c + z * s, cy + y, cz - x * s + z * c))
    # indices matching a box: 0-1-2-3 bottom? defined as y-min first four with z- then z+
    quads = [
        (4, 5, 6, 7, (s, 0, c)),
        (1, 0, 3, 2, (-s, 0, -c)),
        (3, 7, 6, 2, (0, 1, 0)),
        (0, 1, 5, 4, (0, -1, 0)),
        (1, 2, 6, 5, (c, 0, -s)),
        (4, 7, 3, 0, (-c, 0, s)),
    ]
    for a, b, c0, d, outward in quads:
        mesh.face([corners[a], corners[b], corners[c0], corners[d]], outward, region, tile)


def cylinder(mesh, base, radius, height, region, sides=8, tile=1.2):
    cx, y0, cz = base
    y1 = y0 + height
    ring0, ring1 = [], []
    for i in range(sides):
        a = 2 * math.pi * i / sides
        ring0.append((cx + radius * math.cos(a), y0, cz + radius * math.sin(a)))
        ring1.append((cx + radius * math.cos(a), y1, cz + radius * math.sin(a)))
    for i in range(sides):
        j = (i + 1) % sides
        outward = ((ring0[i][0] + ring0[j][0]) / 2 - cx, 0, (ring0[i][2] + ring0[j][2]) / 2 - cz)
        mesh.face([ring0[i], ring0[j], ring1[j], ring1[i]], outward, region, tile)
    mesh.face(ring1, (0, 1, 0), region, tile)
    mesh.face(list(reversed(ring0)), (0, -1, 0), region, tile)


def tube(mesh, a, b, radius, region, sides=5):
    a, b = np.asarray(a, np.float64), np.asarray(b, np.float64)
    direction = b - a
    length = np.linalg.norm(direction)
    if length < 1e-4:
        return
    direction /= length
    helper = np.array([0.0, 1.0, 0.0]) if abs(direction[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    tangent = np.cross(helper, direction)
    tangent /= np.linalg.norm(tangent)
    bitangent = np.cross(direction, tangent)
    rings = []
    for origin in (a, b):
        ring = []
        for i in range(sides):
            angle = 2 * math.pi * i / sides
            ring.append(origin + radius * math.cos(angle) * tangent + radius * math.sin(angle) * bitangent)
        rings.append(ring)
    for i in range(sides):
        j = (i + 1) % sides
        mid = (rings[0][i] + rings[0][j] + rings[1][j] + rings[1][i]) / 4
        outward = mid - (a + b) / 2
        mesh.face([rings[0][i], rings[0][j], rings[1][j], rings[1][i]], outward, region, 0.8)


def extrude(mesh, polygon, y0, y1, region, tile=1.8):
    """Extrude an x/z polygon. CCW when viewed from above."""
    coords = np.asarray(polygon, np.float64)
    if len(coords) < 3:
        return
    rings = np.array([len(coords)], np.uint32)
    triangles = mapbox_earcut.triangulate_float64(coords, rings).reshape(-1, 3)
    top = [(x, y1, z) for x, z in coords]
    bottom = [(x, y0, z) for x, z in coords]
    for tri in triangles:
        mesh.face([top[i] for i in tri], (0, 1, 0), region, tile)
        mesh.face([bottom[i] for i in tri[::-1]], (0, -1, 0), region, tile)
    for i, a in enumerate(coords):
        b = coords[(i + 1) % len(coords)]
        outward = (a[1] - b[1], 0, b[0] - a[0])
        mesh.face([(a[0], y0, a[1]), (b[0], y0, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1])], outward, region, tile)


def arch_wall(mesh, center, width, height, thick, arch_w, arch_h, region, segments=10, tile=1.3):
    """Wall along X, front toward +Z. `center` is the base center. Opening is empty."""
    ox, oy, oz = center
    radius = arch_w / 2
    spring = oy + arch_h - radius
    left, right = ox - width / 2, ox + width / 2
    inner_l, inner_r = ox - arch_w / 2, ox + arch_w / 2
    z0, z1 = oz - thick / 2, oz + thick / 2
    y1 = oy + height
    box(mesh, ((left + inner_l) / 2, oy + height / 2, oz), (inner_l - left, height, thick), region, tile)
    box(mesh, ((right + inner_r) / 2, oy + height / 2, oz), (right - inner_r, height, thick), region, tile)
    for i in range(segments):
        a0 = math.pi - math.pi * i / segments
        a1 = math.pi - math.pi * (i + 1) / segments
        x0, y_a = ox + radius * math.cos(a0), spring + radius * math.sin(a0)
        x1, y_b = ox + radius * math.cos(a1), spring + radius * math.sin(a1)
        mesh.face([(x0, y_a, z1), (x1, y_b, z1), (x1, y1, z1), (x0, y1, z1)], (0, 0, 1), region, tile)
        mesh.face([(x1, y_b, z0), (x0, y_a, z0), (x0, y1, z0), (x1, y1, z0)], (0, 0, -1), region, tile)
        mesh.face([(x0, y_a, z1), (x0, y_a, z0), (x1, y_b, z0), (x1, y_b, z1)], (0, -1, 0), region, tile)
        mesh.face([(x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0)], (0, 1, 0), region, tile)


def segment_wall(mesh, a, b, y0, y1, thick, region):
    a, b = np.asarray(a, np.float64), np.asarray(b, np.float64)
    delta = b - a
    length = np.linalg.norm(delta)
    if length < 1e-3:
        return
    direction = delta / length
    side = np.array([-direction[1], direction[0]])
    outer0, outer1 = a + side * thick / 2, b + side * thick / 2
    inner0, inner1 = a - side * thick / 2, b - side * thick / 2
    mesh.face([(outer0[0], y0, outer0[1]), (outer1[0], y0, outer1[1]), (outer1[0], y1, outer1[1]), (outer0[0], y1, outer0[1])],
              (side[0], 0, side[1]), region, 1.3)
    mesh.face([(inner1[0], y0, inner1[1]), (inner0[0], y0, inner0[1]), (inner0[0], y1, inner0[1]), (inner1[0], y1, inner1[1])],
              (-side[0], 0, -side[1]), region, 1.3)
    mesh.face([(outer0[0], y1, outer0[1]), (outer1[0], y1, outer1[1]), (inner1[0], y1, inner1[1]), (inner0[0], y1, inner0[1])],
              (0, 1, 0), region, 1.3)


def _course(mesh, quad, outward, region, along):
    """Tile rows run along `along` (metres per repeat) and up the slope."""
    pts = [np.asarray(p, np.float64) for p in quad]
    span = np.linalg.norm(pts[1] - pts[0])
    climb = np.linalg.norm(pts[3] - pts[0])
    u = max(span / 0.46, 0.4)
    v = max(climb / 0.32, 0.4)
    mesh.face(quad, outward, region, uvs=[(0, 0), (u, 0), (u, v), (0, v)])
    del along


def _fascia(mesh, a, b, drop, region):
    """Outward board under one eave segment. Thickness keeps the corner from reading as a spike."""
    a, b = np.asarray(a, np.float64), np.asarray(b, np.float64)
    edge = b - a
    edge[1] = 0.0
    length = float(np.linalg.norm(edge))
    if length < 1e-4:
        return
    tangent = edge / length
    outward = np.array([-tangent[2], 0.0, tangent[0]])
    thick = 0.16
    down = np.array([0.0, -drop, 0.0])
    shift = outward * thick
    ao, bo = a + shift, b + shift
    mesh.face([ao, bo, bo + down, ao + down], outward, region, 0.55)
    mesh.face([ao + down, bo + down, b + down, a + down], (0, -1, 0), region, 0.45)
    mesh.face([a, b, bo, ao], (0, 1, 0), region, 0.4)


def _ceiling(mesh, quad):
    """Wooden 望板 just under a roof slope, facing down, so the eave is not a culled hole."""
    pts = [np.asarray(p, np.float64) + np.array([0.0, -0.08, 0.0]) for p in quad]
    a, b, c, d = pts
    mesh.face([a, d, c, b], (0, -1, 0), 'wood', 0.8)


def _soffit(mesh, a, b, center, reach):
    """Underside of the overhang, so the eave has depth when seen from below."""
    a, b = np.asarray(a, np.float64), np.asarray(b, np.float64)
    mid = (a + b) / 2
    inward = np.array([center[0] - mid[0], 0.0, center[1] - mid[2]])
    norm = float(np.linalg.norm(inward))
    if norm < 1e-4:
        return
    inward = inward / norm * min(reach, 0.9)
    drop = np.array([0.0, -0.05, 0.0])
    shift = np.array([inward[0], 0.0, inward[2]])
    mesh.face([a + drop, b + drop, b + drop + shift, a + drop + shift], (0, -1, 0), 'soffit', 0.4)


def _chiwen(mesh, origin, direction, region):
    """Simplified 吻兽: three blocks stepping up and out from the ridge end."""
    ox, oy, oz = origin
    dx, dz = direction
    box(mesh, (ox + dx * 0.2, oy + 0.55, oz + dz * 0.2), (0.46, 1.05, 0.34), region, 0.35)
    box(mesh, (ox + dx * 0.62, oy + 1.2, oz + dz * 0.62), (0.34, 0.7, 0.26), region, 0.3)
    box(mesh, (ox + dx * 0.98, oy + 1.65, oz + dz * 0.98), (0.24, 0.4, 0.2), region, 0.25)


def xieshan(mesh, center, y, width, depth, rise, overhang, lift, tile_region, fascia_region, tiers=1, gable_region='wood', sides=4, ceiling=False):
    """Traditional roof shared by the C-group landmarks.

    Rectangular plan is a 歇山顶: four lower slopes, then a gable (山花) and a
    ridge with a horn at each end. `sides=6` is a hexagonal pavilion roof.
    Corners of the eave are lifted 0.4–0.8 m. `tiers=2` stacks a smaller upper roof.
    """
    lift = float(min(0.8, max(0.4, lift)))
    if not getattr(mesh, 'detail', True):
        tiers = 1
    for tier in range(max(1, tiers)):
        scale = 0.74 ** tier
        _one_roof(
            mesh, center, y + tier * rise * 0.78, width * scale, depth * scale,
            rise * (0.7 if tier else 1), overhang * scale, lift, tile_region, fascia_region, gable_region, sides, ceiling,
        )


def _one_roof(mesh, center, y, width, depth, rise, overhang, lift, tile_region, fascia_region, gable_region, sides, ceiling=False):
    x, z = center
    if sides >= 6:
        _hex_roof(mesh, center, y, min(width, depth) / 2 + overhang, rise, lift, tile_region, fascia_region)
        return
    hw, hd = width / 2 + overhang, depth / 2 + overhang
    detail = getattr(mesh, 'detail', True)
    segments = (8 if min(hw, hd) >= 3.2 else 5) if detail else 2

    def edge(p0, p1):
        pts = []
        for i in range(segments + 1):
            t = i / segments
            point = p0 * (1 - t) + p1 * t
            corner = min(t, 1 - t) / 0.16
            point[1] = y + lift * max(0.0, 1 - corner) ** 2
            pts.append(point)
        return pts

    south = edge(np.array([x - hw, y, z + hd]), np.array([x + hw, y, z + hd]))
    east = edge(np.array([x + hw, y, z + hd]), np.array([x + hw, y, z - hd]))
    north = edge(np.array([x + hw, y, z - hd]), np.array([x - hw, y, z - hd]))
    west = edge(np.array([x - hw, y, z - hd]), np.array([x - hw, y, z + hd]))
    if detail:
        for ring in (south, east, north, west):
            for a, b in zip(ring, ring[1:]):
                _fascia(mesh, a, b, 0.46, fascia_region)
                if not ceiling:
                    _soffit(mesh, a, b, (x, z), overhang * 0.9)
    # 收山: hips stop and the gable starts, far enough in that the 山花 reads.
    gy = y + rise * 0.5
    ix, iz = max(hw * 0.46, hw - 2.6), hd * 0.34
    ring_top = {
        's': (np.array([x - ix, gy, z + iz]), np.array([x + ix, gy, z + iz])),
        'n': (np.array([x + ix, gy, z - iz]), np.array([x - ix, gy, z - iz])),
        'e': (np.array([x + ix, gy, z + iz]), np.array([x + ix, gy, z - iz])),
        'w': (np.array([x - ix, gy, z - iz]), np.array([x - ix, gy, z + iz])),
    }
    for name, ring in (('s', south), ('e', east), ('n', north), ('w', west)):
        top0, top1 = ring_top[name]
        outward = {'s': (0, rise, hd), 'n': (0, rise, -hd), 'e': (hw, rise, 0), 'w': (-hw, rise, 0)}[name]
        for i in range(segments):
            t0, t1 = i / segments, (i + 1) / segments
            a, b = ring[i], ring[i + 1]
            c = top0 * (1 - t1) + top1 * t1
            d = top0 * (1 - t0) + top1 * t0
            _course(mesh, [a, b, c, d], outward, tile_region, 0.46)
            if ceiling:
                _ceiling(mesh, [a, b, c, d])
    ridge_y = y + rise
    half = ix * 0.96
    rw, re = np.array([x - half, ridge_y, z]), np.array([x + half, ridge_y, z])
    s0, s1 = ring_top['s']
    n0, n1 = ring_top['n']
    _course(mesh, [s0, s1, re, rw], (0, rise, iz), tile_region, 0.46)
    _course(mesh, [n1, n0, rw, re], (0, rise, -iz), tile_region, 0.46)
    if ceiling:
        _ceiling(mesh, [s0, s1, re, rw])
        _ceiling(mesh, [n1, n0, rw, re])
    # 山花, the vertical triangle on each gable end.
    mesh.face([ring_top['e'][0], ring_top['e'][1], re], (1, 0, 0), gable_region, None)
    mesh.face([ring_top['w'][0], ring_top['w'][1], rw], (-1, 0, 0), gable_region, None)
    if detail:
        span = float(np.linalg.norm(re - rw))
        box(mesh, ((rw[0] + re[0]) / 2, ridge_y + 0.18, z), (span, 0.36, 0.42), tile_region, 0.45)
        _chiwen(mesh, re, (1, 0), tile_region)
        _chiwen(mesh, rw, (-1, 0), tile_region)


def _hex_roof(mesh, center, y, radius, rise, lift, tile_region, fascia_region):
    x, z = center
    corners = []
    for i in range(6):
        angle = math.pi / 6 + i * math.pi / 3
        corners.append(np.array([x + radius * math.cos(angle), y, z + radius * math.sin(angle)]))
    edges = []
    for i, a in enumerate(corners):
        b = corners[(i + 1) % 6]
        steps = 4 if getattr(mesh, 'detail', True) else 2
        pts = []
        for step in range(steps):
            t = step / (steps - 1)
            point = a * (1 - t) + b * t
            corner = min(t, 1 - t) / 0.16
            point[1] = y + lift * max(0.0, 1 - corner) ** 2
            pts.append(point)
        edges.append(pts)
        if getattr(mesh, 'detail', True):
            for p, q in zip(pts, pts[1:]):
                _fascia(mesh, p, q, 0.4, fascia_region)
                _soffit(mesh, p, q, (x, z), radius * 0.28)
    apex = np.array([x, y + rise, z])
    for pts in edges:
        for p, q in zip(pts, pts[1:]):
            span = np.linalg.norm(q - p)
            climb = np.linalg.norm(apex - (p + q) / 2)
            mesh.face([p, q, apex], q + p - 2 * np.array([x, y, z]), tile_region,
                      uvs=[(0, 0), (max(span / 0.46, 0.4), 0), (max(span / 0.92, 0.2), max(climb / 0.32, 0.4))])
    box(mesh, (x, y + rise + 0.28, z), (0.28, 0.5, 0.28), tile_region, 0.3)


def hip_roof(mesh, center, y, width, depth, rise, overhang, lift, tile_region, soffit_region, tiers=1, sides=4, ceiling=False):
    xieshan(
        mesh, center, y, width, depth, rise, overhang, lift, tile_region, soffit_region,
        tiers=tiers, sides=sides, ceiling=ceiling,
    )


def railing(mesh, a, b, y, height, region, post=0.8, stone=False):
    a, b = np.asarray(a, np.float64), np.asarray(b, np.float64)
    delta = b - a
    length = np.linalg.norm(delta)
    if length < 0.2:
        return
    direction = delta / length
    count = max(2, int(length / post) + 1)
    yaw = math.atan2(-direction[1], direction[0])
    mid = (a + b) / 2
    if stone:
        for i in range(count):
            p = a + delta * (i / (count - 1))
            box(mesh, (p[0], y + height * 0.42, p[1]), (0.26, height * 0.84, 0.26), region, 0.4)
            box(mesh, (p[0], y + height - 0.08, p[1]), (0.4, 0.16, 0.4), region, 0.3)
        yaw_box(mesh, (mid[0], y + height - 0.02, mid[1]), (length, 0.2, 0.28), yaw, region, 0.6)
        return
    for i in range(count):
        p = a + delta * (i / (count - 1))
        box(mesh, (p[0], y + height * 0.45, p[1]), (0.12, height * 0.9, 0.12), region, 0.5)
    yaw_box(mesh, (mid[0], y + height - 0.06, mid[1]), (length, 0.1, 0.1), yaw, region, 0.8)
    yaw_box(mesh, (mid[0], y + 0.28, mid[1]), (length, 0.08, 0.08), yaw, region, 0.8)


def stairs(mesh, a, b, width, count, region):
    a, b = np.asarray(a, np.float64), np.asarray(b, np.float64)
    for i in range(count):
        p0 = a + (b - a) * (i / count)
        p1 = a + (b - a) * ((i + 1) / count)
        mid = (p0 + p1) / 2
        mid[1] = p1[1] - (p1[1] - p0[1]) / 2
        step = p1 - p0
        yaw = math.atan2(step[0], step[2])
        yaw_box(mesh, mid, (width, p1[1] - p0[1], np.linalg.norm(step[[0, 2]]) + 0.02), yaw, region, 0.6)


def ramp(mesh, a, b, width, thickness=0.28):
    a, b = np.asarray(a, np.float64), np.asarray(b, np.float64)
    direction = b - a
    flat = direction.copy()
    flat[1] = 0
    length = np.linalg.norm(flat)
    if length < 1e-3:
        return
    side = np.cross(direction, [0, 1, 0])
    side = side / np.linalg.norm(side) * (width / 2)
    normal = np.cross(side, direction)
    normal = normal / np.linalg.norm(normal) * thickness
    if normal[1] < 0:
        normal = -normal
    c0, c1, c2, c3 = a + side, a - side, b - side, b + side
    mesh.face([c0, c1, c2, c3], (0, 1, 0), 'granite', 1.0)
    mesh.face([c0 - normal, c3 - normal, c2 - normal, c1 - normal], (0, -1, 0), 'granite', 1.0)


def _canopy(mesh, center, rx, ry, rz, region, bands, segments):
    """One flattened crown. Wider than it is tall, not a stack of balls."""
    cx, cy, cz = center
    rings = []
    for i in range(bands + 1):
        v = i / bands
        lat = math.radians(-18 + 100 * v)
        rad_y = math.sin(lat)
        rad_h = math.cos(lat)
        ring = []
        for j in range(segments):
            u = j / segments * math.tau
            ring.append((cx + rx * rad_h * math.cos(u), cy + ry * rad_y, cz + rz * rad_h * math.sin(u)))
        rings.append(ring)
    for i in range(bands):
        for j in range(segments):
            k = (j + 1) % segments
            mesh.face([rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j]],
                      np.mean([rings[i][j], rings[i + 1][k]], axis=0) - np.array(center), region, 2.4)


def banyan(mesh, origin, height, crown, seed, detail):
    rng = np.random.default_rng(seed)
    x, y, z = origin
    spread = max(crown, height * 0.95)
    trunk_h = height * 0.38
    cylinder(mesh, (x, y, z), 0.62 * (height / 14), trunk_h, 'bark', 8 if detail else 5, 1.4)
    if not detail:
        return
    crown_h = spread * 0.36
    _canopy(mesh, (x, y + trunk_h + crown_h * 0.31, z), spread * 0.92, crown_h, spread * 0.78, 'foliage', 6, 14)
    branch_y = y + trunk_h + crown_h * 0.42
    count = 16
    for n in range(count):
        angle = n / count * math.tau + float(rng.uniform(-0.08, 0.08))
        reach = spread * float(rng.uniform(0.42, 0.78))
        tip = np.array([x + math.cos(angle) * reach, branch_y - 0.15, z + math.sin(angle) * reach])
        root = np.array([x + math.cos(angle) * 0.35, branch_y, z + math.sin(angle) * 0.35])
        tube(mesh, root, tip, 0.07, 'bark', 4)
        thick = n < 3
        radius = 0.16 if thick else 0.04
        drop = branch_y - y if thick else branch_y * 0 + float(rng.uniform(1.4, trunk_h * 0.7))
        tube(mesh, tip, (tip[0], tip[1] - drop, tip[2]), radius, 'bark', 5 if thick else 4)


def star(mesh, center, radius, depth, region):
    cx, cy, cz = center
    pts = []
    for i in range(10):
        angle = math.pi / 2 + i * math.pi / 5
        rad = radius if i % 2 == 0 else radius * 0.4
        pts.append((cx + rad * math.cos(angle), cy + rad * math.sin(angle)))
    z0, z1 = cz - depth / 2, cz + depth / 2
    mesh.face([(x, y, z1) for x, y in pts], (0, 0, 1), region, None)
    mesh.face([(x, y, z0) for x, y in reversed(pts)], (0, 0, -1), region, None)


def grille(mesh, x, y, z, w, h, region, bars=3, depth=0.06):
    """Lattice in a rectangle facing +Z. Frame plus bars, so the opening still reads as a window."""
    t = 0.06
    box(mesh, (x, y + h / 2, z), (w, t, depth), region, 0.4)
    box(mesh, (x, y - h / 2, z), (w, t, depth), region, 0.4)
    box(mesh, (x - w / 2, y, z), (t, h, depth), region, 0.4)
    box(mesh, (x + w / 2, y, z), (t, h, depth), region, 0.4)
    for i in range(1, bars + 1):
        box(mesh, (x - w / 2 + w * i / (bars + 1), y, z), (t * 0.7, h - t, depth * 0.6), region, 0.3)
        box(mesh, (x, y - h / 2 + h * i / (bars + 1), z), (w - t, t * 0.7, depth * 0.6), region, 0.3)


def ring(mesh, center, outer, inner, region, axis='z', sides=14):
    cx, cy, cz = center
    outward = (0, 0, 1) if axis == 'z' else (1, 0, 0)

    def at(radius, angle):
        if axis == 'z':
            return (cx + radius * math.cos(angle), cy + radius * math.sin(angle), cz)
        return (cx, cy + radius * math.sin(angle), cz + radius * math.cos(angle))

    for i in range(sides):
        a0, a1 = 2 * math.pi * i / sides, 2 * math.pi * (i + 1) / sides
        mesh.face([at(outer, a0), at(outer, a1), at(inner, a1), at(inner, a0)], outward, region, None)


def disc(mesh, center, radius, region, sides=12, axis='z'):
    cx, cy, cz = center
    ring_pts = []
    for i in range(sides):
        angle = 2 * math.pi * i / sides
        if axis == 'z':
            ring_pts.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle), cz))
        else:
            ring_pts.append((cx, cy + radius * math.sin(angle), cz + radius * math.cos(angle)))
    mesh.face(ring_pts, (0, 0, 1) if axis == 'z' else (1, 0, 0), region, None)


class Builder:
    def __init__(self, lod, collide=False):
        self.lod = lod
        self.collide = collide
        self.parts = {'atlas': Mesh(), 'lit': Mesh(), 'steel': Mesh()}
        self.hit = Mesh()
        for part in self.parts.values():
            part.detail = self.lod == 0

    @property
    def detail(self):
        return self.lod == 0


def _material(image, name, emissive, metallic, roughness):
    material = trimesh.visual.material.PBRMaterial(
        name=name, baseColorTexture=image, metallicFactor=float(metallic),
        roughnessFactor=float(roughness), emissiveFactor=list(emissive), doubleSided=False,
    )
    if any(emissive):
        material.emissiveTexture = image
    return material


def _trimesh_of(mesh, image, name, emissive, metallic, roughness):
    if not mesh.faces:
        return None
    geometry = trimesh.Trimesh(
        vertices=np.asarray(mesh.pos, np.float32), faces=np.asarray(mesh.faces, np.int64),
        vertex_normals=np.asarray(mesh.nrm, np.float32), process=False,
    )
    geometry.visual = trimesh.visual.TextureVisuals(
        uv=np.asarray(mesh.uv, np.float32),
        material=_material(image, name, emissive, metallic, roughness),
    )
    return geometry


SPECS = {
    'atlas': ('landmark', (0, 0, 0), 0.0, 0.88),
    'lit': ('window_lit', (0.45, 0.28, 0.12), 0.0, 0.42),
    'steel': ('steel', (0, 0, 0), 0.7, 0.38),
}


def export_landmark(path, image, builders):
    """builders is ((lod_name, Builder), ...). Collision comes from the first builder."""
    scene = trimesh.Scene()
    base = scene.graph.base_frame
    for name, builder in builders:
        scene.graph.update(frame_from=base, frame_to=name)
        for key, (mat_name, emissive, metallic, roughness) in SPECS.items():
            geometry = _trimesh_of(builder.parts[key], image, mat_name, emissive, metallic, roughness)
            if geometry is not None:
                scene.add_geometry(geometry, node_name=f'{name}_{key}', parent_node_name=name)
    hit = _trimesh_of(builders[0][1].hit, image, 'collision_mat', (0, 0, 0), 0, 1)
    if hit is not None:
        scene.add_geometry(hit, node_name='collision_body')
    scene.export(path)
    return scene


def tri_count(builder):
    return sum(len(mesh) for mesh in builder.parts.values())
