import argparse
import hashlib
import json
import os
import struct
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
import trimesh
from hidden_faces import GroundFloor, prune

SINGLE_LANDMARK_VRAM_BUDGET_MB = 4.0
SINGLE_LANDMARK_VRAM_BUDGET_BYTES = int(SINGLE_LANDMARK_VRAM_BUDGET_MB * 1024 * 1024)

_MAT_TEX_FIELDS = (
    ('pbrMetallicRoughness', 'baseColorTexture'),
    ('pbrMetallicRoughness', 'metallicRoughnessTexture'),
    (None, 'normalTexture'),
    (None, 'occlusionTexture'),
    (None, 'emissiveTexture'),
)


def read_glb(path: Path):
    raw = path.read_bytes()
    magic, version, _ = struct.unpack_from('<4sII', raw, 0)
    if magic != b'glTF' or version != 2:
        raise ValueError(f'Not a GLB v2 file: {path}')
    jlen, jtype = struct.unpack_from('<II', raw, 12)
    if jtype != 0x4E4F534A:
        raise ValueError(f'Missing JSON chunk in {path}')
    doc = json.loads(raw[20:20 + jlen].decode('utf-8'))
    bin_off = 20 + jlen
    bin_data = b''
    if bin_off + 8 <= len(raw):
        blen, btype = struct.unpack_from('<II', raw, bin_off)
        if btype == 0x004E4942:
            bin_data = raw[bin_off + 8:bin_off + 8 + blen]
    return doc, bin_data


def write_glb(path: Path, doc: dict, bin_data: bytes):
    meta = json.dumps(doc, separators=(',', ':')).encode('utf-8')
    meta += b' ' * ((-len(meta)) % 4)
    padded_bin = bytes(bin_data) + b'\x00' * ((-len(bin_data)) % 4)
    total = 12 + 8 + len(meta) + (8 + len(padded_bin) if padded_bin else 0)
    chunks = [
        struct.pack('<4sII', b'glTF', 2, total),
        struct.pack('<II', len(meta), 0x4E4F534A),
        meta,
    ]
    if padded_bin:
        chunks.append(struct.pack('<II', len(padded_bin), 0x004E4942))
        chunks.append(padded_bin)
    path.write_bytes(b''.join(chunks))


def _parse_image_dims(mime: str, blob: bytes):
    if mime == 'image/ktx2' and blob[:12] == b'\xabKTX 20\xbb\r\n\x1a\n' and len(blob) >= 48:
        _, _, w, h, _, _, _, levels, _ = struct.unpack_from('<9I', blob, 12)
        return w, h, max(1, levels)
    if mime == 'image/png' and blob[:8] == b'\x89PNG\r\n\x1a\n' and len(blob) >= 24:
        w, h = struct.unpack_from('>II', blob, 16)
        return w, h, 1
    if mime == 'image/jpeg' and blob[:2] == b'\xff\xd8':
        i = 2
        while i < len(blob) - 8:
            if blob[i] != 0xFF:
                break
            marker = blob[i + 1]
            if marker in (0xC0, 0xC1, 0xC2):
                h, w = struct.unpack_from('>HH', blob, i + 5)
                return w, h, 1
            seg_len = struct.unpack_from('>H', blob, i + 2)[0]
            i += 2 + seg_len
    if mime == 'image/webp' and blob[:4] == b'RIFF' and blob[8:12] == b'WEBP':
        chunk = blob[12:16]
        if chunk == b'VP8X' and len(blob) >= 30:
            w = 1 + int.from_bytes(blob[24:27], 'little')
            h = 1 + int.from_bytes(blob[27:30], 'little')
            return w, h, 1
    return 0, 0, 1


def inspect_glb_textures(path: Path):
    doc, bin_data = read_glb(path)
    bvs = doc.get('bufferViews', [])
    images = doc.get('images', [])
    non_ktx2 = 0
    gpu_bytes = 0
    rgba_bytes = 0
    details = []
    for img in images:
        mime = img.get('mimeType', 'unknown')
        bv_idx = img.get('bufferView')
        if bv_idx is None:
            continue
        bv = bvs[bv_idx]
        off = bv.get('byteOffset', 0)
        blob = bin_data[off:off + bv['byteLength']]
        w, h, levels = _parse_image_dims(mime, blob)
        if mime == 'image/ktx2':
            mip_mul = (4.0 / 3.0) if levels > 1 else 1.0
            # Conservative KTX2 GPU estimate (BC7 / ASTC 4x4 = 1 byte/pixel).
            gpu_bytes += int(round(w * h * 1.0 * mip_mul))
            rgba_bytes += w * h * 4
        else:
            non_ktx2 += 1
            gpu_bytes += int(round(w * h * 4.0 * (4.0 / 3.0)))
            rgba_bytes += w * h * 4
        details.append(dict(mime=mime, width=w, height=h, levels=levels, bytes=bv['byteLength']))
    exts = doc.get('extensionsUsed', [])
    return dict(
        id=path.stem,
        file_bytes=path.stat().st_size,
        images=len(images),
        non_ktx2=non_ktx2,
        meshopt='EXT_meshopt_compression' in exts,
        gpu_vram_bytes=gpu_bytes,
        gpu_vram_mb=round(gpu_bytes / 1048576, 2),
        rgba_mb=round(rgba_bytes / 1048576, 2),
        details=details,
    )


def _iter_material_tex_slots(doc: dict):
    for mat in doc.get('materials', []):
        for section, field in _MAT_TEX_FIELDS:
            container = mat.get(section) if section else mat
            if isinstance(container, dict) and isinstance(container.get(field), dict):
                yield mat, container, field, container[field]


def _strip_collision_only_textures(doc: dict) -> int:
    """Remove textures from materials used solely by invisible collision* subtrees."""
    nodes = doc.get('nodes', [])
    meshes = doc.get('meshes', [])
    visible_mats = set()
    collision_mats = set()

    def visit(idx: int, in_collision: bool):
        node = nodes[idx]
        is_col = in_collision or node.get('name', '').lower().startswith('collision')
        if 'mesh' in node:
            for prim in meshes[node['mesh']].get('primitives', []):
                if 'material' in prim:
                    (collision_mats if is_col else visible_mats).add(prim['material'])
        for child in node.get('children', []):
            visit(child, is_col)

    for scene in doc.get('scenes', []):
        for idx in scene.get('nodes', []):
            visit(idx, False)

    stripped = 0
    for mat_idx in collision_mats - visible_mats:
        mat = doc['materials'][mat_idx]
        pbr = mat.get('pbrMetallicRoughness')
        changed = False
        for section, field in _MAT_TEX_FIELDS:
            container = mat.get(section) if section else mat
            if isinstance(container, dict) and field in container:
                del container[field]
                changed = True
        if changed:
            if isinstance(pbr, dict) and 'baseColorFactor' not in pbr:
                pbr['baseColorFactor'] = [0.5, 0.5, 0.5, 1.0]
            stripped += 1
    return stripped


def _tex_source_index(tex: dict):
    ext = tex.get('extensions', {}).get('KHR_texture_basisu')
    if isinstance(ext, dict) and 'source' in ext:
        return ext['source'], True
    return tex.get('source'), False


def _set_tex_source_index(tex: dict, new_idx: int, is_basisu: bool):
    if is_basisu:
        tex['extensions']['KHR_texture_basisu']['source'] = new_idx
    else:
        tex['source'] = new_idx


def optimize_glb_textures(path: Path) -> tuple[int, int, int]:
    """Strip collision-only textures, deduplicate identical embedded images/textures,
    and compact unused bufferViews out of the BIN chunk without re-encoding surviving textures.
    Returns (images_before, images_after, bytes_saved).
    """
    orig_size = path.stat().st_size
    doc, bin_data = read_glb(path)
    images = doc.get('images', [])
    before_imgs = len(images)
    if not before_imgs:
        return 0, 0, 0

    stripped = _strip_collision_only_textures(doc)
    bvs = doc.get('bufferViews', [])
    textures = doc.get('textures', [])

    # Step 1: Deduplicate embedded images by exact content hash + mimeType.
    # Only keep images referenced by at least one material texture slot.
    used_tex_indices = {slot['index'] for _, _, _, slot in _iter_material_tex_slots(doc) if 'index' in slot}
    used_img_indices = set()
    for ti in used_tex_indices:
        if ti < len(textures):
            src, _ = _tex_source_index(textures[ti])
            if src is not None:
                used_img_indices.add(src)

    hash_to_new_img = {}
    old_to_new_img = {}
    new_images = []
    for old_idx, img in enumerate(images):
        if old_idx not in used_img_indices:
            continue
        bv_idx = img.get('bufferView')
        if bv_idx is not None:
            bv = bvs[bv_idx]
            off = bv.get('byteOffset', 0)
            blob = bin_data[off:off + bv['byteLength']]
            key = (img.get('mimeType', ''), hashlib.sha256(blob).digest())
        else:
            key = (img.get('mimeType', ''), img.get('uri', f'ext-{old_idx}'))
        if key in hash_to_new_img:
            old_to_new_img[old_idx] = hash_to_new_img[key]
        else:
            new_idx = len(new_images)
            hash_to_new_img[key] = new_idx
            old_to_new_img[old_idx] = new_idx
            new_images.append(dict(img))

    # Step 2: Deduplicate textures referencing the same (image, sampler, extra extensions).
    tex_key_to_new = {}
    old_to_new_tex = {}
    new_textures = []
    for old_ti in sorted(used_tex_indices):
        if old_ti >= len(textures):
            continue
        tex = json.loads(json.dumps(textures[old_ti]))
        src, is_basisu = _tex_source_index(tex)
        if src is not None and src in old_to_new_img:
            _set_tex_source_index(tex, old_to_new_img[src], is_basisu)
        tkey = json.dumps(tex, sort_keys=True, separators=(',', ':'))
        if tkey in tex_key_to_new:
            old_to_new_tex[old_ti] = tex_key_to_new[tkey]
        else:
            new_ti = len(new_textures)
            tex_key_to_new[tkey] = new_ti
            old_to_new_tex[old_ti] = new_ti
            new_textures.append(tex)

    if len(new_images) == before_imgs and len(new_textures) == len(textures) and stripped == 0:
        return before_imgs, before_imgs, 0

    for _, _, _, slot in _iter_material_tex_slots(doc):
        if 'index' in slot and slot['index'] in old_to_new_tex:
            slot['index'] = old_to_new_tex[slot['index']]

    if new_images:
        doc['images'] = new_images
    else:
        doc.pop('images', None)
    if new_textures:
        doc['textures'] = new_textures
    else:
        doc.pop('textures', None)

    # Step 3: Collect all bufferViews still referenced anywhere in the glTF and compact buffer 0.
    referenced_bvs = set()
    for img in doc.get('images', []):
        if 'bufferView' in img:
            referenced_bvs.add(img['bufferView'])
    for acc in doc.get('accessors', []):
        if 'bufferView' in acc:
            referenced_bvs.add(acc['bufferView'])
        sparse = acc.get('sparse')
        if isinstance(sparse, dict):
            if 'bufferView' in sparse.get('indices', {}):
                referenced_bvs.add(sparse['indices']['bufferView'])
            if 'bufferView' in sparse.get('values', {}):
                referenced_bvs.add(sparse['values']['bufferView'])

    new_bvs = []
    old_to_new_bv = {}
    new_bin = bytearray()

    def copy_slice(offset: int, length: int) -> int:
        if len(new_bin) % 4:
            new_bin.extend(b'\x00' * (4 - len(new_bin) % 4))
        dest = len(new_bin)
        new_bin.extend(bin_data[offset:offset + length])
        return dest

    for old_bv_idx, bv in enumerate(bvs):
        if old_bv_idx not in referenced_bvs:
            continue
        nbv = json.loads(json.dumps(bv))
        if nbv.get('buffer') == 0:
            off = nbv.get('byteOffset', 0)
            nbv['byteOffset'] = copy_slice(off, nbv['byteLength'])
        meshopt = nbv.get('extensions', {}).get('EXT_meshopt_compression')
        if isinstance(meshopt, dict) and meshopt.get('buffer') == 0:
            moff = meshopt.get('byteOffset', 0)
            meshopt['byteOffset'] = copy_slice(moff, meshopt['byteLength'])
        old_to_new_bv[old_bv_idx] = len(new_bvs)
        new_bvs.append(nbv)

    for img in doc.get('images', []):
        if 'bufferView' in img:
            img['bufferView'] = old_to_new_bv[img['bufferView']]
    for acc in doc.get('accessors', []):
        if 'bufferView' in acc:
            acc['bufferView'] = old_to_new_bv[acc['bufferView']]
        sparse = acc.get('sparse')
        if isinstance(sparse, dict):
            if 'bufferView' in sparse.get('indices', {}):
                sparse['indices']['bufferView'] = old_to_new_bv[sparse['indices']['bufferView']]
            if 'bufferView' in sparse.get('values', {}):
                sparse['values']['bufferView'] = old_to_new_bv[sparse['values']['bufferView']]

    doc['bufferViews'] = new_bvs
    if doc.get('buffers'):
        doc['buffers'][0]['byteLength'] = len(new_bin)

    write_glb(path, doc, bytes(new_bin))
    saved = orig_size - path.stat().st_size
    return before_imgs, len(new_images), saved


def _pack_with_gltfpack(src: Path, dst: Path, position_bits=None):
    cmd = [
        os.getenv('GLTFPACK', 'gltfpack'),
        '-i', str(src),
        '-o', str(dst),
        '-cc', '-tc', '-tl', '1024', '-kn',
    ]
    if position_bits:
        cmd.extend(['-vp', str(position_bits)])
    subprocess.run(cmd, check=True)


def run_audit(landmarks_dir: Path, strict: bool = True) -> int:
    rows = [inspect_glb_textures(p) for p in sorted(landmarks_dir.glob('*.glb'))]
    rows.sort(key=lambda r: (-r['non_ktx2'], -r['gpu_vram_bytes'], r['id']))
    violations = []
    for r in rows:
        flag = []
        if r['non_ktx2']:
            flag.append(f"NON-KTX2({r['non_ktx2']})")
        if not r['meshopt']:
            flag.append('NO-MESHOPT')
        if r['gpu_vram_bytes'] > SINGLE_LANDMARK_VRAM_BUDGET_BYTES:
            flag.append(f"OVER-4MB({r['gpu_vram_mb']:.2f}MB)")
        status = 'FAIL:' + ','.join(flag) if flag else 'OK'
        if flag:
            violations.append((r['id'], status))
        print(
            f"{r['id']:26s} {status:24s} glb={r['file_bytes']/1048576:5.2f}MB "
            f"imgs={r['images']:2d} ktx2VRAM={r['gpu_vram_mb']:5.2f}MB rgba={r['rgba_mb']:5.2f}MB"
        )
    total_gpu = sum(r['gpu_vram_bytes'] for r in rows) / 1048576
    total_rgba = sum(r['rgba_mb'] for r in rows)
    total_disk = sum(r['file_bytes'] for r in rows) / 1048576
    print(
        f"\nAudited {len(rows)} landmarks: disk={total_disk:.2f}MB, "
        f"sum_ktx2VRAM={total_gpu:.2f}MB, sum_rgba={total_rgba:.2f}MB, "
        f"violations={len(violations)}"
    )
    if strict and violations:
        for lid, reason in violations:
            print(f"  VIOLATION {lid}: {reason}", file=sys.stderr)
        return 1
    return 0


def main():
    parser = argparse.ArgumentParser(description='Pack, optimize and VRAM-audit landmark GLBs.')
    parser.add_argument('ids', nargs='*', help='Landmark IDs to process (default: all)')
    parser.add_argument('--audit', action='store_true', help='Audit existing public/landmarks/*.glb against KTX2 & 4MB VRAM budget')
    parser.add_argument('--optimize-existing', action='store_true', help='Convert non-KTX2 GLBs and deduplicate embedded textures in public/landmarks/*.glb')
    parser.add_argument('--no-strict-budget', action='store_true', help='Warn instead of failing when a landmark exceeds 4MB GPU VRAM budget')
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    landmarks_dir = root.parent / 'public' / 'landmarks'
    specs = {entry['id']: entry for entry in json.loads((root / 'landmarks.json').read_text())}

    if args.audit:
        sys.exit(run_audit(landmarks_dir, strict=not args.no_strict_budget))

    if args.optimize_existing:
        targets = sorted(landmarks_dir.glob('*.glb'))
        if args.ids:
            wanted = set(args.ids)
            targets = [p for p in targets if p.stem in wanted]
        for glb in targets:
            info = inspect_glb_textures(glb)
            spec = specs.get(glb.stem, {})
            if info['non_ktx2'] or not info['meshopt']:
                with TemporaryDirectory() as temp:
                    tmp_in = Path(temp) / glb.name
                    tmp_in.write_bytes(glb.read_bytes())
                    optimize_glb_textures(tmp_in)
                    _pack_with_gltfpack(tmp_in, glb, spec.get('positionBits'))
                b, a, saved = optimize_glb_textures(glb)
                after = inspect_glb_textures(glb)
                print(
                    f"repacked+ktx2 {glb.stem:24s} {info['file_bytes']/1024:6.0f}KB -> {after['file_bytes']/1024:6.0f}KB "
                    f"imgs {info['images']} -> {after['images']} ktx2VRAM {info['gpu_vram_mb']:.2f} -> {after['gpu_vram_mb']:.2f}MB",
                    flush=True,
                )
            else:
                b, a, saved = optimize_glb_textures(glb)
                if b != a or saved > 0:
                    after = inspect_glb_textures(glb)
                    print(
                        f"deduped      {glb.stem:24s} {info['file_bytes']/1024:6.0f}KB -> {after['file_bytes']/1024:6.0f}KB "
                        f"imgs {b} -> {a} ktx2VRAM {info['gpu_vram_mb']:.2f} -> {after['gpu_vram_mb']:.2f}MB",
                        flush=True,
                    )
        sys.exit(run_audit(landmarks_dir, strict=not args.no_strict_budget))

    ground = GroundFloor(root.parent / 'public/world')
    for entry in specs.values():
        if entry.get('noStreetSign'):
            continue
        if args.ids and entry['id'] not in args.ids:
            continue
        generator = root / 'landmarks' / f"{entry['id']}.py"
        if not generator.exists():
            continue
        target = root.parent / 'public' / entry['model']
        target.parent.mkdir(exist_ok=True, parents=True)
        with TemporaryDirectory() as temp:
            raw_glb = Path(temp) / f"{entry['id']}.glb"
            subprocess.run([sys.executable, generator, temp], check=True)
            scene = trimesh.load_scene(raw_glb)
            minimum, maximum = scene.bounds
            info = dict(
                sphere=[*((minimum + maximum) / 2), float(np.linalg.norm(maximum - minimum) / 2)],
                lods=sorted(name for name in scene.graph.nodes if name in ('lod0', 'lod1', 'lod2')),
            )
            before, after = prune(raw_glb, entry['id'], ground)
            print(f"render triangles {entry['id']} {before} {after}", flush=True)
            optimize_glb_textures(raw_glb)
            # campus-wide models (IDOK-165): 14-bit positions over ~1 km snap facade layers onto walls
            _pack_with_gltfpack(raw_glb, target, entry.get('positionBits'))
            optimize_glb_textures(target)
            audit = inspect_glb_textures(target)
            print(
                f"texture budget {entry['id']} imgs={audit['images']} non_ktx2={audit['non_ktx2']} "
                f"ktx2VRAM={audit['gpu_vram_mb']:.2f}MB rgba={audit['rgba_mb']:.2f}MB",
                flush=True,
            )
            if not args.no_strict_budget and (audit['non_ktx2'] > 0 or audit['gpu_vram_bytes'] > SINGLE_LANDMARK_VRAM_BUDGET_BYTES):
                raise SystemExit(
                    f"Landmark {entry['id']} exceeded texture budget: "
                    f"non_ktx2={audit['non_ktx2']}, ktx2VRAM={audit['gpu_vram_mb']:.2f}MB > {SINGLE_LANDMARK_VRAM_BUDGET_MB:.1f}MB"
                )
            target.with_suffix('.json').write_text(json.dumps(info) + '\n')


if __name__ == '__main__':
    main()
