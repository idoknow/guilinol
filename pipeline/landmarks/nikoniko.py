"""Guilin Weixiaotang Plaza (桂林微笑堂商厦), OSM way/253743030 (~109 x 99 m).

Position, footprint and orientation follow OSM way/253743030 anchored at its
polygon centroid (-974.91, -121.59). Heights are estimated from 1.7 m
pedestrians and 4.2 m double-decker buses in 2019 Wikimedia Commons (CC0) and
2024 aerial/street views: 6-storey retail wings 23.6 m (ground 4.8 m + five
3.76 m upper floors), flanking silver-grey aluminum stair pylons 27.0 m,
stepped corner glass cylinder 30.2 m, and white rooftop crown sign drum 35.0 m.

Shared Group-B procedural textures (public/textures/landmarks/B/) sample hues
from reference photos while keeping low-saturation harmony with docs/style.md:
- curtain_glass.png: #3c657a..#6791a5 blue-teal curtain glass, #283f4d spandrel
- plaza_pave.png: #b4b2aa / #9ea1a4 staggered granite & bluestone slabs
- shop_brick.png: #aba8a0 / #7c848c ashlar limestone & grey masonry courses
- surfaces.png: 1024x1024 4x4 procedural swatch sheet (aluminum #c7ccd0,
  warm white #eae5db, beige stone #d5cab7, dark granite #44494e, Shizijie red
  #b84a42 & yellow #cfa346 pavements, redwood #694435, cinnabar #b53b32,
  municipal sign blue #2d5f9a, LED screen #1f262e, camphor foliage #395f34 /
  #5b803d, standing-seam roof #5c6468, terracotta #a96e5b, karst stone #9e9686,
  streetlamp bronze #52584f).
"""
from pathlib import Path
import math
import sys

import mapbox_earcut
import numpy as np
from PIL import Image, ImageDraw
import trimesh


SWATCHES = dict(
    alum='#c7ccd0',
    white='#eae5db',
    beige='#d5cab7',
    dark='#44494e',
    red_pave='#b84a42',
    yellow_pave='#cfa346',
    wood='#694435',
    red='#b53b32',
    blue='#2d5f9a',
    screen='#1f262e',
    leaf='#395f34',
    hedge='#5b803d',
    roof='#5c6468',
    terra='#a96e5b',
    karst='#9e9686',
    bronze='#52584f',
)


def _rgb(hex_color):
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i + 2], 16) for i in (0, 2, 4))


def _clamp_img(arr):
    return Image.fromarray(np.uint8(np.clip(arr, 0, 255)))


def build_surfaces_sheet():
    rng = np.random.default_rng(20261901)
    sheet = Image.new('RGB', (1024, 1024))
    for idx, (key, hex_col) in enumerate(SWATCHES.items()):
        base = _rgb(hex_col)
        panel = Image.new('RGB', (256, 256), base)
        draw = ImageDraw.Draw(panel)
        if key == 'alum':
            for y in range(0, 256, 32):
                draw.line((0, y, 255, y), fill=(168, 174, 180), width=2)
            for x in range(0, 256, 64):
                draw.line((x, 0, x, 255), fill=(172, 178, 184), width=2)
                for y in range(16, 256, 32):
                    draw.rectangle((x + 4, y - 10, x + 60, y + 10), outline=(210, 215, 220), width=1)
        elif key in ('white', 'beige', 'terra'):
            step = 16 if key == 'white' else 24
            joint = tuple(max(0, c - 18) for c in base)
            for y in range(0, 256, step):
                draw.line((0, y, 255, y), fill=joint, width=1)
                for x in range((y // step % 2) * 24, 256, 48):
                    shade = int(rng.integers(-6, 7))
                    col = tuple(np.clip(c + shade, 0, 255) for c in base)
                    draw.rectangle((x + 1, y + 1, x + 46, y + step - 1), fill=col)
        elif key == 'dark':
            for y in range(0, 256, 32):
                draw.line((0, y, 255, y), fill=(52, 56, 60), width=2)
                for x in range(0, 256, 64):
                    shade = int(rng.integers(-8, 9))
                    col = tuple(np.clip(c + shade, 0, 255) for c in base)
                    draw.rectangle((x + 2, y + 2, x + 62, y + 30), fill=col)
        elif key in ('red_pave', 'yellow_pave'):
            for _ in range(380):
                px, py = int(rng.integers(0, 254)), int(rng.integers(0, 254))
                shade = int(rng.integers(-14, 15))
                draw.rectangle((px, py, px + 2, py + 2), fill=tuple(np.clip(c + shade, 0, 255) for c in base))
            if key == 'yellow_pave':
                for y in range(12, 256, 24):
                    for x in range(12, 256, 24):
                        draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill=(224, 182, 84))
        elif key == 'wood':
            for x in range(0, 256, 16):
                shade = int(rng.integers(-10, 10))
                col = tuple(np.clip(c + shade, 0, 255) for c in base)
                draw.rectangle((x, 0, x + 14, 255), fill=col)
                draw.line((x + 15, 0, x + 15, 255), fill=(72, 44, 34), width=2)
        elif key == 'blue':
            draw.rectangle((10, 10, 245, 245), outline=(238, 242, 246), width=5)
            draw.line((10, 172, 245, 172), fill=(238, 242, 246), width=3)
        elif key == 'screen':
            for y in range(24, 232):
                t = (y - 24) / 208.0
                r = int(38 + 75 * math.sin(t * math.pi) ** 2)
                g = int(52 + 68 * (1 - abs(t - 0.45)))
                b = int(74 + 72 * (1 - t * 0.6))
                draw.line((18, y, 238, y), fill=(r, g, b))
            for y in range(24, 232, 4):
                draw.line((18, y, 238, y), fill=(24, 30, 38), width=1)
            draw.rectangle((8, 8, 247, 247), outline=(36, 40, 45), width=10)
        elif key in ('leaf', 'hedge'):
            for _ in range(260):
                cx, cy = int(rng.integers(0, 256)), int(rng.integers(0, 256))
                rad = int(rng.integers(6, 18))
                shade = int(rng.integers(-18, 20))
                col = tuple(np.clip(c + shade, 0, 255) for c in base)
                draw.ellipse((cx - rad, cy - rad, cx + rad, cy + rad), fill=col)
        elif key == 'roof':
            for x in range(0, 256, 12):
                draw.line((x, 0, x, 255), fill=(72, 79, 83), width=2)
                draw.line((x + 2, 0, x + 2, 255), fill=(108, 116, 120), width=1)
        elif key == 'karst':
            for x in range(0, 256, 6):
                streak = int(rng.integers(-28, 12))
                col = tuple(np.clip(c + streak, 0, 255) for c in base)
                draw.line((x, 0, x + int(rng.integers(-4, 5)), 255), fill=col, width=4)
        arr = np.asarray(panel, dtype=float) + rng.normal(0, 2.5, (256, 256, 1))
        sheet.paste(_clamp_img(arr), ((idx % 4) * 256, (idx // 4) * 256))
    return sheet


def build_curtain_glass():
    rng = np.random.default_rng(20261902)
    arr = np.zeros((512, 512, 3), dtype=float)
    y_grid, x_grid = np.mgrid[0:512, 0:512]
    # Subtle sky-reflection gradient across glass panes + diagonal sheen
    t = (y_grid % 128) / 128.0
    sheen = 0.5 + 0.5 * np.sin((x_grid * 0.7 + y_grid * 0.45) * 2 * math.pi / 256.0)
    arr[..., 0] = 58 + 28 * (1 - t) + 14 * sheen
    arr[..., 1] = 98 + 32 * (1 - t) + 16 * sheen
    arr[..., 2] = 118 + 34 * (1 - t) + 16 * sheen
    # Spandrel dark band at each floor slab (top 22 px of every 128 px floor)
    spandrel = (y_grid % 128) < 22
    arr[spandrel] = [40, 63, 77]
    arr += rng.normal(0, 1.8, (512, 512, 1))
    img = _clamp_img(arr)
    draw = ImageDraw.Draw(img)
    # Aluminum mullions (every 64 px) and floor transoms (every 128 px)
    for x in range(0, 512, 64):
        draw.line((x, 0, x, 511), fill=(176, 184, 190), width=3)
        draw.line((x + 2, 0, x + 2, 511), fill=(118, 128, 136), width=1)
    for y in range(0, 512, 128):
        draw.rectangle((0, y, 511, y + 4), fill=(186, 192, 198))
        draw.line((0, y + 22, 511, y + 22), fill=(154, 164, 170), width=2)
    return img


def build_plaza_pave():
    rng = np.random.default_rng(20261903)
    img = Image.new('RGB', (512, 512), (168, 168, 162))
    draw = ImageDraw.Draw(img)
    h = 32
    w = 64
    for row in range(512 // h):
        y0 = row * h
        offset = (row % 2) * (w // 2)
        for col in range(-1, 512 // w + 1):
            x0 = col * w + offset
            tone = 178 if (row + col) % 3 else 160
            jitter = int(rng.integers(-8, 9))
            rgb = (tone + jitter + 2, tone + jitter + 1, tone + jitter - 2)
            draw.rectangle((x0 + 2, y0 + 2, x0 + w - 1, y0 + h - 1), fill=rgb)
            draw.line((x0, y0, x0 + w, y0), fill=(132, 134, 132), width=2)
            draw.line((x0, y0, x0, y0 + h), fill=(132, 134, 132), width=2)
    arr = np.asarray(img, dtype=float) + rng.normal(0, 3.2, (512, 512, 1))
    return _clamp_img(arr)


def build_shop_brick():
    rng = np.random.default_rng(20261904)
    img = Image.new('RGB', (512, 512), (176, 174, 166))
    draw = ImageDraw.Draw(img)
    h = 32
    w = 64
    for row in range(512 // h):
        y0 = row * h
        offset = (row % 2) * (w // 2)
        for col in range(-1, 512 // w + 1):
            x0 = col * w + offset
            shade = int(rng.integers(-11, 12))
            base = (166 + shade, 165 + shade, 158 + shade)
            draw.rectangle((x0 + 2, y0 + 2, x0 + w - 2, y0 + h - 2), fill=base)
    arr = np.asarray(img, dtype=float) + rng.normal(0, 2.8, (512, 512, 1))
    return _clamp_img(arr)


def ensure_b_textures():
    tex_dir = Path(__file__).resolve().parents[2] / 'public/textures/landmarks/B'
    tex_dir.mkdir(parents=True, exist_ok=True)
    textures = {
        'surfaces': build_surfaces_sheet(),
        'glass': build_curtain_glass(),
        'pave': build_plaza_pave(),
        'stone': build_shop_brick(),
    }
    filenames = {
        'surfaces': 'surfaces.png',
        'glass': 'curtain_glass.png',
        'pave': 'plaza_pave.png',
        'stone': 'shop_brick.png',
    }
    for key, img in textures.items():
        img.save(tex_dir / filenames[key], optimize=True)
    return textures


class Builder:
    """Low-draw-call geometry accumulator (<= 5 meshes per LOD)."""

    TILED_SCALES = {
        'glass': (5.2, 15.0),
        'pave': (4.8, 4.8),
        'stone': (4.0, 2.4),
    }

    def __init__(self, detail=True):
        self.detail = detail
        self.visible = []
        self.uv = []
        self.tiled = {k: [] for k in self.TILED_SCALES}
        self.lit_tris = []
        self.lit_uv = []
        self.solid = []
        self.pose = (0.0, 0.0, 0.0, 0.0)

    def mesh(self, vertices, faces, mat, collide=False, uv_scale=None):
        verts = np.asarray(vertices, dtype=float)
        idx = np.asarray(faces, dtype=np.int64)
        if len(idx) == 0:
            return
        tris = verts[idx]
        local = tris.copy()
        dx, dy, dz, angle = self.pose
        if angle:
            c, s = math.cos(angle), math.sin(angle)
            tris[:, :, 0] = local[:, :, 0] * c + local[:, :, 2] * s + dx
            tris[:, :, 2] = -local[:, :, 0] * s + local[:, :, 2] * c + dz
        else:
            tris[:, :, 0] += dx
            tris[:, :, 2] += dz
        tris[:, :, 1] += dy

        if collide:
            self.solid.append(tris)

        cross = np.cross(local[:, 1] - local[:, 0], local[:, 2] - local[:, 0])
        normal_axis = np.abs(cross).argmax(axis=1)
        axes = np.array([[2, 1], [0, 2], [0, 1]])[normal_axis]
        coords = np.take_along_axis(local, axes[:, None, :], axis=2)

        if mat in self.tiled:
            scale = uv_scale or self.TILED_SCALES[mat]
            self.tiled[mat].append((tris, coords / scale))
            return

        is_lit = False
        swatch_key = mat
        if mat.endswith('_lit'):
            is_lit = True
            swatch_key = mat[:-4]
            if swatch_key not in SWATCHES:
                swatch_key = 'white'

        cmin = coords.min(axis=1, keepdims=True)
        span = np.maximum(coords.max(axis=1, keepdims=True) - cmin, 1e-6)
        norm_uv = (coords - cmin) / span
        cell = list(SWATCHES).index(swatch_key)
        mapped_uv = (norm_uv * 0.90 + 0.05 + [cell % 4, 3 - cell // 4]) / 4.0

        if is_lit:
            self.lit_tris.append(tris)
            self.lit_uv.append(mapped_uv)
        else:
            self.visible.append(tris)
            self.uv.append(mapped_uv)

    def box(self, x, y, z, w, h, d, mat, collide=False, uv_scale=None):
        cube = trimesh.creation.box([w, h, d])
        self.mesh(cube.vertices + [x, y + h / 2.0, z], cube.faces, mat, collide, uv_scale)

    def beam(self, start, end, r, mat, sections=8, collide=False):
        seg = np.asarray([start, end], dtype=float)
        if np.linalg.norm(seg[1] - seg[0]) < 1e-4:
            return
        cyl = trimesh.creation.cylinder(radius=r, sections=sections, segment=seg)
        self.mesh(cyl.vertices, cyl.faces, mat, collide)

    def cylinder_y(self, x, y0, h, z, r, mat, sections=16, collide=False, uv_scale=None):
        cyl = trimesh.creation.cylinder(radius=r, height=h, sections=sections)
        # Rotate trimesh cylinder (along Z) so its axis is Y
        verts = cyl.vertices[:, [0, 2, 1]].copy()
        verts[:, 2] *= -1
        verts += [x, y0 + h / 2.0, z]
        self.mesh(verts, cyl.faces, mat, collide, uv_scale)

    def prism(self, poly_xz, y0, h, mat, collide=False, cap_mat=None, uv_scale=None, wall_mask=None):
        """Extrude a 2D polygon [(x, z), ...] vertically from y0 to y0 + h."""
        pts = np.asarray(poly_xz, dtype=float)
        if np.allclose(pts[0], pts[-1]):
            pts = pts[:-1]
        n = len(pts)
        if n < 3:
            return
        # Ensure counter-clockwise in (x, z) so earcut winding is consistent
        signed_area = 0.5 * np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1])
        if signed_area < 0:
            pts = pts[::-1]
            if wall_mask is not None:
                wall_mask = list(reversed(wall_mask))
        tris_2d = mapbox_earcut.triangulate_float64(pts, np.array([n], dtype=np.uint32)).reshape(-1, 3)
        top_verts = np.column_stack([pts[:, 0], np.full(n, y0 + h), pts[:, 1]])
        # Top cap (normal +Y)
        self.mesh(top_verts, tris_2d[:, ::-1], cap_mat or mat, collide, uv_scale)
        # Side walls
        for i in range(n):
            if wall_mask is not None and not wall_mask[i]:
                continue
            j = (i + 1) % n
            x0, z0 = pts[i]
            x1, z1 = pts[j]
            quad_v = [
                (x0, y0, z0),
                (x1, y0, z1),
                (x1, y0 + h, z1),
                (x0, y0 + h, z0),
            ]
            self.mesh(quad_v, [[0, 2, 1], [0, 3, 2]], mat, collide, uv_scale)

    def poly_wall_strip(self, chain_xz, y0, h, thickness, mat, collide=False, uv_scale=None):
        """Extrude a polyline strip of given thickness from y0 to y0 + h."""
        pts = np.asarray(chain_xz, dtype=float)
        for i in range(len(pts) - 1):
            p0, p1 = pts[i], pts[i + 1]
            dx, dz = p1 - p0
            ln = math.hypot(dx, dz)
            if ln < 1e-3:
                continue
            nx, nz = -dz / ln * (thickness / 2.0), dx / ln * (thickness / 2.0)
            quad = [
                (p0[0] - nx, p0[1] - nz),
                (p1[0] - nx, p1[1] - nz),
                (p1[0] + nx, p1[1] + nz),
                (p0[0] + nx, p0[1] + nz),
            ]
            self.prism(quad, y0, h, mat, collide=collide, uv_scale=uv_scale)

    def cluster_lamp(self, x, y0, z, height=7.2, globes=5, collide=False):
        """Guilin municipal multi-globe decorative streetlamp (玉兰/五头球灯)."""
        self.box(x, y0, z, 0.52, 0.55, 0.52, 'dark', collide=collide)
        self.beam([x, y0 + 0.55, z], [x, y0 + height - 0.5, z], 0.11, 'bronze', sections=6, collide=collide)
        if not self.detail:
            self.box(x, y0 + height - 0.5, z, 0.9, 0.65, 0.9, 'white_lit')
            return
        # Top central globe + surrounding arms
        self.cylinder_y(x, y0 + height - 0.15, 0.46, z, 0.24, 'white_lit', sections=8)
        arms = max(2, globes - 1)
        for i in range(arms):
            ang = i * (2 * math.pi / arms) + 0.4
            gx = x + math.cos(ang) * 0.68
            gz = z + math.sin(ang) * 0.68
            gy = y0 + height - 0.65
            self.beam([x, y0 + height - 1.15, z], [gx, gy, gz], 0.045, 'bronze', sections=5)
            self.cylinder_y(gx, gy, 0.38, gz, 0.20, 'white_lit', sections=8)
        # Small red municipal banner frame on shaft
        self.box(x + 0.28, y0 + height * 0.46, z, 0.36, 0.95, 0.05, 'red')
        self.box(x - 0.28, y0 + height * 0.46, z, 0.36, 0.95, 0.05, 'red')

    def street_tree(self, x, y0, z, height=8.5, spread=3.4, kind='camphor', lanterns=False, collide=False):
        """Low-poly camphor / banyan or date-palm street tree."""
        if kind == 'palm':
            self.beam([x, y0, z], [x, y0 + height * 0.78, z], 0.24, 'wood', sections=7, collide=collide)
            fronds = 9 if self.detail else 4
            top = y0 + height * 0.78
            for i in range(fronds):
                ang = i * (2 * math.pi / fronds)
                dx, dz = math.cos(ang), math.sin(ang)
                px, pz = -dz * 0.45, dx * 0.45
                verts = [
                    (x, top + 0.15, z),
                    (x + dx * spread * 0.52 + px, top + 0.85, z + dz * spread * 0.52 + pz),
                    (x + dx * spread, top - 0.65, z + dz * spread),
                    (x + dx * spread * 0.52 - px, top + 0.85, z + dz * spread * 0.52 - pz),
                ]
                self.mesh(verts, [[0, 1, 2], [0, 2, 3]], 'hedge' if i % 2 == 0 else 'leaf')
            return

        trunk_h = height * 0.44
        self.beam([x, y0, z], [x, y0 + trunk_h, z], 0.26, 'wood', sections=6, collide=collide)
        if not self.detail:
            self.cylinder_y(x, y0 + trunk_h - 0.4, height * 0.55, z, spread * 0.85, 'leaf', sections=7)
            return
        blobs = [
            (0.0, trunk_h + height * 0.24, 0.0, spread * 0.82, height * 0.36, 'leaf'),
            (-spread * 0.38, trunk_h + height * 0.14, spread * 0.25, spread * 0.62, height * 0.28, 'hedge'),
            (spread * 0.36, trunk_h + height * 0.16, -spread * 0.28, spread * 0.60, height * 0.28, 'leaf'),
            (0.08 * spread, trunk_h + height * 0.38, 0.1 * spread, spread * 0.54, height * 0.24, 'hedge'),
        ]
        for bx, by, bz, br, bh, mat in blobs:
            ico = trimesh.creation.icosphere(subdivisions=1, radius=1.0)
            v = ico.vertices.copy()
            v[:, 0] = v[:, 0] * br + x + bx
            v[:, 1] = v[:, 1] * bh + y0 + by
            v[:, 2] = v[:, 2] * br + z + bz
            self.mesh(v, ico.faces, mat)
        if lanterns:
            for ang in (0.6, 2.5, 4.4):
                lx = x + math.cos(ang) * spread * 0.52
                lz = z + math.sin(ang) * spread * 0.52
                ly = y0 + trunk_h + 0.15
                self.cylinder_y(lx, ly, 0.34, lz, 0.16, 'red_lit', sections=6)


def export_landmark(name, build_fn):
    textures = ensure_b_textures()
    scene = trimesh.Scene()

    mat_surfaces = trimesh.visual.material.PBRMaterial(
        name='B_surfaces',
        baseColorTexture=textures['surfaces'],
        roughnessFactor=0.92,
        metallicFactor=0.04,
        doubleSided=True,
    )
    mat_lit = trimesh.visual.material.PBRMaterial(
        name='B_surfaces_lit',
        baseColorTexture=textures['surfaces'],
        emissiveFactor=[0.18, 0.16, 0.12],
        roughnessFactor=0.65,
        metallicFactor=0.05,
        doubleSided=True,
    )
    tiled_mats = {
        'glass': trimesh.visual.material.PBRMaterial(
            name='B_curtain_glass',
            baseColorTexture=textures['glass'],
            roughnessFactor=0.28,
            metallicFactor=0.35,
            doubleSided=True,
        ),
        'pave': trimesh.visual.material.PBRMaterial(
            name='B_plaza_pave',
            baseColorTexture=textures['pave'],
            roughnessFactor=0.95,
            metallicFactor=0.0,
            doubleSided=True,
        ),
        'stone': trimesh.visual.material.PBRMaterial(
            name='B_shop_brick',
            baseColorTexture=textures['stone'],
            roughnessFactor=0.92,
            metallicFactor=0.0,
            doubleSided=True,
        ),
    }

    def pack_tris(tri_list):
        verts = np.concatenate(tri_list, axis=0).reshape(-1, 3)
        faces = np.arange(len(verts), dtype=np.int64).reshape(-1, 3)
        return trimesh.Trimesh(vertices=verts, faces=faces, process=False)

    for lod in (0, 1):
        builder = Builder(detail=(lod == 0))
        build_fn(builder)
        layer = f'lod{lod}'
        scene.graph.update(frame_to=layer)

        if builder.visible:
            mesh = pack_tris(builder.visible)
            uv = np.concatenate(builder.uv, axis=0).reshape(-1, 2)
            mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=mat_surfaces)
            scene.add_geometry(mesh, node_name=f'{layer}_joinery', parent_node_name=layer)

        for key, parts in builder.tiled.items():
            if not parts:
                continue
            mesh = pack_tris([t for t, _ in parts])
            uv = np.concatenate([u for _, u in parts], axis=0).reshape(-1, 2)
            mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=tiled_mats[key])
            scene.add_geometry(mesh, node_name=f'{layer}_{key}', parent_node_name=layer)

        if builder.lit_tris:
            mesh = pack_tris(builder.lit_tris)
            uv = np.concatenate(builder.lit_uv, axis=0).reshape(-1, 2)
            mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=mat_lit)
            scene.add_geometry(mesh, node_name=f'{layer}_lit', parent_node_name=layer)

        if lod == 0 and builder.solid:
            coll = pack_tris(builder.solid)
            scene.add_geometry(coll, node_name='collision_surface')

    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    scene.export(out_dir / f'{name}.glb')


# Exact OSM way/253743030 polygon vertices relative to centroid (-974.905, -121.586)
FOOTPRINT = [
    (-44.00, -43.57),
    (-55.60, 8.50),
    (-55.18, 13.84),
    (-53.08, 19.08),
    (-48.54, 20.86),
    (-0.96, 32.50),
    (13.38, 46.01),
    (38.80, 52.82),
    (53.67, -2.19),
    (50.70, -14.83),
    (47.55, -17.59),
    (46.11, -18.85),
    (43.08, -21.51),
    (41.52, -22.87),
    (27.48, -26.63),
    (29.09, -33.31),
    (-17.98, -41.96),
    (-40.41, -46.09),
]


def _facade_run(m, p0, p1, ground_h=4.8, upper_h=18.2, bays=8, brand_seed=0):
    """Build detailed ground-floor luxury storefronts + upper blue glass curtain wall."""
    dx, dz = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dz)
    angle = math.atan2(-dx, dz)
    # Outward normal (pointing right of p0->p1 when polygon is CW/CCW checked)
    ux, uz = dx / length, dz / length
    # Outward toward street (+east for east wing, -z for north wing)
    nx, nz = -uz, ux
    if p0[0] + p1[0] > 40 and nx < 0:
        nx, nz = -nx, -nz
    if p0[1] + p1[1] < -50 and nz > 0:
        nx, nz = -nx, -nz

    bay_w = length / bays
    m.pose = (0.0, 0.0, 0.0, 0.0)
    # Continuous aluminum parapet cornice and floor-1 spandrel fascia
    midx = (p0[0] + p1[0]) / 2.0 + nx * 0.45
    midz = (p0[1] + p1[1]) / 2.0 + nz * 0.45
    facade_yaw = math.atan2(nx, nz)
    m.pose = (midx, 0.0, midz, facade_yaw)
    m.box(0, ground_h - 0.35, 0, length + 0.4, 0.85, 0.95, 'alum')
    m.box(0, ground_h + upper_h, 0, length + 0.5, 1.35, 1.05, 'alum')
    m.box(0, ground_h + upper_h + 1.35, 0, length + 0.7, 0.28, 1.25, 'dark')

    # Upper blue-teal curtain glass plane slightly proud of core
    m.box(0, ground_h + 0.5, 0.22, length - 0.4, upper_h - 0.5, 0.36, 'glass')

    if not m.detail:
        m.pose = (0.0, 0.0, 0.0, 0.0)
        return

    # Vertical silver aluminum mullions & ground-floor granite piers + shop windows
    sign_colors = ['dark', 'leaf', 'red', 'blue']
    for i in range(bays + 1):
        lx = -length / 2.0 + i * bay_w
        # Ground-floor dark granite pier
        m.box(lx, -1.5, 0.25, 0.72, ground_h + 1.5, 0.85, 'dark', collide=True)
        # Full-height thin aluminum mullion fin
        m.box(lx, ground_h + 0.5, 0.44, 0.24, upper_h - 0.5, 0.22, 'alum')
        if i < bays:
            cx = lx + bay_w / 2.0
            # Recessed shop display glass
            m.box(cx, 0.15, -0.05, bay_w - 0.82, 3.35, 0.24, 'glass')
            # Brand fascia signboard + illuminated logo glyphs
            sc = sign_colors[(i + brand_seed) % len(sign_colors)]
            m.box(cx, 3.55, 0.32, bay_w - 0.76, 0.88, 0.28, sc)
            for gx in (-0.95, -0.32, 0.32, 0.95):
                if abs(gx) < bay_w * 0.36:
                    m.box(cx + gx, 3.78, 0.48, 0.34, 0.36, 0.08, 'white_lit')
            # Horizontal transom bars across upper floors
            for fl in range(1, 5):
                m.box(cx, ground_h + fl * (upper_h / 5.0), 0.42, bay_w - 0.24, 0.18, 0.16, 'alum')
    m.pose = (0.0, 0.0, 0.0, 0.0)


def _buttress_pylon(m, cx, cz, yaw):
    """Flanking chamfered silver-grey aluminum stair/elevator pylon (27.0 m)."""
    m.pose = (cx, 0.0, cz, yaw)
    # Stepped chamfered aluminum shaft
    m.box(0, -2.0, 0, 10.6, 28.6, 9.2, 'alum', collide=True)
    m.box(0, 26.6, 0, 9.2, 0.85, 8.0, 'alum')
    if m.detail:
        # Rounded/recessed vertical stairwell glass bay on front face (+z in pose)
        m.box(0, 2.2, 4.48, 3.8, 22.8, 0.35, 'glass')
        m.box(-2.05, 1.8, 4.55, 0.34, 23.4, 0.38, 'alum')
        m.box(2.05, 1.8, 4.55, 0.34, 23.4, 0.38, 'alum')
        for fl in range(7):
            fy = 2.4 + fl * 3.22
            m.box(0, fy, 4.62, 4.1, 0.26, 0.26, 'white')
        # Vertical aluminum seam ribs on flanks
        for sx in (-4.2, -3.0, 3.0, 4.2):
            m.box(sx, 0.5, 4.58, 0.16, 25.8, 0.14, 'white')
    m.pose = (0.0, 0.0, 0.0, 0.0)


def _crown_glyphs(m, cx, cz, radius, y_base, corner_yaw):
    """3D simplified block characters '桂林微笑堂商厦' + green double-loop logo on white crown."""
    # Green infinity/double-loop Dashang Group logo on left of text arc
    for loop_off in (-0.36, -0.27):
        ang = corner_yaw + loop_off
        lx = cx + math.sin(ang) * (radius + 0.16)
        lz = cz + math.cos(ang) * (radius + 0.16)
        m.pose = (lx, y_base + 2.35, lz, ang)
        m.box(0, -0.55, 0, 0.92, 1.10, 0.16, 'hedge')
        m.box(0, -0.28, 0.05, 0.44, 0.56, 0.14, 'white')
    # 7 prominent dark-framed illuminated character glyphs across the front 85° arc
    for idx in range(7):
        ang = corner_yaw - 0.12 + idx * 0.135
        gx = cx + math.sin(ang) * (radius + 0.16)
        gz = cz + math.cos(ang) * (radius + 0.16)
        m.pose = (gx, y_base + 1.85, gz, ang)
        # Main vertical/horizontal strokes simplified so silhouette reads crisply at 150 m
        m.box(0, 0.0, 0, 1.18, 1.65, 0.16, 'dark')
        m.box(0, 0.18, 0.06, 0.96, 0.26, 0.14, 'white_lit')
        m.box(0, 0.78, 0.06, 1.06, 0.26, 0.14, 'white_lit')
        m.box(0, 1.32, 0.06, 0.88, 0.24, 0.14, 'white_lit')
        m.box(-0.34 if idx % 2 else 0.0, 0.08, 0.06, 0.24, 1.48, 0.14, 'white_lit')
        if idx in (0, 2, 4, 6):
            m.box(0.36, 0.12, 0.06, 0.22, 1.32, 0.14, 'white_lit')
        # English subtitle bar underneath ('GUI LIN WEI XIAO TANG PLAZA')
        m.box(0, -0.62, 0.02, 1.08, 0.36, 0.12, 'dark')
    m.pose = (0.0, 0.0, 0.0, 0.0)


def build_nikoniko(m: Builder):
    # 1. Granite sidewalk & corner forecourt plaza (flush at ground y=0, skirt to -2.0 m)
    apron = [
        (-46.5, -49.5),
        (-58.5, 9.5),
        (-56.0, 21.5),
        (-1.5, 35.5),
        (14.0, 49.0),
        (42.5, 56.5),
        (59.8, -1.5),
        (57.2, -18.5),
        (48.5, -29.5),
        (33.5, -38.0),
        (-18.0, -47.0),
    ]
    m.prism(apron, -2.0, 2.08, 'pave', collide=True, cap_mat='pave')

    # 2. Main 6-storey retail body extruded from exact OSM footprint
    # Ground podium (y=-2..4.8 m) in dark stone; upper core (y=4.8..23.0 m) in silver-grey alum/stone
    # Leave wall segment 10..12 (NE chamfered corner entrance) uncollided at ground level for vestibule!
    n_edges = len(FOOTPRINT)
    ground_mask = [i not in (9, 10, 11, 12) for i in range(n_edges)]
    m.prism(FOOTPRINT, -2.0, 6.8, 'dark', collide=True, cap_mat='alum', wall_mask=ground_mask)
    m.prism(FOOTPRINT, 4.8, 18.2, 'alum', collide=True, cap_mat='roof')

    # Rooftop mechanical penthouse & skylight atrium curb (visible in 2024 aerials)
    m.pose = (-8.0, 0.0, -4.0, 0.22)
    m.box(0, 23.0, 0, 34.0, 3.2, 24.0, 'alum')
    m.box(0, 26.2, 0, 22.0, 1.4, 14.0, 'roof')
    m.pose = (0.0, 0.0, 0.0, 0.0)

    # 3. East Wing (along Zhongshan Middle Rd) & North Wing (along Jiefang West Rd) curtain walls
    _facade_run(m, (38.80, 52.82), (53.67, -2.19), ground_h=4.8, upper_h=18.2, bays=9, brand_seed=1)
    _facade_run(m, (53.67, -2.19), (50.70, -14.83), ground_h=4.8, upper_h=18.2, bays=2, brand_seed=0)
    _facade_run(m, (27.48, -26.63), (-40.41, -46.09), ground_h=4.8, upper_h=18.2, bays=11, brand_seed=3)
    # West return & south stepped return glass bands
    _facade_run(m, (-44.00, -43.57), (-55.60, 8.50), ground_h=4.8, upper_h=18.2, bays=7, brand_seed=2)
    _facade_run(m, (13.38, 46.01), (38.80, 52.82), ground_h=4.8, upper_h=18.2, bays=4, brand_seed=0)

    # Signature cantilevered semi-cylindrical glass bay on upper-west end of North Wing (00-2019.jpg right)
    m.cylinder_y(-33.5, 13.8, 7.6, -45.6, 2.6, 'glass', sections=12 if m.detail else 6)
    m.cylinder_y(-33.5, 13.4, 0.4, -45.6, 2.75, 'alum', sections=12 if m.detail else 6)
    m.cylinder_y(-33.5, 21.4, 0.45, -45.6, 2.75, 'alum', sections=12 if m.detail else 6)

    # 4. NE Corner Rotunda Glass Tower + Flanking Aluminum Buttress Pylons + Rooftop Sign Drum
    # Facing northeast (+x, -z) directly into Shizijie intersection (~131° yaw from +z -> ~2.30 rad)
    corner_cx, corner_cz = 40.5, -15.5
    corner_yaw = math.atan2(1.0, -0.88)  # Points NE toward Shizijie center (-880, -170)

    # Left (SE) and Right (NW) silver-grey aluminum buttress pylons
    _buttress_pylon(m, 49.2, -9.2, corner_yaw - 0.34)
    _buttress_pylon(m, 33.0, -25.0, corner_yaw + 0.34)

    # Walkable recessed corner entrance lobby floor + rear glass doors (open doorway!)
    m.pose = (corner_cx + 4.2, 0.0, corner_cz - 3.8, corner_yaw)
    # Entrance steps (gentle walkable 0.12 m steps)
    for step in range(2):
        m.box(0, step * 0.11, 8.2 - step * 1.1, 13.5, 0.12, 1.2, 'pave', collide=True)
    # Recessed dark vestibule back wall at z=2.5 (leaves 6 m deep covered porch walkable)
    m.box(0, 0.2, 2.2, 12.6, 5.8, 0.5, 'glass', collide=True)
    # Twin monumental silver cylindrical entrance columns
    for side in (-1, 1):
        m.cylinder_y(side * 5.2, 0.0, 6.8, 7.2, 0.68, 'alum', sections=12 if m.detail else 6, collide=True)
        if m.detail:
            # Red vertical promotional banners flanking the arched canopy
            m.box(side * 5.2, 1.8, 7.92, 0.92, 4.4, 0.08, 'red')
            for gy in (2.4, 3.2, 4.0, 4.8):
                m.box(side * 5.2, gy, 7.98, 0.45, 0.42, 0.05, 'white_lit')

    # Semi-circular fan-ribbed glass arch canopy over main corner entrance (00-2019.jpg)
    arch_r = 4.65
    arch_y0 = 3.65
    arch_segs = 12 if m.detail else 6
    for idx in range(arch_segs):
        a0 = math.pi * idx / arch_segs
        a1 = math.pi * (idx + 1) / arch_segs
        x0, y0 = arch_r * math.cos(a0), arch_y0 + arch_r * math.sin(a0) * 0.78
        x1, y1 = arch_r * math.cos(a1), arch_y0 + arch_r * math.sin(a1) * 0.78
        # Extruded arch barrel + front glass fanlight
        quad = [(x0, y0, 6.6), (x1, y1, 6.6), (x1, y1, 9.2), (x0, y0, 9.2)]
        m.mesh(quad, [[0, 1, 2], [0, 2, 3]], 'alum')
        fan = [(0.0, arch_y0, 9.05), (x0, y0, 9.05), (x1, y1, 9.05)]
        m.mesh(fan, [[0, 1, 2]], 'glass')
        if m.detail:
            m.beam([0.0, arch_y0, 9.12], [x0, y0, 9.12], 0.045, 'white', sections=4)
    # Canopy horizontal signboard + red LED ticker bar
    m.box(0, arch_y0 - 0.55, 8.95, 9.6, 0.62, 0.55, 'alum')
    m.box(0, arch_y0 - 1.02, 8.85, 8.8, 0.42, 0.35, 'dark')
    if m.detail:
        for gx in np.linspace(-3.4, 3.4, 9):
            m.box(gx, arch_y0 - 0.94, 9.05, 0.42, 0.24, 0.06, 'red_lit')
    m.pose = (0.0, 0.0, 0.0, 0.0)

    # Main corner curved blue-teal glass drum (y=6.6..26.0 m) + stepped upper cylinder (y=26.0..30.2 m)
    m.cylinder_y(corner_cx, 6.6, 19.4, corner_cz, 14.8, 'glass', sections=24 if m.detail else 10, collide=True)
    m.cylinder_y(corner_cx, 25.8, 0.55, corner_cz, 15.1, 'alum', sections=24 if m.detail else 10)
    m.cylinder_y(corner_cx, 26.3, 3.9, corner_cz, 12.8, 'glass', sections=20 if m.detail else 10)
    m.cylinder_y(corner_cx, 30.1, 0.45, corner_cz, 13.0, 'alum', sections=20 if m.detail else 10)

    # Giant curved/framed corner LED billboard screen on floors 2..4 (00-2019.jpg & 2024 drone shot)
    m.pose = (corner_cx, 0.0, corner_cz, corner_yaw)
    m.box(0, 9.4, 14.55, 13.8, 8.8, 0.65, 'dark')
    m.box(0, 9.85, 14.92, 12.9, 7.9, 0.18, 'screen_lit')

    # White cylindrical rooftop crown signboard drum (y=30.5..35.0 m)
    m.pose = (0.0, 0.0, 0.0, 0.0)
    m.cylinder_y(corner_cx, 30.5, 4.45, corner_cz, 11.2, 'white', sections=24 if m.detail else 10)
    m.cylinder_y(corner_cx, 34.85, 0.22, corner_cz, 11.35, 'alum', sections=24 if m.detail else 10)
    if m.detail:
        # Vertical steel lattice ribs around crown drum + 3D '桂林微笑堂商厦' glyphs
        for idx in range(18):
            ang = corner_yaw - 1.35 + idx * 0.16
            rx = corner_cx + math.sin(ang) * 11.28
            rz = corner_cz + math.cos(ang) * 11.28
            m.beam([rx, 30.5, rz], [rx, 35.0, rz], 0.055, 'alum', sections=4)
        _crown_glyphs(m, corner_cx, corner_cz, 11.22, 30.6, corner_yaw)

        # Three steel-and-blue-glass underground pedestrian passage canopies on NE forecourt (2024 aerial)
        for ux, uz, uyaw in ((52.5, -20.5, corner_yaw - 0.55), (46.8, -26.8, corner_yaw), (37.2, -33.2, corner_yaw + 0.55)):
            m.pose = (ux, 0.0, uz, uyaw)
            # U-shaped granite parapet leaving front open, sloped blue-teal glass hood
            m.box(-1.65, 0.0, 0.0, 0.32, 1.05, 5.2, 'dark', collide=True)
            m.box(1.65, 0.0, 0.0, 0.32, 1.05, 5.2, 'dark', collide=True)
            m.box(0.0, 0.0, -2.45, 3.62, 1.05, 0.32, 'dark', collide=True)
            # Sloped canopy roof
            roof_v = [
                (-1.85, 2.55, 2.65), (1.85, 2.55, 2.65),
                (1.85, 1.25, -2.65), (-1.85, 1.25, -2.65),
            ]
            m.mesh(roof_v, [[0, 1, 2], [0, 2, 3]], 'glass')
            m.beam([-1.7, 1.05, 2.4], [-1.7, 2.5, 2.4], 0.07, 'alum', sections=5)
            m.beam([1.7, 1.05, 2.4], [1.7, 2.5, 2.4], 0.07, 'alum', sections=5)
        m.pose = (0.0, 0.0, 0.0, 0.0)

        # Decorative multi-globe streetlamps along North & East sidewalks
        for lx, lz in ((56.8, 12.0), (52.0, 34.0), (14.0, -39.5), (-14.0, -44.5)):
            m.cluster_lamp(lx, 0.08, lz, height=6.8, globes=5, collide=True)


if __name__ == '__main__':
    export_landmark('nikoniko', build_nikoniko)
