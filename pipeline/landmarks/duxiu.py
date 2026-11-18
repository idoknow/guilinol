"""OSM peak 5981119758; use the shipped PK02 rings, not a second mountain.
2012 Duxiu series: gate clearance relative to a visitor ~3 m, stair ~1.6 m
wide. The pavilion footprint is an estimate, not a surveyed summit plan.
"""
import gzip
import json
import math
from pathlib import Path

import numpy as np

from jingjiang import generate


def summit(model):
    world=Path(__file__).resolve().parents[2]/'public/world'
    if not (world/'manifest.json').exists():raise RuntimeError('Run npm run world before building Duxiu')
    manifest=json.loads((world/'manifest.json').read_text())
    peak=next(entry for entry in manifest['peaks']['entries'] if entry['name']=='独秀峰')
    x,height,z=peak['center']; left,top,*_=manifest['extent']; size=manifest['chunkSize']
    col,row=int((x-left)//size),int((z-top)//size)
    ground=gzip.decompress((world/f'{col}_{row}.glc').read_bytes()); stride=size//manifest['grid']+1
    anchor=np.frombuffer(ground,'<i2',stride**2,24).reshape(stride,stride)[round((z-top-row*size)/4),round((x-left-col*size)/4)]/10
    lod=peak['lods'][0]; payload=gzip.decompress((world/manifest['peaks']['file']).read_bytes())
    vertices=np.frombuffer(payload,'<i2',lod['vertices']*3,lod['offset']).reshape(-1,3)/100;vertices[:,1]+=height-anchor
    rings=vertices[:-1].reshape(12,-1,3); tip=vertices[-1]; count=rings.shape[1]
    def tread(progress):
        phase=(.28+progress*1.37)*count; col=int(phase)%count
        level=1+progress*10; row=min(10,int(level)); weight=level-row
        strip=rings[:,col]*(1-phase%1)+rings[:,(col+1)%count]*(phase%1)
        point=strip[row]*(1-weight)+strip[row+1]*weight
        radial=point[[0,2]]-tip[[0,2]];radial/=np.linalg.norm(radial)
        point[[0,2]]+=radial*1.15
        return point,math.atan2(radial[1],radial[0])
    steps=430 if model.detail else 62
    for index in range(steps):
        start,angle=tread(index/steps);end,_=tread((index+1)/steps)
        model.pose=(*((start+end)/2),angle);depth=np.linalg.norm((end-start)[[0,2]])+.12
        model.box(0,-.35,0,2.4,.64,depth,'granite',True)
        if model.detail and index%6==0:
            model.beam([1,.12,0],[1,1.25,0],.09,'stone')
    start,angle=tread(0);model.pose=(*start,angle+math.pi/2)
    model.arcade(0,2.4,10,2.8,5,[0],2,'stone');model.box(0,4.1,4,4,.68,.22,'red')
    if model.detail:
        for col in range(9):
            for line in range(3):model.box(4.9+col*.34,1.4+line*.45,3.9,.14,.33,.08,'red')
    model.pose=(*tip,0);model.box(0,-.25,0,6,.58,6,'granite',True)
    for east in (-2.2,2.2):
        for south in (-2.2,2.2):model.beam([east,0,south],[east,3.6,south],.23,'red',8,True)
    model.roof(0,3.6,0,6.8,6.8,2.1)


if __name__=='__main__':generate('duxiu',summit)
