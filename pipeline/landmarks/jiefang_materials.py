"""Bridge finishes and a single emissive atlas for all coloured light strips."""
from pathlib import Path
import sys

import numpy as np
import trimesh
from jingjiang import Model, SWATCHES, atlas

COLORS = dict(tile='#4c535b', pave='#c3c5c5', stone='#c9ced0', granite='#d9dcdb',
              wood='#606975', white='#eef0eb', gold='#ffdf97', glass='#70ffe5',
              green='#83ff97', yellow='#e1c58b', red='#fd4136', earth='#9983ff')
LIGHT = {'violet':'earth','jade':'green','aqua':'glass','ice':'white',
         'lamp':'gold','knot':'red'}


class BridgeModel(Model):
    def __init__(self, detail):
        super().__init__(detail)
        self.lights=[]
        self.glass=[]

    def mesh(self, vertices, faces, color, collide=False):
        group=self.lights if color in LIGHT else self.glass if color=='glazing' else None
        super().mesh(vertices,faces,LIGHT.get(color,'white' if color=='glazing' else color),collide)
        if group is not None:
            group.append((self.visible.pop(),self.uv.pop()))


def generate_bridge(build):
    image=atlas(COLORS,('tile','wood','red'))
    scene=trimesh.Scene()
    def finish(name,texture,ambient=.20,**params):
        return trimesh.visual.material.PBRMaterial(name=name,baseColorTexture=texture,
            emissiveTexture=texture,emissiveFactor=[ambient]*3,doubleSided=True,
            metallicFactor=0,roughnessFactor=.78,**params)
    finishes={'finish':finish('bridge_finish',image), 'lights':finish('bridge_lit',image,1)}
    finishes['glass']=trimesh.visual.material.PBRMaterial(name='lantern_glass',
        baseColorFactor=[207,232,245,56],emissiveFactor=[.12,.16,.19],alphaMode='BLEND',doubleSided=True,roughnessFactor=.18,metallicFactor=.1)
    for key in ('stone','pave'):
        cell=list(SWATCHES).index(key);x,y=128*(cell%4),128*(cell//4)
        finishes[key]=finish(key,image.crop((x,y,x+128,y+128)))
    for lod in (0,1):
        group=f'lod{lod}'
        scene.graph.update(frame_to=group)
        model=BridgeModel(lod==0)
        build(model)
        def emit(parts,uvs,name):
            vertices=np.concatenate(parts).reshape(-1,3)
            vertices[:,1]+=5.62-vertices[:,0]*1.3/281
            mesh=trimesh.Trimesh(vertices,np.arange(len(vertices)).reshape(-1,3),process=False)
            if uvs is not None:
                mesh.visual=trimesh.visual.TextureVisuals(uv=np.concatenate(uvs).reshape(-1,2),material=finishes[name])
            scene.add_geometry(mesh,node_name=group+'_'+name if uvs is not None else 'collision_surface',
                               parent_node_name=group if uvs is not None else scene.graph.base_frame)
        emit(model.visible,model.uv,'finish')
        for name,parts in [('lights',model.lights),('glass',model.glass),*model.tile_parts.items()]:
            if parts:
                triangles,uvs=zip(*parts)
                emit(triangles,uvs,name)
        if lod==0:
            emit(model.solid,None,'collision')
    scene.export(Path(sys.argv[1])/'jiefang_bridge.glb')
