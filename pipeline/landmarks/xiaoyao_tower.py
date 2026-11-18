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
                    model.box(east, base+1.05, half-1.4, width-.14, height-1.35, .12, 'glass', True)
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
    model.box(0,-.2,0,22,1.56,22,'stone',True)
    for side in (-1,1):
        for step in range(8):
            model.box(0,-.04,side*(11+(7.5-step)*.34),6,.04+(step+1)*.17,.34,'pave',True)
    facade(model,1.36,8.5,5.9,False)
    model.swept_roof(0,7.25,0,22,22,2.55)
    model.box(0,9.65,0,16.8,.45,16.8,'pave',True)
    facade(model,10.1,6.85,5.45,True)
    model.swept_roof(0,15.55,0,18.9,18.9,2.9)
    model.box(0,18.05,0,11.4,1.2,10.6,'wood')
    model.swept_roof(0,19.25,0,15.5,14.9,4.15)


def generate():
    image = atlas()
    target = Path(__file__).resolve().parents[2]/'public/textures/landmarks/E'
    target.mkdir(parents=True, exist_ok=True)
    image.save(target/'timber-and-tile.png', optimize=True)
    scene = trimesh.Scene()
    for level in (0,1):
        model = Model(level==0)
        tower(model)
        group = f'lod{level}'
        scene.graph.update(frame_to=group)
        def add(parts, uvs, texture, name):
            vertices = np.concatenate(parts).reshape(-1,3)
            mesh = trimesh.Trimesh(vertices, np.arange(len(vertices)).reshape(-1,3), process=False)
            if texture is not None:
                material = trimesh.visual.material.PBRMaterial(name=name,baseColorTexture=texture,roughnessFactor=1,metallicFactor=0,doubleSided=True)
                mesh.visual = trimesh.visual.TextureVisuals(uv=np.concatenate(uvs).reshape(-1,2),material=material)
            scene.add_geometry(mesh,node_name=group+'_'+name if texture else 'collision_surface',parent_node_name=group if texture else scene.graph.base_frame)
        add(model.visible,model.uv,image,'joinery')
        for key, parts in model.tile_parts.items():
            if parts:
                cell = list(SWATCHES).index(key); left,top=128*(cell%4),128*(cell//4)
                add([tri for tri,uv in parts],[uv for tri,uv in parts],image.crop((left,top,left+128,top+128)),key)
        if not level:
            add(model.solid,None,None,'collision_surface')
    scene.export(Path(sys.argv[1])/'xiaoyao_tower.glb')


if __name__ == '__main__':
    generate()
