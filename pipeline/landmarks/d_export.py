"""Shared glTF export for group D. One opaque atlas draw plus one `_lit` draw.

Source PNGs land in public/textures/landmarks/D/. The uncompressed glb embeds them;
`npm run landmarks` runs gltfpack (meshopt + KTX2, longest side ≤ 1024).
"""
import json
import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
ATLAS = ROOT / 'public' / 'textures' / 'landmarks' / 'D'

# Photo samples (sRGB), noted beside each generator. Cells are 128 px in a 512 sheet.
CELLS = {
    'stone': 0, 'granite': 1, 'bronze': 2, 'gold': 3,
    'plaster': 4, 'cinnabar': 5, 'slate': 6, 'teal': 7,
    'leaf': 8, 'bark': 9, 'lotus': 10, 'waterstain': 11,
}
LIT = {'sunGlow': (246, 197, 98), 'moonGlow': (214, 224, 232), 'caveGlow': (255, 176, 92)}


def _rgb(hex_color):
    return tuple(int(hex_color[i:i + 2], 16) for i in (1, 3, 5))


def build_atlas():
    """Tiling swatches. Hues follow the 2024 Commons frames and docs/style.md."""
    rng = np.random.default_rng(21)
    sheet = Image.new('RGB', (512, 512), '#8d8a80')
    paints = {
        0: ('#c4c2b8', 'brick'),   # limestone ashlar, 日塔莲座 / 象山岩壁
        1: ('#b7b3a6', 'brick'),   # granite promenade
        2: ('#a67c3a', 'metal'),   # copper body #c4923f darkened for flat shade
        3: ('#e0b056', 'metal'),   # brighter bronze eaves
        4: ('#e7e3d9', 'plaster'), # moon-pagoda whitewash
        5: ('#98352d', 'wood'),    # vermilion rail
        6: ('#3c434a', 'tile'),    # dark grey tile
        7: ('#4f7872', 'wood'),    # eave teal
        8: ('#3a6334', 'leaf'),
        9: ('#6a5438', 'bark'),
        10: ('#e4e0d6', 'brick'),  # lotus stone #e0dcd2
        11: ('#57544c', 'stain'), # vertical water stain
    }
    for index, (color, kind) in paints.items():
        panel = Image.new('RGB', (128, 128), color)
        draw = ImageDraw.Draw(panel)
        base = panel.getpixel((1, 1))
        if kind == 'brick':
            for row in range(8):
                y = row * 16
                draw.line((0, y, 127, y), fill=tuple(max(0, c - 28) for c in base))
                for col in range(-1, 5):
                    x = col * 32 + (16 if row % 2 else 0)
                    draw.line((x, y, x, y + 16), fill=tuple(max(0, c - 28) for c in base))
                    shade = int(rng.integers(-12, 13))
                    draw.rectangle((x + 1, y + 1, x + 31, y + 15), fill=tuple(int(np.clip(c + shade, 0, 255)) for c in base))
        elif kind == 'tile':
            for col in range(0, 128, 8):
                draw.line((col, 0, col, 127), fill=tuple(max(0, c - 18) for c in base))
            for row in range(0, 128, 14):
                draw.line((0, row, 127, row), fill=tuple(min(255, c + 16) for c in base))
        elif kind == 'wood':
            for col in range(0, 128, 9):
                draw.line((col, 0, col, 127), fill=tuple(max(0, int(c * 0.82)) for c in base))
        elif kind == 'metal':
            pixels = np.asarray(panel).astype(np.float32)
            pixels += rng.integers(-8, 9, (128, 128, 1))
            panel = Image.fromarray(np.uint8(np.clip(pixels, 0, 255)))
            draw = ImageDraw.Draw(panel)
            for row in range(0, 128, 18):
                draw.line((0, row, 127, row), fill=tuple(min(255, c + 28) for c in base))
        elif kind == 'leaf':
            pixels = np.asarray(panel).astype(np.float32)
            pixels += rng.normal(0, 10, (128, 128, 1))
            panel = Image.fromarray(np.uint8(np.clip(pixels, 0, 255)))
        elif kind == 'stain':
            for col in range(0, 128, 7):
                tone = tuple(int(np.clip(c + rng.integers(-20, 16), 0, 255)) for c in base)
                draw.line((col, 0, col + rng.integers(-2, 3), 127), fill=tone)
        elif kind == 'bark':
            for col in range(0, 128, 6):
                draw.line((col, 0, col, 127), fill=tuple(max(0, c - 24) for c in base))
        else:
            pixels = np.asarray(panel).astype(np.float32)
            pixels += rng.normal(0, 3, (128, 128, 1))
            panel = Image.fromarray(np.uint8(np.clip(pixels, 0, 255)))
        sheet.paste(panel, ((index % 4) * 128, (index // 4) * 128))
    ATLAS.mkdir(parents=True, exist_ok=True)
    sheet.save(ATLAS / 'surfaces.png', optimize=True)
    return sheet


def grain_image():
    """Near-white stone grain. Multiplies vertex colour so karst hues stay put."""
    rng = np.random.default_rng(7)
    noise = rng.normal(236, 8, (256, 256)).astype(np.float32)
    yy = np.linspace(0, 1, 256)
    stain = (0.65 + 0.35 * np.sin(yy * 40)[:, None]) * (0.5 + 0.5 * np.sin(np.arange(256) * 0.7))
    noise *= 0.82 + 0.18 * stain
    image = Image.fromarray(np.uint8(np.clip(noise, 0, 255)), 'L').convert('RGB')
    ATLAS.mkdir(parents=True, exist_ok=True)
    image.save(ATLAS / 'grain.png', optimize=True)
    return image


def _as_tris(tris):
    array = np.asarray(tris, dtype=np.float64).reshape(-1, 3, 3)
    if len(array) == 0:
        return array[:0]
    normal = np.cross(array[:, 1] - array[:, 0], array[:, 2] - array[:, 0])
    keep = np.linalg.norm(normal, axis=1) > 1e-8
    return array[keep]


def _uv(tris, cell):
    edges = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    axis = np.abs(edges).argmax(axis=1)
    uv = np.zeros((len(tris), 3, 2))
    for mode, pair in enumerate(((1, 2), (0, 2), (0, 1))):
        mask = axis == mode
        uv[mask, :, 0] = tris[mask, :, pair[0]]
        uv[mask, :, 1] = tris[mask, :, pair[1]]
    uv = np.mod(uv / 2.2, 1.0)
    col, row = cell % 4, cell // 4
    # glTF V = 0 is the top of the image. Cell 0 sits at the top-left of the sheet.
    return uv * 0.22 + np.array([0.015 + col * 0.25, 0.015 + row * 0.25])


def _project_uv(tris):
    edges = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    axis = np.abs(edges).argmax(axis=1)
    uv = np.zeros((len(tris), 3, 2))
    for mode, pair in enumerate(((1, 2), (0, 2), (0, 1))):
        mask = axis == mode
        uv[mask, :, 0] = tris[mask, :, pair[0]]
        uv[mask, :, 1] = tris[mask, :, pair[1]]
    return np.mod(uv / 3.0, 1.0)


def coarsen(tris, colors=None, cell=1.6, limit=0.2):
    """Voxel-merge until the face count is within the lod1 budget."""
    source = len(tris)
    if source == 0:
        return tris if colors is None else (tris, colors)
    step = cell
    for _ in range(8):
        quant = np.round(tris.reshape(-1, 3) / step).astype(np.int32)
        unique, inverse = np.unique(quant, axis=0, return_inverse=True)
        faces = inverse.reshape(-1, 3)
        keep = (faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])
        faces = faces[keep]
        if colors is not None:
            flat = np.asarray(colors, dtype=np.float64).reshape(-1, 3) 
            # colors arg is (N,3,3) aligned with original tris; rebuild after unique of kept faces is harder.
            # Average per quantized vertex from all corners, then expand kept faces.
            acc = np.zeros((len(unique), 3))
            count = np.zeros(len(unique))
            np.add.at(acc, inverse, flat)
            np.add.at(count, inverse, 1)
            corner = acc / np.maximum(count[:, None], 1)
        order = np.sort(faces, axis=1)
        _, index = np.unique(order, axis=0, return_index=True)
        faces = faces[np.sort(index)]
        if len(faces) <= max(80, int(source * limit)) or step > 8:
            verts = unique[faces] * step
            if colors is None:
                return verts
            return verts, corner[faces]
        step *= 1.45
    verts = unique[faces] * step
    return verts if colors is None else (verts, corner[faces])


def _normals(tris):
    normal = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    length = np.linalg.norm(normal, axis=1, keepdims=True)
    keep = length[:, 0] > 1e-8
    normal = normal[keep] / length[keep]
    return tris[keep], np.repeat(normal, 3, axis=0)


def _pack(path, primitives, image):
    """primitives: list of (node, material_name, positions, normals, uvs, colors_or_None, emissive_or_None)."""
    blob = bytearray()
    views, accessors, meshes, nodes, materials = [], [], [], [], []
    material_of = {}

    def align():
        while len(blob) % 4:
            blob.append(0)

    def accessor(array, kind, component, normalized=False, target=34962):
        array = np.ascontiguousarray(array)
        align()
        views.append(dict(buffer=0, byteOffset=len(blob), byteLength=array.nbytes, target=target))
        blob.extend(array.tobytes())
        item = dict(bufferView=len(views) - 1, componentType=component, count=len(array), type=kind)
        if normalized:
            item['normalized'] = True
        if kind == 'VEC3' and array.ndim == 2 and array.shape[1] == 3 and component == 5126:
            item['min'] = array.min(0).astype(float).tolist()
            item['max'] = array.max(0).astype(float).tolist()
        accessors.append(item)
        return len(accessors) - 1

    png = path.with_suffix('.png')
    image.save(png, optimize=True)
    data = png.read_bytes()
    png.unlink()
    align()
    image_view = len(views)
    views.append(dict(buffer=0, byteOffset=len(blob), byteLength=len(data)))
    blob.extend(data)

    by_node = {}
    for node, material, positions, normals, uvs, colors, emissive in primitives:
        if len(positions) == 0:
            continue
        key = material
        if key not in material_of:
            mat = dict(name=material, doubleSided=True, pbrMetallicRoughness=dict(
                baseColorFactor=[1, 1, 1, 1], metallicFactor=0.04 if 'bronze' in material or 'gold' in material else 0,
                roughnessFactor=0.86, baseColorTexture=dict(index=0)))
            if emissive is not None:
                mat['emissiveFactor'] = emissive
            materials.append(mat)
            material_of[key] = len(materials) - 1
        attributes = dict(
            POSITION=accessor(positions.astype('<f4'), 'VEC3', 5126),
            NORMAL=accessor(normals.astype('<f4'), 'VEC3', 5126),
            TEXCOORD_0=accessor(uvs.astype('<f4'), 'VEC2', 5126),
        )
        if colors is not None:
            attributes['COLOR_0'] = accessor(np.clip(colors, 0, 1).astype('<f4'), 'VEC3', 5126)
        by_node.setdefault(node, []).append(dict(attributes=attributes, material=material_of[key]))
    for name, prims in by_node.items():
        meshes.append(dict(name=name, primitives=prims))
        nodes.append(dict(name=name, mesh=len(meshes) - 1))
    align()
    doc = dict(
        asset=dict(version='2.0', generator='guilinol pipeline/landmarks/d_export.py'),
        scene=0, scenes=[dict(nodes=list(range(len(nodes))))],
        nodes=nodes, meshes=meshes, materials=materials,
        textures=[dict(source=0, sampler=0)],
        images=[dict(bufferView=image_view, mimeType='image/png')],
        samplers=[dict(magFilter=9729, minFilter=9987, wrapS=10497, wrapT=10497)],
        accessors=accessors, bufferViews=views, buffers=[dict(byteLength=len(blob))],
    )
    text = json.dumps(doc, separators=(',', ':')).encode()
    text += b' ' * ((4 - len(text) % 4) % 4)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        struct.pack('<4sII', b'glTF', 2, 28 + len(text) + len(blob))
        + struct.pack('<I4s', len(text), b'JSON') + text
        + struct.pack('<I4s', len(blob), b'BIN\0') + blob
    )
    tris = sum(prim['attributes'] and accessors[prim['attributes']['POSITION']]['count'] // 3
               for mesh in meshes for prim in mesh['primitives'])
    print(f'{path.name} {path.stat().st_size:,} B, {tris:,} tris, {len(materials)} materials, nodes={[n["name"] for n in nodes]}')


def _emit(tris, uv, colors=None):
    tris, normals = _normals(np.asarray(tris, dtype=np.float64))
    if len(tris) == 0:
        empty = np.zeros((0, 3), np.float32)
        return empty, empty, np.zeros((0, 2), np.float32), None
    uv = np.asarray(uv, dtype=np.float64).reshape(len(uv), 3, 2)
    # _normals dropped degenerate faces; recompute uv mask the same way
    source = np.asarray(tris)  # already filtered inside _normals return
    # The uv passed in matches the pre-filter tris. Recompute consistently:
    return source.reshape(-1, 3), normals, uv.reshape(-1, 2)[:len(source.reshape(-1, 3))], None


def export_buckets(path, buckets, collision):
    """buckets: material name -> iterable of triangles. Lit names are sunGlow/moonGlow/caveGlow."""
    atlas = build_atlas()
    opaque, lit = [], []
    for name, raw in buckets.items():
        tris = _as_tris(raw)
        if len(tris) == 0:
            continue
        if name in LIT:
            lit.append((name, tris))
        else:
            cell = {
                'lotusStone': 10, 'lotusShadow': 10, 'stoneDeck': 1, 'stoneRail': 0,
                'bronzeDark': 2, 'bronzeBody': 2, 'goldBronze': 3, 'roofBronze': 3,
                'whiteWall': 4, 'vermilion': 5, 'eaveTeal': 7, 'slateTile': 6, 'slateTrim': 6,
                'spireSilver': 3, 'leaf': 8, 'bark': 9, 'canopy': 8,
            }.get(name, 0)
            opaque.append((cell, tris))
    opaque_tris = np.concatenate([t for _, t in opaque]) if opaque else np.zeros((0, 3, 3))
    lit_tris = np.concatenate([t for _, t in lit]) if lit else np.zeros((0, 3, 3))
    lit_colors = None
    if len(lit_tris):
        chunks = []
        for name, tris in lit:
            rgb = np.array(LIT[name]) / 255
            chunks.append(np.broadcast_to(rgb, tris.shape))
        lit_colors = np.concatenate(chunks)
    primitives = []

    def add(node, tris, uv, colors, material, emissive):
        if len(tris) == 0:
            return
        filtered, normals = _normals(tris)
        # uv/colors were built for `tris`; drop the same degenerates
        normal = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
        keep = np.linalg.norm(normal, axis=1) > 1e-8
        uv = np.asarray(uv).reshape(len(tris), 3, 2)[keep]
        col = None if colors is None else np.asarray(colors).reshape(len(tris), 3, 3)[keep]
        primitives.append((
            node, material, filtered.reshape(-1, 3), normals, uv.reshape(-1, 2),
            None if col is None else col.reshape(-1, 3), emissive,
        ))

    if len(opaque_tris):
        uv = np.concatenate([_uv(tris, cell) for cell, tris in opaque])
        add('lod0', opaque_tris, uv, None, 'd_surfaces', None)
        far = coarsen(opaque_tris, cell=1.8)
        add('lod1', far, _uv(far, 0), None, 'd_surfaces', None)
    if len(lit_tris):
        uv = _uv(lit_tris, 4)
        add('lod0', lit_tris, uv, lit_colors, 'glow_lit', [1, 0.72, 0.38])
        far, colors = coarsen(lit_tris, lit_colors, cell=2.2)
        add('lod1', far, _uv(far, 4), colors, 'glow_lit', [1, 0.72, 0.38])
    collision = _as_tris(collision)
    if len(collision):
        add('collision_shell', collision, _uv(collision, 1), None, 'd_surfaces', None)
    _pack(path, primitives, atlas)


def export_colored(path, tris, colors, collision, lit, pagoda=None):
    """Vertex-coloured karst.

    `lit` is the cave interior. `pagoda` keeps the bottle pagoda on its own
    material so dimming the cave does not dim the pagoda.
    """
    image = grain_image()
    tris = np.asarray(tris, dtype=np.float64)
    colors = np.asarray(colors, dtype=np.float64)
    lit = np.asarray(lit, dtype=bool)
    pagoda = np.zeros(len(tris), dtype=bool) if pagoda is None else np.asarray(pagoda, dtype=bool)
    plain = ~(lit | pagoda)
    primitives = []

    def add(node, faces, cols, material, emissive):
        if len(faces) == 0:
            return
        normal = np.cross(faces[:, 1] - faces[:, 0], faces[:, 2] - faces[:, 0])
        keep = np.linalg.norm(normal, axis=1) > 1e-8
        faces, cols = faces[keep], cols[keep]
        filtered, normals = _normals(faces)
        uv = _project_uv(faces)
        primitives.append((
            node, material, filtered.reshape(-1, 3), normals, uv.reshape(-1, 2),
            cols.reshape(-1, 3), emissive,
        ))

    add('lod0', tris[plain], colors[plain], 'd_grain', None)
    add('lod0', tris[lit], colors[lit], 'cave_lit', [0.55, 0.34, 0.12])
    add('lod0', tris[pagoda], colors[pagoda], 'pagoda_lit', [1, 0.62, 0.22])
    if plain.any():
        far, cols = coarsen(tris[plain], colors[plain], cell=2.4)
        add('lod1', far, cols, 'd_grain', None)
    if lit.any():
        far, cols = coarsen(tris[lit], colors[lit], cell=2.8)
        add('lod1', far, cols, 'cave_lit', [0.55, 0.34, 0.12])
    if pagoda.any():
        far, cols = coarsen(tris[pagoda], colors[pagoda], cell=2.8)
        add('lod1', far, cols, 'pagoda_lit', [1, 0.62, 0.22])
    collision = _as_tris(collision)
    if len(collision):
        dummy = np.ones_like(collision)
        add('collision_hill', collision, dummy, 'd_grain', None)
    _pack(path, primitives, image)
