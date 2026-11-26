"""Generate subtle, neutral-luminance tileable KTX2 detail maps for city surfaces (IDOK-28)."""

import json
import os
from pathlib import Path
import struct
import subprocess
import tempfile

import numpy as np
from PIL import Image
import trimesh
from trimesh.visual import TextureVisuals


def tileable_noise(size: int, freq: int, rng: np.random.Generator) -> np.ndarray:
    grid = rng.normal(0.0, 1.0, (freq, freq))
    # Tile-periodic bilinear upsample
    u = np.arange(size, dtype=np.float64) * freq / size
    i0 = np.floor(u).astype(int) % freq
    i1 = (i0 + 1) % freq
    f = u - np.floor(u)
    f = f * f * (3.0 - 2.0 * f)
    fx, fy = np.meshgrid(f, f)
    c00 = grid[np.ix_(i0, i0)]
    c10 = grid[np.ix_(i0, i1)]
    c01 = grid[np.ix_(i1, i0)]
    c11 = grid[np.ix_(i1, i1)]
    return (c00 * (1 - fx) + c10 * fx) * (1 - fy) + (c01 * (1 - fx) + c11 * fx) * fy


CC0_DETAIL = {
    # channel: (file in pipeline/textures-cc0, contrast of the normalised detail, mean multiplier)
    'road': ('road-Asphalt031.png', 0.10, 0.985),
    'wall': ('wall-Plaster001.png', 0.035, 0.99),
}


def cc0_channel_image(name: str) -> Image.Image | None:
    """Luminance-neutral detail from a CC0 photo source (IDOK-291), or None to fall back to noise."""
    spec = CC0_DETAIL.get(name)
    if not spec:
        return None
    path = Path(__file__).resolve().parent / 'textures-cc0' / spec[0]
    if not path.exists():
        return None
    a = np.asarray(Image.open(path).convert('L'), dtype=np.float64)
    z = (a - a.mean()) / max(a.std(), 1e-6)
    lum = spec[2] + spec[1] * np.clip(z, -3.0, 3.0) / 3.0
    rgb = np.clip(np.rint(lum * 255.0), 180, 255).astype(np.uint8)
    return Image.fromarray(np.stack([rgb, rgb, rgb], axis=-1), mode='RGB')


def make_channel_image(name: str, size: int = 256) -> Image.Image:
    rng = np.random.default_rng({'road': 101, 'sidewalk': 202, 'bank': 303, 'wall': 404, 'roof': 505}[name])
    coarse = tileable_noise(size, 8, rng)
    mid = tileable_noise(size, 32, rng)
    fine = rng.normal(0.0, 1.0, (size, size))

    if name == 'road':
        # Asphalt micro-aggregate: subtle, neutral mean ~0.98
        lum = 0.985 + 0.018 * coarse + 0.022 * mid + 0.024 * fine
    elif name == 'sidewalk':
        # 4x4 granite pavers per 2m tile (50cm slabs)
        lum = 0.99 + 0.014 * coarse + 0.014 * fine
        yy, xx = np.mgrid[0:size, 0:size]
        cell_x, cell_y = xx // 64, yy // 64
        slab_var = ((cell_x * 37 + cell_y * 73) % 11 - 5) * 0.004
        lum += slab_var
        joint = (xx % 64 < 2) | (yy % 64 < 2)
        lum[joint] -= 0.075
    elif name == 'bank':
        # Coursed ashlar limestone blocks (4 courses, staggered bond)
        lum = 0.99 + 0.022 * coarse + 0.016 * mid + 0.012 * fine
        yy, xx = np.mgrid[0:size, 0:size]
        course = yy // 64
        shift = (course % 2) * 64
        block_x = ((xx + shift) % size) // 128
        lum += ((course * 29 + block_x * 53) % 9 - 4) * 0.006
        h_joint = (yy % 64 < 3)
        v_joint = (((xx + shift) % 128) < 3)
        lum[h_joint | v_joint] -= 0.095
    elif name == 'wall':
        # Subtle plaster / facade ceramic micro-texture
        lum = 0.992 + 0.014 * coarse + 0.012 * mid + 0.010 * fine
    else:  # roof
        # Subtle tile courses + concrete grain
        yy, _ = np.mgrid[0:size, 0:size]
        rib = 0.018 * np.sin(2.0 * np.pi * yy / 16.0)
        lum = 0.988 + 0.016 * coarse + rib + 0.012 * fine

    rgb = np.clip(np.rint(lum * 255.0), 200, 255).astype(np.uint8)
    arr = np.stack([rgb, rgb, rgb], axis=-1)
    return Image.fromarray(arr, mode='RGB')


def png_to_ktx2(img: Image.Image, out_path: Path, gltfpack: str, limit: int = 256):
    with tempfile.TemporaryDirectory() as tmp:
        in_glb = Path(tmp) / 'in.glb'
        out_glb = Path(tmp) / 'out.glb'
        mesh = trimesh.Trimesh(
            vertices=[[0, 0, 0], [1, 0, 0], [0, 1, 0]],
            faces=[[0, 1, 2]],
            visual=TextureVisuals(uv=[[0, 0], [1, 0], [0, 1]], image=img),
            process=False,
        )
        sc = trimesh.Scene()
        sc.add_geometry(mesh)
        sc.export(in_glb)
        subprocess.run([gltfpack, '-i', str(in_glb), '-o', str(out_glb), '-tc', '-tl', str(limit)],
                       check=True, capture_output=True)
        blob = out_glb.read_bytes()
        j_len, j_type = struct.unpack_from('<II', blob, 12)
        assert j_type == 0x4E4F534A
        meta = json.loads(blob[20:20 + j_len])
        b_off = 20 + j_len
        b_len, b_type = struct.unpack_from('<II', blob, b_off)
        assert b_type == 0x004E4942
        bin_chunk = blob[b_off + 8:b_off + 8 + b_len]
        img_info = meta['images'][0]
        assert img_info.get('mimeType') == 'image/ktx2', img_info
        bv = meta['bufferViews'][img_info['bufferView']]
        start = bv.get('byteOffset', 0)
        ktx2_bytes = bin_chunk[start:start + bv['byteLength']]
        assert ktx2_bytes.startswith(b'\xabKTX 20')
        out_path.write_bytes(ktx2_bytes)


def main():
    root = Path(__file__).resolve().parents[1]
    tex_dir = root / 'public/textures'
    tex_dir.mkdir(parents=True, exist_ok=True)
    gltfpack = os.getenv('GLTFPACK') or 'gltfpack'
    total = 0
    for ch in ('wall', 'roof', 'road', 'sidewalk', 'bank'):
        img = cc0_channel_image(ch) or make_channel_image(ch, 256)
        target = tex_dir / f'{ch}.ktx2'
        png_to_ktx2(img, target, gltfpack, img.width)
        sz = target.stat().st_size
        total += sz
        print(f'Generated {target.name}: {img.width}x{img.height}, {sz:,} B')
    print(f'Total KTX2 bytes: {total:,} B (budget <= 1,500,000 B)')


if __name__ == '__main__':
    main()
