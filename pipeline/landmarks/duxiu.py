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
    steps=430 if model.detail else 45
    for index in range(steps):
        start,angle=tread(index/steps);end,_=tread((index+1)/steps)
        model.pose=(*((start+end)/2),angle);depth=np.linalg.norm((end-start)[[0,2]])+.12
        support=2.1+3.6*math.sin(math.pi*index/steps)
        model.box(-.65,-support,0,3.7,support+.29,depth+.35,'stone',True)
        model.box(0,.23,0,2.5,.08,depth+.22,'granite',True)
        if model.detail and index%6==0:
            model.beam([1,.12,0],[1,1.25,0],.09,'stone')
    start,angle=tread(0);model.pose=(*start,angle-math.pi/2)
    lip=[(-6,-1),(-5.4,2.2),(-4.1,3.75),(-1.8,4.2),(.4,3.8),(2.7,3.7),(4.6,2.85),(5.4,-1)]
    for index,((left,low),(right,high)) in enumerate(zip(lip,lip[1:])):
        front=2.8+.35*math.cos(index*2);back=-1.35
        model.mesh([(left,low,front),(right,high,front),(right,high-.55,back),(left,low-.55,back)],[[0,1,2],[0,2,3]],'sign')
        model.mesh([(left,low,front),(right,high,front),(right*1.27,high+2.4,front-.7),(left*1.27,low+2.4,front-.7), (right*1.4,high+3.1,-2.8),(left*1.4,low+3.1,-2.8)],[[0,1,2],[0,2,3],[3,2,4],[3,4,5]],'stone')
    model.box(0,-1,-1.5,10,5,.32,'sign',True)
    for east in np.linspace(-4,4,15):model.box(east,-.4,2.6,.065,1.9,.07,'tile',True)
    model.box(0,1.35,2.6,8.4,.11,.09,'tile')
    for east,height in ((-3,4.9),(0,4.6),(2.7,4.55)):
        model.box(east,height,2.25,1.9,1.1,.18,'tile')
        if model.detail:
            for mark in range(5):model.box(east+(mark-2)*.28,height+.18,2.37,.09,.54,.045,'white')
    model.pose=(*tip,0)
    def ring(radius,height):return [(radius*math.cos(n*math.pi/4),height,radius*math.sin(n*math.pi/4)) for n in range(8)]
    model.beam([0,-2.8,0],[0,.48,0],5.2,'stone',8,True)
    for index,(east,_,south) in enumerate(ring(4.8,.48)):
        nxt=ring(4.8,1.56)[(index+1)%8];model.beam([east,.48,south],[east,1.7,south],.16,'white')
        if index!=4:model.beam([east,1.48,south],nxt,.12,'white')
    for east,_,south in ring(2.75,.48):
        model.beam([east,.48,south],[east,5.25,south],.22,'red',8,True)
        model.box(east,3.25,south,.68,.45,.68,'wood')
    for bottom,radius,rise in ((3.45,4.25,1.8),(5.18,3.45,2.9)):
        for index in range(8):
            angle=index*math.pi/4;angles=np.array([angle,angle+math.pi/8,angle+math.pi/4]);rings=[]
            for scale,lift,curve in ((1,-.27,.93),(1,0,.93),(.75,.3,.25),(.34,rise*.65,.04),(.06,rise,0)):
                rings.append([(radius*scale*math.cos(a),bottom+lift+curve*(i!=1),radius*scale*math.sin(a)) for i,a in enumerate(angles)])
            for row in range(4):
                for col in range(2):model.mesh([rings[row][col],rings[row][col+1],rings[row+1][col+1],rings[row+1][col]],[[0,1,2],[0,2,3]],'red' if row==0 else 'tile')
    model.beam([0,7.8,0],[0,8.8,0],.19,'gold',8)


if __name__=='__main__':generate('duxiu',summit)
