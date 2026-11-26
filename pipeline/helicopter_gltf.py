"""Indexed PBR geometry and rigid attachment frames for the tour helicopter."""
import io
from collections import defaultdict
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFont
from pack_landmarks import read_glb, write_glb

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / 'web/public/models'
PALETTE = dict(paint='f2f1e9', jade='6c9c97', ink='243d40', rubber='252b30',
               alloy='88969b', leather='495f62', piping='b1b9a8', glass='6a9da9',
               blur='788687', red='ff3430', green='3cff80', white='fff4cc', gold='ecc15b')


class Aircraft:
    def __init__(self, lod):
        self.lod = lod
        self.g = dict(asset=dict(version='2.0'), scene=0, scenes=[dict(nodes=[0])],
                      nodes=[], meshes=[], accessors=[], bufferViews=[], materials=[])
        self.bin = bytearray()
        self.parts = defaultdict(list)
        self.frames = {}
        self.node('airframe')
        self.materials = {}
        for name, color in PALETTE.items():
            srgb = np.frombuffer(bytes.fromhex(color), dtype=np.uint8) / 255
            linear = np.where(srgb <= .04045, srgb / 12.92, ((srgb + .055) / 1.055)**2.4)
            alpha = {'glass': .30 if lod == 0 else 1, 'blur': .16}.get(name, 1)
            pbr = dict(baseColorFactor=[*linear, alpha], metallicFactor=.55 if name == 'alloy' else .06,
                       roughnessFactor=.21 if name == 'glass' else .65)
            mat = dict(name=name, doubleSided=True, pbrMetallicRoughness=pbr)
            if name in ('paint', 'jade'):
                mat['extensions'] = {'KHR_materials_clearcoat': dict(clearcoatFactor=.85, clearcoatRoughnessFactor=.19)}
                self.g['extensionsUsed'] = ['KHR_materials_clearcoat']
                pbr['roughnessFactor'] = .29
            if alpha < 1:
                mat['alphaMode'] = 'BLEND'
            if name in ('red', 'green', 'white'):
                mat['emissiveFactor'] = linear.tolist()
            self.materials[name] = len(self.g['materials'])
            self.g['materials'].append(mat)

    def node(self, name, xyz=(0, 0, 0), parent='airframe'):
        index = len(self.g['nodes'])
        self.frames[name] = index
        self.g['nodes'].append(dict(name=name, translation=list(xyz)))
        if index:
            self.g['nodes'][self.frames[parent]].setdefault('children', []).append(index)
        return index

    def add(self, mesh, mat, frame='airframe'):
        self.parts[frame, mat].append(mesh)

    def box(self, center, size, mat, frame='airframe'):
        self.add(trimesh.creation.box(extents=size).apply_translation(center), mat, frame)

    def rod(self, a, b, radius, mat, frame='airframe', sides=None):
        sides = sides or (12, 6, 3)[self.lod]
        self.add(trimesh.creation.cylinder(radius, sections=sides, segment=[a, b]), mat, frame)

    def oval(self, center, radii, mat, frame='airframe'):
        mesh = trimesh.creation.uv_sphere(count=[20, 24] if not self.lod else [6, 8])
        self.add(mesh.apply_scale(radii).apply_translation(center), mat, frame)

    def surface(self, vertices, faces, mat, frame='airframe'):
        self.add(trimesh.Trimesh(vertices, faces, process=False), mat, frame)

    def view(self, data):
        self.bin.extend(bytes(-len(self.bin) % 4))
        views = self.g['bufferViews']
        views.append(dict(buffer=0, byteOffset=len(self.bin), byteLength=len(data)))
        self.bin.extend(data)
        return len(views)-1

    def array(self, values, kind, indices=False):
        a = np.asarray(values, dtype='<u4' if indices else '<f4')
        record = dict(bufferView=self.view(a.tobytes()), type=kind, count=len(a),
                      componentType=5125 if indices else 5126)
        if kind in ('SCALAR', 'VEC3'):
            record.update(min=np.atleast_1d(a.min(axis=0)).tolist(), max=np.atleast_1d(a.max(axis=0)).tolist())
        self.g['accessors'].append(record)
        return len(self.g['accessors'])-1

    def lettering(self):
        image = Image.new('RGBA', (1024, 160))
        draw = ImageDraw.Draw(image)
        for path in ['NotoSansCJK-Regular.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
                     '/System/Library/Fonts/STHeiti Medium.ttc']:
            try:
                font = ImageFont.truetype(path, 70)
                break
            except OSError:
                continue
        else:
            raise RuntimeError('Install Noto Sans CJK to render the tour livery.')
        draw.text((512, 80), 'B-GLOL   网上桂林 观光', font=font, anchor='mm', fill='#203d40')
        out = io.BytesIO()
        image.save(out, 'PNG')
        self.g.update(images=[dict(bufferView=self.view(out.getvalue()), mimeType='image/png')],
                      textures=[dict(source=0)])
        self.materials['lettering'] = len(self.g['materials'])
        self.g['materials'].append(dict(name='Tour livery atlas', alphaMode='BLEND', doubleSided=True,
            pbrMetallicRoughness=dict(baseColorTexture=dict(index=0), metallicFactor=0, roughnessFactor=.7)))

    def finish(self):
        by_frame = defaultdict(list)
        for (frame, mat), parts in self.parts.items():
            mesh = trimesh.util.concatenate(parts)
            attrs = dict(POSITION=self.array(mesh.vertices, 'VEC3'), NORMAL=self.array(mesh.vertex_normals, 'VEC3'))
            if mat.startswith('disk_'):
                coords = mesh.vertices[:, [1 if mat.endswith('tail') else 0, 2]]
                attrs['TEXCOORD_0'] = self.array(.5 + coords / (2 * np.abs(coords).max()), 'VEC2')
            if mat in ('lettering','dial_print'):
                attrs['TEXCOORD_0'] = self.array([[0,1],[1,1],[1,0],[0,0]] * len(parts), 'VEC2')
            by_frame[frame].append(dict(attributes=attrs, indices=self.array(mesh.faces.flatten(), 'SCALAR', True),
                                        material=self.materials[mat]))
        for frame, primitives in by_frame.items():
            self.g['nodes'][self.frames[frame]]['mesh'] = len(self.g['meshes'])
            self.g['meshes'].append(dict(name=frame, primitives=primitives))

    def save(self, path):
        self.g['buffers'] = [dict(byteLength=len(self.bin))]
        write_glb(path, self.g, self.bin)
