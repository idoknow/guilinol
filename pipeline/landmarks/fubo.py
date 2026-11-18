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


def mountain(name):
    root=Path(__file__).resolve().parents[2]/'public/world'
    manifest=json.loads((root/'manifest.json').read_text())
    peak=next(entry for entry in manifest['peaks']['entries'] if entry['name']==name)
    east,summit,south=peak['center'];left,top,*_=manifest['extent']
    col,row=int((east-left)//256),int((south-top)//256)
    tile=gzip.decompress((root/f'{col}_{row}.glc').read_bytes())
    level=np.frombuffer(tile,'<i2',4225,24).reshape(65,65)[round((south-top-row*256)/4),round((east-left-col*256)/4)]/10
    lod=peak['lods'][0];payload=gzip.decompress((root/manifest['peaks']['file']).read_bytes())
    vertices=np.frombuffer(payload,'<i2',lod['vertices']*3,lod['offset']).reshape(-1,3)/100
    vertices[:,1]+=summit-level
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
    rings,tip=mountain('伏波山');model.pose=(*tip,0);pavilion(model,5.2,3.6)
    east=rings[1,:,0].argmax();base=rings[1,east].copy();base[0]+=5
    model.pose=(*base,-math.pi/2);grotto(model,5.3,4.2,6)
    model.beam([1,.35,3],[.8,4.1,3.4],.72,'stone',7,True)
    model.pose=(base[0]+1.5,base[1],base[2]+15,0);pavilion(model,6.4,4)
    model.pose=(base[0]-1,base[1],base[2]+31,0)
    model.arcade(0,0,14,2.7,4.3,[0],2.3,'brick');model.swept_roof(0,4.45,0,16,5,2.1)
    model.box(0,3.35,1.45,2.6,.68,.14,'sign')
    model.pose=(0,0,0,0)
    # Rock mantle follows the existing east wall, leaving the cave aperture free.
    columns=55 if model.detail else 12;rows=40 if model.detail else 7
    vertices=[];faces=[]
    for row in range(rows+1):
        layer=1+8*row/rows;lower=int(layer);weight=layer-lower
        for col in range(columns+1):
            phase=(east+(col/columns-.5)*29)%rings.shape[1];idx=int(phase);frac=phase-idx
            strip=rings[:,idx]*(1-frac)+rings[:,(idx+1)%rings.shape[1]]*frac
            point=strip[lower]*(1-weight)+strip[min(11,lower+1)]*weight
            point[0]+=.9+.5*math.cos(phase*3)+.17*math.sin(row*.7+phase)
            vertices.append(point)
            if row and col:
                at=len(vertices)-1;faces.extend([[at-columns-2,at-1,at],[at-columns-2,at,at-columns-1]])
    model.mesh(vertices,faces,'stone')


if __name__=='__main__':generate('fubo',build,'F')
