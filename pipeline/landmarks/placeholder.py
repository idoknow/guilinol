import sys
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image


output = Path(sys.argv[1])
pixels = ((np.indices((32,32))//8).sum(axis=0)%2*190+45).astype('uint8')
image = Image.fromarray(pixels).convert('RGB')
image.save(output/'checker.png')
cube = trimesh.creation.box([3,3,3])
cube.apply_translation([0,1.5,0])
cube.unmerge_vertices()
uv = []
for vertices, normal in zip(cube.triangles, cube.face_normals):
    axes = np.flatnonzero(abs(normal)<.5)
    uv.extend(vertices[:,axes]/3 + [.5,.5])
cube.visual = trimesh.visual.TextureVisuals(uv=uv, material=trimesh.visual.material.PBRMaterial(baseColorTexture=image, metallicFactor=0, roughnessFactor=1))
scene = trimesh.Scene()
scene.add_geometry(cube,node_name='lod0')
scene.graph.update(frame_to='collision_box',geometry=next(iter(scene.geometry)))
scene.export(output/'placeholder.glb')
