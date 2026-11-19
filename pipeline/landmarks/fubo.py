"""OSM peak 1618571712 (213 m), park 485320268. East face on the Li.
Mount follows the actual PK02 summit and east flank. Shore galleries and
the pearl cave are approximations from visitor-scale references (~3 m clear).
"""
import gzip
import json
import math
from pathlib import Path

import numpy as np
from xiaoyao_tower import generate
from c_kit import landmark_surface


def mountain(name):
    root=Path(__file__).resolve().parents[2]/'public/world'
    manifest=json.loads((root/'manifest.json').read_text())
    peak=next(entry for entry in manifest['peaks']['entries'] if entry['name']==name)
    # PK02 vertices are relative to the peak center. The GLB is mounted at
    # its landmark anchor, which can be tens of metres away from the summit.
    surface=landmark_surface({'伏波山':'fubo','明月峰':'diecai'}[name])
    lod=peak['lods'][0];payload=gzip.decompress((root/manifest['peaks']['file']).read_bytes())
    vertices=np.frombuffer(payload,'<i2',lod['vertices']*3,lod['offset']).reshape(-1,3)/100
    vertices += np.subtract(peak['center'],[surface.x,surface.y,surface.z])
    return vertices[:-1].reshape(12,-1,3),vertices[-1]


def pavilion(model,width,height):
    model.box(0,-.65,0,width+1.5,.75,width+1.5,'pave',True)
    for side in (-1,1):
        for end in (-1,1):
            east,south=side*width*.38,end*width*.38
            model.beam([east,.1,south],[east,height,south],.21,'red',8 if model.detail else 4,True)
            if model.detail:
                for tier in range(3):model.box(east,height-.65+tier*.21,south,.48+tier*.35,.2,.52+tier*.32,'wood')
        model.box(0,height-.35,side*width*.38,width-.5,.38,.38,'red')
    model.swept_roof(0,height,0,width+1.8,width+1.8,width*.3)


def grotto(model,half,height,depth):
    sections=32 if model.detail else 8
    for index in range(sections):
        angles=np.pi*np.array([index,index+1])/sections
        points=[]
        for back in (0,depth):
            for radius in (1,1.55):
                for angle in angles:
                    rough=.12*math.sin(7*angle+back*.13)
                    points.append([half*radius*math.cos(angle),height*radius*math.sin(angle)+rough,back])
        model.mesh(points,[[0,1,3],[0,3,2],[4,7,5],[4,6,7],[0,4,5],[0,5,1],[2,3,7],[2,7,6]],'stone',True)
    model.box(0,-.3,depth*.5,half*2+.5,.3,depth+2,'pave',True)


def build(model):
    surface=landmark_surface('fubo')
    rings,tip=mountain('伏波山');model.pose=(*tip,0);pavilion(model,5.2,3.6)
    base=rings[1,0].copy();base[0]=rings[2,0,0]
    model.pose=(*base,math.pi/2)
    model.beam([1,-.85,6],[.8,3.5,6.4],.72,'granite',7,True)
    model.pose=(base[0]+1.5,surface.ground(base[0]+1.5,base[2]+15),base[2]+15,0);pavilion(model,6.4,4)
    model.pose=(base[0]-1,surface.ground(base[0]-1,base[2]+31),base[2]+31,0)
    model.arcade(0,0,14,2.7,4.3,[0],2.3,'brick');model.swept_roof(0,4.45,0,16,5,2.1)
    model.box(0,3.35,1.45,2.6,.68,.14,'sign')
    model.pose=(0,0,0,0)
    for index in range(19):
        south=base[2]-19+index*2
        shore=base[0]+7.1-.006*(south-base[2])**2
        ground,water=surface.sample(shore,south)
        deck=max(ground+.45,water+.75 if water is not None else ground+.45)
        model.box(shore,deck-.34,south,3.25,.34,2.04,'wood',True)
        model.box(shore+1.49,deck,south,.14,1.08,.14,'red',True)
        model.box(shore+1.49,deck+.98,south,.14,.14,2.14,'wood',True)
        for side in (-1,1):
            px=shore+side*1.25
            bed=surface.ground(px,south)-.10
            model.beam([px,bed,south],[px,deck-.29,south],.21,'wood',8)
        if model.detail:
            for offset in np.linspace(-.88,.88,8):
                model.box(shore,deck,south+offset,3.28,.06,.22,'wood')
                model.box(shore+1.49,deck+.12,south+offset,.065,.82,.065,'red')


if __name__=='__main__':generate('fubo',build,'F')
