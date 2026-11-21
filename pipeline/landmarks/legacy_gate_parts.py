"""Shared helpers for the detailed street gates that were already live before IDOK-84.

The campus interiors are generalized from OSM, but Rock asked (2026-11-21) to keep the
previously modelled school gates and heritage buildings exactly as they were.
"""
import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFont


def _cjk_font(size):
    for path in (
        'NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
        '/System/Library/Fonts/STHeiti Medium.ttc',
        '/System/Library/Fonts/Hiragino Sans GB.ttc',
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def text_mesh(model, text, width, height, color, y_center, z_plane, font_px=28):
    if not model.detail:
        return
    font = _cjk_font(font_px)
    w_px = max(96, round(width * 34))
    h_px = max(28, round(height * 34))
    image = Image.new('1', (w_px, h_px))
    draw = ImageDraw.Draw(image)
    draw.text((w_px // 2, h_px // 2), text, font=font, anchor='mm', fill=1)
    sx, sy = width / w_px, height / h_px
    for row, pixels in enumerate(np.asarray(image)):
        for left, right in np.flatnonzero(np.diff(np.r_[False, pixels, False])).reshape(-1, 2):
            x0, x1 = (left - w_px / 2) * sx, (right - w_px / 2) * sx
            top = y_center + height / 2 - row * sy
            model.mesh(
                [(x0, top, z_plane), (x1, top, z_plane), (x1, top - sy, z_plane), (x0, top - sy, z_plane)],
                [[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]],
                color,
            )


def camphor_tree(model, x, y0, z, h=11.0, spread=4.4):
    model.beam([x, y0 - 0.5, z], [x, y0 + h * 0.44, z], 0.28, 'wood', 7, True)
    model.beam([x, y0 + h * .40, z], [x, y0 + h * .84, z], .17, 'wood', 7)
    sphere = trimesh.creation.icosphere(subdivisions=1 if model.detail else 0)
    for dx, dy, dz, r in (
        (-1.2, h * 0.64, 0.5, spread * 0.78),
        (1.1, h * 0.68, -0.5, spread * 0.74),
        (0.0, h * 0.84, 0.0, spread * 0.70),
    ):
        model.mesh(sphere.vertices * [r, r * 0.68, r] + [x + dx, y0 + dy, z + dz], sphere.faces, 'leaf')


def seated_lion(model, x, y0, z, yaw):
    model.pose = (x, y0, z, yaw)
    model.box(0, -0.4, 0, 1.18, 0.72, 1.52, 'granite', True)
    model.box(0, 0.32, 0, 1.02, 0.42, 1.36, 'stone', True)
    model.box(0, 0.74, -0.05, 0.84, 0.88, 1.08, 'stone', True)
    model.box(0, 1.52, 0.16, 0.72, 0.62, 0.72, 'stone')
    model.box(0, 1.72, -0.06, 0.80, 0.48, 0.56, 'granite')
    for sx in (-0.28, 0.28):
        model.box(sx, 0.74, 0.46, 0.22, 0.72, 0.24, 'stone')
    model.box(0.24, 0.74, 0.58, 0.28, 0.32, 0.28, 'granite')
    model.pose = (0, 0, 0, 0)


def closed_grille(model, cx, y0, cz, width, height, color='tile', bar=0.07, spacing=0.22):
    """Closed iron gate across an opening in the current pose (blocks walking into campus)."""
    model.box(cx, y0, cz, width, 0.12, 0.10, color, True)
    model.box(cx, y0 + height - 0.12, cz, width, 0.12, 0.10, color, True)
    model.box(cx, y0 + height * 0.5, cz, width, 0.08, 0.08, color)
    # Collision-only panel so the closed gate cannot be walked through; bars carry the look.
    cube = trimesh.creation.box([width, height, 0.06])
    model.mesh(cube.vertices + [cx, y0 + height / 2, cz], cube.faces, 'sign', True)
    model.visible.pop()
    model.uv.pop()
    step = spacing if model.detail else spacing * 3
    for bx in np.arange(cx - width / 2 + step / 2, cx + width / 2, step):
        model.box(bx, y0, cz, bar, height, bar, color)
