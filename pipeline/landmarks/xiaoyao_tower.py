"""Xinhua (新华社), 2016-04-01,《逍遥楼重现桂林漓江边》: two floors,
three eaves, ~22 m square and ~24 m high. OSM way/702352884 gives the
footprint and the NNE axis (~17 degrees east of north). The floor and sill
heights are estimates, not survey data. Roof slate, dark red timber and
pale grey paving follow the daylight 2025 views in landmark-refs.json.
"""
from pathlib import Path
import sys

import numpy as np
import trimesh

from jingjiang import Model, SWATCHES, atlas


LIGHTS = {'lamp': [.85,.57,.24], 'violet': [.78,.045,.92], 'jade': [.18,.94,.38]}


class LandmarkModel(Model):
    def __init__(self, detail):
        super().__init__(detail)
        self.lamps={}

    def mesh(self, vertices, faces, color, collide=False):
        if isinstance(color,str) and color in LIGHTS:
            super().mesh(vertices,faces,'gold',collide)
            self.lamps.setdefault(color, []).append((self.visible.pop(),self.uv.pop()))
        else:
            super().mesh(vertices,faces,color,collide)


def facade(model, base, half, height, upstairs):
    for side in range(4):
        model.pose = (0, 0, 0, side * np.pi / 2)
        for bay in range(-2, 3):
            east = bay * half / 2.5
            width = half / 2.5
            post = east - width / 2
            model.beam([post, base, half], [post, base+height, half], .24, 'red', 10 if model.detail else 4, True)
            if bay or upstairs:
                if model.detail:
                    model.box(east, base, half-1.4, width-.14, 1.05, .18, 'wood', True)
                    model.box(east, base+1.05, half-1.55, width-.14, height-1.35, .12, 'sign', True)
                else:
                    model.box(east, base, half-1.4, width-.14, height-.3, .18, 'wood')
                if model.detail:
                    for offset in np.linspace(-width*.43, width*.43, 7):
                        model.box(east+offset, base+1.05, half-1.3, .07, height-1.35, .075, 'wood')
                    for lift in np.arange(1.35, height-.3, .65):
                        model.box(east, base+lift, half-1.3, width-.14, .07, .075, 'wood')
            if model.detail:
                for tier in range(3):
                    model.box(post, base+height-.6+tier*.19, half, .45+tier*.33, .19, .55+tier*.41, 'red')
            if upstairs:
                model.box(east, base+.94, half+.82, width+.04, .14, .14, 'red', True)
                for offset in ([-.4,-.2,0,.2,.4] if model.detail else [0]):
                    model.box(east+offset*width, base, half+.82, .11, .94, .11, 'wood')
        model.box(0, base+height-.3, half, half*2+.5, .48, .52, 'red')
        if not upstairs:
            model.box(0,base+height-.98,half+.28,2.5,.7,.14,'sign')
    model.pose = (0,0,0,0)


def tower(model):
    model.box(0,-.25,0,22.4,3.65,22.4,'brick',True)
    model.box(0,3.4,0,22.8,.32,22.8,'pave',True)
    for side in (-1,1):
        for step in range(22):
            model.box(0,-.04,side*(11.4+(21.5-step)*.36),6.2,.04+(step+1)*3.72/22,.36,'pave',True)
    facade(model,3.72,7.55,5.05,False)
    model.swept_roof(0,8.77,0,22.4,22.4,2.1)
    model.box(0,10.67,0,16.6,.45,16.6,'wood',True)
    facade(model,11.12,6.65,4.9,True)
    model.swept_roof(0,16.02,0,19.8,19.8,2.65)
    model.box(0,18.33,0,11.4,1.05,10.6,'wood')
    model.swept_roof(0,19.38,0,16.8,15.9,3.7)
    model.beam([0,23.08,0],[0,24.15,0],.29,'gold',8)


def generate(name='xiaoyao_tower', build=tower, folder='E', lift=None, colors=None, smooth=()):
    image = atlas(colors,smooth)
    target = Path(__file__).resolve().parents[2]/'public/textures/landmarks'/folder
    target.mkdir(parents=True, exist_ok=True)
    if colors is None: image.save(target/'timber-and-tile.png', optimize=True)
    scene = trimesh.Scene()
    for level in (0,1):
        model = LandmarkModel(level==0)
        build(model)
        group = f'lod{level}'
        scene.graph.update(frame_to=group)
        def add(parts, uvs, texture, name):
            vertices = np.concatenate(parts).reshape(-1,3)
            if lift is not None:
                vertices[:,1]+=lift(vertices[:,0])
            mesh = trimesh.Trimesh(vertices, np.arange(len(vertices)).reshape(-1,3), process=False)
            if texture is not None:
                material = trimesh.visual.material.PBRMaterial(name=name,baseColorTexture=texture,roughnessFactor=1,metallicFactor=0,doubleSided=True)
                if name.endswith('_lit'):
                    material.emissiveFactor=LIGHTS[name.removesuffix('_lit')]
                mesh.visual = trimesh.visual.TextureVisuals(uv=np.concatenate(uvs).reshape(-1,2),material=material)
            scene.add_geometry(mesh,node_name=group+'_'+name if texture else 'collision_surface',parent_node_name=group if texture else scene.graph.base_frame)
        if model.visible:
            add(model.visible,model.uv,image,'joinery')
        if model.pigmented:
            triangles,colors=zip(*model.pigmented)
            vertices=np.concatenate(triangles).reshape(-1,3)
            rock=trimesh.Trimesh(vertices,np.arange(len(vertices)).reshape(-1,3),process=False)
            rock.visual.vertex_colors=np.concatenate(colors).reshape(-1,4)
            scene.add_geometry(rock,node_name=group+'_limestone',parent_node_name=group)
        for light, parts in model.lamps.items():
            faces,uvs=zip(*parts)
            add(faces,uvs,image,light+'_lit')
        for key, parts in model.tile_parts.items():
            if parts:
                cell = list(SWATCHES).index(key); left,top=128*(cell%4),128*(cell//4)
                add([tri for tri,uv in parts],[uv for tri,uv in parts],image.crop((left,top,left+128,top+128)),key)
        if not level:
            add(model.solid,None,None,'collision_surface')
    scene.export(Path(sys.argv[1])/(name+'.glb'))


if __name__ == '__main__':
    generate()
