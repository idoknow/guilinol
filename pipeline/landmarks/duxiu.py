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
from wangcheng_plan import ROOT, ll2xz


def rock_shelter(model):
    samples=41 if model.detail else 15
    widths=np.linspace(-8.6,8.6,samples)
    profile=[(-3.8,1.5,18),(-2.15,1.45,24),(-1.52,2.0,38),(-1.35,2.9,56),
             (-1.17,3.85,91),(-.81,3.95,161),(-.38,3.69,183),(.28,3.4,172),
             (1.21,3.05,188),(2.26,1.82,173),(3.3,-.72,157),(3.85,-4.1,148)]
    vertices=[];colors=[];faces=[]
    for row,(height,depth,light) in enumerate(profile):
        for col,east in enumerate(widths):
            shoulder=np.clip((abs(east)-5.45)/2.85,0,1)
            fold=.14*np.sin(east*1.4+row*.27)+.075*np.sin(east*3.1-row*.31)
            lip_drop=shoulder*(1.9 if row<7 else .72)
            vertices.append([east,height-lip_drop+fold,depth+.25*np.sin(east*.86+row*.22)-1.85*shoulder])
            shade=light+(4 if row<4 else 16)*(np.sin(east*1.79+.35*row)*.6+np.sin(east*4.13-row*.63)*.4)
            linear=255*((np.clip(np.array([shade+1,shade+1,shade]),0,255)/255+.055)/1.055)**2.4
            colors.append([*linear.round().astype(int),255])
            if row and col:
                end=row*samples+col;faces.extend([[end-samples-1,end-samples,end],[end-samples-1,end,end-1]])
    model.mesh(vertices,faces,np.asarray(colors,dtype=np.uint8))
    model.box(0,-4.45,7.15,11,.53,4.8,'pave',True)
    for step in range(4):model.box(0,-4.3,4.75-step*.44,8.8,.52+step*.14,.46,'granite',True)
    model.box(0,-4.2,2.38,9,.84,2.28,'pave',True)
    for east in np.linspace(-4.4,4.4,17):model.box(east,-3.36,3.15,.065,1.35,.07,'tile',True)
    model.box(0,-2.06,3.15,8.85,.085,.085,'tile')
    for east,base in ((-3.4,-.32),(-.9,-.23),(2.5,-.36)):
        front=3.98+.25*np.sin(east*.86+1.5)
        model.box(east,base,front,.82,1.65,.14,'tile')
        if model.detail:
            for line in range(4):
                for column in (-.16,.12):model.box(east+column,base+.25+line*.31,front+.083,.085,.17,.035,'granite')


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
    pois=json.loads((ROOT/'docs/layout/wangcheng.geojson').read_text())['features']
    def cliff_column(name):
        poi=next(f for f in pois if f['properties']['name']==name)
        east,south=ll2xz(*reversed(poi['geometry']['coordinates']))
        offset=rings[1][:,[0,2]]+[x,z]-[east,south]
        return int(np.argmin(np.linalg.norm(offset,axis=1)))
    entrance=cliff_column('太平岩')
    def tread(progress):
        phase=entrance+progress*1.37*count; col=int(phase)%count
        level=1+progress*10; row=min(10,int(level)); weight=level-row
        strip=rings[:,col]*(1-phase%1)+rings[:,(col+1)%count]*(phase%1)
        point=strip[row]*(1-weight)+strip[row+1]*weight
        radial=point[[0,2]]-tip[[0,2]];radial/=np.linalg.norm(radial)
        point[[0,2]]+=radial*1.15
        return point,math.atan2(radial[1],radial[0])
    steps=306 if model.detail else 45
    for index in range(steps):
        start,angle=tread(index/steps);end,_=tread((index+1)/steps)
        model.pose=(*((start+end)/2),angle);depth=np.linalg.norm((end-start)[[0,2]])+.12
        support=2.1+3.6*math.sin(math.pi*index/steps)
        model.box(-.65,-support,0,3.7,support+.29,depth+.35,'stone',True)
        model.box(0,.23,0,2.5,.08,depth+.22,'granite',True)
        if model.detail and index%6==0:
            model.beam([1,.12,0],[1,1.25,0],.09,'stone')
    start,angle=tread(0);model.pose=(*start,angle-math.pi/2)
    rock_shelter(model)  # Taiping Cave, west foot at the stair entrance.
    southeast = rings[1,cliff_column('读书岩')]
    model.pose = (*southeast, -math.pi/4)
    rock_shelter(model)  # Dushu Cave and cliff inscriptions, southeast foot.
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
